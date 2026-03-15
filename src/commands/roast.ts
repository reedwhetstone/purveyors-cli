import { Command } from 'commander';
import { createAuthenticatedClient } from '../lib/supabase.js';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, AuthError, PrvrsError } from '../lib/errors.js';
import { confirm, todayIso } from '../lib/prompts.js';
import type { OutputOptions } from '../types/index.js';

// ─── Local types ──────────────────────────────────────────────────────────────

export interface RoastProfile {
  roast_id: number;
  batch_name: string | null;
  coffee_id: number | null;
  coffee_name: string | null;
  roast_date: string | null;
  oz_in: number | null;
  oz_out: number | null;
  weight_loss_percent: number | null;
  roast_notes: string | null;
  user: string;
  last_updated: string;
  roaster_type: string | null;
  roaster_size: string | null;
  temperature_unit: string | null;
  charge_time: number | null;
  drop_time: number | null;
  fc_start_time: number | null;
  fc_end_time: number | null;
  fc_start_temp: number | null;
  drop_temp: number | null;
  charge_temp: number | null;
  dry_percent: number | null;
  maillard_percent: number | null;
  development_percent: number | null;
  total_roast_time: number | null;
  data_source: string | null;
  roast_uuid: string | null;
}

export interface TemperatureEntry {
  roast_id: number;
  time_seconds: number;
  bean_temp: number | null;
  environmental_temp: number | null;
}

export interface RoastEventEntry {
  roast_id: number;
  time_seconds: number;
  event_type: number | null;
  event_value: string | null;
}

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

        let query = supabase
          .from('roast_profiles')
          .select(
            'roast_id, batch_name, coffee_id, coffee_name, roast_date, oz_in, oz_out, weight_loss_percent, roast_notes, roaster_type, roaster_size, temperature_unit, total_roast_time, development_percent, data_source, last_updated'
          )
          .eq('user', user.id);

        if (opts.coffeeId !== undefined) {
          query = query.eq('coffee_id', parseInt(opts.coffeeId as string, 10));
        }

        const limit = Math.max(1, parseInt(opts.limit as string, 10));
        const { data, error } = await query.order('roast_date', { ascending: false }).limit(limit);

        if (error) throw error;

        if (!data || data.length === 0) {
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

        const roastId = parseInt(id, 10);

        // Fetch the profile, verifying ownership
        const { data: profile, error: profileError } = await supabase
          .from('roast_profiles')
          .select('*')
          .eq('roast_id', roastId)
          .eq('user', user.id)
          .single();

        if (profileError) {
          if (profileError.code === 'PGRST116') {
            throw new AuthError(`Roast profile ${id} not found or does not belong to you.`);
          }
          throw profileError;
        }

        const result: Record<string, unknown> = { ...profile };

        // Optionally fetch temperature curve
        if (opts.includeTemps) {
          const { data: temps, error: tempError } = await supabase
            .from('roast_temperatures')
            .select('roast_id, time_seconds, bean_temp, environmental_temp')
            .eq('roast_id', roastId)
            .order('time_seconds', { ascending: true });

          if (tempError) throw tempError;
          result.temperatures = temps ?? [];
        }

        // Optionally fetch roast events
        if (opts.includeEvents) {
          const { data: events, error: eventsError } = await supabase
            .from('roast_events')
            .select('roast_id, time_seconds, event_type, event_value')
            .eq('roast_id', roastId)
            .order('time_seconds', { ascending: true });

          if (eventsError) throw eventsError;
          result.events = events ?? [];
        }

        outputData(result, globalOpts);
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

        // Verify ownership of the inventory item and get coffee name for default batch name
        const { data: invItem, error: invError } = await supabase
          .from('green_coffee_inv')
          .select('id, coffee_catalog!catalog_id (name)')
          .eq('id', coffeeId)
          .eq('user', user.id)
          .single();

        if (invError || !invItem) {
          throw new AuthError(`Inventory item ${coffeeId} not found or does not belong to you.`);
        }

        const roastDate = (opts.roastDate as string | undefined) ?? todayIso();

        // Default batch name: coffee name + roast date
        let batchName = opts.batchName as string | undefined;
        if (!batchName) {
          const catalogRaw = invItem.coffee_catalog as
            | { name: string | null }
            | { name: string | null }[]
            | null;
          const catalog = Array.isArray(catalogRaw) ? (catalogRaw[0] ?? null) : catalogRaw;
          const coffeeName = catalog?.name ?? `Coffee #${coffeeId}`;
          batchName = `${coffeeName} — ${roastDate}`;
        }

        const insertPayload: Record<string, unknown> = {
          user: user.id,
          coffee_id: coffeeId,
          batch_name: batchName,
          roast_date: roastDate,
        };

        if (opts.ozIn !== undefined) {
          const ozIn = parseFloat(opts.ozIn as string);
          if (isNaN(ozIn) || ozIn <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-in: "${opts.ozIn}".`);
          insertPayload.oz_in = ozIn;
        }

        if (opts.ozOut !== undefined) {
          const ozOut = parseFloat(opts.ozOut as string);
          if (isNaN(ozOut) || ozOut <= 0)
            throw new PrvrsError('INVALID_ARGUMENT', `Invalid --oz-out: "${opts.ozOut}".`);
          insertPayload.oz_out = ozOut;
        }

        if (opts.notes !== undefined) {
          insertPayload.roast_notes = opts.notes;
        }

        const { data: inserted, error: insertError } = await supabase
          .from('roast_profiles')
          .insert(insertPayload)
          .select('roast_id')
          .single();

        if (insertError) throw insertError;

        // Re-fetch the full row
        const { data, error } = await supabase
          .from('roast_profiles')
          .select(
            'roast_id, batch_name, coffee_id, coffee_name, roast_date, oz_in, oz_out, weight_loss_percent, roast_notes, roaster_type, total_roast_time, data_source, last_updated'
          )
          .eq('roast_id', inserted.roast_id)
          .single();

        if (error) throw error;

        success(`Roast profile ${inserted.roast_id} created.`);
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
        void cmd; // global opts not needed for delete
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

        // Verify ownership
        const { data: existing, error: fetchError } = await supabase
          .from('roast_profiles')
          .select('roast_id, batch_name')
          .eq('roast_id', roastId)
          .eq('user', user.id)
          .single();

        if (fetchError || !existing) {
          throw new AuthError(`Roast profile ${id} not found or does not belong to you.`);
        }

        if (!opts.yes) {
          const label = existing.batch_name ? `"${existing.batch_name}"` : `#${roastId}`;
          const ok = await confirm(`Delete roast profile ${label}?`);
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const { error: deleteError } = await supabase
          .from('roast_profiles')
          .delete()
          .eq('roast_id', roastId)
          .eq('user', user.id);

        if (deleteError) throw deleteError;

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
