import chalk from 'chalk';
import type { OutputOptions } from '../types/index.js';

/**
 * Determine whether a command should emit interactive human-readable output.
 * Structured output wins whenever an explicit mode is requested or stdout is not a TTY.
 */
export function shouldUseInteractiveOutput(
  options: OutputOptions = {},
  isTTY = process.stdout.isTTY
): boolean {
  return Boolean(isTTY && !options.pretty && !options.csv && !options.json);
}

/**
 * Infer global output options from the current argv so process-boundary handlers
 * (like fatal error formatting) can honor the same output contract as commands.
 */
export function outputOptionsFromArgv(argv: string[] = process.argv): OutputOptions {
  return {
    json: argv.includes('--json'),
    pretty: argv.includes('--pretty'),
    csv: argv.includes('--csv'),
  };
}

/**
 * Flatten a nested object to a single-depth record for CSV output.
 */
function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      result[fullKey] = value === null || value === undefined ? '' : String(value);
    }
  }
  return result;
}

/**
 * Convert an array of objects to CSV string.
 */
function toCsv(data: unknown[]): string {
  if (!Array.isArray(data) || data.length === 0) return '';

  const rows = data.map((item) => flattenObject(item as Record<string, unknown>));
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  const escape = (val: string) =>
    val.includes(',') || val.includes('"') || val.includes('\n')
      ? `"${val.replace(/"/g, '""')}"`
      : val;

  const headerRow = headers.map(escape).join(',');
  const dataRows = rows.map((row) => headers.map((h) => escape(row[h] ?? '')).join(','));

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Basic JSON syntax colorizer using chalk.
 */
function colorizeJson(json: string): string {
  return json
    .replace(/"([^"]+)":/g, (_, key) => chalk.cyan(`"${key}"`) + ':')
    .replace(/: "([^"]*)"/g, (_, val) => ': ' + chalk.green(`"${val}"`))
    .replace(/: (true|false)/g, (_, val) => ': ' + chalk.yellow(val))
    .replace(/: (null)/g, (_, val) => ': ' + chalk.dim(val))
    .replace(/: (-?\d+\.?\d*)/g, (_, val) => ': ' + chalk.magenta(val));
}

/**
 * Format structured JSON output as a string so stdout and stderr can share the
 * same JSON rendering rules.
 */
export function formatStructuredOutput(
  data: unknown,
  options: Pick<OutputOptions, 'pretty'> = {}
): string {
  if (options.pretty) {
    return colorizeJson(JSON.stringify(data, null, 2));
  }

  return JSON.stringify(data);
}

/**
 * Output data to stdout in the requested format.
 *
 * Defaults to compact JSON (machine-readable, no colors).
 * --json: explicit alias for compact JSON
 * --pretty: indented JSON with syntax highlighting
 * --csv: CSV format (only works with arrays of objects)
 */
export function outputData(data: unknown, options: OutputOptions = {}): void {
  if (options.csv) {
    if (!Array.isArray(data)) {
      // Wrap scalar/object in array for CSV compatibility
      data = [data];
    }
    console.log(toCsv(data as unknown[]));
    return;
  }

  console.log(formatStructuredOutput(data, { pretty: options.pretty }));
}

/**
 * Print a success message to stderr (so it doesn't pollute JSON stdout pipes).
 */
export function success(message: string): void {
  console.error(chalk.green(`✔ ${message}`));
}

/**
 * Print an info message to stderr.
 */
export function info(message: string): void {
  console.error(chalk.blue(`ℹ ${message}`));
}

/**
 * Print a warning to stderr.
 */
export function warn(message: string): void {
  console.error(chalk.yellow(`⚠ ${message}`));
}
