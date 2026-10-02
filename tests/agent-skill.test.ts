import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_SKILL_DESCRIPTION,
  AGENT_SKILL_MAX_BYTES,
  AGENT_SKILL_NAME,
  AGENT_WORKFLOWS_FILE,
  AGENT_WORKFLOWS_MAX_BYTES,
  installAgentSkill,
  renderAgentSkill,
  renderAgentWorkflows,
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
  const workflows = renderAgentWorkflows(version);
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

  // SKILL.md loads whenever the skill triggers. Step-by-step material belongs in
  // workflows.md, so each new manifest workflow adds only one index line here.
  it(`keeps SKILL.md under ${AGENT_SKILL_MAX_BYTES} bytes`, () => {
    expect(Buffer.byteLength(skill, 'utf8')).toBeLessThanOrEqual(AGENT_SKILL_MAX_BYTES);
  });

  it(`keeps workflows.md under ${AGENT_WORKFLOWS_MAX_BYTES} bytes`, () => {
    expect(Buffer.byteLength(workflows, 'utf8')).toBeLessThanOrEqual(AGENT_WORKFLOWS_MAX_BYTES);
  });

  it('references only commands and flags that exist in the manifest', () => {
    expect(extractInvocations(skill).length).toBeGreaterThan(5);
    expect(extractInvocations(workflows).length).toBeGreaterThan(15);
    expect(invalidInvocations(skill)).toEqual([]);
    expect(invalidInvocations(workflows)).toEqual([]);
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

  it('renders every manifest workflow verbatim in workflows.md and indexes it in SKILL.md', () => {
    const index = skill.split('## Workflows\n')[1].split('\n## ')[0];
    for (const workflow of getCliManifest().workflows) {
      expect(workflows).toContain(`\n## ${workflow.title}\n\n\`\`\`sh\n`);
      for (const command of workflow.commands) {
        expect(workflows).toContain(`\n${command}\n`);
      }
      expect(index).toContain(`\n- ${workflow.title}\n`);
    }
    // The steps live only in workflows.md.
    expect(skill).not.toContain('```sh\npurvey inventory add');
  });

  it('points SKILL.md to workflows.md with a relative link before multi-step tasks', () => {
    expect(skill).toContain(
      `Before a multi-step task, read [${AGENT_WORKFLOWS_FILE}](${AGENT_WORKFLOWS_FILE}) next to this file`
    );
    expect(skill).toContain('`purvey skill print --file workflows.md`');
    expect(workflows).toMatch(/^# Purveyors workflows/);
    expect(workflows).toContain('[SKILL.md](SKILL.md) covers sign-in');
    // Supporting files carry no frontmatter; only SKILL.md does.
    expect(workflows).not.toMatch(/^---\n/);
  });

  it('teaches the headless device-approval login and never carries a raw API key', () => {
    for (const text of [skill, agentsMd]) {
      expect(text).toContain('purvey auth login --headless');
      expect(text).toMatch(/Never ask (?:the user to paste )?(?:for )?an API key/);
    }
    for (const text of [skill, workflows, agentsMd]) {
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

  it('sends Claude Code to --target claude and Codex or Cursor to --target agents', () => {
    expect(skill).toContain('(`claude` for Claude Code, `agents` for Codex and Cursor)');
    expect(agentsMd).toContain(
      '`purvey skill install --target claude` in Claude Code, or `--target agents` in Codex, Cursor'
    );
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
  const skill = renderAgentSkill(version);
  const workflows = renderAgentWorkflows(version);
  const skillBytes = Buffer.byteLength(skill, 'utf8');
  const workflowsBytes = Buffer.byteLength(workflows, 'utf8');

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

  it('installs both files into a temp HOME without credentials and is idempotent', () => {
    const dir = join(home, '.claude', 'skills', 'purveyors');
    const skillPath = join(dir, 'SKILL.md');
    const workflowsPath = join(dir, 'workflows.md');

    const first = runCli(['skill', 'install', '--target', 'claude']);
    expect(first.status).toBe(EXIT_CODES.OK);
    expect(first.json).toEqual(
      expect.objectContaining({
        target: 'claude',
        scope: 'user',
        path: skillPath,
        action: 'create',
        written: true,
        bytes: Buffer.byteLength(skill + workflows, 'utf8'),
        files: [
          { file: 'SKILL.md', path: skillPath, action: 'create', written: true, bytes: skillBytes },
          {
            file: 'workflows.md',
            path: workflowsPath,
            action: 'create',
            written: true,
            bytes: workflowsBytes,
          },
        ],
      })
    );
    expect(readFileSync(skillPath, 'utf8')).toBe(runCli(['skill', 'print']).stdout);
    expect(readFileSync(workflowsPath, 'utf8')).toBe(
      runCli(['skill', 'print', '--file', 'workflows.md']).stdout
    );

    const second = runCli(['skill', 'install', '--target', 'claude']);
    expect(second.status).toBe(EXIT_CODES.OK);
    expect(second.json).toEqual(
      expect.objectContaining({ path: skillPath, action: 'unchanged', written: false })
    );
    expect((second.json as { files: { action: string }[] }).files.map((f) => f.action)).toEqual([
      'unchanged',
      'unchanged',
    ]);
  }, 30000);

  for (const file of ['SKILL.md', 'workflows.md'] as const) {
    it(`refuses to overwrite a locally edited ${file} without --force and writes nothing`, () => {
      const dir = join(home, '.agents', 'skills', 'purveyors');
      const path = join(dir, file);
      const other = join(dir, file === 'SKILL.md' ? 'workflows.md' : 'SKILL.md');
      expect(runCli(['skill', 'install', '--target', 'agents']).status).toBe(EXIT_CODES.OK);
      const edited = `${readFileSync(path, 'utf8')}\nMy own note.\n`;
      writeFileSync(path, edited);
      // An outdated sibling would normally be updated; a refusal must leave it alone too.
      const olderOther = (file === 'SKILL.md' ? renderAgentWorkflows : renderAgentSkill)('0.0.1');
      writeFileSync(other, olderOther);

      const refused = runCli(['skill', 'install', '--target', 'agents']);
      expect(refused.status).toBe(EXIT_CODES.CONFIG_ERROR);
      expect(JSON.parse(refused.stderr)).toEqual(
        expect.objectContaining({
          code: 'CONFIG_ERROR',
          message: expect.stringContaining(`${file} in ${dir} has local edits`),
        })
      );
      expect(readFileSync(path, 'utf8')).toBe(edited);
      expect(readFileSync(other, 'utf8')).toBe(olderOther);

      const forced = runCli(['skill', 'install', '--target', 'agents', '--force']);
      expect(forced.status).toBe(EXIT_CODES.OK);
      expect(forced.json).toEqual(expect.objectContaining({ action: 'overwrite', written: true }));
      const actions = Object.fromEntries(
        (forced.json as { files: { file: string; action: string }[] }).files.map((f) => [
          f.file,
          f.action,
        ])
      );
      expect(actions[file]).toBe('overwrite');
      expect(readFileSync(join(dir, 'SKILL.md'), 'utf8')).toBe(skill);
      expect(readFileSync(join(dir, 'workflows.md'), 'utf8')).toBe(workflows);
    }, 30000);
  }

  it('names every edited file in one refusal', async () => {
    const dir = dirname(resolveSkillInstallPath('claude', 'user', { home }));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '# mine\n');
    writeFileSync(join(dir, 'workflows.md'), '# mine too\n');
    await expect(
      installAgentSkill({ target: 'claude', version, home, cwd: project })
    ).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
      message: expect.stringContaining('SKILL.md and workflows.md'),
      details: { paths: [join(dir, 'SKILL.md'), join(dir, 'workflows.md')] },
    });
  });

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
    const dir = join(project, '.claude', 'skills', 'purveyors');
    expect(result.status).toBe(EXIT_CODES.OK);
    expect(result.json).toEqual(
      expect.objectContaining({
        path: join(dir, 'SKILL.md'),
        action: 'create',
        written: false,
        dryRun: true,
        files: [
          expect.objectContaining({ file: 'SKILL.md', action: 'create', written: false }),
          expect.objectContaining({ file: 'workflows.md', action: 'create', written: false }),
        ],
      })
    );
    expect(existsSync(dir)).toBe(false);
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

  it('updates both files when both are unedited output of an earlier CLI version', async () => {
    const path = resolveSkillInstallPath('claude', 'user', { home });
    const workflowsPath = join(dirname(path), 'workflows.md');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderAgentSkill('0.0.1'));
    writeFileSync(workflowsPath, renderAgentWorkflows('0.0.1'));

    const dryRun = await installAgentSkill({
      target: 'claude',
      version,
      home,
      cwd: project,
      dryRun: true,
    });
    expect(dryRun.files?.map((f) => f.action)).toEqual(['update', 'update']);
    expect(readFileSync(path, 'utf8')).toBe(renderAgentSkill('0.0.1'));

    const result = await installAgentSkill({ target: 'claude', version, home, cwd: project });
    expect(result.action).toBe('update');
    expect(result.files?.map((f) => f.action)).toEqual(['update', 'update']);
    expect(readFileSync(path, 'utf8')).toBe(skill);
    expect(readFileSync(workflowsPath, 'utf8')).toBe(workflows);
  });

  it('upgrades a single-file install: updates SKILL.md and creates workflows.md', async () => {
    const path = resolveSkillInstallPath('agents', 'user', { home });
    const workflowsPath = join(dirname(path), 'workflows.md');
    mkdirSync(dirname(path), { recursive: true });
    // The earlier single-file layout: workflows inline in SKILL.md, sealed by `purvey skill print`.
    const legacyBody =
      skill.slice(0, skill.indexOf('<!-- generated by')).split('## Workflows\n')[0] +
      '## Workflows\n\n### Catalog to inventory\n\n```sh\npurvey catalog search --origin "Ethiopia" --stocked --pretty\n```\n';
    const legacy = `${legacyBody}<!-- generated by @purveyors/cli 0.35.0 (purvey skill print); sha256:${createHash('sha256').update(legacyBody, 'utf8').digest('hex')} -->\n`;
    writeFileSync(path, legacy);

    const dryRun = await installAgentSkill({
      target: 'agents',
      version,
      home,
      cwd: project,
      dryRun: true,
    });
    expect(dryRun.files?.map((f) => f.action)).toEqual(['update', 'create']);
    expect(existsSync(workflowsPath)).toBe(false);

    const result = await installAgentSkill({ target: 'agents', version, home, cwd: project });
    expect(result).toEqual(expect.objectContaining({ action: 'update', written: true }));
    expect(result.files?.map((f) => [f.file, f.action, f.written])).toEqual([
      ['SKILL.md', 'update', true],
      ['workflows.md', 'create', true],
    ]);
    expect(readFileSync(path, 'utf8')).toBe(skill);
    expect(readFileSync(workflowsPath, 'utf8')).toBe(workflows);

    const again = await installAgentSkill({ target: 'agents', version, home, cwd: project });
    expect(again).toEqual(expect.objectContaining({ action: 'unchanged', written: false }));
  });

  it('recreates a deleted workflows.md without touching a current SKILL.md', async () => {
    const path = resolveSkillInstallPath('claude', 'user', { home });
    await installAgentSkill({ target: 'claude', version, home, cwd: project });
    rmSync(join(dirname(path), 'workflows.md'));
    const result = await installAgentSkill({ target: 'claude', version, home, cwd: project });
    expect(result.action).toBe('create');
    expect(result.files?.map((f) => f.action)).toEqual(['unchanged', 'create']);
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

describe('Claude Code visibility for the AGENTS.md block', () => {
  const install = (extra: { linkClaudeMd?: boolean; dryRun?: boolean; cwd?: string } = {}) =>
    installAgentSkill({ target: 'agents-md', version, home, cwd: project, ...extra });

  it('reports the block visible when no CLAUDE.md is on the path, and links nothing', async () => {
    const result = await install({ linkClaudeMd: true });
    expect(result.claudeCode).toEqual({
      visible: true,
      via: 'agents-md',
      reason: expect.stringContaining('reads AGENTS.md directly'),
      claudeMdFiles: [],
      link: { path: null, action: 'not-needed', written: false },
    });
    expect(existsSync(join(project, 'CLAUDE.md'))).toBe(false);
  });

  it('reports a CLAUDE.md without the import and leaves it alone by default', async () => {
    const claudeMd = join(project, 'CLAUDE.md');
    writeFileSync(claudeMd, '# Rules\n\nRead AGENTS.md before you start.\n');

    const result = await install();
    expect(result.claudeCode).toEqual({
      visible: false,
      via: null,
      reason: expect.stringContaining('--link-claude-md'),
      claudeMdFiles: [claudeMd],
    });
    expect(readFileSync(claudeMd, 'utf8')).toBe('# Rules\n\nRead AGENTS.md before you start.\n');
  });

  it('appends one @AGENTS.md line with --link-claude-md, honoring --dry-run and re-runs', async () => {
    const claudeMd = join(project, 'CLAUDE.md');
    const original = '# Rules\n\nUse pnpm.\n';
    writeFileSync(claudeMd, original);

    const dryRun = await install({ linkClaudeMd: true, dryRun: true });
    expect(dryRun.claudeCode?.link).toEqual({ path: claudeMd, action: 'append', written: false });
    expect(readFileSync(claudeMd, 'utf8')).toBe(original);
    expect(existsSync(join(project, 'AGENTS.md'))).toBe(false);

    const linked = await install({ linkClaudeMd: true });
    expect(linked.claudeCode).toEqual(
      expect.objectContaining({
        visible: true,
        via: 'claude-md-import',
        link: { path: claudeMd, action: 'append', written: true },
      })
    );
    expect(readFileSync(claudeMd, 'utf8')).toBe(`${original}\n@AGENTS.md\n`);

    const again = await install({ linkClaudeMd: true });
    expect(again.claudeCode?.link).toEqual({ path: claudeMd, action: 'unchanged', written: false });
    expect(readFileSync(claudeMd, 'utf8')).toBe(`${original}\n@AGENTS.md\n`);
  });

  it('recognizes an existing import, including one reached through another import', async () => {
    const claudeMd = join(project, 'CLAUDE.md');
    writeFileSync(claudeMd, '# Rules\n\n@AGENTS.md\n');
    expect((await install()).claudeCode).toEqual(
      expect.objectContaining({ visible: true, via: 'claude-md-import' })
    );

    // A path in backticks is literal text, not an import.
    writeFileSync(claudeMd, 'Instructions live in `@AGENTS.md`.\n');
    expect((await install()).claudeCode?.visible).toBe(false);

    mkdirSync(join(project, 'docs'));
    writeFileSync(join(project, 'docs', 'agents.md'), 'See @../AGENTS.md\n');
    writeFileSync(claudeMd, '- Agent rules: @docs/agents.md\n');
    expect((await install()).claudeCode?.visible).toBe(true);
  });

  it('counts a CLAUDE.md in a parent directory but links only inside the project', async () => {
    const parentClaudeMd = join(sandbox, 'CLAUDE.md');
    writeFileSync(parentClaudeMd, '# Workspace rules\n');

    const hidden = await install();
    expect(hidden.claudeCode).toEqual(
      expect.objectContaining({ visible: false, claudeMdFiles: [parentClaudeMd] })
    );

    const linked = await install({ linkClaudeMd: true });
    const projectClaudeMd = join(project, 'CLAUDE.md');
    expect(linked.claudeCode?.link).toEqual({
      path: projectClaudeMd,
      action: 'create',
      written: true,
    });
    expect(readFileSync(projectClaudeMd, 'utf8')).toBe('@AGENTS.md\n');
    expect(readFileSync(parentClaudeMd, 'utf8')).toBe('# Workspace rules\n');

    // A parent CLAUDE.md that imports this project's AGENTS.md also works.
    rmSync(projectClaudeMd);
    writeFileSync(parentClaudeMd, '@project/AGENTS.md\n');
    expect((await install()).claudeCode).toEqual(
      expect.objectContaining({ visible: true, via: 'claude-md-import' })
    );
  });

  it('never edits CLAUDE.local.md and links .claude/CLAUDE.md with a relative import', async () => {
    const localMd = join(project, 'CLAUDE.local.md');
    writeFileSync(localMd, 'My sandbox URL\n');
    expect((await install()).claudeCode?.visible).toBe(false);
    expect((await install({ linkClaudeMd: true })).claudeCode?.link?.action).toBe('create');
    expect(readFileSync(localMd, 'utf8')).toBe('My sandbox URL\n');
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');

    rmSync(join(project, 'CLAUDE.md'));
    const dotClaudeMd = join(project, '.claude', 'CLAUDE.md');
    mkdirSync(dirname(dotClaudeMd));
    writeFileSync(dotClaudeMd, '# Rules');
    expect((await install({ linkClaudeMd: true })).claudeCode?.link?.path).toBe(dotClaudeMd);
    expect(readFileSync(dotClaudeMd, 'utf8')).toBe('# Rules\n\n@../AGENTS.md\n');
    expect((await install()).claudeCode?.visible).toBe(true);
  });

  it('ignores the user-level ~/.claude/CLAUDE.md, which loads alongside AGENTS.md', async () => {
    const repo = join(home, 'repo');
    mkdirSync(repo);
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'CLAUDE.md'), '# Personal rules\n');
    expect((await install({ cwd: repo })).claudeCode).toEqual(
      expect.objectContaining({ visible: true, via: 'agents-md', claudeMdFiles: [] })
    );
  });

  it('warns on stderr from the CLI and rejects --link-claude-md for other targets', () => {
    writeFileSync(join(project, 'CLAUDE.md'), '# Rules\n');
    const result = runCli(['skill', 'install', '--target', 'agents-md']);
    expect(result.status).toBe(EXIT_CODES.OK);
    expect(result.json).toEqual(
      expect.objectContaining({
        claudeCode: expect.objectContaining({ visible: false, via: null }),
      })
    );
    expect(result.stderr).toContain('Claude Code will not load this block');

    const linked = runCli(['skill', 'install', '--target', 'agents-md', '--link-claude-md']);
    expect(linked.status).toBe(EXIT_CODES.OK);
    expect(linked.stderr).toBe('');
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe('# Rules\n\n@AGENTS.md\n');

    expect(runCli(['skill', 'install', '--target', 'claude', '--link-claude-md']).status).toBe(
      EXIT_CODES.INVALID_ARGUMENT
    );
  }, 30000);
});

describe('purvey skill print', () => {
  const skill = renderAgentSkill(version);
  const workflows = renderAgentWorkflows(version);

  it('prints Markdown by default and a JSON wrapper with --json', () => {
    const markdown = runCli(['skill', 'print']);
    expect(markdown.status).toBe(EXIT_CODES.OK);
    expect(markdown.stdout).toBe(skill);

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

  it('prints workflows.md or every file with --file', () => {
    expect(runCli(['skill', 'print', '--file', 'workflows.md']).stdout).toBe(workflows);
    expect(runCli(['skill', 'print', '--file', 'workflows.md', '--json']).json).toEqual({
      name: AGENT_SKILL_NAME,
      file: 'workflows.md',
      cliVersion: version,
      bytes: Buffer.byteLength(workflows, 'utf8'),
      content: workflows,
    });
    expect(runCli(['skill', 'print', '--file', 'all', '--json']).json).toEqual({
      name: AGENT_SKILL_NAME,
      cliVersion: version,
      files: [
        { file: 'SKILL.md', bytes: Buffer.byteLength(skill, 'utf8'), content: skill },
        { file: 'workflows.md', bytes: Buffer.byteLength(workflows, 'utf8'), content: workflows },
      ],
    });

    for (const args of [
      ['--file', 'all'],
      ['--file', 'README.md'],
      ['--agents-md', '--file', 'workflows.md'],
      ['--agents-md', '--file', 'SKILL.md'],
    ]) {
      const result = runCli(['skill', 'print', ...args]);
      expect(result.status, args.join(' ')).toBe(EXIT_CODES.INVALID_ARGUMENT);
      expect(result.stdout).toBe('');
    }
  }, 30000);
});
