import { Command } from 'commander';
import * as p from '@clack/prompts';
import { outputData, info, success } from '../lib/output.js';
import { withErrorHandling, PrvrsError, AuthError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth-guard.js';
import {
  getTastingNotes,
  rateCoffee,
  isValidCuppingScore,
  parseCuppingScore,
} from '../lib/tasting.js';
import type { TastingFilter, TastingData, CuppingNotes } from '../lib/tasting.js';
import { pickBean, guardCancel } from '../lib/interactive/forms.js';
import { getConfigValue } from '../lib/config.js';
import { parseStrictInt4Id, parseStrictInteger } from '../lib/strict-number.js';
import type { OutputOptions } from '../types/index.js';

// Re-export types and helpers for backwards compatibility
export type { TastingFilter, TastingData, CuppingNotes };
export { isValidCuppingScore, parseCuppingScore };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUPPING_SCORE_FLAGS = ['aroma', 'body', 'acidity', 'sweetness', 'aftertaste'] as const;

/** Prompt for a single cupping dimension score. */
async function promptCuppingScore(dimension: string): Promise<number> {
  const raw = await p.text({
    message: `${dimension} (1-5)`,
    placeholder: '3',
    validate: (v) => {
      const n = parseStrictInteger(String(v), 1, 5);
      if (!Number.isFinite(n)) {
        return `Must be an integer between 1 and 5.`;
      }
    },
  });
  guardCancel(raw);
  return parseStrictInteger(String(raw), 1, 5);
}

function parseTastingId(value: string, label: string): number {
  const parsed = parseStrictInt4Id(value);
  if (!Number.isFinite(parsed)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Invalid ${label}: "${value}". Must be an integer between 1 and 2147483647.`
    );
  }
  return parsed;
}

// ─── Command builder ──────────────────────────────────────────────────────────

/**
 * `purvey tasting` — View and record tasting notes for a bean.
 * Combines supplier notes from coffee_catalog with user notes from green_coffee_inv.
 * Requires member+ authentication.
 */
export function buildTastingCommand(): Command {
  const tasting = new Command('tasting').description(
    'View and record tasting notes for a coffee bean'
  );

  // ── tasting get <bean-id> ─────────────────────────────────────────────────
  tasting
    .command('get <bean-id>')
    .description(
      'Retrieve tasting notes for a bean (by coffee_catalog ID). Combines supplier and user notes.'
    )
    .option(
      '--filter <type>',
      'Which notes to show: user, supplier, or both (default: both)',
      'both'
    )
    .addHelpText(
      'after',
      `
Examples:
  purvey tasting get 128 --pretty
  purvey tasting get 128 --filter supplier --pretty
  purvey tasting get 128 --filter user --pretty
  purvey tasting get 42 | jq '.user.aroma'

Notes:
  <bean-id> is coffee_catalog.catalog_id (NOT inventory id).
  --filter both returns: {supplier: {flavor_notes, ...}, user: {aroma, body, ...}}
  --filter supplier: only the supplier's flavor notes from the catalog.
  --filter user: only your cupping scores from green_coffee_inv.
  Returns null fields if no notes exist for that filter.
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(async (beanId: string, opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const filter = opts.filter as string as TastingFilter;

        if (!['user', 'supplier', 'both'].includes(filter)) {
          throw new PrvrsError(
            'INVALID_OPTION',
            `Invalid --filter value "${filter}". Use: user, supplier, or both.`
          );
        }

        const catalogId = parseTastingId(beanId, 'bean ID');

        const result = await getTastingNotes(catalogId, filter);

        if (result.supplier === null && result.user === null) {
          info(`No tasting notes found for bean ID ${catalogId} (filter: ${filter}).`);
          return;
        }

        outputData(result, globalOpts);
      })
    );

  // ── tasting rate <bean-id> ────────────────────────────────────────────────
  tasting
    .command('rate')
    .description('Rate a bean from your inventory using cupping scores (updates green_coffee_inv)')
    .argument('[bean-id]', 'Inventory item ID (green_coffee_inv.id), or use --form')
    .option('--aroma <1-5>', '[REQUIRED in flag mode] Aroma score, integer 1-5')
    .option('--body <1-5>', '[REQUIRED in flag mode] Body score, integer 1-5')
    .option('--acidity <1-5>', '[REQUIRED in flag mode] Acidity score, integer 1-5')
    .option('--sweetness <1-5>', '[REQUIRED in flag mode] Sweetness score, integer 1-5')
    .option('--aftertaste <1-5>', '[REQUIRED in flag mode] Aftertaste score, integer 1-5')
    .option('--brew-method <method>', 'Brew method used (e.g. pour_over, french_press, espresso)')
    .option('--notes <text>', 'Additional tasting notes')
    .option('--form', 'Interactive form mode (browse inventory + guided scoring)')
    .addHelpText(
      'after',
      `
Examples:
  purvey tasting rate 7 --aroma 4 --body 3 --acidity 5 --sweetness 4 --aftertaste 4
  purvey tasting rate 7 --aroma 5 --body 4 --acidity 4 --sweetness 5 --aftertaste 4 --brew-method pour_over
  purvey tasting rate 42 --aroma 3 --body 3 --acidity 3 --sweetness 3 --aftertaste 3 --notes "Underextracted, try finer grind"
  purvey tasting rate --form     # interactive wizard

Required (flag mode): <bean-id> + all five score flags (--aroma, --body, --acidity, --sweetness, --aftertaste)
  <bean-id> is green_coffee_inv.id (your inventory ID, NOT catalog_id).
  Use 'purvey inventory list' to find your bean IDs.
  Scores: integer 1 (low) to 5 (excellent).
  Scores are stored on your green_coffee_inv row (overwrite on re-rate).
  Requires authentication (member role).
`
    )
    .action(
      withErrorHandling(
        async (beanId: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;

          // ── Interactive form mode ────────────────────────────────────────
          // Automatic form mode is only safe when the caller supplied no
          // explicit target or scores. Explicit --form always wins.
          const hasExplicitRateInput =
            beanId !== undefined || CUPPING_SCORE_FLAGS.some((flag) => opts[flag] !== undefined);
          const formMode =
            opts.form === true ||
            (!hasExplicitRateInput && (await getConfigValue('form-mode')) === 'true');
          if (formMode) {
            const { credentialContext } = await requireAuth('member');
            p.intro('Rate Coffee');

            const {
              data: { session: pickerSession },
            } = await credentialContext.getSession();
            if (!pickerSession?.apiKey) {
              throw new AuthError('Session expired. Run `purvey auth login` and retry.');
            }
            const bean = await pickBean(pickerSession.apiKey);

            const aroma = await promptCuppingScore('Aroma');
            const body = await promptCuppingScore('Body');
            const acidity = await promptCuppingScore('Acidity');
            const sweetness = await promptCuppingScore('Sweetness');
            const aftertaste = await promptCuppingScore('Aftertaste');

            const notesRaw = await p.text({
              message: 'Notes',
              placeholder: 'optional',
            });
            guardCancel(notesRaw);

            const confirmed = await p.confirm({ message: 'Save rating?' });
            guardCancel(confirmed);

            if (!confirmed) {
              p.cancel('Aborted.');
              return;
            }

            const notesStr = String(notesRaw).trim();

            const spin = p.spinner();
            spin.start('Saving rating...');
            const {
              data: { session: writeSession },
            } = await credentialContext.getSession();
            if (!writeSession?.apiKey) {
              throw new AuthError('Session expired mid-form. Run `purvey auth login` and retry.');
            }
            const data = await rateCoffee(
              bean.id,
              {
                aroma,
                body,
                acidity,
                sweetness,
                aftertaste,
                notes: notesStr !== '' ? notesStr : undefined,
              },
              writeSession.apiKey
            );
            spin.stop('Done');

            p.outro(`Rating saved for "${bean.name}"!`);
            outputData(data, globalOpts);
            return;
          }

          // ── Flag-based mode ──────────────────────────────────────────────
          if (!beanId) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              'Missing bean-id argument. Use --form for interactive mode.'
            );
          }

          const inventoryId = parseTastingId(beanId, 'bean ID');

          // Require all score flags in flag-based mode
          for (const flag of CUPPING_SCORE_FLAGS) {
            if (opts[flag] === undefined) {
              throw new PrvrsError(
                'INVALID_ARGUMENT',
                `Missing --${flag}. Use --form for interactive mode.`
              );
            }
          }

          // Parse and validate all scores (CLI strings → numbers)
          const aroma = parseCuppingScore(opts.aroma as string, 'aroma');
          const body = parseCuppingScore(opts.body as string, 'body');
          const acidity = parseCuppingScore(opts.acidity as string, 'acidity');
          const sweetness = parseCuppingScore(opts.sweetness as string, 'sweetness');
          const aftertaste = parseCuppingScore(opts.aftertaste as string, 'aftertaste');

          const { credentialContext } = await requireAuth('member');
          const {
            data: { session: writeSession },
          } = await credentialContext.getSession();
          if (!writeSession?.apiKey) {
            throw new AuthError('Session expired. Run `purvey auth login` and retry.');
          }
          const data = await rateCoffee(
            inventoryId,
            {
              aroma,
              body,
              acidity,
              sweetness,
              aftertaste,
              brewMethod: opts.brewMethod as string | undefined,
              notes: opts.notes as string | undefined,
            },
            writeSession.apiKey
          );

          success(`Cupping notes saved for inventory item ${inventoryId}.`);
          outputData(data, globalOpts);
        }
      )
    );

  return tasting;
}
