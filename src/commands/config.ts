import { Command } from 'commander';
import { withErrorHandling, PrvrsError } from '../lib/errors.js';
import {
  readConfig,
  writeConfig,
  getConfigValue,
  setConfigValue,
  isValidConfigKey,
} from '../lib/config.js';
import { success, info } from '../lib/output.js';

// ─── Command builder ──────────────────────────────────────────────────────────

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
    .action(
      withErrorHandling(async () => {
        const cfg = await readConfig();
        const keys = Object.keys(cfg) as Array<keyof typeof cfg>;

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
    .action(
      withErrorHandling(async (key: string) => {
        if (!isValidConfigKey(key)) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            `Unknown config key: "${key}". Valid keys: form-mode.`
          );
        }

        const value = await getConfigValue(key);

        if (value === undefined) {
          info(`${key} is not set.`);
        } else {
          console.log(value);
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
  $ purvey config list
`
    )
    .action(
      withErrorHandling(async (key: string, value: string) => {
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

        success(`Config updated: ${key} = ${value}`);
      })
    );

  // ── config reset ──────────────────────────────────────────────────────────
  config
    .command('reset')
    .description('Reset all configuration to defaults')
    .action(
      withErrorHandling(async () => {
        await writeConfig({});
        success('Config reset to defaults.');
      })
    );

  return config;
}
