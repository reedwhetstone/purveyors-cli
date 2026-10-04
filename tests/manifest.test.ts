import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { EXIT_CODES } from '../src/lib/errors.js';
import { getCliManifest, renderContextText, type CliOptionContract } from '../src/lib/manifest.js';
import { CLI_NUMERIC_BOUNDS } from '../src/lib/numeric-contracts.js';
import { createProgram } from '../src/program.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

function stripAnsi(text: string): string {
  return text.replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '').replace(/\r/g, '');
}

function longFlag(flags: string): string {
  const match = flags.match(/--[a-z0-9-]+/i);
  if (!match) {
    throw new Error(`No long flag found in: ${flags}`);
  }
  return match[0];
}

function flattenManifestCommands() {
  const manifest = getCliManifest();
  const commands = new Map<
    string,
    | (typeof manifest.commandGroups)[number]['command']
    | NonNullable<(typeof manifest.commandGroups)[number]['subcommands']>[number]
  >();

  for (const group of manifest.commandGroups) {
    if (group.command) {
      commands.set(group.name, group.command);
    }

    for (const subcommand of group.subcommands ?? []) {
      commands.set(`${group.name} ${subcommand.name}`, subcommand);
    }
  }

  return commands;
}

function flattenCommanderLeafCommands(
  command: Command,
  prefix: string[] = []
): Map<string, Command> {
  const commands = new Map<string, Command>();

  for (const subcommand of command.commands) {
    const path = [...prefix, subcommand.name()];
    if (subcommand.commands.length === 0) {
      commands.set(path.join(' '), subcommand);
      continue;
    }

    // A group with its own action (bare `purvey price-index`) is runnable too.
    if ((subcommand as unknown as { _actionHandler: unknown })._actionHandler) {
      commands.set(path.join(' '), subcommand);
    }

    for (const entry of flattenCommanderLeafCommands(subcommand, path)) {
      commands.set(entry[0], entry[1]);
    }
  }

  return commands;
}

/** Every option contract in the manifest, labeled by the command that owns it. */
function manifestOptions(): Array<[string, CliOptionContract]> {
  const manifest = getCliManifest();
  const options: Array<[string, CliOptionContract]> = manifest.globalOptions.map((option) => [
    'global',
    option,
  ]);
  for (const [key, command] of flattenManifestCommands()) {
    for (const option of command?.options ?? []) options.push([key, option]);
  }
  return options;
}

/**
 * Implementation detail that does not belong in customer-facing CLI copy:
 * backing endpoints, SDK plumbing, database table names, and design references.
 * Output field names such as canonical_candidates stay allowed.
 */
const INTERNAL_COPY =
  /\bcanonical\b|decision surface|\bPADR\b|PADR-\d|§|\/v1\/|\bSDK\b|@purveyors\/sdk|\bRPC\b|\bbacked by\b|server-owned|server-side|query layer|\bPhase \d\b|\b(?:coffee_catalog|green_coffee_inv|roast_data|coffee_sales|roast_temperatures|roast_events)\b/i;

/** Customer-facing manifest text: summaries, descriptions, notes, and guidance. */
function manifestCopy(): Array<[string, string]> {
  const manifest = getCliManifest();
  const copy: Array<[string, string]> = [
    ['description', manifest.description],
    ['outputContract.stdout', manifest.outputContract.stdout],
    ['outputContract.stderr', manifest.outputContract.stderr],
    ['structuredErrors.when', manifest.outputContract.structuredErrors.when],
    ['structuredErrors.exception', manifest.outputContract.structuredErrors.exception ?? ''],
    ...manifest.outputContract.notes.map((note): [string, string] => ['outputContract', note]),
    ...manifest.machineSurfaces.notes.map((note): [string, string] => ['machineSurfaces', note]),
    ...manifest.roles.map((role): [string, string] => [`role ${role.role}`, role.description]),
    ...manifest.exitCodes.map((code): [string, string] => [code.code, code.description]),
    ...manifest.idTypes.flatMap(
      (id): Array<[string, string]> => [
        [id.name, id.source],
        [id.name, id.note ?? ''],
      ]
    ),
    ...manifest.errorPatterns.flatMap((pattern) =>
      pattern.guidance.map((line): [string, string] => [pattern.title, line])
    ),
  ];
  for (const group of manifest.commandGroups) copy.push([group.name, group.summary]);
  for (const [key, command] of flattenManifestCommands()) {
    if (!command) continue;
    copy.push([key, command.summary]);
    for (const note of command.notes ?? []) copy.push([key, note]);
    for (const argument of command.arguments ?? []) copy.push([key, argument.description]);
  }
  for (const [key, option] of manifestOptions()) {
    copy.push([`${key} ${option.flags}`, option.description ?? '']);
    for (const note of option.notes ?? []) copy.push([`${key} ${option.flags}`, note]);
  }
  return copy;
}

/** Rendered `--help` for the program and every command under it. */
function renderedHelp(command: Command, path = 'purvey'): Array<[string, string]> {
  let text = '';
  command.configureOutput({ writeOut: (chunk) => (text += chunk) });
  command.outputHelp();
  return [
    [path, stripAnsi(text)],
    ...command.commands.flatMap((subcommand) =>
      renderedHelp(subcommand, `${path} ${subcommand.name()}`)
    ),
  ];
}

describe('CLI manifest contract', () => {
  it('is JSON-serializable and includes core sections', () => {
    const manifest = getCliManifest();
    const serialized = JSON.stringify(manifest);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(parsed.schemaVersion).toBe('1');
    expect(parsed.binary).toBe('purvey');
    expect(parsed.packageName).toBe('@purveyors/cli');
    expect(parsed.importPath).toBe('@purveyors/cli/manifest');
    expect(parsed.machineSurfaces).toEqual(
      expect.objectContaining({
        humanReference: 'purvey context',
        shellManifest: 'purvey manifest',
        moduleImport: '@purveyors/cli/manifest',
      })
    );
    expect(Array.isArray(parsed.commandGroups)).toBe(true);
    expect(Array.isArray(parsed.exitCodes)).toBe(true);
    expect(Array.isArray(parsed.idTypes)).toBe(true);
  });

  it('models context and manifest as root commands instead of fake nested subcommands', () => {
    const manifest = getCliManifest();
    const contextGroup = manifest.commandGroups.find((group) => group.name === 'context');
    const manifestGroup = manifest.commandGroups.find((group) => group.name === 'manifest');
    const rootReferenceKeys = [...flattenManifestCommands().keys()].filter(
      (key) => key === 'context' || key === 'manifest'
    );

    expect(contextGroup).toBeDefined();
    expect(contextGroup?.command).toEqual(
      expect.objectContaining({
        name: 'context',
        options: expect.arrayContaining([
          expect.objectContaining({ flags: '--json' }),
          expect.objectContaining({ flags: '--pretty' }),
        ]),
      })
    );
    expect(contextGroup?.subcommands).toBeUndefined();
    expect(manifestGroup).toBeDefined();
    expect(manifestGroup?.command).toEqual(
      expect.objectContaining({
        name: 'manifest',
        options: expect.arrayContaining([
          expect.objectContaining({ flags: '--json' }),
          expect.objectContaining({ flags: '--pretty' }),
        ]),
      })
    );
    expect(manifestGroup?.subcommands).toBeUndefined();
    expect(rootReferenceKeys).toEqual(['context', 'manifest']);
  });

  it('keeps exhaustive manifest command, argument, and option parity with commander', () => {
    const manifestCommands = flattenManifestCommands();
    const commanderCommands = flattenCommanderLeafCommands(createProgram('0.12.0-test'));

    expect([...manifestCommands.keys()].sort()).toEqual([...commanderCommands.keys()].sort());

    for (const [key, command] of commanderCommands) {
      const manifestCommand = manifestCommands.get(key);
      expect(manifestCommand, `missing manifest entry for ${key}`).toBeDefined();

      const actualArguments = command.registeredArguments.map((argument) => ({
        token: argument.name(),
        required: argument.required,
      }));
      const manifestArguments = (manifestCommand?.arguments ?? []).map((argument) => ({
        token: argument.cliToken ?? argument.name,
        required: argument.required,
      }));
      expect(manifestArguments, `${key} argument mismatch`).toEqual(actualArguments);

      const actualFlags = command.options.map((option) => option.long).sort();
      const manifestFlags = (manifestCommand?.options ?? [])
        .map((option) => longFlag(option.flags))
        .sort();
      expect(manifestFlags, `${key} option mismatch`).toEqual(actualFlags);
    }
  });

  it('lists every catalog command in the root help', () => {
    const help = renderedHelp(createProgram('0.12.0-test'))[0]?.[1] ?? '';

    const missing = [...flattenManifestCommands().keys()]
      .filter((key) => key.startsWith('catalog '))
      .filter((key) => !new RegExp(`^  ${key}\\s`, 'm').test(help));

    expect(missing).toEqual([]);
  });

  it('gives every manifest option, including global options, a non-empty description', () => {
    const missing = manifestOptions()
      .filter(([, option]) => !option.description?.trim())
      .map(([key, option]) => `${key} ${option.flags}`);

    expect(missing).toEqual([]);
  });

  it('renders every commander option description from the manifest', () => {
    const program = createProgram('0.12.0-test');
    const commands = [
      ['global', program] as const,
      ...flattenCommanderLeafCommands(program).entries(),
    ];

    for (const [key, command] of commands) {
      for (const option of command.options) {
        if (option.long === '--help') continue;
        expect(option.description.trim(), `${key} ${option.long} help`).not.toBe('');
      }
    }

    const search = flattenCommanderLeafCommands(program).get('catalog search');
    const limit = search?.options.find((option) => option.long === '--limit');
    const manifestLimit = flattenManifestCommands()
      .get('catalog search')
      ?.options?.find((option) => longFlag(option.flags) === '--limit');
    expect(limit?.description).toContain(manifestLimit?.description);
  });

  it('renders the built-in -h, --help option from the manifest on every command', () => {
    const help = getCliManifest().globalOptions.find((option) => option.flags === '--help');
    expect(help?.description).toBeTruthy();

    for (const [path, text] of renderedHelp(createProgram('0.12.0-test'))) {
      const line = text.split('\n').find((candidate) => /^\s*-h, --help\b/.test(candidate));
      expect(line, `${path} -h, --help`).toContain(help?.description);
    }
  });

  it('keeps fixed option bounds in minimum/maximum, not in description text', () => {
    const repeated = manifestOptions()
      .filter(([, option]) => option.minimum !== undefined && option.maximum !== undefined)
      .filter(([, option]) =>
        [option.minimum, option.maximum].every((bound) =>
          new RegExp(`(^|[^0-9.])${String(bound).replace('.', '\\.')}(?![0-9])`).test(
            option.description ?? ''
          )
        )
      )
      .map(([key, option]) => `${key} ${option.flags}: ${option.description}`);

    expect(repeated).toEqual([]);
  });

  it('declares every commander default in the manifest with the same value', () => {
    const manifestCommands = flattenManifestCommands();

    for (const [key, command] of flattenCommanderLeafCommands(createProgram('0.12.0-test'))) {
      for (const option of command.options) {
        if (option.defaultValue === undefined || Array.isArray(option.defaultValue)) continue;
        const contract = manifestCommands
          .get(key)
          ?.options?.find((candidate) => longFlag(candidate.flags) === option.long);
        expect(String(contract?.defaultValue), `${key} ${option.long} default`).toBe(
          String(option.defaultValue)
        );
      }
    }
  });

  it('publishes option bounds as minimum and maximum pairs', () => {
    const unpaired = manifestOptions()
      .filter(([, option]) => (option.minimum === undefined) !== (option.maximum === undefined))
      .map(([key, option]) => `${key} ${option.flags}`);

    expect(unpaired).toEqual([]);
  });

  it('marks options required in flag mode only on commands that offer --form', () => {
    for (const [key, command] of flattenManifestCommands()) {
      const options = command?.options ?? [];
      if (options.some((option) => option.requiredInFlagMode)) {
        expect(
          options.some((option) => option.flags === '--form'),
          `${key} has requiredInFlagMode without --form`
        ).toBe(true);
      }
    }
  });

  it('keeps implementation jargon out of customer-facing manifest copy', () => {
    const leaks = manifestCopy()
      .filter(([, text]) => INTERNAL_COPY.test(text))
      .map(([where, text]) => `${where}: ${text}`);

    expect(leaks).toEqual([]);
  });

  it('keeps implementation jargon out of rendered --help text', () => {
    const leaks = renderedHelp(createProgram('0.12.0-test')).flatMap(([path, text]) =>
      text
        .split('\n')
        .filter((line) => INTERNAL_COPY.test(line))
        .map((line) => `${path}: ${line.trim()}`)
    );

    expect(leaks).toEqual([]);
  });

  it('describes catalog similar access the way Parchment enforces it', () => {
    const similar = flattenManifestCommands().get('catalog similar');
    const access = similar?.notes?.join(' ') ?? '';

    // Any sign-in works: `purvey auth login` stores an API key with catalog:read,
    // and Parchment admits any customer API key with that scope, on any plan.
    expect(similar?.auth).toBe('viewer');
    expect(access).toContain('purvey auth login');
    expect(access).toContain('any API key with catalog:read');
    expect(access).toContain('Green');
    expect(access).not.toMatch(/member|paid/i);
  });

  it('does not claim member access for structured process filters', () => {
    const search = flattenManifestCommands().get('catalog search');
    const copy = [
      search?.summary ?? '',
      ...(search?.notes ?? []),
      ...(search?.options ?? []).map((option) => option.description ?? ''),
    ];

    expect(copy.filter((text) => /member/i.test(text))).toEqual([]);
  });

  it('publishes canonical numeric bounds for bounded endpoint options', () => {
    const commands = flattenManifestCommands();
    const commanderCommands = flattenCommanderLeafCommands(createProgram('0.12.0-test'));
    const expectedBounds = [
      ['catalog search', '--limit', CLI_NUMERIC_BOUNDS.catalogSearchLimit],
      ['catalog supplier-rank', '--min-coffees', CLI_NUMERIC_BOUNDS.supplierMinCoffees],
      ['market signals', '--limit', CLI_NUMERIC_BOUNDS.marketSignalsLimit],
      ['price-index', '--limit', CLI_NUMERIC_BOUNDS.priceIndexLimit],
      ['price-index history', '--limit', CLI_NUMERIC_BOUNDS.priceIndexHistoryLimit],
      ['price-index history', '--window-days', CLI_NUMERIC_BOUNDS.priceIndexHistoryWindowDays],
      ['procurement matches', '--limit', CLI_NUMERIC_BOUNDS.procurementMatchesLimit],
      ['reference-profile roasts', '--limit', CLI_NUMERIC_BOUNDS.referenceProfileRoastsLimit],
    ] as const;

    for (const [commandName, flag, bounds] of expectedBounds) {
      const option = commands
        .get(commandName)
        ?.options?.find((candidate) => longFlag(candidate.flags) === flag);

      expect(option, `${commandName} ${flag} manifest metadata`).toEqual(
        expect.objectContaining({ minimum: bounds.minimum, maximum: bounds.maximum })
      );
      const help = commanderCommands
        .get(commandName)
        ?.options.find((candidate) => candidate.long === flag)?.description;
      expect(help, `${commandName} ${flag} help`).toContain(`${bounds.minimum}-${bounds.maximum}`);
    }
  });

  it('describes the shared exit code and machine-mode error-envelope contracts', () => {
    const manifest = getCliManifest();

    expect(manifest.exitCodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exitCode: EXIT_CODES.OK, code: 'OK' }),
        expect.objectContaining({
          exitCode: EXIT_CODES.INVALID_ARGUMENT,
          code: 'INVALID_ARGUMENT',
        }),
        expect.objectContaining({ exitCode: EXIT_CODES.AUTH_ERROR, code: 'AUTH_ERROR' }),
        expect.objectContaining({ exitCode: EXIT_CODES.NOT_FOUND, code: 'NOT_FOUND' }),
        expect.objectContaining({
          exitCode: EXIT_CODES.DEPENDENCY_CONFLICT,
          code: 'DEPENDENCY_CONFLICT',
        }),
        expect.objectContaining({ exitCode: EXIT_CODES.CONFIG_ERROR, code: 'CONFIG_ERROR' }),
      ])
    );

    expect(manifest.outputContract.stdout).toContain(
      'Structured JSON by default for most commands'
    );
    expect(manifest.outputContract.notes).toContain(
      '`purvey context` prints dense human-readable operator reference text unless --json or --pretty is passed.'
    );
    expect(manifest.outputContract.notes).toContain(
      '`purvey manifest` is the preferred machine-readable contract and always emits it on stdout.'
    );
    expect(manifest.outputContract.notes).toContain(
      '`purvey context --json` stays available for compatibility parity with existing context-based callers.'
    );
    expect(manifest.outputContract.notes).toContain(
      '`@purveyors/cli/manifest` exposes the same machine-readable contract for in-process consumers.'
    );
    expect(manifest.machineSurfaces.notes).toContain(
      '`@purveyors/cli/manifest` exposes the same manifest contract in-process for Node.js and agent consumers.'
    );
    expect(manifest.machineSurfaces.notes).toContain(
      '`@purveyors/cli/cherry` is the primary in-process Cherry roast-classification helper; `@purveyors/cli/ai` is its deprecated compatibility re-export.'
    );
    expect(manifest.outputContract.notes).toContain(
      '`purvey config list/get/set/reset` stay human-readable in an interactive TTY, but emit JSON on stdout in machine mode and reject --csv.'
    );
    expect(manifest.outputContract.structuredErrors).toEqual(
      expect.objectContaining({
        channel: 'stderr',
        guaranteedFields: ['error', 'code', 'exitCode', 'message'],
        optionalFields: ['details'],
      })
    );
    expect(manifest.outputContract.structuredErrors.when).toContain(
      'parser and runtime command failures'
    );
    expect(manifest.outputContract.structuredErrors.when).toContain('non-interactive');
    expect(manifest.outputContract.structuredErrors.exception).toContain('auth status');
    expect(manifest.outputContract.notes).toContain(
      'Parser mistakes like unknown options, unknown commands, and missing required arguments follow the same fatal-error contract as runtime command failures.'
    );
  });

  it('renders human-readable context text that matches the actual CLI surface', () => {
    const text = renderContextText();

    expect(text).toContain('PURVEY CLI - Agent Reference');
    expect(text).toContain('Module import:    @purveyors/cli/manifest');
    expect(text).toContain(
      'No pre-existing credentials required for: auth, config, context, manifest, skill.'
    );
    expect(text).toContain('Local-only commands: config, context, manifest, skill.');
    expect(text).toContain('Mixed public and entitled access: market, price-index.');
    expect(text).toContain(
      'Mixed-access public teaser slices can run without credentials; filtered or non-public slices require a valid scoped key and server-side entitlements.'
    );
    expect(text).not.toContain('ALL commands require authentication.');
    expect(text).toContain('Machine-mode error envelope: stderr');
    expect(text).toContain('guaranteed fields: error, code, exitCode, message');
    expect(text).toContain(
      'Parser mistakes like unknown options, unknown commands, and missing required arguments follow the same fatal-error contract as runtime command failures.'
    );
    expect(text).toContain('context [options]');
    expect(text).toContain('manifest [options]');
    expect(text).toContain('Machine mode emits the full config object as JSON.');
    expect(text).not.toContain('context\n  context');
    expect(text).toContain('tasting\n  get <bean-id> [options]');
    expect(text).toContain('  import [file] [options]');
    expect(text).toContain(
      'Prefer `purvey manifest` for the stable machine-readable CLI contract.'
    );
    expect(text).toContain(
      'Use `purvey context --json` only for compatibility with existing context-based callers.'
    );
    expect(text).toContain('Quick discovery:  purvey --help');
  });

  it('falls back to legacy machine surfaces when rendering older schema version 1 manifests', () => {
    const legacyManifest = JSON.parse(JSON.stringify(getCliManifest())) as {
      machineSurfaces?: unknown;
    } & ReturnType<typeof getCliManifest>;

    delete legacyManifest.machineSurfaces;

    const text = renderContextText(legacyManifest);

    expect(text).toContain('Quick discovery:  purvey --help');
    expect(text).toContain('Human reference:  purvey context');
    expect(text).toContain('JSON manifest:    purvey manifest');
    expect(text).toContain('Module import:    @purveyors/cli/manifest');
  });

  it('describes `purvey --help` as quick discovery and keeps machine surfaces distinct', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const helpText = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(helpText).toContain('Quick discovery:  purvey --help');
    expect(helpText).toContain('Human reference:  purvey context');
    expect(helpText).toContain('JSON manifest:    purvey manifest');
    expect(helpText).toContain('Module import:    @purveyors/cli/manifest');
    // Padding/wrapping in commander's auto command list shifts as commands are
    // added; assert the command term + start of its description rather than a
    // fixed-width single-line slice so the check survives column reflow.
    expect(helpText).toMatch(
      /context \[options\]\s+Output the dense human-readable operator reference/
    );
    expect(helpText).toMatch(
      /manifest \[options\]\s+Output the preferred stable machine-readable CLI/
    );
  });

  it('describes API-key custody without advertising the removed session runtime', () => {
    const serialized = JSON.stringify(getCliManifest());

    expect(serialized).not.toMatch(/session-authenticated|logged-in session|Purveyors session/);
    expect(serialized).toContain('scoped API key');
    expect(serialized).toContain('purvey auth login');
  });

  it('emits valid JSON from `purvey context --json` with the corrected context shape', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'context', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(stripAnsi(result.stdout).trim()) as {
      schemaVersion: string;
      binary: string;
      commandGroups: Array<Record<string, unknown>>;
    };
    const contextGroup = manifest.commandGroups.find((group) => group.name === 'context') as
      | { command?: { name?: string }; subcommands?: unknown[] }
      | undefined;

    expect(manifest.schemaVersion).toBe('1');
    expect(manifest.binary).toBe('purvey');
    expect(contextGroup?.command?.name).toBe('context');
    expect(contextGroup?.subcommands).toBeUndefined();
  }, 15000);

  it('emits valid JSON from `purvey manifest` and keeps it in parity with `purvey context --json`', () => {
    const manifestResult = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'manifest'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const contextResult = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'context', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    expect(manifestResult.status).toBe(0);
    expect(manifestResult.stderr).toBe('');
    expect(contextResult.status).toBe(0);
    expect(contextResult.stderr).toBe('');

    const manifestOutput = JSON.parse(stripAnsi(manifestResult.stdout).trim());
    const contextOutput = JSON.parse(stripAnsi(contextResult.stdout).trim());

    expect(manifestOutput).toEqual(contextOutput);
  }, 15000);

  it('keeps `purvey context` human-readable by default', () => {
    const result = spawnSync('pnpm', ['exec', 'tsx', 'src/index.ts', 'context'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stripAnsi(result.stdout);

    expect(result.status).toBe(0);
    expect(output).toContain('PURVEY CLI - Agent Reference');
    expect(output).toContain('WORKFLOWS');
    expect(output).toContain(
      'No pre-existing credentials required for: auth, config, context, manifest, skill.'
    );
    expect(output).toContain('Local-only commands: config, context, manifest, skill.');
    expect(output).toContain('Mixed public and entitled access: market, price-index.');
    expect(output.trim().startsWith('{')).toBe(false);
  }, 15000);
});
