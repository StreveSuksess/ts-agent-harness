import { now } from '../types.js';
import type { RuntimeContext } from './context.js';
import { loadPolicy } from './context.js';
import { selectNextTask, renderPhaseMessage } from './task-state.js';
import { completeWithoutExecution } from './tool-results.js';

export interface PlanDecisionOptions {
  expectedRevision?: number;
  feedback?: string;
}

export class ApprovalChangedError extends Error {
  constructor() {
    super('Запуск изменился во время ожидания. Проверьте текущее состояние и повторите решение.');
  }
}

function checkRevision(revision: number, expectedRevision?: number): void {
  if (expectedRevision !== undefined && revision !== expectedRevision) {
    throw new ApprovalChangedError();
  }
}

export function decidePlan(
  context: RuntimeContext,
  id: string,
  allow: boolean,
  { expectedRevision, feedback }: PlanDecisionOptions = {},
): void {
  const run = context.store.get(id);
  checkRevision(run.revision, expectedRevision);
  if (run.status !== 'awaiting_plan' || !run.plan) {
    throw new Error('Run is not waiting for a plan decision');
  }
  if (allow && feedback !== undefined) {
    throw new Error('Комментарий можно передать при отклонении плана.');
  }

  const comment = feedback?.trim();
  run.decisions.push({
    at: now(),
    kind: 'plan',
    choice: allow ? 'approve' : 'reject',
    ...(comment ? { feedback: comment } : {}),
  });
  if (allow) {
    loadPolicy(context, run);
    run.tasks = run.plan.steps.map((step) => ({ ...step, status: 'pending' }));
    run.phase = 'execute';
    selectNextTask(run);
  } else {
    delete run.plan;
    const rejection = 'Plan rejected. Inspect or propose another plan.';
    run.messages.push({ role: 'user', content: comment ? `${rejection}\n${comment}` : rejection });
  }

  run.status = 'running';
  delete run.reason;
  run.messages.push({ role: 'user', content: renderPhaseMessage(run) });
  context.store.save(run);
}

export function decideAction(
  context: RuntimeContext,
  id: string,
  allow: boolean,
  expectedRevision?: number,
): void {
  const run = context.store.get(id);
  checkRevision(run.revision, expectedRevision);
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
