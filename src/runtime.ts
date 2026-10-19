import type { Store } from './store.js';
import type { Model, RunState } from './types.js';
import type { RuntimeContext, RuntimeOptions } from './runtime/context.js';
import { createRun } from './runtime/create-run.js';
import type { StartOptions } from './runtime/create-run.js';
import { runAgent } from './runtime/agent-loop.js';
import { decidePlan, decideAction } from './runtime/approvals.js';
import { resolveUncertainCall } from './runtime/recovery.js';
import { getRunDiff, rollbackRun, completeInterruptedRollback } from './runtime/rollback.js';
import { printTaskChecklist } from './runtime/task-state.js';

/**
 * Public entry point for a run. Execution, approvals and recovery live in
 * separate modules; this facade keeps the CLI and programmatic API stable.
 */
export class Runtime {
  private readonly context: RuntimeContext;

  constructor(
    public readonly store: Store,
    model: Model,
    options: RuntimeOptions = {},
  ) {
    this.context = { store, model, options };
  }

  start(options: StartOptions): RunState {
    return createRun(this.context, options);
  }

  run(id: string): Promise<RunState> {
    return runAgent(this.context, id);
  }

  approvePlan(id: string, allow: boolean): void {
    decidePlan(this.context, id, allow);
  }

  approveAction(id: string, allow: boolean): void {
    decideAction(this.context, id, allow);
  }

  resolve(id: string, choice: 'retry' | 'fail' | 'abort', attribute?: boolean): void {
    resolveUncertainCall(this.context, id, choice, attribute);
  }

  diff(id: string): string {
    return getRunDiff(this.context, id);
  }

  rollback(id: string): Promise<RunState> {
    return rollbackRun(this.context, id);
  }

  resolveRollback(id: string): Promise<void> {
    return completeInterruptedRollback(this.context, id);
  }

  printTasks(run: RunState): void {
    printTaskChecklist(this.context, run);
  }
}
