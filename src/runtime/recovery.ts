import { snapshot, treeDiff } from '../journal.js';
import { fitResult } from '../tools/results.js';
import { SIDE_EFFECTS, now } from '../types.js';
import type { RuntimeContext } from './context.js';
import { loadPolicy } from './context.js';
import { recordChanges } from './change-journal.js';
import { deliverToolResult } from './tool-results.js';

export function resolveUncertainCall(
  context: RuntimeContext,
  id: string,
  choice: 'retry' | 'fail' | 'abort',
  attribute?: boolean,
): void {
  const run = context.store.get(id);
  const record = Object.values(run.calls).find((call) => call.status === 'uncertain');

  if (run.status !== 'uncertain' || !record || run.rollbackStarted) {
    throw new Error('No recovered uncertain tool call to resolve; resume first');
  }

  const attempt = record.attempts.at(-1)!;
  const policy = loadPolicy(context, run);
  const current = snapshot(policy);
  const observed = treeDiff(attempt.before, current);

  if (observed.length && attribute === undefined) {
    throw new Error(
      'Observed workspace changes require --attribute yes or no before resolution/rollback',
    );
  }

  if (choice === 'retry') {
    if (!['read_file', 'list_files', 'write_file'].includes(record.call.function.name)) {
      throw new Error('This tool is not safely repeatable; choose fail or abort');
    }

    policy.validate(record.call);
    if (
      run.spent.toolCalls + 1 > run.limits.toolCalls ||
      (SIDE_EFFECTS.has(record.call.function.name) &&
        run.spent.sideEffects + run.reservedSideEffects + 1 > run.limits.sideEffects)
    ) {
      throw new Error('Retry budget exhausted');
    }

    if (run.limits.resultBytes - run.spent.resultBytes < 32) {
      throw new Error('Retry result budget exhausted');
    }
  }

  if (attribute === true) {
    recordChanges(run, attempt.before, current);
  }

  run.expected = current;
  run.decisions.push({
    at: now(),
    kind: 'uncertain',
    callId: record.call.id,
    choice,
    ...(attribute === undefined ? {} : { attribute }),
  });
  attempt.after = current;
  attempt.status = 'failed';
  if (choice === 'abort') {
    run.status = 'failed';
    run.reason = 'User aborted uncertain run';
    context.store.save(run);

    return;
  }

  run.status = 'running';
  delete run.reason;
  if (choice === 'retry') {
    run.spent.toolCalls++;
    if (SIDE_EFFECTS.has(record.call.function.name)) {
      run.reservedSideEffects++;
      record.sideReserved = true;
    }

    record.status = 'queued';
    record.approved = true;
    context.store.save(run);

    return;
  }

  const result = {
    ok: false,
    error: 'User resolved uncertain attempt as unsuccessful; it was not replayed.',
  };

  record.status = 'completed';
  record.result = result;
  record.resultText = fitResult(result, attempt.reservedBytes).text;

  const pending = run.pending[0];

  if (!pending || pending.call.id !== record.call.id) {
    throw new Error('Uncertain call is not the current pending call');
  }

  deliverToolResult(run, pending, record.resultText);
  // The crashed output reservation is intentionally retained in full.
  context.store.save(run);
}
