import { now } from '../types.js';
import type { RuntimeContext } from './context.js';
import { loadPolicy } from './context.js';
import { selectNextTask, renderPhaseMessage } from './task-state.js';
import { completeWithoutExecution } from './tool-results.js';

export function decidePlan(context: RuntimeContext, id: string, allow: boolean): void {
  const run = context.store.get(id);

  if (run.status !== 'awaiting_plan' || !run.plan) {
    throw new Error('Run is not waiting for a plan decision');
  }

  run.decisions.push({ at: now(), kind: 'plan', choice: allow ? 'approve' : 'reject' });
  if (allow) {
    loadPolicy(context, run);
    run.tasks = run.plan.steps.map((step) => ({ ...step, status: 'pending' }));
    run.phase = 'execute';
    selectNextTask(run);
  } else {
    delete run.plan;
    run.messages.push({ role: 'user', content: 'Plan rejected. Inspect or propose another plan.' });
  }

  run.status = 'running';
  delete run.reason;
  run.messages.push({ role: 'user', content: renderPhaseMessage(run) });
  context.store.save(run);
}

export function decideAction(context: RuntimeContext, id: string, allow: boolean): void {
  const run = context.store.get(id);
  const pending = run.pending[0];

  if (run.status !== 'awaiting_action' || !pending) {
    throw new Error('Run is not waiting for an action decision');
  }

  const record = run.calls[pending.call.id]!;

  run.decisions.push({
    at: now(),
    kind: 'action',
    callId: pending.call.id,
    choice: allow ? 'approve' : 'reject',
  });
  run.status = 'running';
  delete run.reason;
  if (allow) {
    record.approved = true;
    record.status = 'queued';
    context.store.save(run);
  } else {
    completeWithoutExecution(context, run, pending, record, {
      ok: false,
      error: 'User denied this action. Choose a different step.',
    });
  }
}
