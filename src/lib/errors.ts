import chalk from 'chalk';
import { ZodError } from 'zod';

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

export function exitCodeForError(error: unknown): ExitCode {
  if (error instanceof PrvrsError) {
    return PRVRS_ERROR_EXIT_CODES[error.code] ?? EXIT_CODES.GENERAL_ERROR;
  }

  if (error instanceof ZodError) {
    return EXIT_CODES.INVALID_ARGUMENT;
  }

  return EXIT_CODES.GENERAL_ERROR;
}

function formatZodErrorMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid arguments.';
  }

  const path = issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
  return `Invalid argument${path}: ${issue.message}`;
}

/**
 * Print a formatted error to stderr and exit with a structured exit code.
 */
export function fatal(error: unknown): never {
  if (error instanceof PrvrsError) {
    console.error(chalk.red(`✖ ${error.message}`));
    if (process.env.PURVEY_DEBUG && error.details) {
      console.error(chalk.dim('Details:'), error.details);
    }
  } else if (error instanceof ZodError) {
    console.error(chalk.red(`✖ ${formatZodErrorMessage(error)}`));
    if (process.env.PURVEY_DEBUG) {
      console.error(chalk.dim(JSON.stringify(error.issues, null, 2)));
    }
  } else if (error instanceof Error) {
    console.error(chalk.red(`✖ ${error.message}`));
    if (process.env.PURVEY_DEBUG && error.stack) {
      console.error(chalk.dim(error.stack));
    }
  } else {
    console.error(chalk.red('✖ An unknown error occurred'));
  }

  process.exit(exitCodeForError(error));
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
