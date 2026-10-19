import type { CallRecord, Pending, RunState, ToolResult, Tree } from '../types.js';
import { SIDE_EFFECTS, now } from '../types.js';
import { fitResult } from '../tools/results.js';
import type { RuntimeContext } from './context.js';
import { recordChanges } from './change-journal.js';
import { deliverToolResult } from './tool-results.js';
import { renderPhaseMessage, printTaskChecklist } from './task-state.js';

interface CallOutcome {
  before: Tree;
  after: Tree;
  result: ToolResult;
  capacity: number;
  previousTaskId: string | null;
}

export function beginAttempt(
  context: RuntimeContext,
  run: RunState,
  record: CallRecord,
  before: Tree,
  capacity: number,
): void {
  record.status = 'started';
  if (SIDE_EFFECTS.has(record.call.function.name)) {
    if (!record.sideReserved || run.reservedSideEffects < 1) {
      throw new Error('Missing side-effect reservation');
    }

    record.sideReserved = false;
    run.reservedSideEffects--;
    run.spent.sideEffects++;
  }

  record.attempts.push({
    number: record.attempts.length + 1,
    startedAt: now(),
    reservedBytes: capacity,
    status: 'started',
    before,
  });
  run.spent.resultBytes += capacity;
  // Persist started and its output reservation before executing the tool.
  context.store.save(run);
  context.options.faults?.('after_reservation');
}

export function finishAttempt(
  context: RuntimeContext,
  run: RunState,
  record: CallRecord,
  pending: Pending,
  outcome: CallOutcome,
): void {
  const { before, after, result, capacity, previousTaskId } = outcome;

  if (SIDE_EFFECTS.has(record.call.function.name)) {
    recordChanges(run, before, after);
    run.expected = after;
  }

  const fitted = fitResult(result, capacity);

  // A completed attempt releases its unused reservation. A crash never does.
  run.spent.resultBytes -= capacity - fitted.bytes;
  const attempt = record.attempts.at(-1)!;

  attempt.status = 'completed';
  attempt.after = after;
  attempt.result = { ...result, truncated: Boolean(result.truncated || fitted.result.truncated) };
  record.status = 'completed';
  record.result = attempt.result;
  record.resultText = fitted.text;
  deliverToolResult(run, pending, fitted.text);
  if (previousTaskId !== run.activeTaskId) {
    run.messages.push({ role: 'user', content: renderPhaseMessage(run) });
    printTaskChecklist(context, run);
  }

  // Commit outcome, journal, budgets and the message to the model together.
  context.store.save(run);
}
