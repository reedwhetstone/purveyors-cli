import { Command } from 'commander';
import * as p from '@clack/prompts';
import { access, readFile } from 'fs/promises';
import { basename } from 'path';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import {
  listRoasts,
  getRoast,
  createRoast,
  deleteRoast,
  importRoastFromFile,
} from '../lib/roast.js';
import type {
  RoastProfile,
  TemperatureEntry,
  RoastEventEntry,
  ImportRoastResult,
} from '../lib/roast.js';
import { pickBean, guardCancel } from '../lib/interactive/forms.js';
import type { OutputOptions } from '../types/index.js';

// Re-export types for backwards compatibility
export type { RoastProfile, TemperatureEntry, RoastEventEntry };

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey roast` — Browse and manage your roast profiles.
 * Requires authentication.
 */
export function buildRoastCommand(): Command {
  const roast = new Command('roast').description('Browse and manage your roast profiles');

  // ── roast list ────────────────────────────────────────────────────────────
  roast
    .command('list')
    .description('List your roast profiles, sorted by date (newest first)')
    .option('--coffee-id <id>', 'Filter by green_coffee_inv ID')
    .option('--limit <n>', 'Maximum results to return', '20')
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        const data = await listRoasts(supabase, user.id, {
          coffeeId: opts.coffeeId !== undefined ? parseInt(opts.coffeeId as string, 10) : undefined,
          limit: Math.max(1, parseInt(opts.limit as string, 10)),
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
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        const data = await getRoast(supabase, user.id, parseInt(id, 10), {
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
    .option('--coffee-id <id>', 'green_coffee_inv ID for this roast')
    .option('--batch-name <name>', "Batch name (defaults to coffee name + today's date)")
    .option('--oz-in <oz>', 'Green weight in ounces')
    .option('--oz-out <oz>', 'Roasted weight in ounces')
    .option('--roast-date <YYYY-MM-DD>', 'Roast date (defaults to today)')
    .option('--notes <text>', 'Roast notes')
    .option('--form', 'Interactive form mode')
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

        // ── Interactive form mode ──────────────────────────────────────────
        if (opts.form) {
          p.intro('Create Roast Profile');

          const bean = await pickBean(supabase, user.id);

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

          const data = await createRoast(supabase, user.id, {
            coffeeId: bean.id,
            batchName: String(batchNameRaw).trim() || defaultBatch,
            ozIn,
            roastDate: today,
            notes: combinedNotes,
          });

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

        const data = await createRoast(supabase, user.id, {
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

  // ── roast delete <id> ─────────────────────────────────────────────────────
  roast
    .command('delete <id>')
    .description('Delete a roast profile (must be yours)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const supabase = await createAuthenticatedClient();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          throw new AuthError('Not logged in. Run `purvey auth login` first.');
        }

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

        await deleteRoast(supabase, user.id, roastId);
        success(`Roast profile ${roastId} deleted.`);
      })
    );

  // ── roast import <file> ───────────────────────────────────────────────────
  roast
    .command('import')
    .description('Import an Artisan .alog file and create a new roast profile')
    .argument('[file]', 'Path to .alog file (or use --form for interactive mode)')
    .option('--coffee-id <id>', 'green_coffee_inv ID for this roast')
    .option('--batch-name <name>', 'Batch name (auto-generated from coffee name + date if omitted)')
    .option('--oz-in <oz>', 'Green weight in ounces (extracted from .alog if omitted)')
    .option('--roast-notes <notes>', 'Additional roast notes')
    .option('--form', 'Interactive form mode')
    .action(
      withErrorHandling(
        async (file: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;

          // ── Interactive form mode ────────────────────────────────────────
          if (opts.form) {
            p.intro('Import Artisan Roast');

            const filePathRaw = await p.text({
              message: 'Path to .alog file',
              placeholder: '/path/to/roast.alog',
              validate: (v) => {
                if (!v || String(v).trim() === '') return 'Please enter a file path.';
              },
            });
            guardCancel(filePathRaw);

            const filePath = String(filePathRaw).trim();

            // Validate file exists (async check after prompt)
            try {
              await access(filePath);
            } catch {
              p.cancel(`File not found: "${filePath}"`);
              process.exit(1);
            }

            // Authenticate
            const supabase = await createAuthenticatedClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
              throw new AuthError('Not logged in. Run `purvey auth login` first.');
            }

            const bean = await pickBean(supabase, user.id);

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

            const result = await importRoastFromFile(supabase, user.id, {
              fileContent,
              fileName,
              coffeeId: bean.id,
              batchName,
              ozIn,
              roastNotes: notesStr !== '' ? notesStr : undefined,
            });

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
          try {
            await access(file);
          } catch {
            throw new PrvrsError('INVALID_ARGUMENT', `File not found or not readable: "${file}"`);
          }

          // 2. Read file content
          const fileContent = await readFile(file, 'utf-8');
          const fileName = basename(file);

          // 3. Authenticate
          const supabase = await createAuthenticatedClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user) {
            throw new AuthError('Not logged in. Run `purvey auth login` first.');
          }

          // 4. Parse --coffee-id
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

          // 5. Parse --oz-in if provided
          let ozIn: number | undefined;
          if (opts.ozIn !== undefined) {
            ozIn = parseFloat(opts.ozIn as string);
            if (isNaN(ozIn) || ozIn <= 0) {
              throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
            }
          }

          // 6. Run the import
          const result = await importRoastFromFile(supabase, user.id, {
            fileContent,
            fileName,
            coffeeId,
            batchName: opts.batchName as string | undefined,
            ozIn,
            roastNotes: opts.roastNotes as string | undefined,
          });

          // 7. Output
          if (globalOpts.pretty) {
            printImportPretty(result, coffeeId);
          } else {
            success(`Roast profile ${result.roast_id} imported from ${fileName}.`);
            outputData(result, globalOpts);
          }
        }
      )
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
