import { Command } from 'commander';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import { readConfig, writeConfig, setConfigValue, isValidConfigKey } from '../lib/config.js';
import { outputData, shouldUseInteractiveOutput, success, info } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

// ─── Command builder ──────────────────────────────────────────────────────────

function resolveConfigOutput(cmd: Command): {
  outputOptions: OutputOptions;
  isInteractive: boolean;
} {
  const outputOptions = cmd.optsWithGlobals() as OutputOptions;

  if (outputOptions.csv) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      'The config commands do not support --csv. Use text, --json, or --pretty.'
    );
  }

  return {
    outputOptions,
    isInteractive: shouldUseInteractiveOutput(outputOptions),
  };
}

function configValuePayload(
  key: string,
  value: boolean | undefined
): Record<string, boolean | null> {
  return {
    [key]: value ?? null,
  };
}

/**
 * `purvey config` — Manage purvey CLI settings.
 * Config is stored in ~/.config/purvey/config.json.
 */
export function buildConfigCommand(): Command {
  const config = new Command('config').description('Manage purvey CLI settings');

  // ── config list ───────────────────────────────────────────────────────────
  config
    .command('list')
    .description('Show all configuration values')
    .addHelpText(
      'after',
      `
Examples:
  purvey config list

Notes:
  Config is stored at ~/.config/purvey/config.json.
  Interactive terminals show human-readable key = value lines.
  --json / --pretty, or any non-interactive use, emits the config object on stdout.
  --csv is not supported.
`
    )
    .action(
      withErrorHandling(async (_: unknown, cmd: Command) => {
        const cfg = await readConfig();
        const keys = Object.keys(cfg) as Array<keyof typeof cfg>;
        const { outputOptions, isInteractive } = resolveConfigOutput(cmd);

        if (!isInteractive) {
          outputData(cfg, outputOptions);
          return;
        }

        if (keys.length === 0) {
          info('No config values set. Use `purvey config set <key> <value>` to configure.');
          return;
        }

        console.log('');
        for (const key of keys) {
          console.log(`  ${key} = ${String(cfg[key])}`);
        }
        console.log('');
      })
    );

  // ── config get <key> ──────────────────────────────────────────────────────
  config
    .command('get <key>')
    .description('Get a single configuration value')
    .addHelpText(
      'after',
      `
Examples:
  purvey config get form-mode

Supported keys:
  form-mode   true/false — auto-enter interactive wizard when required args are missing

Notes:
  Interactive terminals print the raw value to stdout with no decorators.
  --json / --pretty, or any non-interactive use, emits {"<key>": value|null}.
  Prints "form-mode is not set." interactively if the key has no value.
  --csv is not supported.
`
    )
    .action(
      withErrorHandling(async (key: string, _opts: Record<string, unknown>, cmd: Command) => {
        if (!isValidConfigKey(key)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Unknown config key: "${key}". Valid keys: form-mode.`
          );
        }

        const cfg = await readConfig();
        const value = cfg[key];
        const { outputOptions, isInteractive } = resolveConfigOutput(cmd);

        if (!isInteractive) {
          outputData(configValuePayload(key, value), outputOptions);
          return;
        }

        if (value === undefined) {
          info(`${key} is not set.`);
        } else {
          console.log(String(value));
        }
      })
    );

  // ── config set <key> <value> ──────────────────────────────────────────────
  config
    .command('set <key> <value>')
    .description('Set a configuration value')
    .addHelpText(
      'after',
      `
Supported keys:
  form-mode   true/false — when true, write commands auto-enter form mode
              if required args are missing

Examples:
  $ purvey config set form-mode true
  $ purvey config set form-mode false
  $ purvey config get form-mode
  $ purvey config set form-mode true --json

Notes:
  Interactive terminals print a human-readable success line.
  --json / --pretty, or any non-interactive use, emits the updated config value.
  --csv is not supported.
`
    )
    .action(
      withErrorHandling(
        async (key: string, value: string, _opts: Record<string, unknown>, cmd: Command) => {
          if (!isValidConfigKey(key)) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              `Unknown config key: "${key}". Valid keys: form-mode.`
            );
          }

          try {
            await setConfigValue(key, value);
          } catch (err) {
            throw new PrvrsError(
              'INVALID_ARGUMENT',
              err instanceof Error ? err.message : String(err)
            );
          }

          const cfg = await readConfig();
          const { outputOptions, isInteractive } = resolveConfigOutput(cmd);

          if (!isInteractive) {
            outputData(configValuePayload(key, cfg[key]), outputOptions);
            return;
          }

          success(`Config updated: ${key} = ${value}`);
        }
      )
    );

  // ── config reset ──────────────────────────────────────────────────────────
  config
    .command('reset')
    .description('Reset all configuration to defaults')
    .addHelpText(
      'after',
      `
Examples:
  purvey config reset

Notes:
  Clears all config values. Equivalent to deleting ~/.config/purvey/config.json.
  Interactive terminals print a human-readable success line.
  --json / --pretty, or any non-interactive use, emits {}.
  --csv is not supported.
`
    )
    .action(
      withErrorHandling(async (_: unknown, cmd: Command) => {
        await writeConfig({});
        const { outputOptions, isInteractive } = resolveConfigOutput(cmd);

        if (!isInteractive) {
          outputData({}, outputOptions);
          return;
        }

        success('Config reset to defaults.');
      })
    );

  return config;
}
