import chalk from 'chalk';

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

/**
 * Print a formatted error to stderr and exit with code 1.
 */
export function fatal(error: unknown): never {
  if (error instanceof PrvrsError) {
    console.error(chalk.red(`✖ ${error.message}`));
    if (process.env.PRVRS_DEBUG && error.details) {
      console.error(chalk.dim('Details:'), error.details);
    }
  } else if (error instanceof Error) {
    console.error(chalk.red(`✖ ${error.message}`));
    if (process.env.PRVRS_DEBUG && error.stack) {
      console.error(chalk.dim(error.stack));
    }
  } else {
    console.error(chalk.red('✖ An unknown error occurred'));
  }
  process.exit(1);
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
