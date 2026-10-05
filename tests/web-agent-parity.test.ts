import { describe, expect, it } from 'vitest';
import {
  CHAT_AGENT_CAPABILITIES,
  CHAT_AGENT_CONFIRMED_ACTION_TYPES,
  createParchmentClient,
  type ConfirmedActionExecuteRequest,
} from '@purveyors/sdk';
import { getCliManifest, type CliCommandContract } from '../src/lib/manifest.js';

// Parchment owns the web agent's capability list and publishes it with the SDK,
// so an SDK upgrade that gives Cherry a new capability fails here until the CLI
// covers it.
const WEB_AGENT_CAPABILITIES = {
  sdkMethods: CHAT_AGENT_CAPABILITIES,
  confirmedActions: CHAT_AGENT_CONFIRMED_ACTION_TYPES,
} as const;

/**
 * Rule: the CLI may do more than the Cherry web agent, never less. Every SDK
 * method the agent can call must be consumed by a CLI command, and every
 * session-only confirmed action must have an API-key CLI equivalent.
 *
 * A gap belongs here only when no API-key route exists for the capability, so
 * the CLI cannot close it without a Parchment change. Remove the entry when
 * that route ships and a command declares it.
 */
const KNOWN_CLI_GAPS: Record<string, string> = {};

// Compile-time guard: the published action list covers every SDK action type.
type UnlistedConfirmedAction = Exclude<
  ConfirmedActionExecuteRequest['actionType'],
  (typeof WEB_AGENT_CAPABILITIES)['confirmedActions'][number]
>;
const confirmedActionsAreExhaustive: [UnlistedConfirmedAction] extends [never] ? true : never =
  true;

function manifestCommands(): Array<{ path: string; command: CliCommandContract }> {
  const commands: Array<{ path: string; command: CliCommandContract }> = [];
  for (const group of getCliManifest().commandGroups) {
    if (group.command) commands.push({ path: group.name, command: group.command });
    for (const subcommand of group.subcommands ?? []) {
      commands.push({ path: `${group.name} ${subcommand.name}`, command: subcommand });
    }
  }
  return commands;
}

function commandsDeclaring(
  field: 'sdkMethods' | 'confirmedActionEquivalents',
  capability: string
): string[] {
  return manifestCommands()
    .filter(({ command }) => command[field]?.includes(capability))
    .map(({ path }) => path);
}

function resolveSdkMember(client: unknown, method: string): unknown {
  return method
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      client
    );
}

describe('CLI covers every web-agent capability', () => {
  it('keeps the checked-in confirmed-action list exhaustive for the installed SDK', () => {
    expect(confirmedActionsAreExhaustive).toBe(true);
  });

  it.each([...WEB_AGENT_CAPABILITIES.sdkMethods])(
    'SDK method %s is consumed by a CLI command',
    (method) => {
      expect(
        commandsDeclaring('sdkMethods', method),
        `No manifest command declares sdkMethods: ['${method}']. Add a command (or annotate the existing one) so the CLI is not behind the web agent.`
      ).not.toEqual([]);
    }
  );

  it.each([...WEB_AGENT_CAPABILITIES.confirmedActions])(
    'confirmed action %s has an API-key CLI equivalent or a documented gap',
    (action) => {
      const equivalents = commandsDeclaring('confirmedActionEquivalents', action);
      if (action in KNOWN_CLI_GAPS) {
        expect(
          equivalents,
          `${action} is now covered by ${equivalents.join(', ')}; remove it from KNOWN_CLI_GAPS.`
        ).toEqual([]);
        return;
      }
      expect(
        equivalents,
        `No manifest command declares confirmedActionEquivalents: ['${action}'].`
      ).not.toEqual([]);
    }
  );

  it('lists only real web-agent capabilities as known gaps', () => {
    const actions: readonly string[] = WEB_AGENT_CAPABILITIES.confirmedActions;
    const methods: readonly string[] = WEB_AGENT_CAPABILITIES.sdkMethods;
    for (const gap of Object.keys(KNOWN_CLI_GAPS)) {
      expect(actions.includes(gap) || methods.includes(gap), `stale gap ${gap}`).toBe(true);
    }
  });

  it('declares only SDK methods that exist on the installed client', () => {
    const client = createParchmentClient({ baseUrl: 'http://127.0.0.1:9', token: 'test' });
    for (const { path, command } of manifestCommands()) {
      for (const method of command.sdkMethods ?? []) {
        expect(typeof resolveSdkMember(client, method), `${path} declares ${method}`).toBe(
          'function'
        );
      }
    }
  });

  it('declares the selector and classification reads a command performs', () => {
    const sdkMethodsFor = (path: string) =>
      manifestCommands().find((entry) => entry.path === path)?.command.sdkMethods;
    // recordSale resolves its target through roasts.list, plus roasts.get for --roast-id and
    // roastBatches.get for --batch-id and for the candidates of a repeated batch name.
    expect(sdkMethodsFor('sales record')).toEqual(
      expect.arrayContaining(['sales.create', 'roasts.list', 'roasts.get', 'roastBatches.get'])
    );
    // --coffee-id reads the inventory item; --auto-match lists stock and calls classify.
    expect(sdkMethodsFor('roast watch')).toEqual(
      expect.arrayContaining(['roasts.import', 'inventory.list', 'roasts.classify'])
    );
    // Batch commit mode opens the session's batch, reads it back, and removes it when unused;
    // a session saved with only a batch name finds its batch through a saved roast.
    expect(sdkMethodsFor('roast watch')).toEqual(
      expect.arrayContaining([
        'roastBatches.create',
        'roastBatches.get',
        'roastBatches.delete',
        'roasts.get',
      ])
    );
    // No command path replaces or clears an Artisan import.
    expect(sdkMethodsFor('roast import')).toEqual(['roasts.import']);
    // Without --roast-revision, both roast-based commands read the roast's current revision.
    expect(sdkMethodsFor('reference-profile preview-from-roast')).toEqual([
      'referenceProfiles.previewFromRoast',
      'roasts.get',
    ]);
    expect(sdkMethodsFor('reference-profile from-roast')).toEqual([
      'referenceProfiles.fromRoast',
      'roasts.get',
    ]);
  });

  it('covers every roast batch SDK method ahead of the web agent', () => {
    // Parchment publishes these methods but does not give them to the assistant yet. The CLI
    // already consumes all five, so the parity rule holds on the day any of them is added.
    expect(commandsDeclaring('sdkMethods', 'roastBatches.list')).toEqual(['roast-batch list']);
    expect(commandsDeclaring('sdkMethods', 'roastBatches.get')).toEqual(
      expect.arrayContaining(['roast-batch get', 'sales record'])
    );
    expect(commandsDeclaring('sdkMethods', 'roastBatches.create')).toEqual(
      expect.arrayContaining(['roast-batch create', 'roast watch'])
    );
    expect(commandsDeclaring('sdkMethods', 'roastBatches.update')).toEqual(['roast-batch update']);
    expect(commandsDeclaring('sdkMethods', 'roastBatches.delete')).toEqual(
      expect.arrayContaining(['roast-batch delete', 'roast watch'])
    );
    // The name-based batch helpers are deprecated in favor of batch ids; nothing calls them.
    expect(commandsDeclaring('sdkMethods', 'roasts.createBatch')).toEqual([]);
    expect(commandsDeclaring('sdkMethods', 'roasts.deleteBatch')).toEqual([]);
  });

  it('covers the roast-history planning chain with API-key commands', () => {
    expect(commandsDeclaring('sdkMethods', 'referenceProfiles.roastCandidates')).toEqual([
      'reference-profile roasts',
    ]);
    expect(commandsDeclaring('sdkMethods', 'referenceProfiles.previewFromRoast')).toEqual([
      'reference-profile preview-from-roast',
    ]);
    // Saving a roast-based plan is two API-key writes: the roast's reference, then the plan.
    expect(commandsDeclaring('confirmedActionEquivalents', 'create_generated_reference')).toEqual([
      'reference-profile from-roast',
      'reference-profile save',
    ]);
    expect(commandsDeclaring('confirmedActionEquivalents', 'create_roast_from_reference')).toEqual([
      'roast from-reference',
    ]);
    expect(KNOWN_CLI_GAPS).toEqual({});
  });

  it('declares only known confirmed actions as equivalents', () => {
    const actions: readonly string[] = WEB_AGENT_CAPABILITIES.confirmedActions;
    for (const { path, command } of manifestCommands()) {
      for (const action of command.confirmedActionEquivalents ?? []) {
        expect(actions, `${path} declares ${action}`).toContain(action);
      }
    }
  });
});
