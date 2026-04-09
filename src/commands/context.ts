import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import { getCliManifest, renderContextText } from '../lib/manifest.js';
import { outputData } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

export function buildContextCommand(): Command {
  return new Command('context')
    .description('Output the CLI contract for agents, scripts, and integrations')
    .option('--json', 'Emit the machine-readable manifest contract as compact JSON')
    .option('--pretty', 'Emit the machine-readable manifest contract as indented JSON')
    .addHelpText(
      'after',
      `
Examples:
  purvey context
  purvey context --json
  purvey context --pretty
  purvey context | head -50
  purvey context --json > cli-manifest.json

Notes:
  Default output is dense human-readable onboarding text.
  --json emits the machine-readable manifest contract on stdout.
  --pretty emits the same manifest with indentation.
  The same helpers are exported for in-process integrations from
  @purveyors/cli/manifest.
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
            'The context command does not support --csv. Use default text output, --json, or --pretty.'
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
