import { fatal, PrvrsError } from '../../src/lib/errors.js';

const args = process.argv.slice(2);
const code = args[0] ?? 'GENERAL_ERROR';
const maybeMessage = args[1];
const message =
  maybeMessage && !maybeMessage.startsWith('--') ? maybeMessage : `Fixture error for ${code}`;

fatal(new PrvrsError(code, message));
