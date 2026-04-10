import chalk from 'chalk';
import { CommanderError } from 'commander';
import { ZodError } from 'zod';
import type { CliErrorEnvelope } from '../types/index.js';
import {
  formatStructuredOutput,
  outputOptionsFromArgv,
  shouldUseInteractiveOutput,
} from './output.js';

export const EXIT_CODES = {
  OK: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGUMENT: 2,
  AUTH_ERROR: 3,
  NOT_FOUND: 4,
  DEPENDENCY_CONFLICT: 5,
  CONFIG_ERROR: 6,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

const PRVRS_ERROR_EXIT_CODES: Partial<Record<string, ExitCode>> = {
  INVALID_ARGUMENT: EXIT_CODES.INVALID_ARGUMENT,
  AUTH_ERROR: EXIT_CODES.AUTH_ERROR,
  NOT_FOUND: EXIT_CODES.NOT_FOUND,
  DEPENDENCY_CONFLICT: EXIT_CODES.DEPENDENCY_CONFLICT,
  CONFIG_ERROR: EXIT_CODES.CONFIG_ERROR,
};

const COMMANDER_INVALID_ARGUMENT_CODES = new Set([
  'commander.invalidArgument',
  'commander.missingArgument',
  'commander.optionMissingArgument',
  'commander.missingMandatoryOptionValue',
  'commander.unknownOption',
  'commander.unknownCommand',
  'commander.excessArguments',
]);

export class PrvrsError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'PrvrsError';
    this.code = code;
    this.details = details;
  }
}

export class AuthError extends PrvrsError {
  constructor(message: string, details?: unknown) {
    super('AUTH_ERROR', message, details);
    this.name = 'AuthError';
  }
}

export class ConfigError extends PrvrsError {
  constructor(message: string, details?: unknown) {
    super('CONFIG_ERROR', message, details);
    this.name = 'ConfigError';
  }
}

function normalizeCommanderErrorMessage(message: string): string {
  const normalized = message.replace(/^error:\s*/i, '').trim();
  if (!normalized) {
    return 'Commander parse error';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function normalizeCliError(error: unknown): unknown {
  if (!(error instanceof CommanderError)) {
    return error;
  }

  const code = COMMANDER_INVALID_ARGUMENT_CODES.has(error.code)
    ? 'INVALID_ARGUMENT'
    : 'GENERAL_ERROR';

  return new PrvrsError(code, normalizeCommanderErrorMessage(error.message), {
    commanderCode: error.code,
    commanderExitCode: error.exitCode,
    ...(error.nestedError ? { nestedError: error.nestedError } : {}),
  });
}

export function exitCodeForError(error: unknown): ExitCode {
  const normalized = normalizeCliError(error);

  if (normalized instanceof PrvrsError) {
    return PRVRS_ERROR_EXIT_CODES[normalized.code] ?? EXIT_CODES.GENERAL_ERROR;
  }

  if (normalized instanceof ZodError) {
    return EXIT_CODES.INVALID_ARGUMENT;
  }

  return EXIT_CODES.GENERAL_ERROR;
}

function errorCodeLabel(error: unknown): string {
  const normalized = normalizeCliError(error);

  if (normalized instanceof PrvrsError) {
    return normalized.code;
  }

  if (normalized instanceof ZodError) {
    return 'INVALID_ARGUMENT';
  }

  return 'GENERAL_ERROR';
}

function formatZodErrorMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid arguments.';
  }

  const path = issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
  return `Invalid argument${path}: ${issue.message}`;
}

function errorMessageForError(error: unknown): string {
  const normalized = normalizeCliError(error);

  if (normalized instanceof PrvrsError) {
    return normalized.message;
  }

  if (normalized instanceof ZodError) {
    return formatZodErrorMessage(normalized);
  }

  if (normalized instanceof Error) {
    return normalized.message;
  }

  return 'An unknown error occurred';
}

function errorDetailsForError(error: unknown): unknown {
  if (!process.env.PURVEY_DEBUG) {
    return undefined;
  }

  const normalized = normalizeCliError(error);

  if (normalized instanceof PrvrsError) {
    return normalized.details;
  }

  if (normalized instanceof ZodError) {
    return normalized.issues;
  }

  if (normalized instanceof Error && normalized.stack) {
    return { stack: normalized.stack };
  }

  return undefined;
}

function buildCliErrorEnvelope(error: unknown): CliErrorEnvelope {
  const envelope: CliErrorEnvelope = {
    error: true,
    code: errorCodeLabel(error),
    exitCode: exitCodeForError(error),
    message: errorMessageForError(error),
  };

  const details = errorDetailsForError(error);
  if (details !== undefined) {
    envelope.details = details;
  }

  return envelope;
}

function shouldUseStructuredErrorOutput(argv: string[] = process.argv): boolean {
  const options = outputOptionsFromArgv(argv);

  // Keep human-readable errors only when the whole invocation is interactive.
  // If either stdout or stderr is redirected, prefer the machine contract.
  const isFullyInteractive = Boolean(process.stdout.isTTY && process.stderr.isTTY);

  return !shouldUseInteractiveOutput(options, isFullyInteractive);
}

function writeStructuredError(error: unknown, argv: string[] = process.argv): void {
  const options = outputOptionsFromArgv(argv);
  const formatted = formatStructuredOutput(buildCliErrorEnvelope(error), {
    pretty: options.pretty,
  });

  process.stderr.write(`${formatted}\n`);
}

/**
 * Print a formatted error to stderr and exit with a structured exit code.
 */
export function fatal(error: unknown): never {
  const normalized = normalizeCliError(error);

  if (shouldUseStructuredErrorOutput()) {
    writeStructuredError(normalized);
    process.exit(exitCodeForError(normalized));
  }

  if (normalized instanceof PrvrsError) {
    console.error(chalk.red(`✖ ${normalized.message}`));
    if (process.env.PURVEY_DEBUG && normalized.details) {
      console.error(chalk.dim('Details:'), normalized.details);
    }
  } else if (normalized instanceof ZodError) {
    console.error(chalk.red(`✖ ${formatZodErrorMessage(normalized)}`));
    if (process.env.PURVEY_DEBUG) {
      console.error(chalk.dim(JSON.stringify(normalized.issues, null, 2)));
    }
  } else if (normalized instanceof Error) {
    console.error(chalk.red(`✖ ${normalized.message}`));
    if (process.env.PURVEY_DEBUG && normalized.stack) {
      console.error(chalk.dim(normalized.stack));
    }
  } else {
    console.error(chalk.red('✖ An unknown error occurred'));
  }

  process.exit(exitCodeForError(normalized));
}

/**
 * Wrap an async command handler to catch and format errors.
 */
export function withErrorHandling<T extends unknown[]>(
  fn: (...args: T) => Promise<void>
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      fatal(error);
    }
  };
}
