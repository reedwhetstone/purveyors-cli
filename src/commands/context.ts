import { Command } from 'commander';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import { getCliManifest, renderContextText } from '../lib/manifest.js';
import { outputData } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

export function buildContextCommand(): Command {
  return new Command('context')
    .description(
      'Output the dense human-readable CLI reference, or the manifest JSON for compatibility with --json/--pretty'
    )
    .option('--json', 'Emit the machine-readable manifest contract as compact JSON')
    .option('--pretty', 'Emit the machine-readable manifest contract as indented JSON')
    .addHelpText(
      'after',
      `
Default output is dense human-readable reference text.
Use --json or --pretty for the same machine-readable manifest emitted by \`purvey manifest\`.
Prefer \`purvey manifest\` for new machine integrations, and keep \`purvey context --json\` for compatibility with existing context-based tooling.

Examples:
  purvey context
  purvey context | head -50
  purvey context --json
  purvey context --pretty
  purvey context --json > cli-manifest.json
  purvey manifest
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
