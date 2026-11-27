import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The distributed CLI lives in dist/src/cli. Its bundled example and default
// state are relative to the harness; user-supplied paths are relative to cwd.
export const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultDatabase = resolve(projectRoot, '.agent/state.sqlite');
export const cliCommand = process.env.TS_AGENT_LAUNCHER === 'global' ? 'agent' : './agent';
