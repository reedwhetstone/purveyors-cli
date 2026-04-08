#!/usr/bin/env node
import { fatal } from './lib/errors.js';
import { createProgram } from './program.js';

createProgram()
  .parseAsync(process.argv)
  .catch((err: unknown) => {
    fatal(err);
  });
