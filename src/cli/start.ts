import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from './paths.js';
import type { Runtime } from '../runtime.js';
import type { RunState } from '../types.js';
import type { CliArguments } from './arguments.js';

export function startTask(runtime: Runtime, args: CliArguments, prompt: string): RunState {
  const { flags } = args;
  const mode: RunState['mode'] = flags.get('mode') === 'auto' ? 'auto' : 'safe';
  const options = {
    prompt,
    mode,
    policyFile: resolve(flags.get('policy') ?? resolve(projectRoot, 'policy.example.json')),
    plan: !flags.has('no-plan'),
  };
  const workspace = flags.get('workspace');
  if (workspace || args.command === 'start') {
    return runtime.start({
      ...options,
      workspace: resolve(workspace ?? resolve(projectRoot, 'workspace')),
    });
  }

  const parent = resolve(projectRoot, '.agent', 'workspaces');
  mkdirSync(parent, { recursive: true });
  const copy = mkdtempSync(resolve(parent, 'run-'));
  try {
    cpSync(resolve(projectRoot, 'workspace'), copy, { recursive: true, verbatimSymlinks: true });
    return runtime.start({ ...options, workspace: copy });
  } catch (error) {
    rmSync(copy, { recursive: true, force: true });
    throw error;
  }
}
