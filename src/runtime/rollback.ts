import { displayDiff, restoreFiles, rollbackPreflight, snapshot } from '../journal.js';
import { now } from '../types.js';
import type { RuntimeContext } from './context.js';
import type { RunState, Tree } from '../types.js';
import { loadPolicy } from './context.js';

export function getRunDiff(context: RuntimeContext, id: string): string {
  const run = context.store.get(id);
  const before: Tree = {};
  const after: Tree = {};

  for (const change of Object.values(run.changes)) {
    if (change.before) {
      Object.defineProperty(before, change.path, { value: change.before, enumerable: true });
    }

    if (change.after) {
      Object.defineProperty(after, change.path, { value: change.after, enumerable: true });
    }
  }

  let text = displayDiff(before, after) || 'No attributed file changes.';
  const uncertain = Object.values(run.calls).find(
    (call) => call.status === 'uncertain' || call.status === 'started',
  );

  if (uncertain) {
    const observedDiff = displayDiff(
      uncertain.attempts.at(-1)!.before,
      snapshot(loadPolicy(context, run)),
    );

    text += `\nUncertain changes (not attributed):\n${observedDiff || 'No changes observed.'}`;
  }

  return text;
}

export async function rollbackRun(context: RuntimeContext, id: string): Promise<RunState> {
  const state = context.store.get(id);

  return context.store.locked(state.workspace, async () => {
    const run = context.store.get(id);

    if (run.status === 'rolled_back') {
      return run;
    }

    if (
      run.rollbackStarted ||
      Object.values(run.calls).some((call) => ['started', 'uncertain'].includes(call.status))
    ) {
      throw new Error('Resolve uncertain action/rollback before rollback');
    }

    const policy = loadPolicy(context, run);
    const current = snapshot(policy);
    const before: Tree = Object.create(null) as Tree;
    const after: Tree = Object.create(null) as Tree;

    for (const change of Object.values(run.changes)) {
      if (change.before) {
        before[change.path] = change.before;
      }

      if (change.after) {
        after[change.path] = change.after;
      }
    }

    const changes = rollbackPreflight(policy, before, after, current);

    run.rollbackStarted = true;
    context.store.save(run);
    restoreFiles(policy, changes, context.options.faults);
    run.expected = snapshot(policy);
    run.rollbackStarted = false;
    run.status = 'rolled_back';
    run.decisions.push({ at: now(), kind: 'rollback', choice: 'restore' });
    context.store.save(run);

    return run;
  });
}

export async function completeInterruptedRollback(
  context: RuntimeContext,
  id: string,
): Promise<void> {
  const state = context.store.get(id);

  await context.store.locked(state.workspace, async () => {
    const run = context.store.get(id);

    if (!run.rollbackStarted) {
      throw new Error('No interrupted rollback');
    }

    const policy = loadPolicy(context, run);
    const current = snapshot(policy);

    for (const change of Object.values(run.changes)) {
      const actual = current[change.path];

      if (
        (actual?.hash !== change.before?.hash || actual?.mode !== change.before?.mode) &&
        (actual?.hash !== change.after?.hash || actual?.mode !== change.after?.mode)
      ) {
        throw new Error(`Interrupted rollback conflict: ${change.path}`);
      }

      policy.path(change.path, true);
    }

    for (const change of Object.values(run.changes)) {
      const actual = current[change.path];

      if (actual?.hash !== change.before?.hash || actual?.mode !== change.before?.mode) {
        restoreFiles(policy, [change]);
      }
    }

    run.expected = snapshot(policy);
    run.rollbackStarted = false;
    run.status = 'rolled_back';
    run.decisions.push({
      at: now(),
      kind: 'rollback',
      choice: 'explicitly-complete-interrupted-rollback',
    });
    context.store.save(run);
  });
}
