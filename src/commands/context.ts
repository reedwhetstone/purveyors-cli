import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import { getCliManifest, renderContextText } from '../lib/manifest.js';
import { outputData } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

export function buildContextCommand(): Command {
  return new Command('context')
    .description('Output full CLI reference for AI agent onboarding')
    .option('--json', 'Emit the machine-readable manifest contract as compact JSON')
    .option('--pretty', 'Emit the machine-readable manifest contract as indented JSON')
    .addHelpText(
      'after',
      `
Examples:
  purvey context
  purvey context --json
  purvey context --pretty
  purvey manifest
  purvey context | head -50
  purvey context --json > cli-manifest.json
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        const manifest = getCliManifest();
        const wantsJson =
          Boolean(opts.json) ||
          Boolean(opts.pretty) ||
          Boolean(globalOpts.json) ||
          Boolean(globalOpts.pretty);

        if (globalOpts.csv) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'The context command does not support --csv. Use text, --json, or --pretty.'
          );
        }

        if (wantsJson) {
          outputData(manifest, {
            json: true,
            pretty: Boolean(opts.pretty) || Boolean(globalOpts.pretty),
          });
          return;
        }

        console.log(renderContextText(manifest));
      })
    );
}
