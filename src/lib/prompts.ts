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

/**
 * Return a date as YYYY-MM-DD on this machine's own clock. A roast batch is
 * filed under the roaster's local session date, which near midnight is not the
 * UTC date.
 */
export function localDateIso(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
