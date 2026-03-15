import { createInterface } from 'readline';

/**
 * Prompt the user for a yes/no confirmation.
 * Writes the prompt to stderr so it doesn't pollute stdout JSON pipes.
 * Returns true only if the user types 'y' or 'Y'.
 */
export async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Return today's date in YYYY-MM-DD format (UTC).
 */
export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}
