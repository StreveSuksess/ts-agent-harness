import { definitions } from '../schema.js';
import { parseAssistant } from '../model.js';
import { failure } from './tool-results.js';
import type { RuntimeContext } from './context.js';
import type { RunState } from '../types.js';
import { stopRun } from './context.js';
import { admitToolBatch } from './tool-batch.js';
import { processPendingCall } from './call-execution.js';
import { printTaskChecklist } from './task-state.js';

export async function runAgent(context: RuntimeContext, id: string): Promise<RunState> {
  const initial = context.store.get(id);

  return context.store.locked(initial.workspace, async () => {
    const run = context.store.get(id);

    if (run.rollbackStarted) {
      run.status = 'uncertain';
      run.reason = 'Rollback was interrupted; resolve-rollback is required';
      context.store.save(run);

      return run;
    }

    const started = Object.values(run.calls).find((call) => call.status === 'started');

    if (started) {
      started.status = 'uncertain';
      started.attempts.at(-1)!.status = 'uncertain';
      run.status = 'uncertain';
      run.reason = `Uncertain tool call: ${started.call.id}. Inspect status/diff and resolve explicitly.`;
      context.store.save(run);

      return run;
    }

    if (
      [
        'completed',
        'failed',
        'rolled_back',
        'awaiting_plan',
        'awaiting_action',
        'uncertain',
      ].includes(run.status)
    ) {
      return run;
    }

    if (run.status === 'blocked' && run.reason?.startsWith('Budget exhausted')) {
      return run;
    }

    run.status = 'running';
    delete run.reason;
    context.store.save(run);
    printTaskChecklist(context, run);
    while (run.status === 'running') {
      if (run.pending.length) {
        await processPendingCall(context, run);
        continue;
      }

      if (run.spent.modelRequests >= run.limits.modelRequests) {
        stopRun(context, run, 'blocked', 'Budget exhausted: modelRequests');
        break;
      }

      run.spent.modelRequests++;
      context.store.save(run); // No request replay/refund after a crash.
      let response;

      try {
        response = parseAssistant(
          await context.model.complete(structuredClone(run.messages), definitions),
        );
      } catch (error) {
        stopRun(context, run, 'blocked', `Model request failed: ${failure(error).error}`);
        break;
      }

      run.messages.push(response);

      const calls = response.tool_calls ?? [];

      if (!calls.length) {
        run.final = response.content ?? '';
        if (run.phase !== 'execute' || run.tasks.some((task) => task.status !== 'completed')) {
          stopRun(
            context,
            run,
            'failed',
            'Model ended without approved plan/completed task evidence',
          );
        } else {
          run.status = 'completed';
          context.store.save(run);
        }

        break;
      }

      admitToolBatch(context, run, calls);
    }

    return run;
  });
}
