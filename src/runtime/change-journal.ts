import { treeDiff } from '../journal.js';
import type { RunState, Tree } from '../types.js';

export function recordChanges(run: RunState, before: Tree, after: Tree): void {
  const changes = treeDiff(before, after);

  run.journal.push(changes);
  for (const change of changes) {
    const prior = Object.hasOwn(run.changes, change.path) ? run.changes[change.path] : undefined;

    Object.defineProperty(run.changes, change.path, {
      value: {
        path: change.path,
        before: prior ? prior.before : change.before,
        after: change.after,
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
