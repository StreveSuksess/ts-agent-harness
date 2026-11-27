#!/usr/bin/env node
import { runCli } from './cli/commands.js';
import { terminalText } from './cli/terminal-text.js';

runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(terminalText(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
