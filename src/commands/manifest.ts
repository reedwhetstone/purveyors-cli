import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import { getCliManifest } from '../lib/manifest.js';
import { outputData } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

export function buildManifestCommand(): Command {
  return new Command('manifest')
    .description('Output the preferred machine-readable CLI manifest contract')
    .option('--json', 'Emit the manifest as compact JSON (default)')
    .option('--pretty', 'Emit the manifest as indented JSON')
    .addHelpText(
      'after',
      `
Examples:
  purvey manifest
  purvey manifest --pretty
  purvey manifest > cli-manifest.json
  purvey manifest | jq '.commandGroups[].name'
`
    )
    .action(
      withErrorHandling(async (opts: Record<string, unknown>, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;

        if (globalOpts.csv) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'The manifest command does not support --csv. Use --json or --pretty.'
          );
        }

        outputData(getCliManifest(), {
          json: true,
          pretty: Boolean(opts.pretty) || Boolean(globalOpts.pretty),
        });
      })
    );
}
