import { Command } from 'commander';
import * as p from '@clack/prompts';
import { access, readFile } from 'fs/promises';
import { basename } from 'path';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError, AuthError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listRoasts, getRoast, createRoast, deleteRoast, updateRoast } from '../lib/roast.js';
import type {
  RoastProfile,
  TemperatureEntry,
  RoastEventEntry,
  ImportRoastResult,
} from '../lib/roast.js';
import { pickBean, guardCancel } from '../lib/interactive/forms.js';
import { normalizePathInput } from '../lib/path-input.js';
import { startWatch, loadWatchSession } from '../lib/interactive/watch.js';
import { getConfigValue } from '../lib/config.js';
import { createParchmentClient, unwrapParchment } from '../lib/parchment.js';
import type { components } from '@purveyors/sdk';
import type { OutputOptions } from '../types/index.js';

/** Canonical `POST /v1/roasts/imports` response payload. */
type RoastImportPayload = components['schemas']['RoastImportResponse'];

// Re-export types for backwards compatibility
export type { RoastProfile, TemperatureEntry, RoastEventEntry };

/**
 * Map the canonical Parchment `roasts.import` response onto the CLI's existing
 * {@link ImportRoastResult} output shape, so `--pretty` and machine output stay
 * stable now that Artisan parsing and persistence happen server-side.
 *
 * `RoastDetailResource` surfaces only charge / first-crack / drop as top-level
 * time columns, but the full Artisan milestone set (dry-end, second-crack
 * start/end, cool) is persisted as milestone roast events. Recover those from
 * `roast.events` so JSON and `--pretty` output keep the same milestone timing
 * the pre-SDK local importer exposed, without re-parsing the `.alog` locally.
 */
export function mapSdkImportResult(
  payload: RoastImportPayload,
  fallbackCoffeeId: number,
  fallbackBatchName: string
): ImportRoastResult {
  const roast = payload.data.roast;
  const summary = payload.data.import;

  const milestones: ImportRoastResult['milestones'] = {};
  if (roast.charge_time != null) milestones.charge = roast.charge_time;
  if (roast.fc_start_time != null) milestones.fc_start = roast.fc_start_time;
  if (roast.fc_end_time != null) milestones.fc_end = roast.fc_end_time;
  if (roast.drop_time != null) milestones.drop = roast.drop_time;

  // Fill any remaining markers (notably dry_end / sc_start / sc_end / cool,
  // which have no dedicated column) from the canonical milestone events. The
  // top-level columns above win; events only backfill gaps.
  const MILESTONE_KEYS: ReadonlyArray<keyof ImportRoastResult['milestones']> = [
    'charge',
    'dry_end',
    'fc_start',
    'fc_end',
    'sc_start',
    'sc_end',
    'drop',
    'cool',
  ];
  for (const event of roast.events ?? []) {
    const key = event.event_string as keyof ImportRoastResult['milestones'] | null;
    if (
      key != null &&
      MILESTONE_KEYS.includes(key) &&
      milestones[key] == null &&
      event.time_seconds != null
    ) {
      milestones[key] = event.time_seconds;
    }
  }

  const totalTime = roast.total_roast_time ?? 0;
  const temperatureUnit: 'F' | 'C' = roast.temperature_unit === 'C' ? 'C' : 'F';

  return {
    success: true,
    message: `Imported ${summary.temperaturePoints} data points, ${summary.milestoneEvents} milestones, ${summary.controlEvents} control events`,
    milestones,
    phases: {
      drying_percent: roast.dry_percent ?? 0,
      maillard_percent: roast.maillard_percent ?? 0,
      development_percent: roast.development_percent ?? 0,
      total_time_seconds: totalTime,
    },
    total_time: totalTime,
    temperature_unit: temperatureUnit,
    milestone_events: summary.milestoneEvents,
    control_events: summary.controlEvents,
    roast_id: roast.roast_id,
    batch_name: roast.batch_name ?? fallbackBatchName,
    coffee_name: roast.coffee_name ?? '',
    coffee_id: roast.coffee_id ?? fallbackCoffeeId,
  };
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey roast` — Browse and manage your roast profiles.
 * Requires member+ authentication.
 */
export function buildRoastCommand(): Command {
  const roast = new Command('roast').description('Browse and manage your roast profiles');

  // ── roast list ────────────────────────────────────────────────────────────
  roast
    .command('list')
    .description('List your roast profiles, sorted by date (newest first)')
    .option('--coffee-id <id>', 'Filter by green_coffee_inv ID')
    .option('--roast-id <id>', 'Filter by roast profile ID')
    .option('--batch-name <text>', 'Filter by batch name (partial match, case-insensitive)')
    .option('--coffee-name <text>', 'Filter by bean name (partial match, case-insensitive)')
    .option('--date-start <YYYY-MM-DD>', 'Only show roasts on or after this date')
    .option('--date-end <YYYY-MM-DD>', 'Only show roasts on or before this date')
    .option('--stocked', 'Only show roasts for currently stocked beans')
    .option('--catalog-id <id>', 'Filter by coffee_catalog ID')
    .option('--limit <n>', 'Maximum results to return', '20')
    .option('--offset <n>', 'Skip N results (for pagination)', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast list --pretty
  purvey roast list --coffee-id 7 --pretty
  purvey roast list --roast-id 123 --pretty
  purvey roast list --batch-name "Ethiopia Guji" --pretty
  purvey roast list --coffee-name "Ethiopia" --pretty
  purvey roast list --date-start 2026-03-01 --date-end 2026-03-31
  purvey roast list --stocked --limit 10
  purvey roast list --catalog-id 128 --pretty
  purvey roast list --limit 5 | jq '.[].roast_id'
  purvey roast list --csv > roasts.csv
  purvey roast list --limit 20 --offset 20   # page 2

Notes:
  --coffee-id filters by inventory item (green_coffee_inv.id), not catalog_id.
  --roast-id filters by the exact roast profile ID while preserving list output shape.
  --catalog-id filters by coffee_catalog ID (cross-reference from catalog search).
  --batch-name accepts partial matches (case-insensitive).
  --coffee-name accepts partial matches on the bean name (case-insensitive).
  --date-start and --date-end accept YYYY-MM-DD format; use together for a range.
  --stocked only returns roasts for beans currently marked as stocked in inventory.
  --offset + --limit enables pagination through large result sets.
  Returns roast_id, batch_name, roast_date, oz_in, oz_out, and bean details.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        // Parse --date-start and --date-end format
        const dateStart = opts.dateStart as string | undefined;
        const dateEnd = opts.dateEnd as string | undefined;
        if (dateStart && !/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --date-start: "${dateStart}". Must be YYYY-MM-DD format.`
          );
        }
        if (dateEnd && !/^\d{4}-\d{2}-\d{2}$/.test(dateEnd)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --date-end: "${dateEnd}". Must be YYYY-MM-DD format.`
          );
        }

        // Parse exact-id filters
        let roastId: number | undefined;
        if (opts.roastId !== undefined) {
          roastId = parseInt(opts.roastId as string, 10);
          if (isNaN(roastId) || roastId <= 0) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --roast-id: "${opts.roastId}". Must be a positive integer.`
            );
          }
        }

        let catalogId: number | undefined;
        if (opts.catalogId !== undefined) {
          catalogId = parseInt(opts.catalogId as string, 10);
          if (isNaN(catalogId) || catalogId <= 0) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --catalog-id: "${opts.catalogId}". Must be a positive integer.`
            );
          }
        }

        const offsetVal = parseInt(opts.offset as string, 10);
        const data = await listRoasts(supabase, userId, {
          coffee_id:
            opts.coffeeId !== undefined ? parseInt(opts.coffeeId as string, 10) : undefined,
          roast_id: roastId,
          batch_name: opts.batchName as string | undefined,
          coffee_name: opts.coffeeName as string | undefined,
          date_start: dateStart,
          date_end: dateEnd,
          stocked_only: opts.stocked === true ? true : undefined,
          catalog_id: catalogId,
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
          offset: isNaN(offsetVal) || offsetVal < 0 ? 0 : offsetVal,
        });

        if (data.length === 0) {
          info('No roast profiles found.');
          return;
        }

        outputData(data, globalOpts);
      })
    );

  // ── roast get <id> ────────────────────────────────────────────────────────
  roast
    .command('get <id>')
    .description('Fetch a single roast profile by roast_id')
    .option('--include-temps', 'Include temperature curve data (roast_temperatures)')
    .option('--include-events', 'Include roast events (roast_events)')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast get 123 --pretty
  purvey roast get 123 --include-temps --pretty
  purvey roast get 123 --include-events | jq '.events'
  purvey roast get 123 --include-temps --include-events --csv

Notes:
  <id> is roast_data.roast_id (integer).
  --include-temps adds the full temperature curve array (can be large).
  --include-events adds roast event markers (FC start, drop, etc.).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        const data = await getRoast(supabase, userId, parseInt(id, 10), {
          includeTemps: Boolean(opts.includeTemps),
          includeEvents: Boolean(opts.includeEvents),
        });

        outputData(data, globalOpts);
      })
    );

  // ── roast create ──────────────────────────────────────────────────────────
  roast
    .command('create')
    .description('Create a new roast profile')
    .option('--coffee-id <id>', '[REQUIRED] green_coffee_inv ID for this roast')
    .option('--batch-name <name>', "Batch name (defaults to coffee name + today's date)")
    .option('--oz-in <oz>', 'Green weight in ounces')
    .option('--oz-out <oz>', 'Roasted weight in ounces')
    .option('--roast-date <YYYY-MM-DD>', 'Roast date (defaults to today)')
    .option('--notes <text>', 'Roast notes')
    .option('--form', 'Interactive form mode (browse and select bean)')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast create --coffee-id 7 --pretty
  purvey roast create --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz-in 16
  purvey roast create --coffee-id 42 --oz-in 12 --oz-out 9.8 --roast-date 2026-03-15
  purvey roast create --coffee-id 7 --notes "Extended drying phase, aimed for medium roast"
  purvey roast create --form     # interactive wizard

Required flags: --coffee-id (green_coffee_inv.id)
  Use 'purvey inventory list' to find your --coffee-id.
  Prefer 'purvey roast import' if you have an Artisan .alog file.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        // ── Interactive form mode ──────────────────────────────────────────
        // Auto-enter form mode if config form-mode is true and required args are missing
        const formMode =
          opts.form ||
          (!(opts.coffeeId && opts.roastDate) && (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
          p.intro('Create Roast Profile');

          const bean = await pickBean(supabase, userId);

          const today = todayIso();
          const defaultBatch = `${bean.name} ${today}`;

          const batchNameRaw = await p.text({
            message: 'Batch name',
            placeholder: defaultBatch,
            defaultValue: defaultBatch,
          });
          guardCancel(batchNameRaw);

          const ozInRaw = await p.text({
            message: 'Weight in (oz)',
            placeholder: 'optional',
            validate: (v) => {
              if (!v || v.trim() === '') return;
              const n = parseFloat(v);
              if (isNaN(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(ozInRaw);

          const notesRaw = await p.text({
            message: 'Roast notes',
            placeholder: 'optional',
          });
          guardCancel(notesRaw);

          const targetsRaw = await p.text({
            message: 'Roast targets',
            placeholder: 'optional',
          });
          guardCancel(targetsRaw);

          const confirmed = await p.confirm({ message: 'Create this roast?' });
          guardCancel(confirmed);

          if (!confirmed) {
            p.cancel('Aborted.');
            return;
          }

          const ozInStr = String(ozInRaw).trim();
          const ozIn = ozInStr !== '' ? parseFloat(ozInStr) : undefined;

          const notesStr = String(notesRaw).trim();
          const targetsStr = String(targetsRaw).trim();
          const combinedNotes =
            [notesStr, targetsStr ? `Targets: ${targetsStr}` : ''].filter(Boolean).join('\n') ||
            undefined;

          const spin = p.spinner();
          spin.start('Creating roast profile...');
          const data = await createRoast(supabase, userId, {
            coffeeId: bean.id,
            batchName: String(batchNameRaw).trim() || defaultBatch,
            ozIn,
            roastDate: today,
            notes: combinedNotes,
          });
          spin.stop('Done');

          p.outro(`Roast profile created! Roast #${data.roast_id}.`);
          outputData(data, globalOpts);
          return;
        }

        // ── Flag-based mode ────────────────────────────────────────────────
        if (!opts.coffeeId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --coffee-id. Use --form for interactive mode.'
          );
        }

        const coffeeId = parseInt(opts.coffeeId as string, 10);
        if (isNaN(coffeeId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid --coffee-id: "${opts.coffeeId}".`);
        }

        let ozIn: number | undefined;
        if (opts.ozIn !== undefined) {
          ozIn = parseFloat(opts.ozIn as string);
          if (isNaN(ozIn) || ozIn <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
        }

        let ozOut: number | undefined;
        if (opts.ozOut !== undefined) {
          ozOut = parseFloat(opts.ozOut as string);
          if (isNaN(ozOut) || ozOut <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
        }

        const data = await createRoast(supabase, userId, {
          coffeeId,
          batchName: opts.batchName as string | undefined,
          ozIn,
          ozOut,
          roastDate: (opts.roastDate as string | undefined) ?? todayIso(),
          notes: opts.notes as string | undefined,
        });

        success(`Roast profile ${data.roast_id} created.`);
        outputData(data, globalOpts);
      })
    );

  // ── roast update <id> ─────────────────────────────────────────────────────
  roast
    .command('update <id>')
    .description('Update an existing roast profile (must be yours)')
    .option('--notes <text>', 'Updated roast notes')
    .option('--oz-out <oz>', 'Updated roasted weight (oz) — triggers weight loss recalculation')
    .option('--batch-name <name>', 'Updated batch name')
    .option('--targets <text>', 'Updated roast targets')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast update 123 --notes "Extended drying phase"
  purvey roast update 123 --oz-out 12.5
  purvey roast update 123 --batch-name "Ethiopia Guji Light #3"
  purvey roast update 123 --targets "Aim for FC at 390F, 18% dev"
  purvey roast update 123 --notes "Great roast" --oz-out 10.2

Notes:
  At least one flag required. Pass only the fields you want to change.
  --oz-out triggers automatic weight_loss_percent recalculation if oz_in exists.
  --targets updates the roast_targets column (planning/goals for the roast).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const { supabase, userId } = await requireAuth('member');

        const roastId = parseInt(id, 10);
        if (isNaN(roastId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid roast ID: "${id}".`);
        }

        let ozOut: number | undefined;
        if (opts.ozOut !== undefined) {
          ozOut = parseFloat(opts.ozOut as string);
          if (isNaN(ozOut) || ozOut <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
        }

        if (
          opts.notes === undefined &&
          ozOut === undefined &&
          opts.batchName === undefined &&
          opts.targets === undefined
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --notes, --oz-out, --batch-name, --targets.'
          );
        }

        const data = await updateRoast(supabase, userId, roastId, {
          notes: opts.notes as string | undefined,
          ozOut,
          batchName: opts.batchName as string | undefined,
          targets: opts.targets as string | undefined,
        });

        success(`Roast profile ${roastId} updated.`);
        outputData(data, globalOpts);
      })
    );

  // ── roast delete <id> ─────────────────────────────────────────────────────
  roast
    .command('delete <id>')
    .description('Delete a roast profile (must be yours)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast delete 123           # prompts for confirmation
  purvey roast delete 123 --yes     # skip confirmation (use in scripts)

Notes:
  Permanently deletes the roast profile and associated temperature/event data.
  Cannot be undone. Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const { supabase, userId } = await requireAuth('member');

        const roastId = parseInt(id, 10);
        if (isNaN(roastId)) {
          throw new PrvrsError('INVALID_ARGUMENT', `Invalid roast ID: "${id}".`);
        }

        if (!opts.yes) {
          const ok = await confirm(`Delete roast profile #${roastId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        await deleteRoast(supabase, userId, roastId);
        success(`Roast profile ${roastId} deleted.`);
      })
    );

  // ── roast import <file> ───────────────────────────────────────────────────
  roast
    .command('import')
    .description('Import an Artisan .alog file and create a new roast profile')
    .argument('[file]', 'Path to .alog file (or use --form for interactive mode)')
    .option('--coffee-id <id>', '[REQUIRED] green_coffee_inv ID for this roast')
    .option('--batch-name <name>', 'Batch name (auto-generated from coffee name + date if omitted)')
    .option('--oz-in <oz>', 'Green weight in ounces (extracted from .alog if omitted)')
    .option('--roast-notes <notes>', 'Additional roast notes')
    .option('--roast-targets <targets>', 'Roast targets to store with the import')
    .option('--form', 'Interactive form mode (browse and select bean)')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast import ~/artisan/ethiopia-guji.alog --coffee-id 7 --pretty
  purvey roast import roast.alog --coffee-id 42 --oz-in 16
  purvey roast import roast.alog --coffee-id 7 --batch-name "Ethiopia Guji #3" --roast-notes "Faster development"
  purvey roast import roast.alog --coffee-id 7 --roast-targets "Aim for 18% development"
  purvey roast import --form     # interactive wizard (browse files + select bean)

Required: <file> path and --coffee-id (unless using --form)
  .alog files are exported from Artisan roast logging software.
  Imports temperature curve, roast events, and milestone timing.
  oz-in is auto-extracted from the .alog file if present; --oz-in overrides it.
  Use 'purvey inventory list' to find your --coffee-id.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(
        async (file: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;

          // ── Interactive form mode ────────────────────────────────────────
          // Auto-enter form mode if config form-mode is true and required args are missing
          const importFormMode =
            opts.form || (!file && (await getConfigValue('form-mode')) === 'true');
          if (importFormMode) {
            p.intro('Import Artisan Roast');

            const filePathRaw = await p.text({
              message: 'Path to .alog file',
              placeholder: '/path/to/roast.alog',
              validate: (v) => {
                if (!v || String(v).trim() === '') return 'Please enter a file path.';
              },
            });
            guardCancel(filePathRaw);

            const filePath = normalizePathInput(String(filePathRaw));

            // Validate file exists (async check after prompt)
            try {
              await access(filePath);
            } catch {
              p.cancel(`File not found: "${filePath}"`);
              process.exit(1);
            }

            // Authenticate
            const { supabase, userId } = await requireAuth('member');

            const bean = await pickBean(supabase, userId);

            const today = todayIso();
            const defaultBatch = `${bean.name} ${today}`;

            const batchNameRaw = await p.text({
              message: 'Batch name',
              placeholder: defaultBatch,
              defaultValue: defaultBatch,
            });
            guardCancel(batchNameRaw);

            const ozInRaw = await p.text({
              message: 'Weight in (oz)',
              placeholder: 'optional — extracted from .alog if omitted',
              validate: (v) => {
                if (!v || v.trim() === '') return;
                const n = parseFloat(v);
                if (isNaN(n) || n <= 0) return 'Must be a positive number.';
              },
            });
            guardCancel(ozInRaw);

            const roastNotesRaw = await p.text({
              message: 'Roast notes',
              placeholder: 'optional',
            });
            guardCancel(roastNotesRaw);

            const roastTargetsRaw = await p.text({
              message: 'Roast targets',
              placeholder: 'optional',
            });
            guardCancel(roastTargetsRaw);

            const confirmed = await p.confirm({ message: 'Import this roast?' });
            guardCancel(confirmed);

            if (!confirmed) {
              p.cancel('Aborted.');
              return;
            }

            const fileContent = await readFile(filePath, 'utf-8');
            const fileName = basename(filePath);

            const ozInStr = String(ozInRaw).trim();
            const ozIn = ozInStr !== '' ? parseFloat(ozInStr) : undefined;
            const batchName = String(batchNameRaw).trim() || defaultBatch;
            const notesStr = String(roastNotesRaw).trim();
            const targetsStr = String(roastTargetsRaw).trim();

            const spin = p.spinner();
            spin.start('Importing roast data...');
            // Parse + persist happen server-side via the canonical Parchment
            // API. `bean` was resolved through the authenticated Supabase
            // session above (pickBean), so the import must run under that same
            // session identity. Pin the request to the session access token
            // instead of letting an exported PARCHMENT_API_KEY/PURVEYORS_API_KEY
            // for another account authorize an import against a coffeeId owned
            // by the session user.
            const {
              data: { session: formSession },
            } = await supabase.auth.getSession();
            if (!formSession?.access_token) {
              throw new AuthError('Session expired mid-import. Run `purvey auth login` and retry.');
            }
            const client = await createParchmentClient('member', formSession.access_token);
            const payload = unwrapParchment(
              await client.roasts.import({
                fileContent,
                fileName,
                coffeeId: bean.id,
                batchName,
                ozIn,
                roastNotes: notesStr !== '' ? notesStr : undefined,
                roastTargets: targetsStr !== '' ? targetsStr : undefined,
                fileSize: Buffer.byteLength(fileContent, 'utf-8'),
              }),
              'roast import'
            );
            const result = mapSdkImportResult(payload, bean.id, batchName);
            spin.stop('Done');

            p.outro(`Roast imported! Profile #${result.roast_id} created.`);
            outputData(result, globalOpts);
            return;
          }

          // ── Flag-based mode ──────────────────────────────────────────────
          if (!file) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              'Missing file argument. Use --form for interactive mode.'
            );
          }

          // 1. Validate file exists and is readable
          const filePath = normalizePathInput(file);

          try {
            await access(filePath);
          } catch {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `File not found or not readable: "${filePath}"`
            );
          }

          // 2. Read file content
          const fileContent = await readFile(filePath, 'utf-8');
          const fileName = basename(filePath);

          // 3. Parse --coffee-id
          if (!opts.coffeeId) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              'Missing --coffee-id. Use --form for interactive mode.'
            );
          }

          const coffeeId = parseInt(opts.coffeeId as string, 10);
          if (isNaN(coffeeId) || coffeeId <= 0) {
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --coffee-id: "${opts.coffeeId}".`);
          }

          // 4. Parse --oz-in if provided
          let ozIn: number | undefined;
          if (opts.ozIn !== undefined) {
            ozIn = parseFloat(opts.ozIn as string);
            if (isNaN(ozIn) || ozIn <= 0) {
              throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
            }
          }

          const roastTargets =
            typeof opts.roastTargets === 'string' && opts.roastTargets.trim() !== ''
              ? opts.roastTargets.trim()
              : undefined;

          // 5. Run the import via the canonical Parchment API. The server
          // parses the raw .alog, creates the roast, and persists the curve +
          // events atomically; identity is resolved from the bearer token
          // (session JWT or owner-bound API key), so there is no local write.
          const client = await createParchmentClient('member');
          const payload = unwrapParchment(
            await client.roasts.import({
              fileContent,
              fileName,
              coffeeId,
              batchName: opts.batchName as string | undefined,
              ozIn,
              roastNotes: opts.roastNotes as string | undefined,
              roastTargets,
              fileSize: Buffer.byteLength(fileContent, 'utf-8'),
            }),
            'roast import'
          );
          const result = mapSdkImportResult(payload, coffeeId, (opts.batchName as string) ?? '');

          // 6. Output
          if (globalOpts.pretty) {
            printImportPretty(result, coffeeId);
          } else {
            success(`Roast profile ${result.roast_id} imported from ${fileName}.`);
            outputData(result, globalOpts);
          }
        }
      )
    );

  // ── roast watch <directory> ───────────────────────────────────────────────
  roast
    .command('watch')
    .description('Watch a directory for new .alog files and queue or auto-import them')
    .argument('[directory]', 'Directory to watch for .alog files')
    .option(
      '--coffee-id <id>',
      '[REQUIRED unless --auto-match] green_coffee_inv ID for all imports'
    )
    .option(
      '--batch-prefix <name>',
      'Batch name prefix for auto-named batches (defaults to coffee name)'
    )
    .option(
      '--prompt-each',
      'Prompt for bean selection on each new file (instead of using --coffee-id)'
    )
    .option(
      '--auto-match',
      'Use AI to auto-match beans per file (mutually exclusive with --coffee-id)'
    )
    .option('--commit-mode <mode>', 'Commit mode: batch (default) or individual')
    .option('--oz-in <oz>', 'Green weight in ounces for watched imports')
    .option('--roast-notes <notes>', 'Roast notes to apply to watched imports')
    .option('--roast-targets <targets>', 'Roast targets to apply to watched imports')
    .option('--resume', 'Resume a previous watch session from where it left off')
    .option('--form', 'Interactive form mode (prompts for directory + bean selection)')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast watch ~/artisan/ --coffee-id 7
  purvey roast watch ~/artisan/ --coffee-id 42 --batch-prefix "Colombia Huila"
  purvey roast watch ~/artisan/ --auto-match
  purvey roast watch ~/artisan/ --coffee-id 7 --commit-mode individual
  purvey roast watch ~/artisan/ --prompt-each
  purvey roast watch --resume      # continue a previous session
  purvey roast watch --form        # interactive setup wizard

Notes:
  Runs continuously until Ctrl+C. New .alog files detected in the directory
  are queued or imported as roast profiles depending on commit mode.
  --auto-match and --coffee-id are mutually exclusive.
  --commit-mode defaults to batch.
  Session state is saved for --resume.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (directory: string | undefined, opts: Record<string, unknown>) => {
        const { supabase, userId } = await requireAuth('member');

        const parseCommitMode = (value: unknown, fallback: 'batch' | 'individual' = 'batch') => {
          if (value === undefined || value === null || String(value).trim() === '') {
            return fallback;
          }

          const normalized = String(value).trim().toLowerCase();
          if (normalized === 'batch' || normalized === 'individual') {
            return normalized;
          }

          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --commit-mode: "${value}". Use "batch" or "individual".`
          );
        };

        const parseOptionalPositiveNumber = (value: unknown, flagName: string) => {
          if (value === undefined || value === null || String(value).trim() === '') {
            return undefined;
          }

          const parsed = parseFloat(String(value));
          if (isNaN(parsed) || parsed <= 0) {
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid ${flagName}: "${value}".`);
          }

          return parsed;
        };

        // ── Resume mode ──────────────────────────────────────────────────────
        if (opts.resume) {
          const saved = await loadWatchSession();
          if (!saved) {
            throw new PrvrsError(
              'NOT_FOUND',
              'No watch session to resume. Start a new one with: purvey roast watch <dir> --coffee-id <id>'
            );
          }
          await startWatch(supabase, userId, saved.directory, {
            coffeeId: saved.coffeeId,
            coffeeName: saved.coffeeName,
            batchPrefix: saved.batchPrefix,
            promptEach: Boolean(saved.promptEach),
            autoMatch: Boolean(saved.autoMatch),
            commitMode: saved.commitMode ?? 'batch',
            startedAt: saved.startedAt,
            resumeImports: saved.imports,
            ozIn: saved.ozIn,
            roastNotes: saved.roastNotes,
            roastTargets: saved.roastTargets,
          });
          return;
        }

        // ── Interactive form mode ────────────────────────────────────────────
        if (opts.form) {
          p.intro('Watch for Artisan Roasts');

          const dirRaw = await p.text({
            message: 'Directory to watch',
            placeholder: '/path/to/alog/directory',
            validate: (v) => {
              if (!v || String(v).trim() === '') return 'Please enter a directory path.';
            },
          });
          guardCancel(dirRaw);

          const watchDir = normalizePathInput(String(dirRaw));

          try {
            await access(watchDir);
          } catch {
            p.cancel(`Directory not found: "${watchDir}"`);
            process.exit(1);
          }

          // Ask whether to use AI auto-match
          const useAutoMatchRaw = await p.confirm({
            message: 'Use AI to auto-match beans? (requires member role)',
            initialValue: false,
          });
          guardCancel(useAutoMatchRaw);
          const useAutoMatch = Boolean(useAutoMatchRaw);

          let batchPrefix: string;
          let watchCoffeeId: number;
          let watchCoffeeName: string;

          if (useAutoMatch) {
            // In auto-match mode we don't need a bean upfront; use placeholder values
            watchCoffeeId = 0;
            watchCoffeeName = 'auto-match';

            const batchPrefixRaw = await p.text({
              message: 'Batch prefix',
              placeholder: 'Roast',
              defaultValue: 'Roast',
            });
            guardCancel(batchPrefixRaw);
            batchPrefix = String(batchPrefixRaw).trim() || 'Roast';
          } else {
            const bean = await pickBean(supabase, userId);
            watchCoffeeId = bean.id;
            watchCoffeeName = bean.name;

            const batchPrefixRaw = await p.text({
              message: 'Batch prefix',
              placeholder: bean.name,
              defaultValue: bean.name,
            });
            guardCancel(batchPrefixRaw);
            batchPrefix = String(batchPrefixRaw).trim() || bean.name;
          }

          const promptEachRaw = useAutoMatch
            ? false
            : await p.confirm({
                message: 'Prompt for bean selection on each new file?',
                initialValue: false,
              });
          if (typeof promptEachRaw !== 'boolean') guardCancel(promptEachRaw);

          const commitModeRaw = await p.select({
            message: 'Commit mode',
            initialValue: 'batch',
            options: [
              {
                value: 'batch',
                label: 'Batch commit on Ctrl+C',
                hint: 'Default. Queue imports and commit them together when the session ends.',
              },
              {
                value: 'individual',
                label: 'Commit each roast immediately',
                hint: 'Import each new file as soon as it appears.',
              },
            ],
          });
          guardCancel(commitModeRaw);
          const commitMode = parseCommitMode(commitModeRaw);

          const ozInRaw = await p.text({
            message: 'Green weight (oz)',
            placeholder: 'optional',
            validate: (v) => {
              if (!v || v.trim() === '') return;
              const n = parseFloat(v);
              if (isNaN(n) || n <= 0) return 'Must be a positive number.';
            },
          });
          guardCancel(ozInRaw);

          const roastTargetsRaw = await p.text({
            message: 'Roast targets',
            placeholder: 'optional',
          });
          guardCancel(roastTargetsRaw);

          const roastNotesRaw = await p.text({
            message: 'Roast notes',
            placeholder: 'optional',
          });
          guardCancel(roastNotesRaw);

          await startWatch(supabase, userId, watchDir, {
            coffeeId: watchCoffeeId,
            coffeeName: watchCoffeeName,
            batchPrefix,
            commitMode,
            promptEach: useAutoMatch ? false : Boolean(promptEachRaw),
            autoMatch: useAutoMatch,
            ozIn: parseOptionalPositiveNumber(ozInRaw, 'green weight'),
            roastTargets:
              String(roastTargetsRaw).trim() !== '' ? String(roastTargetsRaw).trim() : undefined,
            roastNotes:
              String(roastNotesRaw).trim() !== '' ? String(roastNotesRaw).trim() : undefined,
          });
          return;
        }

        // ── Flag-based mode ──────────────────────────────────────────────────
        if (!directory) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing directory argument. Use --form for interactive mode or --resume to continue.'
          );
        }

        const autoMatch = Boolean(opts.autoMatch);
        const commitMode = parseCommitMode(opts.commitMode);
        const ozIn = parseOptionalPositiveNumber(opts.ozIn, '--oz-in');
        const roastNotes =
          typeof opts.roastNotes === 'string' && opts.roastNotes.trim() !== ''
            ? opts.roastNotes.trim()
            : undefined;
        const roastTargets =
          typeof opts.roastTargets === 'string' && opts.roastTargets.trim() !== ''
            ? opts.roastTargets.trim()
            : undefined;

        // --auto-match and --coffee-id are mutually exclusive (auto-match picks the bean)
        if (autoMatch && opts.coffeeId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            '--auto-match and --coffee-id are mutually exclusive. Use one or the other.'
          );
        }

        if (!autoMatch && !opts.coffeeId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing --coffee-id. Use --form for interactive mode or --auto-match to let AI pick the bean.'
          );
        }

        let coffeeId: number;
        let coffeeName: string;

        if (autoMatch) {
          // Placeholder values — auto-match resolves per-file at runtime
          coffeeId = 0;
          coffeeName = 'auto-match';
        } else {
          coffeeId = parseInt(opts.coffeeId as string, 10);
          if (isNaN(coffeeId) || coffeeId <= 0) {
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --coffee-id: "${opts.coffeeId}".`);
          }

          // Look up coffee name from inventory
          const { data: invItem, error: invError } = await supabase
            .from('green_coffee_inv')
            .select('id, coffee_catalog!catalog_id (name)')
            .eq('id', coffeeId)
            .eq('user', userId)
            .single();

          if (invError || !invItem) {
            throw new PrvrsError(
              'NOT_FOUND',
              `Inventory item ${coffeeId} not found or does not belong to you.`
            );
          }

          const catalogRaw = invItem.coffee_catalog as
            | { name: string | null }
            | { name: string | null }[]
            | null;
          const catalog = Array.isArray(catalogRaw) ? (catalogRaw[0] ?? null) : catalogRaw;
          coffeeName = catalog?.name ?? `Coffee #${coffeeId}`;
        }

        const batchPrefix = (opts.batchPrefix as string | undefined) ?? coffeeName;

        const watchDir = normalizePathInput(directory);

        await startWatch(supabase, userId, watchDir, {
          coffeeId,
          coffeeName,
          batchPrefix,
          commitMode,
          promptEach: Boolean(opts.promptEach),
          autoMatch,
          ozIn,
          roastNotes,
          roastTargets,
        });
      })
    );

  return roast;
}

// ─── Pretty-print helper ──────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function printImportPretty(result: ImportRoastResult, coffeeId: number): void {
  const { milestones, phases } = result;

  console.log('');
  console.log('✓ Roast imported successfully');
  console.log('');
  console.log(`  Roast ID:     ${result.roast_id}`);
  console.log(`  Bean:         ${result.coffee_name} (#${coffeeId})`);
  console.log(`  Batch:        ${result.batch_name}`);

  const tempCount = result.message.match(/(\d+) data points/)?.[1] ?? '?';
  console.log(
    `  Data points:  ${tempCount} temperatures, ${result.milestone_events} milestones, ${result.control_events} control events`
  );

  // Milestones
  if (Object.keys(milestones).length > 0) {
    console.log('');
    console.log('  Milestones:');
    const labels: Record<string, string> = {
      charge: 'Charge',
      dry_end: 'Dry End',
      fc_start: 'FC Start',
      fc_end: 'FC End',
      sc_start: 'SC Start',
      sc_end: 'SC End',
      drop: 'Drop',
      cool: 'Cool',
    };
    for (const [key, label] of Object.entries(labels)) {
      const t = milestones[key as keyof typeof milestones];
      if (t !== undefined && t > 0) {
        console.log(`    ${label.padEnd(10)}${formatTime(t)}`);
      }
    }
  }

  // Phases
  const { drying_percent, maillard_percent, development_percent, total_time_seconds } = phases;
  if (total_time_seconds > 0) {
    console.log('');
    console.log('  Phases:');
    if (drying_percent > 0) console.log(`    Drying      ${Math.round(drying_percent)}%`);
    if (maillard_percent > 0) console.log(`    Maillard    ${Math.round(maillard_percent)}%`);
    if (development_percent > 0) console.log(`    Development ${Math.round(development_percent)}%`);
    console.log(`    Total       ${formatTime(total_time_seconds)}`);
  }
  console.log('');
}
