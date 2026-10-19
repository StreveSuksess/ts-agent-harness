import type { RuntimeContext } from './context.js';
import type { RunState } from '../types.js';

export function selectNextTask(run: RunState): void {
  const ready = run.tasks.find(
    (task) =>
      task.status === 'pending' &&
      task.depends_on.every((id) =>
        run.tasks.some((dependency) => dependency.id === id && dependency.status === 'completed'),
      ),
  );

  if (ready) {
    ready.status = 'running';
  }

  run.activeTaskId = ready?.id ?? null;
}

export function renderPhaseMessage(run: RunState): string {
  if (run.phase === 'plan') {
    return 'Phase: PLAN. Inspect with list_files/read_file, then submit_plan as a standalone tool call. Bash and mutations are forbidden.';
  }

  const task = run.tasks.find((task) => task.id === run.activeTaskId);

  return task
    ? `Phase: EXECUTE. Current task: ${JSON.stringify(task)}. Use complete_task with saved evidence_call_id after satisfying verification.`
    : 'All tasks verified. Return your final textual answer.';
}

export function printTaskChecklist(context: RuntimeContext, run: RunState): void {
  for (const task of run.tasks) {
    context.options.log?.(
      `[${task.status === 'completed' ? 'x' : task.status === 'running' ? '>' : ' '}] ${task.id}: ${task.description}`,
    );
  }
}
