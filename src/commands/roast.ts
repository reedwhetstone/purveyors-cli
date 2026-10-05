import { Command } from 'commander';
import * as p from '@clack/prompts';
import { access, readFile } from 'fs/promises';
import { basename } from 'path';
import { randomUUID } from 'node:crypto';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError, AuthError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import { confirm, todayIso } from '../lib/prompts.js';
import {
  listRoastsPage,
  getRoast,
  getRoastChartData,
  createRoast,
  createRoastFromReference,
  deleteRoast,
  updateRoast,
  parseRoastBatchId,
  ROAST_CHART_TARGET_POINTS,
  ROAST_SEARCH_MAX_LENGTH,
} from '../lib/roast.js';
import type {
  RoastProfile,
  TemperatureEntry,
  RoastEventEntry,
  ImportRoastResult,
} from '../lib/roast.js';
import { pickBean, guardCancel } from '../lib/interactive/forms.js';
import { normalizePathInput } from '../lib/path-input.js';
import { startWatch, loadWatchSession } from '../lib/interactive/watch.js';
import type { WatchBatchStore, WatchRoastImporter } from '../lib/interactive/watch.js';
import type { CredentialContext } from '../lib/auth-client.js';
import { getConfigValue } from '../lib/config.js';
import {
  createParchmentClient,
  resolveParchmentSessionTokenIfAvailable,
  unwrapParchment,
} from '../lib/parchment.js';
import type { components } from '@purveyors/sdk';
import type { OutputOptions } from '../types/index.js';
import { getInventory } from '../lib/inventory.js';
import { parseReferenceProfileId } from '../lib/reference-profiles.js';
import { downloadRoastArtisanFile } from '../lib/artisan-file.js';
import {
  parseStrictFiniteNumber,
  parseStrictInt4Id,
  parseStrictOffset,
  parseStrictPositiveCount,
} from '../lib/strict-number.js';

/** Canonical `POST /v1/roasts/imports` response payload. */
type RoastImportPayload = components['schemas']['RoastImportResponse'];

// Re-export types for backwards compatibility
export type { RoastProfile, TemperatureEntry, RoastEventEntry };

function parseRoastInt4Id(value: string, label: string): number {
  const parsed = parseStrictInt4Id(value);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${label}: "${value}". Must be an integer between 1 and 2147483647.`
    );
  }
  return parsed;
}

function parseRoastListCount(value: string, flag: '--limit' | '--offset'): number {
  const parsed = flag === '--offset' ? parseStrictOffset(value) : parseStrictPositiveCount(value);
  if (!Number.isFinite(parsed)) {
    const requirement = flag === '--offset' ? 'a non-negative integer' : 'a positive integer';
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${flag}: "${value}". Must be ${requirement}.`
    );
  }
  return parsed;
}

/** `--wholesale` takes true or false, matched the way the price-index commands match it. */
function parseRoastWholesale(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new PrvrsError(
    'INVALID_ARGUMENT',
    `Invalid --wholesale: "${value}". Must be "true" or "false".`
  );
}

function parseRoastChartTargetPoints(value: string): number {
  const parsed = parseStrictPositiveCount(value);
  const { minimum, maximum } = ROAST_CHART_TARGET_POINTS;
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid --target-points: "${value}". Must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return parsed;
}

function parseWatchCommitMode(value: unknown, fallback: 'batch' | 'individual' = 'batch') {
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
}

function parseWatchOptionalPositiveNumber(value: unknown, flagName: string): number | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }

  const parsed = parseStrictFiniteNumber(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new PrvrsError('INVALID_ARGUMENT', `Invalid ${flagName}: "${value}".`);
  }

  return parsed;
}

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
    batch_id: roast.batch_id,
    batch_name: roast.batch_name ?? fallbackBatchName,
    coffee_name: roast.coffee_name ?? '',
    coffee_id: roast.coffee_id ?? fallbackCoffeeId,
  };
}

/**
 * Read the batch a roast should be placed in from `--batch-id` and `--batch-name`.
 * `--batch-id` joins that batch whatever the roast's date and the roast takes its
 * name, so a name beside it has nothing to do and is refused instead of dropped.
 */
function parseRoastBatchTarget(opts: Record<string, unknown>): {
  batchId?: string;
  batchName?: string;
} {
  const batchName = opts.batchName as string | undefined;
  if (opts.batchId === undefined) return { batchName };
  if (batchName !== undefined) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      "Use either --batch-id or --batch-name, not both. --batch-id adds the roast to an existing batch, which already has a name; rename a batch with 'purvey roast-batch update <batch-id> --name <name>'."
    );
  }
  return { batchId: parseRoastBatchId(String(opts.batchId), '--batch-id') };
}

/**
 * Build the roast importer used by `purvey roast watch`. Each import resolves
 * the current member API key at call time (so long-running watch sessions
 * survive token refresh) and forwards the raw `.alog` to the canonical Parchment
 * API via the SDK, which parses and persists the roast server-side. The session
 * JWT is pinned per request so an exported PARCHMENT_API_KEY/PURVEYORS_API_KEY
 * for another account cannot authorize a write against the session user's beans.
 */
export function createWatchRoastImporter(credentialContext: CredentialContext): WatchRoastImporter {
  return async (args) => {
    const {
      data: { session },
    } = await credentialContext.getSession();
    if (!session?.apiKey) {
      throw new AuthError('Session expired mid-watch. Run `purvey auth login` and retry.');
    }
    const client = await createParchmentClient('member', session.apiKey);
    const payload = unwrapParchment(
      await client.roasts.import({
        fileContent: args.fileContent,
        fileName: args.fileName,
        coffeeId: args.coffeeId,
        // A roast placed by id takes that batch's name, so the name is sent only without one.
        ...(args.batchId !== undefined ? { batchId: args.batchId } : { batchName: args.batchName }),
        ozIn: args.ozIn,
        roastNotes: args.roastNotes,
        roastTargets: args.roastTargets,
        fileSize: Buffer.byteLength(args.fileContent, 'utf-8'),
      }),
      'roast import'
    );
    return mapSdkImportResult(payload, args.coffeeId, args.batchName);
  };
}

/**
 * Build the batch access used by `purvey roast watch` in batch commit mode. Like
 * the importer, every call resolves the current member API key and pins it, so
 * the session's batch is opened, read, and removed as the session user.
 */
export function createWatchBatchStore(credentialContext: CredentialContext): WatchBatchStore {
  const sessionClient = async () => {
    const {
      data: { session },
    } = await credentialContext.getSession();
    if (!session?.apiKey) {
      throw new AuthError('Session expired mid-watch. Run `purvey auth login` and retry.');
    }
    return createParchmentClient('member', session.apiKey);
  };
  const toRecord = (batch: components['schemas']['RoastBatchResource']) => ({
    id: batch.id,
    name: batch.name,
    batchDate: batch.batch_date,
    roastIds: batch.roast_ids,
  });

  return {
    async create({ name, batchDate }) {
      const client = await sessionClient();
      const envelope = unwrapParchment(
        await client.roastBatches.create({ name, batchDate }, randomUUID()),
        'roast batch create'
      );
      return toRecord(envelope.data.batch);
    },
    async get(batchId) {
      const client = await sessionClient();
      const result = await client.roastBatches.get(batchId);
      if (result.response.status === 404) return null;
      return toRecord(unwrapParchment(result, 'roast batch').data);
    },
    async delete(batchId) {
      const client = await sessionClient();
      unwrapParchment(await client.roastBatches.delete(batchId), 'roast batch delete');
    },
    async batchIdForRoast(roastId) {
      const client = await sessionClient();
      const result = await client.roasts.get(String(roastId));
      if (result.response.status === 404) return null;
      return unwrapParchment(result, 'roast').data.batch_id;
    },
  };
}

/** Resolve the current form session at write time and pin it to the roast create request. */
export async function createInteractiveRoast(
  credentialContext: CredentialContext,
  input: Parameters<typeof createRoast>[0]
): Promise<RoastProfile> {
  const {
    data: { session },
  } = await credentialContext.getSession();
  if (!session?.apiKey) {
    throw new AuthError('Session expired mid-create. Run `purvey auth login` and retry.');
  }
  return createRoast(input, session.apiKey);
}

async function requireCurrentSessionToken(credentialContext: CredentialContext): Promise<string> {
  const {
    data: { session },
  } = await credentialContext.getSession();
  if (!session?.apiKey) {
    throw new AuthError('Session expired. Run `purvey auth login` and retry.');
  }
  return session.apiKey;
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
    .option('--coffee-id <id>')
    .option('--roast-id <id>')
    .option('--batch-id <uuid>')
    .option('--batch-name <text>')
    .option('--coffee-name <text>')
    .option('--search <text>')
    .option('--date-start <YYYY-MM-DD>')
    .option('--date-end <YYYY-MM-DD>')
    .option('--stocked')
    .option('--catalog-id <id>')
    .option('--wholesale <true|false>')
    .option('--include-totals')
    .option('--limit <n>', '', '20')
    .option('--offset <n>', '', '0')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast list --pretty
  purvey roast list --search "guji" --pretty
  purvey roast list --search "#4529"
  purvey roast list --search "guji" --date-start 2026-03-01 --include-totals --pretty
  purvey roast list --wholesale false --include-totals | jq '.meta.totals'
  purvey roast list --coffee-id 7 --pretty
  purvey roast list --roast-id 123 --pretty
  purvey roast list --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --pretty
  purvey roast list --batch-name "Ethiopia Guji" --pretty
  purvey roast list --coffee-name "Ethiopia" --pretty
  purvey roast list --date-start 2026-03-01 --date-end 2026-03-31
  purvey roast list --stocked --limit 10
  purvey roast list --catalog-id 128 --pretty
  purvey roast list --limit 5 | jq '.[].roast_id'
  purvey roast list --csv > roasts.csv
  purvey roast list --limit 20 --offset 20   # page 2
  purvey roast list --include-totals --limit 20 --offset 20 | jq '{rows: (.data | length), of: .meta.totals.roasts}'

Notes:
  --search finds roasts by one term: text in the coffee name or the batch name
  (case-insensitive), or a roast ID, with or without a leading #. It takes up to
  ${ROAST_SEARCH_MAX_LENGTH} characters and is matched as written: % and _ are ordinary characters, and
  * stands for any one character. A number finds the roast with exactly that ID, and
  any roast with the number in its coffee or batch name.
  Search text that is refused exits 2; the message calls the search text q.
  Every filter narrows the list together. --search with --coffee-name, --batch-name, or
  --roast-id returns only roasts that match all of them.
  --wholesale true returns roasts of wholesale coffees; false returns every other roast,
  including roasts of coffees with no catalog listing. Leave it out for both.
  --include-totals prints { data, meta } instead of a list. data holds the page of roasts.
  meta.totals has roasts, batches, and average_loss_percent for every roast the filters
  match, so it is the same on every page. average_loss_percent is null when no matching
  roast has a recorded weight loss. An empty result prints data: [] with totals of zero.
  It does not support --csv.
  Paging: raise --offset by --limit. With --include-totals, a page is the last one when
  --offset plus the number of roasts returned reaches meta.totals.roasts.
  Without --include-totals, an empty result prints nothing on stdout.
  --coffee-id filters by inventory ID, not catalog ID.
  --roast-id filters by the exact roast profile ID while preserving list output shape.
  --catalog-id filters by catalog ID (from catalog search).
  --batch-id returns the roasts in one batch. Batch names can repeat; a batch ID never does.
  --batch-name accepts partial matches (case-insensitive), across every batch with a matching name.
  --coffee-name accepts partial matches on the bean name (case-insensitive).
  --date-start and --date-end accept YYYY-MM-DD format; use together for a range.
  --stocked only returns roasts for beans currently marked as stocked in inventory.
  Returns roast_id, batch_id, batch_name, roast_date, oz_in, oz_out, and bean details.
  artisan_file_available is true when 'purvey roast artisan-file <id>' can return the roast's Artisan file.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const includeTotals = opts.includeTotals === true;
        if (includeTotals && globalOpts.csv) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            '--include-totals does not support --csv. Use --json or --pretty, or leave out --include-totals.'
          );
        }

        // The one search rule checked here is the length limit; Parchment decides the rest.
        const search = opts.search as string | undefined;
        if (search !== undefined && search.trim().length > ROAST_SEARCH_MAX_LENGTH) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Invalid --search: must be at most ${ROAST_SEARCH_MAX_LENGTH} characters.`
          );
        }

        const wholesale =
          opts.wholesale !== undefined ? parseRoastWholesale(opts.wholesale as string) : undefined;

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
          roastId = parseRoastInt4Id(opts.roastId as string, '--roast-id');
        }

        let catalogId: number | undefined;
        if (opts.catalogId !== undefined) {
          catalogId = parseRoastInt4Id(opts.catalogId as string, '--catalog-id');
        }

        const page = await listRoastsPage({
          coffee_id:
            opts.coffeeId !== undefined
              ? parseRoastInt4Id(opts.coffeeId as string, '--coffee-id')
              : undefined,
          roast_id: roastId,
          batch_id:
            opts.batchId !== undefined
              ? parseRoastBatchId(String(opts.batchId), '--batch-id')
              : undefined,
          batch_name: opts.batchName as string | undefined,
          coffee_name: opts.coffeeName as string | undefined,
          q: search,
          date_start: dateStart,
          date_end: dateEnd,
          stocked_only: opts.stocked === true ? true : undefined,
          catalog_id: catalogId,
          is_wholesale: wholesale,
          limit: parseRoastListCount(opts.limit as string, '--limit'),
          offset: parseRoastListCount(opts.offset as string, '--offset'),
        });

        if (includeTotals) {
          outputData(page, globalOpts);
          return;
        }

        const data = page.data;
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
    .option('--include-temps')
    .option('--include-events')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast get 123 --pretty
  purvey roast get 123 --include-temps --pretty
  purvey roast get 123 --include-events | jq '.events'
  purvey roast get 123 --include-temps --include-events --csv

Notes:
  <id> is the roast ID (integer).
  --include-temps adds the full temperature curve array (can be large).
  --include-events adds roast event markers (FC start, drop, etc.).
  artisan_file_available is true when 'purvey roast artisan-file <id>' can return the roast's Artisan file.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await getRoast(parseRoastInt4Id(id, 'roast ID'), {
          includeTemps: Boolean(opts.includeTemps),
          includeEvents: Boolean(opts.includeEvents),
        });

        outputData(data, globalOpts);
      })
    );

  // ── roast chart <id> ──────────────────────────────────────────────────────
  roast
    .command('chart <id>')
    .description('Fetch the sampled chart model for one roast (series, events, revision)')
    .option('--target-points <n>')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast chart 123 --pretty
  purvey roast chart 123 --target-points 120 --json
  purvey roast chart 123 | jq '.data.metadata.revision'

Notes:
  <id> is the roast ID (integer).
  Returns the roast chart data unchanged: sampled series,
  discrete events, and metadata. data.metadata.revision identifies the immutable
  chart revision accepted by 'purvey reference-profile compare roast:<id>@<revision>'.
  Requires authentication (member role); API keys need the roast:read scope.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const data = await getRoastChartData({
          id: parseRoastInt4Id(id, 'roast ID'),
          targetPoints:
            opts.targetPoints === undefined
              ? undefined
              : parseRoastChartTargetPoints(String(opts.targetPoints)),
        });

        outputData(data, globalOpts);
      })
    );

  // ── roast artisan-file <id> ───────────────────────────────────────────────
  roast
    .command('artisan-file <id>')
    .description('Download the Artisan file a roast was imported from, exactly as you uploaded it')
    .option('--output <path>')
    .option('--force')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast artisan-file 123
  purvey roast artisan-file 123 --output ~/artisan/
  purvey roast artisan-file 123 --output ~/artisan/guji-background.alog --force

Notes:
  <id> is the roast ID (integer).
  Writes the file byte for byte as it was imported, to load as a background in Artisan
  or to keep, then checks it against its SHA-256 and prints a JSON receipt: path, bytes, sha256.
  Without --output the file goes in the current folder under its original name.
  An existing file is never replaced unless you pass --force.
  A roast has a file when artisan_file_available is true in 'purvey roast get <id>'.
  Requires authentication (member role) and Studio access on your account;
  API keys need the roast:read scope.
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const roastId = parseRoastInt4Id(id, 'roast ID');
        const file = await downloadRoastArtisanFile(roastId, {
          output: opts.output === undefined ? undefined : String(opts.output),
          force: Boolean(opts.force),
        });

        outputData({ data: { roastId, ...file } }, globalOpts);
      })
    );

  // ── roast create ──────────────────────────────────────────────────────────
  roast
    .command('create')
    .description('Create a new roast profile')
    .option('--coffee-id <id>')
    .option('--batch-id <uuid>')
    .option('--batch-name <name>')
    .option('--oz-in <oz>')
    .option('--oz-out <oz>')
    .option('--roast-date <YYYY-MM-DD>')
    .option('--notes <text>')
    .option('--targets <text>')
    .option('--roaster-type <text>')
    .option('--form')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast create --coffee-id 7 --pretty
  purvey roast create --coffee-id 7 --batch-name "Ethiopia Guji Light" --oz-in 16
  purvey roast create --coffee-id 7 --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e --oz-in 16
  purvey roast create --coffee-id 42 --oz-in 12 --oz-out 9.8 --roast-date 2026-03-15
  purvey roast create --coffee-id 7 --notes "Extended drying phase, aimed for medium roast"
  purvey roast create --coffee-id 7 --targets "FC at 390F, 18% development" --roaster-type "Aillio Bullet"
  purvey roast create --form     # interactive wizard

Required flags: --coffee-id (inventory ID)
  Use 'purvey inventory list' to find your --coffee-id.
  Prefer 'purvey roast import' if you have an Artisan .alog file.

Batch:
  --batch-id adds the roast to that batch, whatever the roast date. The roast takes the batch's name.
  --batch-name adds the roast to your batch with that name on the roast date, or starts one.
  Pass one or the other. With neither, the roast goes into a batch named after the coffee and roast date.
  The output includes batch_id.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        // ── Interactive form mode ──────────────────────────────────────────
        // Auto-enter form mode if config form-mode is true and the required
        // inventory selector is missing. Roast date defaults to today.
        const formMode =
          opts.form || (!opts.coffeeId && (await getConfigValue('form-mode')) === 'true');
        if (formMode) {
          p.intro('Create Roast Profile');

          const { credentialContext } = await requireAuth('member');

          const bean = await pickBean(await requireCurrentSessionToken(credentialContext));

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
              const n = parseStrictFiniteNumber(v);
              if (!Number.isFinite(n) || n <= 0) return 'Must be a positive number.';
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
          const ozIn = ozInStr !== '' ? parseStrictFiniteNumber(ozInStr) : undefined;

          const notesStr = String(notesRaw).trim();
          const targetsStr = String(targetsRaw).trim();
          const combinedNotes =
            [notesStr, targetsStr ? `Targets: ${targetsStr}` : ''].filter(Boolean).join('\n') ||
            undefined;

          const spin = p.spinner();
          spin.start('Creating roast profile...');
          const data = await createInteractiveRoast(credentialContext, {
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

        const coffeeId = parseRoastInt4Id(opts.coffeeId as string, '--coffee-id');
        const batchTarget = parseRoastBatchTarget(opts);

        let ozIn: number | undefined;
        if (opts.ozIn !== undefined) {
          ozIn = parseStrictFiniteNumber(opts.ozIn as string);
          if (!Number.isFinite(ozIn) || ozIn <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
        }

        let ozOut: number | undefined;
        if (opts.ozOut !== undefined) {
          ozOut = parseStrictFiniteNumber(opts.ozOut as string);
          if (!Number.isFinite(ozOut) || ozOut <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
        }

        const data = await createRoast({
          coffeeId,
          ...batchTarget,
          ozIn,
          ozOut,
          roastDate: (opts.roastDate as string | undefined) ?? todayIso(),
          notes: opts.notes as string | undefined,
          targets: opts.targets as string | undefined,
          roasterType: opts.roasterType as string | undefined,
        });

        success(`Roast profile ${data.roast_id} created in batch ${data.batch_id}.`);
        outputData(data, globalOpts);
      })
    );

  // ── roast update <id> ─────────────────────────────────────────────────────
  roast
    .command('update <id>')
    .description('Update an existing roast profile (must be yours)')
    .option('--notes <text>')
    .option('--oz-out <oz>')
    .option('--batch-id <uuid>')
    .option('--batch-name <name>')
    .option('--targets <text>')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast update 123 --notes "Extended drying phase"
  purvey roast update 123 --oz-out 12.5
  purvey roast update 123 --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e
  purvey roast update 123 --batch-name "Ethiopia Guji Light #3"
  purvey roast update 123 --targets "Aim for FC at 390F, 18% dev"
  purvey roast update 123 --notes "Great roast" --oz-out 10.2

Notes:
  At least one flag required. Pass only the fields you want to change.
  --oz-out triggers automatic weight_loss_percent recalculation if oz_in exists.
  --targets replaces the roast targets (your plan or goals for the roast).
  --batch-id moves the roast into that batch. --batch-name moves it into your batch with that
  name on the roast date, or starts one. Neither renames a batch: use
  'purvey roast-batch update <batch-id> --name <name>' for that.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const roastId = parseRoastInt4Id(id, 'roast ID');

        let ozOut: number | undefined;
        if (opts.ozOut !== undefined) {
          ozOut = parseStrictFiniteNumber(opts.ozOut as string);
          if (!Number.isFinite(ozOut) || ozOut <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
        }

        const batchTarget = parseRoastBatchTarget(opts);

        if (
          opts.notes === undefined &&
          ozOut === undefined &&
          batchTarget.batchId === undefined &&
          batchTarget.batchName === undefined &&
          opts.targets === undefined
        ) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'No update fields provided. Pass at least one of: --notes, --oz-out, --batch-id, --batch-name, --targets.'
          );
        }

        const data = await updateRoast(roastId, {
          notes: opts.notes as string | undefined,
          ozOut,
          ...batchTarget,
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
    .option('-y, --yes')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast delete 123           # prompts for confirmation
  purvey roast delete 123 --yes     # skip confirmation (use in scripts)

Notes:
  Permanently deletes the roast profile and associated temperature/event data.
  Deleting the last roast in a batch leaves the batch in place, empty. Remove it with
  'purvey roast-batch delete <batch-id>'; 'purvey roast-batch list --include-empty' shows it.
  Cannot be undone. Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
        void cmd;
        const roastId = parseRoastInt4Id(id, 'roast ID');

        if (!opts.yes) {
          const ok = await confirm(`Delete roast profile #${roastId}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        await deleteRoast(roastId);
        success(`Roast profile ${roastId} deleted.`);
      })
    );

  // ── roast import <file> ───────────────────────────────────────────────────
  roast
    .command('import')
    .description('Import an Artisan .alog file and create a new roast profile')
    .argument('[file]', 'Path to .alog file (or use --form for interactive mode)')
    .option('--coffee-id <id>')
    .option('--batch-id <uuid>')
    .option('--batch-name <name>')
    .option('--oz-in <oz>')
    .option('--roast-notes <notes>')
    .option('--roast-targets <targets>')
    .option('--form')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast import ~/artisan/ethiopia-guji.alog --coffee-id 7 --pretty
  purvey roast import roast.alog --coffee-id 42 --oz-in 16
  purvey roast import roast.alog --coffee-id 7 --batch-name "Ethiopia Guji #3" --roast-notes "Faster development"
  purvey roast import roast.alog --coffee-id 7 --roast-targets "Aim for 18% development"
  purvey roast import second.alog --coffee-id 7 --batch-id 7c1d4e2a-9b3f-4a6c-8d5e-2f1a0b9c8d7e
  purvey roast import --form     # interactive wizard (browse files + select bean)

Required: <file> path and --coffee-id (unless using --form)
  .alog files are exported from Artisan roast logging software.
  Imports temperature curve, roast events, and milestone timing.
  oz-in is auto-extracted from the .alog file if present; --oz-in overrides it.
  Use 'purvey inventory list' to find your --coffee-id.

Batch:
  --batch-id adds the roast to that batch, whatever the roast date. The roast takes the batch's name.
  --batch-name adds the roast to your batch with that name on the roast date, or starts one.
  Pass one or the other. With neither, the roast goes into a batch named after the coffee and roast date.
  The output includes batch_id: pass it as --batch-id to import the next file into the same batch.
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
            const { credentialContext } = await requireAuth('member');

            const bean = await pickBean(await requireCurrentSessionToken(credentialContext));

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
                const n = parseStrictFiniteNumber(v);
                if (!Number.isFinite(n) || n <= 0) return 'Must be a positive number.';
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
            const ozIn = ozInStr !== '' ? parseStrictFiniteNumber(ozInStr) : undefined;
            const batchName = String(batchNameRaw).trim() || defaultBatch;
            const notesStr = String(roastNotesRaw).trim();
            const targetsStr = String(roastTargetsRaw).trim();

            const spin = p.spinner();
            spin.start('Importing roast data...');
            // Parse + persist happen server-side via the canonical Parchment
            // API. `bean` was resolved through the authenticated Parchment
            // session above (pickBean), so the import must run under that same
            // credential identity. Pin the request to the stored API key
            // instead of letting an exported PARCHMENT_API_KEY/PURVEYORS_API_KEY
            // for another account authorize an import against a coffeeId owned
            // by the session user.
            const {
              data: { session: formSession },
            } = await credentialContext.getSession();
            if (!formSession?.apiKey) {
              throw new AuthError('Session expired mid-import. Run `purvey auth login` and retry.');
            }
            const client = await createParchmentClient('member', formSession.apiKey);
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

          const coffeeId = parseRoastInt4Id(opts.coffeeId as string, '--coffee-id');
          const batchTarget = parseRoastBatchTarget(opts);

          // 4. Parse --oz-in if provided
          let ozIn: number | undefined;
          if (opts.ozIn !== undefined) {
            ozIn = parseStrictFiniteNumber(opts.ozIn as string);
            if (!Number.isFinite(ozIn) || ozIn <= 0) {
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
          // Prefer an existing logged-in member session for flag mode too:
          // users often copy --coffee-id from session-scoped inventory, and an
          // exported API key for another account must not steal that request.
          // If no valid session exists, the API-key-only path still works.
          const sessionToken = await resolveParchmentSessionTokenIfAvailable('member');
          const client = await createParchmentClient('member', sessionToken);
          const payload = unwrapParchment(
            await client.roasts.import({
              fileContent,
              fileName,
              coffeeId,
              ...batchTarget,
              ozIn,
              roastNotes: opts.roastNotes as string | undefined,
              roastTargets,
              fileSize: Buffer.byteLength(fileContent, 'utf-8'),
            }),
            'roast import'
          );
          const result = mapSdkImportResult(payload, coffeeId, batchTarget.batchName ?? '');

          // 6. Output
          if (globalOpts.pretty) {
            printImportPretty(result, coffeeId);
          } else {
            success(
              `Roast profile ${result.roast_id} imported from ${fileName} into batch ${result.batch_id}.`
            );
            outputData(result, globalOpts);
          }
        }
      )
    );

  // ── roast from-reference <profile-id> <revision-id> ───────────────────────
  roast
    .command('from-reference <profile-id> <revision-id>')
    .description('Create a roast from the Artisan file saved with one of your reference profiles')
    .requiredOption('--coffee-id <id>')
    .option('--batch-id <uuid>')
    .option('--batch-name <name>')
    .option('--roast-date <YYYY-MM-DD>')
    .option('--oz-in <oz>')
    .option('--oz-out <oz>')
    .option('--roast-notes <notes>')
    .option('--roast-targets <targets>')
    .option('--idempotency-key <key>')
    .addHelpText(
      'after',
      `
Examples:
  purvey roast from-reference 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --coffee-id 7 --pretty
  purvey roast from-reference 5ea1af6f-234c-43a9-9bf8-5678dd24f854 8d2c41e0-7b9a-4f3e-a6d1-2c9e5f07b3a4 --coffee-id 7 --batch-name "Ethiopia Guji #4" --roast-date 2026-10-03 --json

Notes:
  Use this when the roast's Artisan file was uploaded with 'purvey reference-profile import'
  and is no longer on this machine. With the .alog file at hand, use 'purvey roast import'.
  Only an uploaded Artisan reference can become a roast. A generated plan is never recorded
  as a roast, and a reference saved from a past roast is refused because that roast is
  already in your history.
  Find the ids with 'purvey reference-profile list' (id and currentRevisionId) and the
  --coffee-id with 'purvey inventory list'.
  --batch-id adds the roast to that batch, whatever the roast date; --batch-name adds it to your
  batch with that name on the roast date, or starts one. Pass one or the other.
  Requires a member credential and Studio access on your account.
`
    )
    .action(
      withErrorHandling(
        async (
          profileId: string,
          revisionId: string,
          opts: Record<string, unknown>,
          cmd: Command
        ) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;
          const coffeeId = parseRoastInt4Id(opts.coffeeId as string, '--coffee-id');
          const batchTarget = parseRoastBatchTarget(opts);

          let ozIn: number | undefined;
          if (opts.ozIn !== undefined) {
            ozIn = parseStrictFiniteNumber(opts.ozIn as string);
            if (!Number.isFinite(ozIn) || ozIn <= 0)
              throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
          }

          let ozOut: number | undefined;
          if (opts.ozOut !== undefined) {
            ozOut = parseStrictFiniteNumber(opts.ozOut as string);
            if (!Number.isFinite(ozOut) || ozOut <= 0)
              throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
          }

          const roastDate = opts.roastDate as string | undefined;
          if (roastDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(roastDate)) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Invalid --roast-date: "${roastDate}". Must be YYYY-MM-DD format.`
            );
          }

          const data = await createRoastFromReference(
            {
              referenceProfileId: parseReferenceProfileId(profileId, 'profile id'),
              referenceRevisionId: parseReferenceProfileId(revisionId, 'revision id'),
              coffeeId,
              ...batchTarget,
              roastDate,
              ozIn,
              ozOut,
              roastNotes: opts.roastNotes as string | undefined,
              roastTargets: opts.roastTargets as string | undefined,
            },
            opts.idempotencyKey ? String(opts.idempotencyKey) : undefined
          );

          success(`Roast profile ${data.data.roast.roast_id} created from the saved reference.`);
          outputData(data, globalOpts);
        }
      )
    );

  // ── roast watch <directory> ───────────────────────────────────────────────
  roast
    .command('watch')
    .description('Watch a directory for new .alog files and queue or auto-import them')
    .argument('[directory]', 'Directory to watch for .alog files')
    .option('--coffee-id <id>')
    .option('--batch-prefix <name>')
    .option('--prompt-each')
    .option('--auto-match')
    .option('--commit-mode <mode>')
    .option('--oz-in <oz>')
    .option('--roast-notes <notes>')
    .option('--roast-targets <targets>')
    .option('--resume')
    .option('--form')
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
  --commit-mode defaults to batch: roasts are queued, then saved together
  into one new batch named by --batch-prefix when you stop. The session is one
  batch even when the name was used before or the session runs past midnight.
  The summary prints the batch ID.
  --commit-mode individual saves each roast right away as its own batch,
  named "<name> #1", "<name> #2", and so on.
  Session state is saved for --resume, which keeps adding to the same batch.
  A session saved by an earlier CLI version continues in the batch that holds
  its first saved roast.
  If no roast is saved, the batch opened for the session is removed.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (directory: string | undefined, opts: Record<string, unknown>) => {
        // Validate all flag values before authentication so malformed machine input
        // consistently returns INVALID_ARGUMENT without session or network work.
        const parsedCoffeeId =
          opts.coffeeId !== undefined
            ? parseRoastInt4Id(opts.coffeeId as string, '--coffee-id')
            : undefined;
        const parsedCommitMode = parseWatchCommitMode(opts.commitMode);
        const parsedOzIn = parseWatchOptionalPositiveNumber(opts.ozIn, '--oz-in');
        const autoMatch = Boolean(opts.autoMatch);

        if (autoMatch && opts.coffeeId) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            '--auto-match and --coffee-id are mutually exclusive. Use one or the other.'
          );
        }

        const { credentialContext, userId } = await requireAuth('member');
        const roastImporter = createWatchRoastImporter(credentialContext);
        const batchStore = createWatchBatchStore(credentialContext);

        // ── Resume mode ──────────────────────────────────────────────────────
        if (opts.resume) {
          const saved = await loadWatchSession();
          if (!saved) {
            throw new PrvrsError(
              'NOT_FOUND',
              'No watch session to resume. Start a new one with: purvey roast watch <dir> --coffee-id <id>'
            );
          }
          await startWatch(
            credentialContext,
            userId,
            saved.directory,
            {
              coffeeId: saved.coffeeId,
              coffeeName: saved.coffeeName,
              batchPrefix: saved.batchPrefix,
              promptEach: Boolean(saved.promptEach),
              autoMatch: Boolean(saved.autoMatch),
              interactiveRecovery: Boolean(saved.interactiveRecovery),
              commitMode: saved.commitMode ?? 'batch',
              startedAt: saved.startedAt,
              resumeImports: saved.imports,
              resumeBatchId: saved.batchId,
              resumeBatchOpenedBySession: saved.batchOpenedBySession,
              ozIn: saved.ozIn,
              roastNotes: saved.roastNotes,
              roastTargets: saved.roastTargets,
            },
            { roastImporter, batchStore }
          );
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
              message: 'Batch name',
              placeholder: 'Roast',
              defaultValue: 'Roast',
            });
            guardCancel(batchPrefixRaw);
            batchPrefix = String(batchPrefixRaw).trim() || 'Roast';
          } else {
            const bean = await pickBean(await requireCurrentSessionToken(credentialContext));
            watchCoffeeId = bean.id;
            watchCoffeeName = bean.name;

            const batchPrefixRaw = await p.text({
              message: 'Batch name',
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
                hint: 'Default. Queue roasts and save them together as one batch when the session ends.',
              },
              {
                value: 'individual',
                label: 'Commit each roast immediately',
                hint: 'Save each new file as soon as it appears, as its own numbered batch.',
              },
            ],
          });
          guardCancel(commitModeRaw);
          const commitMode = parseWatchCommitMode(commitModeRaw);

          const ozInRaw = await p.text({
            message: 'Green weight (oz)',
            placeholder: 'optional',
            validate: (v) => {
              if (!v || v.trim() === '') return;
              const n = parseStrictFiniteNumber(v);
              if (!Number.isFinite(n) || n <= 0) return 'Must be a positive number.';
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

          await startWatch(
            credentialContext,
            userId,
            watchDir,
            {
              coffeeId: watchCoffeeId,
              coffeeName: watchCoffeeName,
              batchPrefix,
              commitMode,
              promptEach: useAutoMatch ? false : Boolean(promptEachRaw),
              autoMatch: useAutoMatch,
              interactiveRecovery: true,
              ozIn: parseWatchOptionalPositiveNumber(ozInRaw, 'green weight'),
              roastTargets:
                String(roastTargetsRaw).trim() !== '' ? String(roastTargetsRaw).trim() : undefined,
              roastNotes:
                String(roastNotesRaw).trim() !== '' ? String(roastNotesRaw).trim() : undefined,
            },
            { roastImporter, batchStore }
          );
          return;
        }

        // ── Flag-based mode ──────────────────────────────────────────────────
        if (!directory) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'Missing directory argument. Use --form for interactive mode or --resume to continue.'
          );
        }

        const roastNotes =
          typeof opts.roastNotes === 'string' && opts.roastNotes.trim() !== ''
            ? opts.roastNotes.trim()
            : undefined;
        const roastTargets =
          typeof opts.roastTargets === 'string' && opts.roastTargets.trim() !== ''
            ? opts.roastTargets.trim()
            : undefined;

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
          coffeeId = parsedCoffeeId as number;

          const invItem = await getInventory(
            coffeeId,
            await requireCurrentSessionToken(credentialContext)
          );
          coffeeName = invItem.coffee_catalog?.name ?? `Coffee #${coffeeId}`;
        }

        const batchPrefix = (opts.batchPrefix as string | undefined) ?? coffeeName;

        const watchDir = normalizePathInput(directory);

        await startWatch(
          credentialContext,
          userId,
          watchDir,
          {
            coffeeId,
            coffeeName,
            batchPrefix,
            commitMode: parsedCommitMode,
            promptEach: Boolean(opts.promptEach),
            autoMatch,
            ozIn: parsedOzIn,
            roastNotes,
            roastTargets,
          },
          { roastImporter, batchStore }
        );
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
  console.log(`  Batch ID:     ${result.batch_id}`);

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
