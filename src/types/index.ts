/**
 * Shared type definitions for @purveyors/cli
 */

export interface GlobalOptions {
  pretty?: boolean;
  csv?: boolean;
  json?: boolean;
}

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp (ms)
  user: {
    id: string;
    email: string;
    role?: string;
  };
}

export interface OutputOptions {
  pretty?: boolean;
  csv?: boolean;
  json?: boolean;
}

export interface CliError {
  code: string;
  message: string;
  details?: unknown;
}

export interface CliErrorEnvelope extends CliError {
  error: true;
  exitCode: number;
}
