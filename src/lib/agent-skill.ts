import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PrvrsError } from './errors.js';
import {
  HEADLESS_LOGIN_STEPS,
  getCliManifest,
  type CliAuthRequirement,
  type CliCommandGroupContract,
  type CliManifest,
} from './manifest.js';

/**
 * Agent instructions rendered from the CLI manifest. The manifest stays the
 * single source of truth: commands, flags, auth, output, exit codes, ID types,
 * and workflows all come from `getCliManifest()`, so the skill cannot drift
 * from the contract it describes.
 */

export const AGENT_SKILL_NAME = 'purveyors';
export const AGENT_SKILL_FILE = 'SKILL.md';
/** Upper bound for the rendered SKILL.md, enforced by tests. */
export const AGENT_SKILL_MAX_BYTES = 8 * 1024;

const SKILL_TOPICS =
  'green coffee sourcing, the purveyors.io coffee catalog, green coffee prices and market moves, green inventory, roast logging and Artisan .alog files, sales, and tasting notes';

export const AGENT_SKILL_DESCRIPTION = `${capitalize(SKILL_TOPICS)}, through the \`purvey\` CLI. Use when the user wants to find or compare green coffees or suppliers, check prices or market signals, track inventory, log, import, or plan roasts, record sales, or rate coffees.`;

export const SKILL_TARGETS = ['claude', 'agents', 'agents-md'] as const;
export const SKILL_SCOPES = ['user', 'project'] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];
export type SkillScope = (typeof SKILL_SCOPES)[number];
export type SkillInstallAction = 'create' | 'update' | 'unchanged' | 'append' | 'overwrite';

export interface SkillInstallResult {
  target: SkillTarget;
  scope: SkillScope;
  path: string;
  action: SkillInstallAction;
  written: boolean;
  dryRun: boolean;
  cliVersion: string;
  bytes: number;
}

const ACCESS_LABELS: Record<CliCommandGroupContract['auth'], string> = {
  none: 'no sign-in',
  viewer: 'sign-in',
  member: 'member role',
  mixed: 'mixed access',
};

// Per-command labels, used when a group's commands differ in access.
const COMMAND_ACCESS_LABELS: Record<CliAuthRequirement, string> = {
  none: 'public default view',
  viewer: 'sign-in',
  member: 'member role',
};

// Error patterns whose guidance another skill section already gives in full.
const ERROR_PATTERNS_COVERED_ELSEWHERE = new Set([
  'Not logged in',
  'Wrong ID type',
  'Parser mistakes like unknown options or commands',
  'Missing required args in write commands',
]);

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * List a group's commands. When access differs across them, label each run of
 * commands with its own access so an agent never picks a protected command
 * expecting the public slice.
 */
function renderGroupCommands(group: CliCommandGroupContract): string {
  const commands = [
    ...(group.command ? [{ name: `${group.name} itself`, auth: group.command.auth }] : []),
    ...(group.subcommands ?? []).map(({ name, auth }) => ({ name, auth })),
  ];
  if (commands.every((command) => command.auth === group.auth)) {
    return commands.map((command) => command.name).join(', ');
  }

  const byAccess = new Map<CliAuthRequirement, string[]>();
  for (const command of commands) {
    byAccess.set(command.auth, [...(byAccess.get(command.auth) ?? []), command.name]);
  }
  return [...byAccess]
    .map(([auth, names]) => `${names.join(', ')} (${COMMAND_ACCESS_LABELS[auth]})`)
    .join('; ');
}

/** Drop transport boilerplate that matters to maintainers, not to an agent choosing a command. */
function agentSummary(summary: string): string {
  return summary.replace(/ (?:via|through|from) the canonical API$/, '');
}

function renderWhenToUse(manifest: CliManifest): string[] {
  // Credential-free groups (auth, config, context, manifest, skill) are setup
  // and reference surfaces, covered in their own sections below.
  const dataGroups = manifest.commandGroups.filter((group) => group.auth !== 'none');
  return [
    '## When to use it',
    '',
    `Use \`${manifest.binary}\` for any Purveyors task instead of scraping purveyors.io or guessing API calls. Command groups and their access:`,
    '',
    ...dataGroups.map(
      (group) =>
        `- **${group.name}** (${ACCESS_LABELS[group.auth]}): ${agentSummary(group.summary)}. Commands: ${renderGroupCommands(group)}.`
    ),
  ];
}

function renderSetup(manifest: CliManifest): string[] {
  return [
    '## Set up and sign in',
    '',
    `1. Install (${manifest.nodeVersion}): \`npm install -g ${manifest.packageName}\`, then check \`purvey --version\`.`,
    '2. Check for an existing login: `purvey auth status --json` prints `"authenticated": true` and the role, or exits 3 when signed out.',
    '3. If not signed in, run `purvey auth login --headless`. It prints the URL at once, then waits:',
    ...HEADLESS_LOGIN_STEPS.map((step, index) => `   ${index + 1}. ${step}`),
    '',
    '   If your shell tool shows output only after a command exits, run it in the background to read the URL. Show the URL to the user; sign-in is done when the command exits 0. Rerun it if the request expires.',
    '4. Never ask the user to paste an API key, token, or password into the chat. The CLI stores its own scoped key in ' +
      `\`${manifest.files.credentials}\`; \`PURVEYORS_API_KEY\` or \`PARCHMENT_API_KEY\` in the environment overrides it.`,
    '5. "sign-in" commands work for any signed-in account; "member role" needs a Purveyors membership; "public default view" runs signed out, but filters and longer windows need Parchment Intelligence. reference-profile needs Studio access. Missing access exits 3; relay the message to the user instead of retrying.',
  ];
}

function renderOutput(manifest: CliManifest): string[] {
  const { structuredErrors } = manifest.outputContract;
  const fields = (names: string[]) => names.map((field) => `\`${field}\``).join(', ');
  return [
    '## Output, errors, and exit codes',
    '',
    '- stdout carries the result as compact JSON by default; parse it rather than scraping text. Drop `--pretty` from the examples below when parsing.',
    `- In a non-interactive shell, a failure prints one JSON envelope on ${structuredErrors.channel} with ${fields(structuredErrors.guaranteedFields)} and sometimes ${fields(structuredErrors.optionalFields)}. Progress messages also go to ${structuredErrors.channel}.`,
    `- Exit codes: ${manifest.exitCodes.map((code) => `\`${code.exitCode}\` ${code.description}`).join('; ')}.`,
  ];
}

function renderIdMap(manifest: CliManifest): string[] {
  return [
    '## ID map',
    '',
    'IDs are not interchangeable. Pass the type each command expects:',
    '',
    ...manifest.idTypes.map((id) => `- \`${id.name}\`: ${id.usedBy.join(', ')}`),
  ];
}

function renderWorkflows(manifest: CliManifest): string[] {
  const lines = [
    '## Workflows',
    '',
    'IDs and file paths below are placeholders. Take real IDs from search or list output.',
  ];
  for (const workflow of manifest.workflows) {
    lines.push('', `### ${workflow.title}`, '', '```sh', ...workflow.commands, '```');
  }
  return lines;
}

function renderRules(manifest: CliManifest): string[] {
  return [
    '## Working rules',
    '',
    '- Give every value on the command line: positional arguments per `--help`, flags for the rest. Do not use `--form`, which prompts interactively.',
    '- Confirm with the user before commands that change their data: add, create, update, delete, record, rate, import, save, and watch.',
    ...manifest.errorPatterns
      .filter((pattern) => !ERROR_PATTERNS_COVERED_ELSEWHERE.has(pattern.title))
      .map(
        (pattern) =>
          `- ${pattern.title}${pattern.exitCodes.length > 0 ? ` (exit ${pattern.exitCodes.join('/')})` : ''}: ${pattern.guidance.join(' ')}`
      ),
  ];
}

function renderReference(manifest: CliManifest): string[] {
  return [
    '## Full contract',
    '',
    `\`${manifest.machineSurfaces.shellManifest}\` prints the full contract as JSON: every command, argument, flag, default, auth requirement, and example. Check it before using a flag not shown here:`,
    '',
    '```sh',
    'purvey manifest | jq \'.commandGroups[] | select(.name == "catalog")\'',
    'purvey catalog search --help',
    '```',
    '',
    `\`${manifest.machineSurfaces.humanReference}\` prints it as dense text. Docs: ${manifest.docs
      .filter((link) => new URL(link.url).hostname.endsWith('purveyors.io'))
      .map((link) => `[${link.label}](${link.url})`)
      .join(', ')}.`,
    '',
    'After upgrading the CLI, refresh this file: rerun `purvey skill install` with the same `--target`.',
  ];
}

function renderSkillBody(manifest: CliManifest, version: string): string {
  return [
    '---',
    `name: ${AGENT_SKILL_NAME}`,
    `description: ${JSON.stringify(AGENT_SKILL_DESCRIPTION)}`,
    'metadata:',
    `  generated-by: ${JSON.stringify(`${manifest.packageName} ${version}`)}`,
    '---',
    '',
    `# Purveyors (\`${manifest.binary}\` CLI)`,
    '',
    ...renderWhenToUse(manifest),
    '',
    ...renderSetup(manifest),
    '',
    ...renderOutput(manifest),
    '',
    ...renderIdMap(manifest),
    '',
    ...renderWorkflows(manifest),
    '',
    ...renderRules(manifest),
    '',
    ...renderReference(manifest),
    '',
  ].join('\n');
}

function skillSeal(version: string, hash: string): string {
  return `<!-- generated by @purveyors/cli ${version} (purvey skill print); sha256:${hash} -->\n`;
}

const SKILL_SEAL_PATTERN =
  /<!-- generated by @purveyors\/cli \S+ \(purvey skill print\); sha256:([0-9a-f]{64}) -->\n?$/;

/**
 * Render SKILL.md in the open Agent Skills format. The trailing comment records
 * a hash of everything above it, so `install` can tell an unedited earlier copy
 * (safe to update) from one with local edits (needs --force).
 */
export function renderAgentSkill(
  version: string,
  manifest: CliManifest = getCliManifest()
): string {
  const body = renderSkillBody(manifest, version);
  return body + skillSeal(version, sha256(body));
}

function isUnmodifiedGeneratedSkill(text: string): boolean {
  const match = SKILL_SEAL_PATTERN.exec(text);
  return Boolean(match && sha256(text.slice(0, match.index)) === match[1]);
}

const AGENTS_MD_BEGIN = '<!-- BEGIN purvey agent instructions';
const AGENTS_MD_END = '<!-- END purvey agent instructions -->';
const AGENTS_MD_BEGIN_PATTERN =
  /^<!-- BEGIN purvey agent instructions: generated by @purveyors\/cli \S+ \(purvey skill print --agents-md\); sha256:([0-9a-f]{64}) -->$/;

function renderAgentsMdInner(manifest: CliManifest): string {
  const exitCodes = manifest.exitCodes
    .map((code) => `${code.exitCode} ${code.code.toLowerCase().replace(/_/g, ' ')}`)
    .join(', ');
  return [
    `## Purveyors coffee data (\`${manifest.binary}\` CLI)`,
    '',
    `- Use \`${manifest.binary}\` for ${SKILL_TOPICS}. Install with \`npm install -g ${manifest.packageName}\`.`,
    '- Sign in with `purvey auth login --headless`: show the user the approval URL it prints and wait for it to exit 0. Never ask for an API key, token, or password in chat.',
    `- stdout is JSON; failures print a JSON envelope on stderr. Exit codes: ${exitCodes}.`,
    `- IDs are not interchangeable (${manifest.idTypes.map((id) => `\`${id.name}\``).join(', ')}); check which one a command takes.`,
    '- Do not use `--form`. Confirm with the user before commands that change their data.',
    `- Full contract: \`${manifest.machineSurfaces.shellManifest}\`. Fuller guide with workflows: \`purvey skill print\`.`,
    '',
  ].join('\n');
}

/** Render the marked AGENTS.md block; markers let `install` refresh it in place. */
export function renderAgentsMdBlock(
  version: string,
  manifest: CliManifest = getCliManifest()
): string {
  const inner = renderAgentsMdInner(manifest);
  return `${AGENTS_MD_BEGIN}: generated by @purveyors/cli ${version} (purvey skill print --agents-md); sha256:${sha256(inner)} -->\n${inner}${AGENTS_MD_END}\n`;
}

interface ExistingAgentsMdBlock {
  start: number;
  end: number;
  unmodified: boolean;
}

function findAgentsMdBlock(text: string, path: string): ExistingAgentsMdBlock | null {
  const start = text.indexOf(AGENTS_MD_BEGIN);
  if (start === -1) {
    return null;
  }

  const endMarker = text.indexOf(AGENTS_MD_END, start);
  const beginLineEnd = text.indexOf('\n', start);
  if (
    endMarker === -1 ||
    beginLineEnd === -1 ||
    beginLineEnd > endMarker ||
    text.indexOf(AGENTS_MD_BEGIN, start + 1) !== -1
  ) {
    throw new PrvrsError(
      'CONFIG_ERROR',
      `${path} has an incomplete or repeated purvey agent instructions block. Fix or remove its BEGIN/END markers, then re-run.`,
      { path, reason: 'malformed-block' }
    );
  }

  let end = endMarker + AGENTS_MD_END.length;
  if (text[end] === '\n') {
    end += 1;
  }

  const match = AGENTS_MD_BEGIN_PATTERN.exec(text.slice(start, beginLineEnd));
  const inner = text.slice(beginLineEnd + 1, endMarker);
  return { start, end, unmodified: Boolean(match && sha256(inner) === match[1]) };
}

export function resolveSkillInstallPath(
  target: SkillTarget,
  scope: SkillScope,
  roots: { home?: string; cwd?: string } = {}
): string {
  const home = roots.home ?? homedir();
  const cwd = roots.cwd ?? process.cwd();

  if (target === 'agents-md') {
    return join(cwd, 'AGENTS.md');
  }

  const base = scope === 'user' ? home : cwd;
  const toolDir = target === 'claude' ? '.claude' : '.agents';
  return join(base, toolDir, 'skills', AGENT_SKILL_NAME, AGENT_SKILL_FILE);
}

function parseTarget(value: string | undefined): SkillTarget {
  if (!value) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `--target is required: ${SKILL_TARGETS.join(', ')}. Use claude for Claude Code, agents for Codex, Cursor, and other Agent Skills clients, or agents-md for this repository's AGENTS.md.`
    );
  }
  if (!(SKILL_TARGETS as readonly string[]).includes(value)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Unknown --target "${value}". Use one of: ${SKILL_TARGETS.join(', ')}.`
    );
  }
  return value as SkillTarget;
}

function parseScope(target: SkillTarget, value: string | undefined): SkillScope {
  if (value !== undefined && !(SKILL_SCOPES as readonly string[]).includes(value)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Unknown --scope "${value}". Use one of: ${SKILL_SCOPES.join(', ')}.`
    );
  }
  if (target === 'agents-md') {
    if (value === 'user') {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        'AGENTS.md is repository-level. Run from the repository root without --scope, or with --scope project.'
      );
    }
    return 'project';
  }
  return (value as SkillScope | undefined) ?? 'user';
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    if (code === 'EISDIR') {
      throw new PrvrsError('CONFIG_ERROR', `${path} is a directory, not a file.`, { path });
    }
    throw error;
  }
}

function refuseOverwrite(path: string, what: string): never {
  throw new PrvrsError(
    'CONFIG_ERROR',
    `${what} at ${path} has local edits or was not written by purvey. Keep it, or re-run with --force to replace it.`,
    { path, reason: 'modified' }
  );
}

function planSkillFile(
  existing: string | null,
  desired: string,
  path: string,
  force: boolean
): { action: SkillInstallAction; content: string } {
  if (existing === null) return { action: 'create', content: desired };
  if (existing === desired) return { action: 'unchanged', content: desired };
  if (isUnmodifiedGeneratedSkill(existing)) return { action: 'update', content: desired };
  if (force) return { action: 'overwrite', content: desired };
  return refuseOverwrite(path, 'SKILL.md');
}

function planAgentsMd(
  existing: string | null,
  block: string,
  path: string,
  force: boolean
): { action: SkillInstallAction; content: string } {
  if (existing === null) return { action: 'create', content: block };

  const current = findAgentsMdBlock(existing, path);
  if (!current) {
    const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
    return { action: 'append', content: `${existing}${separator}${block}` };
  }

  const content = existing.slice(0, current.start) + block + existing.slice(current.end);
  if (content === existing) return { action: 'unchanged', content };
  if (current.unmodified) return { action: 'update', content };
  if (force) return { action: 'overwrite', content };
  return refuseOverwrite(path, 'The purvey block in AGENTS.md');
}

async function writeFileAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.purvey-${process.pid}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, path);
}

export interface SkillInstallOptions {
  target?: string;
  scope?: string;
  force?: boolean;
  dryRun?: boolean;
  version: string;
  manifest?: CliManifest;
  home?: string;
  cwd?: string;
}

/**
 * Install the generated instructions. Never touches credentials or the network.
 * Identical content is left alone, unedited earlier output is updated, and
 * anything else needs `force`.
 */
export async function installAgentSkill(options: SkillInstallOptions): Promise<SkillInstallResult> {
  const target = parseTarget(options.target);
  const scope = parseScope(target, options.scope);
  const path = resolveSkillInstallPath(target, scope, options);
  const manifest = options.manifest ?? getCliManifest();
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);

  const existing = await readExisting(path);
  const plan =
    target === 'agents-md'
      ? planAgentsMd(existing, renderAgentsMdBlock(options.version, manifest), path, force)
      : planSkillFile(existing, renderAgentSkill(options.version, manifest), path, force);

  const written = !dryRun && plan.action !== 'unchanged';
  if (written) {
    await writeFileAtomically(path, plan.content);
  }

  return {
    target,
    scope,
    path,
    action: plan.action,
    written,
    dryRun,
    cliVersion: options.version,
    bytes: Buffer.byteLength(plan.content, 'utf8'),
  };
}
