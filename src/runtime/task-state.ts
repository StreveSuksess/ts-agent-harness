import type { RuntimeContext } from './context.js';
import type { RunState } from '../types.js';
import { PROJECT_TOOLS } from '../types.js';

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

  if (!task) {
    return 'All tasks verified. Return your final textual answer.';
  }

  const evidence = Object.values(run.calls)
    .filter(
      (record) =>
        record.phase === 'execute' &&
        record.taskId === task.id &&
        record.status === 'completed' &&
        record.result?.ok &&
        PROJECT_TOOLS.has(record.call.function.name),
    )
    .slice(-8)
    .map((record) => ({
      evidence_call_id: record.call.id,
      tool: record.call.function.name,
    }));

  return [
    `Phase: EXECUTE. Current task: ${JSON.stringify(task)}.`,
    `Recent successful project calls for this task: ${JSON.stringify(evidence)}.`,
    'Use complete_task with a listed evidence_call_id after satisfying verification.',
  ].join(' ');
}

export function printTaskChecklist(context: RuntimeContext, run: RunState): void {
  for (const task of run.tasks) {
    context.options.log?.(
      `[${task.status === 'completed' ? 'x' : task.status === 'running' ? '>' : ' '}] ${task.id}: ${task.description}`,
    );
  }
}
