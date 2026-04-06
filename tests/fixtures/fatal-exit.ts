import { fatal, PrvrsError } from '../../src/lib/errors.js';

const code = process.argv[2] ?? 'GENERAL_ERROR';
const message = process.argv[3] ?? `Fixture error for ${code}`;

fatal(new PrvrsError(code, message));
