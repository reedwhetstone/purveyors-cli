import { Command } from 'commander';
import {
  AGENT_SKILL_FILE,
  AGENT_SKILL_NAME,
  installAgentSkill,
  renderAgentSkill,
  renderAgentsMdBlock,
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

export function buildSkillCommand(version: string): Command {
  const skill = new Command('skill').description(
    'Print or install agent instructions generated from the CLI manifest'
  );

  skill
    .command('print')
    .description('Write the generated SKILL.md (or the AGENTS.md block) to stdout')
    .option('--agents-md', 'Print the compact AGENTS.md block instead of SKILL.md')
    .addHelpText(
      'after',
      `
Prints Markdown by default. --json or --pretty wraps it as { name, file, cliVersion, bytes, content }.
The output is rendered from \`purvey manifest\`; no credentials are needed.

Examples:
  purvey skill print
  purvey skill print --agents-md
  purvey skill print > SKILL.md
`
    )
    .action(
      withErrorHandling(async (opts: { agentsMd?: boolean }, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals() as OutputOptions;
        if (globalOpts.csv) {
          throw new PrvrsError(
            'INVALID_ARGUMENT',
            'The skill print command does not support --csv. Use Markdown (default), --json, or --pretty.'
          );
        }

        const content = opts.agentsMd ? renderAgentsMdBlock(version) : renderAgentSkill(version);
        if (globalOpts.json || globalOpts.pretty) {
          outputData(
            {
              name: AGENT_SKILL_NAME,
              file: opts.agentsMd ? 'AGENTS.md' : AGENT_SKILL_FILE,
              cliVersion: version,
              bytes: Buffer.byteLength(content, 'utf8'),
              content,
            },
            { pretty: globalOpts.pretty }
          );
          return;
        }

        process.stdout.write(content);
      })
    );

  skill
    .command('install')
    .description(
      'Install the generated instructions for Claude Code, Agent Skills clients such as Codex and Cursor, or a repository AGENTS.md'
    )
    .option('--target <target>', 'claude, agents, or agents-md (required)')
    .option(
      '--scope <scope>',
      'user (home directory) or project (current directory); defaults to user, or project for agents-md'
    )
    .option('--force', 'Replace a file or AGENTS.md block that has local edits')
    .option('--dry-run', 'Report the path and action without writing')
    .option(
      '--link-claude-md',
      'agents-md only: add an @AGENTS.md import to ./CLAUDE.md so Claude Code loads the block'
    )
    .addHelpText(
      'after',
      `
Targets:
  claude      ~/.claude/skills/purveyors/SKILL.md        (Claude Code)
  agents      ~/.agents/skills/purveyors/SKILL.md        (Codex, Cursor, other Agent Skills clients)
  agents-md   ./AGENTS.md, as one marked block            (repository-level instructions)

Claude Code loads skills only from .claude/skills, so use --target claude there; it does not read .agents/.
--scope project writes .claude/skills/... or .agents/skills/... under the current directory instead.

Claude Code reads AGENTS.md only when no CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md exists in the
current directory or above it. agents-md reports this as "claudeCode" in its JSON output. --link-claude-md
adds an @AGENTS.md import to ./CLAUDE.md (or ./.claude/CLAUDE.md), creating ./CLAUDE.md if needed, and never
edits CLAUDE.local.md or a parent directory's CLAUDE.md. See https://code.claude.com/docs/en/memory#agents-md
Re-running is safe: identical files are left alone and unedited earlier output is updated.
Files with local edits are refused (exit 6) unless --force is passed. No credentials are needed.

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
            const label = ACTION_LABELS[result.action];
            if (result.dryRun) {
              info(`Dry run, nothing written. Would ${result.action}: ${result.path}`);
            } else {
              success(`${label} ${result.path}`);
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
