import { fitResult } from '../tools/results.js';
import type { RuntimeContext } from './context.js';
import type { CallRecord, Pending, RunState, ToolResult } from '../types.js';
import { loadPolicy, stopRun } from './context.js';

export function failure(error: unknown): ToolResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function deliverToolResult(run: RunState, pending: Pending, text: string): void {
  run.messages.push({ role: 'tool', tool_call_id: pending.call.id, content: text });
  run.pending.shift();
}

export function deliverFreshResult(
  context: RuntimeContext,
  run: RunState,
  pending: Pending,
  result: ToolResult,
): void {
  const capacity = availableResultCapacity(context, run);

  if (capacity < 32) {
    stopRun(context, run, 'blocked', 'Budget exhausted: resultBytes');

    return;
  }

  const fitted = fitResult(result, capacity);

  run.spent.resultBytes += fitted.bytes;
  deliverToolResult(run, pending, fitted.text);
  context.store.save(run);
}

export function completeWithoutExecution(
  context: RuntimeContext,
  run: RunState,
  pending: Pending,
  record: CallRecord,
  result: ToolResult,
): void {
  const capacity = availableResultCapacity(context, run);

  if (capacity < 32) {
    stopRun(context, run, 'blocked', 'Budget exhausted: resultBytes');

    return;
  }

  const fitted = fitResult(result, capacity);

  if (record.sideReserved) {
    run.reservedSideEffects--;
    record.sideReserved = false;
  }

  run.spent.resultBytes += fitted.bytes;
  record.status = 'completed';
  record.result = result;
  record.resultText = fitted.text;
  deliverToolResult(run, pending, fitted.text);
  context.store.save(run);
}

export function availableResultCapacity(context: RuntimeContext, run: RunState): number {
  let maximum = 128;

  try {
    maximum = loadPolicy(context, run).config.maxOutputBytes;
  } catch {
    /* Policy errors must still be returned as bounded tool results. */
  }

  return Math.min(maximum, run.limits.resultBytes - run.spent.resultBytes);
}
