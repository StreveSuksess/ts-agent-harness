import { resolve } from 'node:path';
import { Store } from '../store.js';
import { Runtime } from '../runtime.js';
import { ChatModel } from '../model.js';
import { demo } from '../demo.js';
import { InjectedCrash } from '../types.js';
import type { FaultHook, RunState } from '../types.js';

import { HELP, parseArguments } from './arguments.js';

function printRun(run: RunState, runtime: Runtime): void {
  console.log(
    JSON.stringify(
      {
        run_id: run.id,
        status: run.status,
        phase: run.phase,
        reason: run.reason,
        final: run.final,
        spent: run.spent,
        reservedSideEffects: run.reservedSideEffects,
        limits: run.limits,
        plan: run.plan,
        pending: run.pending[0]?.call,
        decisions: run.decisions,
      },
      null,
      2,
    ),
  );
  runtime.printTasks(run);
}

export async function runCli(argv: string[]): Promise<void> {
  const { command, id, flags } = parseArguments(argv);

  if (['help', '--help', '-h'].includes(command)) {
    console.log(HELP);

    return;
  }

  if (command === 'demo') {
    await demo();

    return;
  }

  const store = new Store(resolve(flags.get('--db') ?? '.agent/state.sqlite'));
  let faults: FaultHook | undefined;

  if (flags.has('--fault')) {
    const point = flags.get('--fault')!;

    if (!['after_reservation', 'after_execute', 'after_rollback_write'].includes(point)) {
      throw new Error('Invalid fault point');
    }

    faults = (faultPoint) => {
      if (faultPoint === point) {
        throw new InjectedCrash(
          `Injected crash at ${faultPoint}; use status/resume and explicit resolution`,
        );
      }
    };
  }

  const runtime = new Runtime(
    store,
    { complete: (messages, tools) => ChatModel.fromEnvironment().complete(messages, tools) },
    { log: console.log, ...(faults ? { faults } : {}) },
  );

  try {
    if (command === 'start') {
      const mode = flags.get('--mode') ?? 'safe';

      if (!['safe', 'auto'].includes(mode)) {
        throw new Error('Mode must be safe or auto');
      }

      const prompt = flags.get('--task');

      if (!prompt) {
        throw new Error('--task is required');
      }

      const run = runtime.start({
        workspace: resolve(flags.get('--workspace') ?? 'workspace'),
        policyFile: resolve(flags.get('--policy') ?? 'policy.example.json'),
        prompt,
        mode: mode as 'safe' | 'auto',
        plan: !flags.has('--no-plan'),
      });

      console.log(`run_id=${run.id}`);
      printRun(await runtime.run(run.id), runtime);

      return;
    }

    if (!id) {
      throw new Error('run_id is required');
    }

    if (command === 'status') {
      printRun(store.get(id), runtime);

      return;
    }

    if (command === 'tasks') {
      runtime.printTasks(store.get(id));

      return;
    }

    if (command === 'diff') {
      console.log(runtime.diff(id));

      return;
    }

    if (command === 'rollback') {
      printRun(await runtime.rollback(id), runtime);

      return;
    }

    if (command === 'resolve-rollback') {
      await runtime.resolveRollback(id);
      printRun(store.get(id), runtime);

      return;
    }

    const decision = flags.get('--decision');

    if (command === 'approve-plan') {
      if (!['approve', 'reject'].includes(decision ?? '')) {
        throw new Error('--decision must be approve or reject');
      }

      runtime.approvePlan(id, decision === 'approve');
    } else if (command === 'approve-action') {
      if (!['allow', 'deny'].includes(decision ?? '')) {
        throw new Error('--decision must be allow or deny');
      }

      runtime.approveAction(id, decision === 'allow');
    } else if (command === 'resolve') {
      if (!['retry', 'fail', 'abort'].includes(decision ?? '')) {
        throw new Error('--decision must be retry, fail or abort');
      }

      const attributionChoice = flags.get('--attribute');

      if (attributionChoice !== undefined && !['yes', 'no'].includes(attributionChoice)) {
        throw new Error('--attribute must be yes or no');
      }

      runtime.resolve(
        id,
        decision as 'retry' | 'fail' | 'abort',
        attributionChoice === undefined ? undefined : attributionChoice === 'yes',
      );
    } else if (command !== 'resume') {
      throw new Error(`Unknown command: ${command}`);
    }

    printRun(await runtime.run(id), runtime);
  } finally {
    store.close();
  }
}
