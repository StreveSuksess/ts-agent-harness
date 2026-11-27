import { resolve } from 'node:path';
import { cliModel } from './model-progress.js';
import { Runtime } from '../runtime.js';
import { Store } from '../store.js';
import { InjectedCrash } from '../types.js';
import type { FaultHook, RunStatus } from '../types.js';
import { cliCommand, defaultDatabase, projectRoot } from './paths.js';
import { parseArguments } from './arguments.js';
import { applyDecision } from './decisions.js';
import { runChat } from './chat.js';
import { HELP } from './help.js';
import { formatHistory, selectRunId } from './history.js';
import { LiveOutput, outputMode, printState, showTarget } from './output.js';
import { formatTasks } from './presentation.js';
import { driveRun } from './session.js';
import { startTask } from './start.js';
import { terminalText } from './terminal-text.js';
import { formatTrace } from './trace.js';

function faultHook(point: string): FaultHook {
  return (reached) => {
    if (point === reached)
      throw new InjectedCrash(
        `Injected crash at ${point}; use status/resume and explicit resolution`,
      );
  };
}

function setRunExitCode(status: RunStatus | undefined): void {
  if (status && ['blocked', 'conflict', 'failed', 'uncertain'].includes(status)) {
    process.exitCode = 1;
  }
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv[0] === 'ui') {
    await import('../web/server.js');
    return;
  }
  if (argv[0] === 'tracker' || (!argv.length && process.stdin.isTTY && process.stdout.isTTY)) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('Для диалога нужен терминал. Для eval используйте npm run eval.');
    const { studioChat } = await import('../studio/cli.js');
    await studioChat(argv[1]);
    return;
  }
  const args = parseArguments(argv);
  const { command, flags } = args;
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const mode = outputMode(args);
  const interactive =
    (command === 'run' || command === 'resume') &&
    tty &&
    mode === 'human' &&
    !flags.has('no-input');

  if (command === 'help' || (!argv.length && !tty)) {
    console.log(HELP);
    return;
  }
  if (command === 'demo') {
    const { demo } = await import('../demo.js');
    await demo(undefined, projectRoot);
    return;
  }

  const chat = command === 'run' && args.task === undefined;
  if (chat && !interactive) {
    throw new Error(`Укажите задачу, например ${cliCommand} run "Исправь расчёт заказа".`);
  }

  const db = flags.get('db');
  const live = mode === 'human' ? new LiveOutput() : undefined;
  const store = new Store(resolve(db ?? defaultDatabase), live && ((run) => live.saved(run)));
  try {
    const point = flags.get('fault');
    const runtime = new Runtime(
      store,
      cliModel(mode === 'human' && Boolean(process.stdout.isTTY)),
      point ? { faults: faultHook(point) } : {},
    );
    if (chat && live) {
      setRunExitCode(await runChat(runtime, args, live));
      return;
    }
    if (command === 'runs') {
      const rows = store.listRuns();
      console.log(mode === 'json' ? JSON.stringify(rows) : formatHistory(rows));
      return;
    }

    const starting = command === 'run' || command === 'start';
    const run = starting
      ? startTask(runtime, args, args.task!)
      : store.get(selectRunId(store, args.id));
    const id = run.id;
    live?.startAt(run);

    switch (command) {
      case 'status':
        printState(run, mode, db);
        return;
      case 'tasks':
        console.log(mode === 'json' ? JSON.stringify(run.tasks) : formatTasks(run));
        return;
      case 'trace': {
        const messages = run.messages.filter((m) => m.role === 'assistant' || m.role === 'tool');
        console.log(
          mode === 'json'
            ? JSON.stringify(messages)
            : formatTrace(messages).join('\n') ||
                'В этом запуске пока нет ответов модели и инструментов.',
        );
        return;
      }
      case 'diff': {
        const diff = runtime.diff(id);
        console.log(mode === 'json' ? JSON.stringify(diff) : terminalText(diff));
        return;
      }
      case 'rollback':
        printState(await runtime.rollback(id), mode, db);
        return;
      case 'resolve-rollback':
        await runtime.resolveRollback(id);
        printState(store.get(id), mode, db);
        return;
    }

    if (mode === 'legacy' && starting) console.log(`run_id=${id}`);
    if (live) showTarget(run);
    applyDecision(runtime, id, args);
    const result = await driveRun(runtime, id, { interactive, mode, db });
    if (command === 'run') setRunExitCode(result.status);
  } finally {
    store.close();
  }
}
