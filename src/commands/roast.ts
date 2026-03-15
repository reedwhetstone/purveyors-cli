import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import { listRoasts, getRoast, createRoast, deleteRoast } from '../lib/roast.js';
import type { RoastProfile, TemperatureEntry, RoastEventEntry } from '../lib/roast.js';
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
    .requiredOption('--coffee-id <id>', 'green_coffee_inv ID for this roast')
    .option('--batch-name <name>', "Batch name (defaults to coffee name + today's date)")
    .option('--oz-in <oz>', 'Green weight in ounces')
    .option('--oz-out <oz>', 'Roasted weight in ounces')
    .option('--roast-date <YYYY-MM-DD>', 'Roast date (defaults to today)')
    .option('--notes <text>', 'Roast notes')
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

  // ── roast import-artisan <id> <file.alog> ─────────────────────────────────
  // TODO (Phase 3): Wire up artisan import.
  // The .alog parser runs server-side on the SvelteKit API. This command needs
  // to POST the file content to the app's /api/artisan-import endpoint, which
  // requires the SvelteKit server URL to be configurable (not just Supabase URL).
  // Tracked for Phase 3 implementation.

  return roast;
}
