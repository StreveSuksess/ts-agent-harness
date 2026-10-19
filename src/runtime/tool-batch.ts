import { SIDE_EFFECTS } from '../types.js';
import type { RuntimeContext } from './context.js';
import type { Pending, RunState, ToolCall } from '../types.js';
import { stopRun } from './context.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonical(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

function fingerprint(call: ToolCall): string {
  let args: unknown = call.function.arguments;

  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    /* invalid JSON still gets a stable identity */
  }

  return canonical({ name: call.function.name, args });
}

export function admitToolBatch(context: RuntimeContext, run: RunState, calls: ToolCall[]): void {
  const queued: Pending[] = [];
  const seen = new Map<string, string>();
  let sideEffectCount = 0;

  for (const call of calls) {
    const pendingCall: Pending = {
      call,
      phase: run.phase,
      taskId: run.phase === 'execute' ? run.activeTaskId : null,
    };
    const existingCall = Object.hasOwn(run.calls, call.id) ? run.calls[call.id] : undefined;

    if (existingCall && existingCall.fingerprint !== fingerprint(call)) {
      pendingCall.error = 'Protocol error: tool_call_id reused with different tool or arguments';
    }

    if (seen.has(call.id) && seen.get(call.id) !== fingerprint(call)) {
      pendingCall.error = 'Protocol error: conflicting tool_call_id within batch';
    }

    if (['submit_plan', 'complete_task'].includes(call.function.name) && calls.length !== 1) {
      pendingCall.error = 'Administrative plan/task transition must be a standalone call';
    }

    if (
      !pendingCall.error &&
      !existingCall &&
      !seen.has(call.id) &&
      SIDE_EFFECTS.has(call.function.name)
    ) {
      sideEffectCount++;
    }

    if (!seen.has(call.id)) {
      seen.set(call.id, fingerprint(call));
    }

    queued.push(pendingCall);
  }

  if (
    run.spent.toolCalls + calls.length > run.limits.toolCalls ||
    run.spent.sideEffects + run.reservedSideEffects + sideEffectCount > run.limits.sideEffects
  ) {
    stopRun(
      context,
      run,
      'blocked',
      'Budget exhausted: entire tool-call batch rejected (toolCalls or sideEffects)',
    );

    return;
  }
  // Batch reservation and queued action state are one SQLite transaction.
  run.spent.toolCalls += calls.length;
  run.reservedSideEffects += sideEffectCount;
  run.pending = queued;
  for (const pendingCall of queued) {
    if (!pendingCall.error && !Object.hasOwn(run.calls, pendingCall.call.id)) {
      run.calls[pendingCall.call.id] = {
        call: pendingCall.call,
        fingerprint: fingerprint(pendingCall.call),
        phase: pendingCall.phase,
        taskId: pendingCall.taskId,
        status: 'queued',
        attempts: [],
        sideReserved: SIDE_EFFECTS.has(pendingCall.call.function.name),
      };
    }
  }

  context.store.save(run);
}
