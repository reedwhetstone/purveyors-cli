import { describe, expect, it } from 'vitest';
import { createParchmentClient, type ConfirmedActionExecuteRequest } from '@purveyors/sdk';
import { getCliManifest, type CliCommandContract } from '../src/lib/manifest.js';
// Swap this import for the SDK's export once @purveyors/sdk publishes the list.
import { WEB_AGENT_CAPABILITIES } from './fixtures/web-agent-capabilities.js';

/**
 * Rule: the CLI may do more than the Cherry web agent, never less. Every SDK
 * method the agent can call must be consumed by a CLI command, and every
 * session-only confirmed action must have an API-key CLI equivalent.
 *
 * A gap belongs here only when no API-key route exists for the capability, so
 * the CLI cannot close it without a Parchment change. Remove the entry when
 * that route ships and a command declares it.
 */
const KNOWN_CLI_GAPS: Record<string, string> = {
  create_roast_from_reference:
    'Parchment creates the roast from the private Artisan source stored with the reference, and only the session-only confirmed-action route can read it. `roast import` covers the same outcome only when the original .alog file is available locally.',
};

// Compile-time guard: the checked-in action list covers every SDK action type.
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

  it('declares only known confirmed actions as equivalents', () => {
    const actions: readonly string[] = WEB_AGENT_CAPABILITIES.confirmedActions;
    for (const { path, command } of manifestCommands()) {
      for (const action of command.confirmedActionEquivalents ?? []) {
        expect(actions, `${path} declares ${action}`).toContain(action);
      }
    }
  });
});
