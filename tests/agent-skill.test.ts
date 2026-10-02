import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_DESCRIPTION,
  AGENT_SKILL_MAX_BYTES,
  AGENT_SKILL_NAME,
  installAgentSkill,
  renderAgentSkill,
  renderAgentsMdBlock,
  resolveSkillInstallPath,
} from '../src/lib/agent-skill.js';
import { EXIT_CODES } from '../src/lib/errors.js';
import { getCliManifest } from '../src/lib/manifest.js';
import { getCliVersion } from '../src/program.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const tsxBin = resolve(repoRoot, 'node_modules', '.bin', 'tsx');
const cliEntry = resolve(repoRoot, 'src', 'index.ts');
const version = getCliVersion();

// ─── Contract checker: every `purvey ...` invocation must exist in the manifest ──

function manifestCommandFlags(): Map<string, Set<string>> {
  const commands = new Map<string, Set<string>>();
  const longFlag = (flags: string) => flags.match(/--[a-z0-9-]+/i)?.[0] ?? flags;
  for (const group of getCliManifest().commandGroups) {
    if (group.command) {
      commands.set(
        group.name,
        new Set((group.command.options ?? []).map((o) => longFlag(o.flags)))
      );
    }
    for (const sub of group.subcommands ?? []) {
      commands.set(
        `${group.name} ${sub.name}`,
        new Set((sub.options ?? []).map((o) => longFlag(o.flags)))
      );
    }
  }
  return commands;
}

/** Shell-ish tokenizer: splits on whitespace, keeps quoted strings whole. */
function tokenize(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

/** Collect every `purvey ...` invocation from fenced blocks and inline code spans. */
function extractInvocations(markdown: string): string[] {
  const snippets: string[] = [];
  const withoutFences = markdown.replace(/```[a-z]*\n([\s\S]*?)```/g, (_, body: string) => {
    snippets.push(...body.split('\n'));
    return '';
  });
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    snippets.push(match[1]);
  }
  return snippets
    .map((snippet) => snippet.trim())
    .filter((snippet) => /^purvey\s+\S/.test(snippet))
    .map((snippet) => snippet.split(/\s(?:\||>|&&|;)\s/)[0]);
}

function invalidInvocations(markdown: string): string[] {
  const commands = manifestCommandFlags();
  const groups = new Set(getCliManifest().commandGroups.map((group) => group.name));
  const globalFlags = new Set(getCliManifest().globalOptions.map((option) => option.flags));
  const problems: string[] = [];

  for (const invocation of extractInvocations(markdown)) {
    const tokens = tokenize(invocation).slice(1);
    const positional = tokens.filter((token) => !token.startsWith('-'));
    let path: string | undefined;
    if (positional.length >= 2 && commands.has(`${positional[0]} ${positional[1]}`)) {
      path = `${positional[0]} ${positional[1]}`;
    } else if (positional.length >= 1 && commands.has(positional[0])) {
      path = positional[0];
    } else if (
      tokens[0]?.startsWith('-') ||
      (positional.length === 1 && groups.has(positional[0]))
    ) {
      path = undefined; // global flag (`purvey --version`) or a bare group reference
    } else {
      problems.push(`${invocation}: unknown command`);
      continue;
    }

    if (path && tokens[0] !== path.split(' ')[0]) {
      problems.push(`${invocation}: flags before the command path`);
    }
    const allowed = path ? commands.get(path)! : new Set<string>();
    for (const token of tokens.filter((t) => t.startsWith('--'))) {
      const flag = token.split('=')[0];
      if (!allowed.has(flag) && !globalFlags.has(flag)) {
        problems.push(`${invocation}: ${flag} is not a flag of ${path ?? 'purvey'}`);
      }
    }
  }

  return problems;
}

function frontmatter(skill: string): Record<string, string> {
  const block = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = line.match(/^([a-z-]+):\s*(.*)$/);
    if (match && match[2]) {
      fields[match[1]] = match[2].startsWith('"') ? JSON.parse(match[2]) : match[2];
    }
  }
  return fields;
}

const RAW_KEY_PATTERNS = [
  /\b(?:pk|sk)_(?:live|test)_[A-Za-z0-9_-]+/,
  /\b(?:pk|sk)_[A-Za-z0-9]{12,}/,
  /Bearer\s+[A-Za-z0-9._-]{8,}/,
  /(?:PURVEYORS|PARCHMENT)_API_KEY\s*=/,
  /"apiKey"\s*:/,
];

describe('generated agent skill', () => {
  const skill = renderAgentSkill(version);
  const agentsMd = renderAgentsMdBlock(version);

  it('uses valid Agent Skills frontmatter that leads with its triggers', () => {
    const fields = frontmatter(skill);
    expect(fields.name).toBe(AGENT_SKILL_NAME);
    expect(fields.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(fields.name.length).toBeLessThanOrEqual(64);
    expect(fields.description).toBe(AGENT_SKILL_DESCRIPTION);
    expect(fields.description.length).toBeLessThanOrEqual(1024);
    expect(fields.description).toMatch(/^Green coffee sourcing/);
    for (const trigger of [
      'catalog',
      'prices',
      'market',
      'inventory',
      'roast',
      'Artisan',
      'sales',
      'tasting',
    ]) {
      expect(fields.description).toContain(trigger);
    }
  });

  it(`stays under ${AGENT_SKILL_MAX_BYTES} bytes`, () => {
    expect(Buffer.byteLength(skill, 'utf8')).toBeLessThanOrEqual(AGENT_SKILL_MAX_BYTES);
  });

  it('references only commands and flags that exist in the manifest', () => {
    const invocations = extractInvocations(skill);
    expect(invocations.length).toBeGreaterThan(20);
    expect(invalidInvocations(skill)).toEqual([]);
    expect(invalidInvocations(agentsMd)).toEqual([]);
  });

  it('catches invented commands and flags', () => {
    expect(invalidInvocations('`purvey catalog serch`')).toEqual([
      'purvey catalog serch: unknown command',
    ]);
    expect(invalidInvocations('```sh\npurvey inventory list --bogus\n```')).toEqual([
      'purvey inventory list --bogus: --bogus is not a flag of inventory list',
    ]);
  });

  it('renders every manifest workflow verbatim', () => {
    for (const workflow of getCliManifest().workflows) {
      expect(skill).toContain(`### ${workflow.title}`);
      for (const command of workflow.commands) {
        expect(skill).toContain(command);
      }
    }
  });

  it('teaches the headless device-approval login and never carries a raw API key', () => {
    for (const text of [skill, agentsMd]) {
      expect(text).toContain('purvey auth login --headless');
      expect(text).toMatch(/Never ask (?:the user to paste )?(?:for )?an API key/);
      for (const pattern of RAW_KEY_PATTERNS) {
        expect(text).not.toMatch(pattern);
      }
    }
    expect(skill).toContain('nothing is pasted back');
  });

  it('labels each command with its own access when a group mixes access levels', () => {
    const labels = { none: 'public default view', viewer: 'sign-in', member: 'member role' };
    for (const group of getCliManifest().commandGroups.filter((g) => g.auth !== 'none')) {
      const line = skill.split('\n').find((l) => l.startsWith(`- **${group.name}** (`));
      expect(line, group.name).toBeDefined();
      const commands = [
        ...(group.command ? [{ name: `${group.name} itself`, auth: group.command.auth }] : []),
        ...(group.subcommands ?? []),
      ];
      if (commands.every((command) => command.auth === group.auth)) continue;
      // Every run of commands ends with the label of the access those commands need.
      const runs = line!.split('Commands: ')[1].replace(/\.$/, '').split('; ');
      const rendered = new Map<string, string>();
      for (const run of runs) {
        const [, names, label] = run.match(/^(.*) \(([^)]+)\)$/)!;
        for (const name of names.split(', ')) rendered.set(name, label);
      }
      for (const command of commands) {
        expect(rendered.get(command.name), `${group.name} ${command.name}`).toBe(
          labels[command.auth]
        );
      }
    }
    expect(skill).toContain(
      'price-index itself, comparisons, comparison (member role); history (public default view)'
    );
  });

  it('keeps required positional arguments and limits pagination to commands with --offset', () => {
    expect(skill).not.toContain('Pass every value as a flag');
    expect(skill).toContain('positional arguments per `--help`');

    const paged: string[] = [];
    for (const group of getCliManifest().commandGroups) {
      for (const command of [
        ...(group.command ? [group.command] : []),
        ...(group.subcommands ?? []),
      ]) {
        const flags = (command.options ?? []).map((option) => option.flags.split(' ')[0]);
        if (flags.includes('--offset')) {
          expect(flags, command.name).toContain('--limit');
          paged.push(command === group.command ? group.name : `${group.name} ${command.name}`);
        }
      }
    }
    const rule = skill.split('\n').find((l) => l.startsWith('- Pagination'))!;
    const named = rule
      .match(/\(default --limit\): ([^.]+)\./)![1]
      .split(', ')
      .map((entry) => entry.replace(/ \d+$/, ''));
    expect(named).toEqual(paged);
    expect(named).not.toContain('procurement list');
    expect(named).not.toContain('reference-profile list');
  });

  it('points to `purvey manifest` as the full contract', () => {
    expect(skill).toContain('`purvey manifest` prints the full contract');
    expect(agentsMd).toContain('Full contract: `purvey manifest`');
  });
});

// ─── Install behavior ───────────────────────────────────────────────────────────

let sandbox: string;
let home: string;
let project: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'purvey-skill-'));
  home = join(sandbox, 'home');
  project = join(sandbox, 'project');
  mkdirSync(home);
  mkdirSync(project);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.PURVEYORS_API_KEY;
  delete env.PARCHMENT_API_KEY;
  const result = spawnSync(tsxBin, [cliEntry, ...args], {
    cwd: project,
    env,
    encoding: 'utf8',
  });
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

describe('purvey skill install', () => {
  it('resolves the documented install locations', () => {
    const roots = { home: '/h', cwd: '/p' };
    expect(resolveSkillInstallPath('claude', 'user', roots)).toBe(
      '/h/.claude/skills/purveyors/SKILL.md'
    );
    expect(resolveSkillInstallPath('claude', 'project', roots)).toBe(
      '/p/.claude/skills/purveyors/SKILL.md'
    );
    expect(resolveSkillInstallPath('agents', 'user', roots)).toBe(
      '/h/.agents/skills/purveyors/SKILL.md'
    );
    expect(resolveSkillInstallPath('agents', 'project', roots)).toBe(
      '/p/.agents/skills/purveyors/SKILL.md'
    );
    expect(resolveSkillInstallPath('agents-md', 'project', roots)).toBe('/p/AGENTS.md');
  });

  it('installs into a temp HOME without credentials, prints the path, and is idempotent', () => {
    const path = join(home, '.claude', 'skills', 'purveyors', 'SKILL.md');

    const first = runCli(['skill', 'install', '--target', 'claude']);
    expect(first.status).toBe(EXIT_CODES.OK);
    expect(first.json).toEqual(
      expect.objectContaining({
        target: 'claude',
        scope: 'user',
        path,
        action: 'create',
        written: true,
      })
    );
    expect(readFileSync(path, 'utf8')).toBe(runCli(['skill', 'print']).stdout);

    const second = runCli(['skill', 'install', '--target', 'claude']);
    expect(second.status).toBe(EXIT_CODES.OK);
    expect(second.json).toEqual(
      expect.objectContaining({ path, action: 'unchanged', written: false })
    );
  }, 30000);

  it('refuses to overwrite a locally edited SKILL.md without --force', () => {
    const path = join(home, '.agents', 'skills', 'purveyors', 'SKILL.md');
    expect(runCli(['skill', 'install', '--target', 'agents']).status).toBe(EXIT_CODES.OK);
    const edited = readFileSync(path, 'utf8').replace('## Working rules', '## My rules');
    writeFileSync(path, edited);

    const refused = runCli(['skill', 'install', '--target', 'agents']);
    expect(refused.status).toBe(EXIT_CODES.CONFIG_ERROR);
    expect(JSON.parse(refused.stderr)).toEqual(
      expect.objectContaining({ code: 'CONFIG_ERROR', message: expect.stringContaining('--force') })
    );
    expect(readFileSync(path, 'utf8')).toBe(edited);

    const forced = runCli(['skill', 'install', '--target', 'agents', '--force']);
    expect(forced.status).toBe(EXIT_CODES.OK);
    expect(forced.json).toEqual(expect.objectContaining({ action: 'overwrite', written: true }));
    expect(readFileSync(path, 'utf8')).toBe(renderAgentSkill(version));
  }, 30000);

  it('writes nothing on --dry-run', () => {
    const result = runCli([
      'skill',
      'install',
      '--target',
      'claude',
      '--scope',
      'project',
      '--dry-run',
    ]);
    const path = join(project, '.claude', 'skills', 'purveyors', 'SKILL.md');
    expect(result.status).toBe(EXIT_CODES.OK);
    expect(result.json).toEqual(
      expect.objectContaining({ path, action: 'create', written: false, dryRun: true })
    );
    expect(existsSync(path)).toBe(false);
  }, 30000);

  it('rejects a missing or unknown target', () => {
    expect(runCli(['skill', 'install']).status).toBe(EXIT_CODES.INVALID_ARGUMENT);
    expect(runCli(['skill', 'install', '--target', 'vim']).status).toBe(
      EXIT_CODES.INVALID_ARGUMENT
    );
    expect(runCli(['skill', 'install', '--target', 'agents-md', '--scope', 'user']).status).toBe(
      EXIT_CODES.INVALID_ARGUMENT
    );
  }, 30000);

  it('updates an unedited SKILL.md written by an earlier CLI version', async () => {
    const path = resolveSkillInstallPath('claude', 'user', { home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderAgentSkill('0.0.1'));

    const result = await installAgentSkill({ target: 'claude', version, home, cwd: project });
    expect(result.action).toBe('update');
    expect(readFileSync(path, 'utf8')).toBe(renderAgentSkill(version));
  });

  it('refuses a SKILL.md that purvey did not write', async () => {
    const path = resolveSkillInstallPath('agents', 'user', { home });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '---\nname: purveyors\ndescription: mine\n---\n');

    await expect(
      installAgentSkill({ target: 'agents', version, home, cwd: project })
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    await expect(
      installAgentSkill({ target: 'agents', version, home, cwd: project, dryRun: true })
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('adds, refreshes, and protects one marked block in AGENTS.md', async () => {
    const path = join(project, 'AGENTS.md');
    const install = (extra: { force?: boolean; version?: string } = {}) =>
      installAgentSkill({ target: 'agents-md', version, home, cwd: project, ...extra });
    writeFileSync(path, '# Repo rules\n\nUse pnpm.\n');

    expect((await install()).action).toBe('append');
    const appended = readFileSync(path, 'utf8');
    expect(appended).toBe(`# Repo rules\n\nUse pnpm.\n\n${renderAgentsMdBlock(version)}`);
    expect((await install()).action).toBe('unchanged');

    // An unedited block from an earlier version is refreshed in place.
    writeFileSync(
      path,
      appended.replace(renderAgentsMdBlock(version), renderAgentsMdBlock('0.0.1')) +
        '\n## Later section\n'
    );
    expect((await install()).action).toBe('update');
    expect(readFileSync(path, 'utf8')).toBe(`${appended}\n## Later section\n`);

    // A block with local edits needs --force; text outside the block survives.
    const edited = readFileSync(path, 'utf8').replace('Do not use `--form`.', 'Use --form.');
    writeFileSync(path, edited);
    await expect(install()).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(readFileSync(path, 'utf8')).toBe(edited);
    expect((await install({ force: true })).action).toBe('overwrite');
    expect(readFileSync(path, 'utf8')).toBe(`${appended}\n## Later section\n`);
  });

  it('creates AGENTS.md when absent and rejects a malformed block even with --force', async () => {
    const path = join(project, 'AGENTS.md');
    const created = await installAgentSkill({ target: 'agents-md', version, home, cwd: project });
    expect(created).toEqual(expect.objectContaining({ action: 'create', scope: 'project', path }));
    expect(readFileSync(path, 'utf8')).toBe(renderAgentsMdBlock(version));

    writeFileSync(path, '<!-- BEGIN purvey agent instructions: half a block -->\n');
    await expect(
      installAgentSkill({ target: 'agents-md', version, home, cwd: project, force: true })
    ).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
  });
});

describe('purvey skill print', () => {
  it('prints Markdown by default and a JSON wrapper with --json', () => {
    const markdown = runCli(['skill', 'print']);
    expect(markdown.status).toBe(EXIT_CODES.OK);
    expect(markdown.stdout).toBe(renderAgentSkill(version));

    const wrapped = runCli(['skill', 'print', '--agents-md', '--json']);
    expect(wrapped.json).toEqual({
      name: AGENT_SKILL_NAME,
      file: 'AGENTS.md',
      cliVersion: version,
      bytes: Buffer.byteLength(renderAgentsMdBlock(version), 'utf8'),
      content: renderAgentsMdBlock(version),
    });

    expect(runCli(['skill', 'print', '--csv']).status).toBe(EXIT_CODES.INVALID_ARGUMENT);
  }, 30000);
});
