import type { Policy } from '../policy.js';
import { assertTree, snapshot } from '../journal.js';
import { executeTool } from '../tools.js';
import { InjectedCrash, PROJECT_TOOLS, SIDE_EFFECTS } from '../types.js';
import { failure, deliverFreshResult, completeWithoutExecution } from './tool-results.js';
import type { RuntimeContext } from './context.js';
import type { Args, RunState, ToolResult, Tree } from '../types.js';
import { loadPolicy, stopRun } from './context.js';
import { executeAdministrativeCall } from './administrative-tools.js';
import { beginAttempt, finishAttempt } from './call-attempts.js';

export async function processPendingCall(context: RuntimeContext, run: RunState): Promise<void> {
  const pending = run.pending[0]!;
  const record = Object.hasOwn(run.calls, pending.call.id) ? run.calls[pending.call.id] : undefined;

  if (pending.error) {
    deliverFreshResult(context, run, pending, { ok: false, error: pending.error });

    return;
  }

  if (!record) {
    throw new Error('Internal error: call record missing');
  }

  if (record.status === 'completed') {
    deliverFreshResult(
      context,
      run,
      pending,
      record.result ?? { ok: false, error: 'Cached result missing' },
    );

    return;
  }

  if (record.status === 'uncertain') {
    stopRun(context, run, 'uncertain', `Resolve call ${record.call.id}`);

    return;
  }

  let policy: Policy;
  let args: Args;

  try {
    policy = loadPolicy(context, run);
    args = policy.validate(pending.call);
    if (
      pending.phase === 'plan' &&
      !['list_files', 'read_file', 'submit_plan'].includes(pending.call.function.name)
    ) {
      throw new Error('Plan Mode allows only project reads and submit_plan; Bash is forbidden');
    }

    if (pending.phase === 'execute' && PROJECT_TOOLS.has(pending.call.function.name)) {
      const task = run.tasks.find(
        (candidate) => candidate.id === pending.taskId && candidate.status === 'running',
      );

      if (!task || task.id !== run.activeTaskId) {
        throw new Error('No active task for execution call');
      }

      if (!task.tools.includes(pending.call.function.name)) {
        throw new Error('Tool is not declared for the active task');
      }
    }
  } catch (error) {
    completeWithoutExecution(context, run, pending, record, failure(error));

    return;
  }

  const hasSideEffect = SIDE_EFFECTS.has(pending.call.function.name);

  if (
    hasSideEffect &&
    (run.mode === 'safe' || pending.call.function.name === 'delete_file') &&
    !record.approved
  ) {
    record.status = 'awaiting';
    stopRun(
      context,
      run,
      'awaiting_action',
      `Approval required for ${pending.call.id}: ${pending.call.function.name}`,
    );

    return;
  }

  const capacity = Math.min(
    policy.config.maxOutputBytes,
    run.limits.resultBytes - run.spent.resultBytes,
  );

  if (capacity < 32) {
    stopRun(context, run, 'blocked', 'Budget exhausted: resultBytes');

    return;
  }

  let before: Tree;

  try {
    before = snapshot(policy);
    if (hasSideEffect) {
      assertTree(run.expected, before);
    }
  } catch (error) {
    stopRun(context, run, 'conflict', failure(error).error!);

    return;
  }

  beginAttempt(context, run, record, before, capacity);

  let result: ToolResult;
  const previousTaskId = run.activeTaskId;

  try {
    if (PROJECT_TOOLS.has(pending.call.function.name)) {
      result = await executeTool(pending.call, loadPolicy(context, run), capacity);
    } else {
      result = executeAdministrativeCall(run, pending, args, policy);
    }
  } catch (error) {
    if (error instanceof InjectedCrash) {
      throw error;
    }

    result = failure(error);
  }

  context.options.faults?.('after_execute');

  let after: Tree;

  try {
    after = hasSideEffect ? snapshot(policy) : before;
  } catch (error) {
    record.status = 'uncertain';
    record.attempts.at(-1)!.status = 'uncertain';
    stopRun(context, run, 'uncertain', `Cannot snapshot tool outcome: ${failure(error).error}`);

    return;
  }

  finishAttempt(context, run, record, pending, {
    before,
    after,
    result,
    capacity,
    previousTaskId,
  });
}
