import { Command } from 'commander';
import {
  AGENT_SKILL_FILE,
  AGENT_SKILL_FILES,
  AGENT_SKILL_NAME,
  installAgentSkill,
  renderAgentSkillFile,
  renderAgentsMdBlock,
  type AgentSkillFile,
} from '../lib/agent-skill.js';
import { PrvrsError, withErrorHandling } from '../lib/errors.js';
import { info, outputData, shouldUseInteractiveOutput, success, warn } from '../lib/output.js';
import type { OutputOptions } from '../types/index.js';

const ACTION_LABELS = {
  create: 'Created',
  update: 'Updated',
  unchanged: 'Already current:',
  append: 'Appended the purvey block to',
  overwrite: 'Replaced',
} as const;

function sized(content: string): { bytes: number; content: string } {
  return { bytes: Buffer.byteLength(content, 'utf8'), content };
}

function parsePrintFile(
  value: string,
  fileGiven: boolean,
  agentsMd: boolean,
  structured: boolean
): AgentSkillFile[] | 'agents-md' {
  if (agentsMd) {
    if (fileGiven) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        '--agents-md prints the AGENTS.md block and cannot be combined with --file.'
      );
    }
    return 'agents-md';
  }
  if (value === 'all') {
    if (!structured) {
      throw new PrvrsError(
        'INVALID_ARGUMENT',
        '--file all prints several files, so it needs --json or --pretty. Use --file SKILL.md or --file workflows.md for Markdown.'
      );
    }
    return [...AGENT_SKILL_FILES];
  }
  if (!(AGENT_SKILL_FILES as readonly string[]).includes(value)) {
    throw new PrvrsError(
      'INVALID_ARGUMENT',
      `Unknown --file "${value}". Use one of: ${AGENT_SKILL_FILES.join(', ')}, all.`
    );
  }
  return [value as AgentSkillFile];
}

export function buildSkillCommand(version: string): Command {
  const skill = new Command('skill').description(
    'Print or install agent instructions generated from the CLI manifest'
  );

  skill
    .command('print')
    .description('Write the generated SKILL.md, workflows.md, or the AGENTS.md block to stdout')
    .option('--file <file>', '', AGENT_SKILL_FILE)
    .option('--agents-md')
    .addHelpText(
      'after',
      `
The skill is a folder: SKILL.md, which agents load first, and workflows.md, which it points to for
step-by-step workflows. Prints SKILL.md as Markdown by default. --json or --pretty wraps one file as
{ name, file, cliVersion, bytes, content }, or every file with --file all as
{ name, cliVersion, files: [{ file, bytes, content }] }.
The output is rendered from \`purvey manifest\`; no credentials are needed.

Examples:
  purvey skill print
  purvey skill print --file workflows.md
  purvey skill print --file all --json
  purvey skill print --agents-md
  purvey skill print > SKILL.md
`
    )
    .action(
      withErrorHandling(async (opts: { file: string; agentsMd?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        if (globalOpts.csv) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'The skill print command does not support --csv. Use Markdown (default), --json, or --pretty.'
          );
        }
        const structured = Boolean(globalOpts.json || globalOpts.pretty);
        const files = parsePrintFile(
          opts.file,
          cmd.getOptionValueSource('file') !== 'default',
          Boolean(opts.agentsMd),
          structured
        );

        if (files === 'agents-md') {
          const content = renderAgentsMdBlock(version);
          if (structured) {
            outputData(
              { name: AGENT_SKILL_NAME, file: 'AGENTS.md', cliVersion: version, ...sized(content) },
              { pretty: globalOpts.pretty }
            );
          } else {
            process.stdout.write(content);
          }
          return;
        }

        const rendered = files.map((file) => ({
          file,
          ...sized(renderAgentSkillFile(file, version)),
        }));
        if (!structured) {
          process.stdout.write(rendered[0].content);
        } else if (opts.file === 'all') {
          outputData(
            { name: AGENT_SKILL_NAME, cliVersion: version, files: rendered },
            { pretty: globalOpts.pretty }
          );
        } else {
          const [{ file, ...rest }] = rendered;
          outputData(
            { name: AGENT_SKILL_NAME, file, cliVersion: version, ...rest },
            { pretty: globalOpts.pretty }
          );
        }
      })
    );

  skill
    .command('install')
    .description(
      'Install the generated instructions for Claude Code, Agent Skills clients such as Codex and Cursor, or a repository AGENTS.md'
    )
    .option('--target <target>')
    .option('--scope <scope>')
    .option('--force')
    .option('--dry-run')
    .option('--link-claude-md')
    .addHelpText(
      'after',
      `
Targets:
  claude      ~/.claude/skills/purveyors/{SKILL.md,workflows.md}   (Claude Code)
  agents      ~/.agents/skills/purveyors/{SKILL.md,workflows.md}   (Codex, Cursor, other Agent Skills clients)
  agents-md   ./AGENTS.md, as one marked block                      (repository-level instructions)

claude and agents write a skill folder: SKILL.md, which agents load first, and workflows.md, the
step-by-step workflows it points to. Each file is checked and reported on its own under "files".
Claude Code loads skills only from .claude/skills, so use --target claude there; it does not read .agents/.
--scope project writes .claude/skills/... or .agents/skills/... under the current directory instead.

Claude Code reads AGENTS.md only when no CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md exists in the
current directory or above it. agents-md reports this as "claudeCode" in its JSON output. --link-claude-md
adds an @AGENTS.md import to ./CLAUDE.md (or ./.claude/CLAUDE.md), creating ./CLAUDE.md if needed, and never
edits CLAUDE.local.md or a parent directory's CLAUDE.md. See https://code.claude.com/docs/en/memory#agents-md
Re-running is safe: identical files are left alone, unedited earlier output is updated, and a missing
workflows.md is created. If any file has local edits, nothing is written and the command exits 6 unless
--force is passed. No credentials are needed.

Examples:
  purvey skill install --target claude
  purvey skill install --target agents --dry-run
  purvey skill install --target claude --scope project
  purvey skill install --target agents-md
  purvey skill install --target agents-md --link-claude-md
`
    )
    .action(
      withErrorHandling(
        async (
          opts: {
            target?: string;
            scope?: string;
            force?: boolean;
            dryRun?: boolean;
            linkClaudeMd?: boolean;
          },
          cmd: Command
        ) => {
          const globalOpts = cmd.optsWithGlobals() as OutputOptions;
          const result = await installAgentSkill({ ...opts, version });

          if (shouldUseInteractiveOutput(globalOpts)) {
            for (const { action, path } of result.files ?? [result]) {
              if (result.dryRun) {
                info(`Dry run, nothing written. Would ${action}: ${path}`);
              } else {
                success(`${ACTION_LABELS[action]} ${path}`);
              }
            }
            if (result.claudeCode?.visible) {
              info(result.claudeCode.reason);
            }
          }
          const { claudeCode } = result;
          if (claudeCode && !claudeCode.visible) {
            // Always on stderr, so agents running non-interactively see it too.
            warn(`Claude Code will not load this block. ${claudeCode.reason}`);
          }

          outputData(result, globalOpts);
        }
      )
    );

  return skill;
}
