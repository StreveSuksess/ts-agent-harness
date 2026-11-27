import { resolve } from 'node:path';
import type { Runtime } from '../runtime.js';
import type { RunStatus } from '../types.js';
import { oneLine } from './terminal-text.js';
import type { CliArguments } from './arguments.js';
import { rememberTurn, type ConversationTurn } from './conversation-context.js';
import { askTask } from './dialog.js';
import { showTarget, type LiveOutput } from './output.js';
import { driveRun } from './session.js';
import { startTask } from './start.js';

export async function runChat(
  runtime: Runtime,
  args: CliArguments,
  live: LiveOutput,
): Promise<RunStatus | undefined> {
  const requestedWorkspace = args.flags.get('workspace');
  console.log(
    'Проект   ' +
      (requestedWorkspace
        ? oneLine(resolve(requestedWorkspace))
        : 'учебный пример, отдельная копия для этого диалога'),
  );
  console.log('Введите запрос. После ответа можно задать следующий. Выход — /exit.');
  let history: ConversationTurn[] = [];
  let workspace: string | undefined;
  let lastStatus: RunStatus | undefined;
  let prompt = await askTask();

  while (prompt !== undefined) {
    const followUp = workspace ? { workspace, history } : undefined;
    const run = startTask(runtime, args, prompt, followUp);
    workspace = run.workspace;
    live.startAt(run);
    showTarget(run);

    const result = await driveRun(runtime, run.id, {
      interactive: true,
      mode: 'human',
      db: args.flags.get('db'),
    });
    lastStatus = result.status;
    if (result.status !== 'completed' && result.status !== 'failed') {
      // Pending approvals and interrupted operations keep their own resume path.
      return lastStatus;
    }

    history = rememberTurn(history, result);
    prompt = await askTask(undefined, 'Следующий запрос');
  }
  return lastStatus;
}
