import { cliCommand } from './paths.js';
import type { Runtime } from '../runtime.js';
import { ApprovalChangedError } from '../runtime/approvals.js';
import type { RunState } from '../types.js';
import { askApproval } from './dialog.js';
import { printState, type OutputMode } from './output.js';
import { formatReview } from './presentation.js';
import { dbOption } from './terminal-text.js';

export async function driveRun(
  runtime: Runtime,
  id: string,
  options: { interactive: boolean; mode: OutputMode; db?: string | undefined },
): Promise<RunState> {
  for (;;) {
    const run = await runtime.run(id);
    const waiting = run.status === 'awaiting_plan' || run.status === 'awaiting_action';
    if (!options.interactive || !waiting) {
      printState(run, options.mode, options.db);
      return run;
    }

    console.log('\n' + formatReview(run));
    const answer = await askApproval(run);
    if (answer.decision === 'pause') {
      console.log(
        `Решение отложено. Продолжить: ${cliCommand} resume ${run.id}${dbOption(options.db)}`,
      );
      return run;
    }

    try {
      if (run.status === 'awaiting_plan') {
        runtime.approvePlan(id, answer.decision === 'accept', {
          expectedRevision: run.revision,
          ...(answer.decision === 'reject' && answer.feedback ? { feedback: answer.feedback } : {}),
        });
      } else {
        runtime.approveAction(id, answer.decision === 'accept', run.revision);
      }
    } catch (error) {
      if (!(error instanceof ApprovalChangedError)) throw error;
      console.log('Запуск изменился в другом терминале. Проверяю текущее состояние.');
    }
  }
}
