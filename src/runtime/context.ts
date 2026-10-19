import { Policy } from '../policy.js';
import type { Store } from '../store.js';
import type { FaultHook, Model, RunState } from '../types.js';

export interface RuntimeContext {
  store: Store;
  model: Model;
  options: RuntimeOptions;
}

export interface RuntimeOptions {
  faults?: FaultHook;
  log?: (line: string) => void;
}

export function loadPolicy(context: RuntimeContext, run: RunState): Policy {
  const policy = Policy.load(run.policyFile, run.workspace);

  if (policy.workspace !== run.workspace || policy.file !== run.policyFile) {
    throw new Error('Workspace or policy identity changed');
  }

  context.store.assertOutside(policy.workspace);

  return policy;
}

export function stopRun(
  context: RuntimeContext,
  run: RunState,
  status: RunState['status'],
  reason: string,
): void {
  run.status = status;
  run.reason = reason;
  context.store.save(run);
}
