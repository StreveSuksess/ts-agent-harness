import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Policy } from './policy.js';
import { hash } from './tools.js';
import type { Change, FaultHook, Tree } from './types.js';

export function snapshot(policy: Policy): Tree {
  const tree: Tree = Object.create(null) as Tree;
  let totalBytes = 0;
  let fileCount = 0;

  function visit(directory: string, prefix: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const stats = lstatSync(path);

      if (stats.isSymbolicLink()) {
        throw new Error(`Snapshot rejects symlink: ${relative}`);
      }

      if (stats.isDirectory()) {
        visit(path, relative);
        continue;
      }

      if (!stats.isFile() || stats.nlink > 1) {
        throw new Error(`Snapshot rejects special/hardlinked file: ${relative}`);
      }

      if (
        ++fileCount > 10000 ||
        stats.size > policy.config.maxFileBytes ||
        totalBytes + stats.size > policy.config.maxTreeBytes
      ) {
        throw new Error('Workspace snapshot exceeds configured limits');
      }

      const content = readFileSync(path);

      totalBytes += content.length;
      tree[relative] = {
        content: content.toString('base64'),
        hash: hash(content),
        mode: stats.mode & 0o777,
      };
    }
  }
  visit(policy.workspace, '');

  return tree;
}

export function treeDiff(before: Tree, after: Tree): Change[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter(
      (path) =>
        before[path]?.hash !== after[path]?.hash || before[path]?.mode !== after[path]?.mode,
    )
    .map((path) => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}

export function assertTree(expected: Tree, actual: Tree): void {
  const changes = treeDiff(expected, actual);

  if (changes.length) {
    throw new Error(
      `External workspace conflict: ${changes.map((change) => change.path).join(', ')}`,
    );
  }
}

export function displayDiff(before: Tree, after: Tree): string {
  return treeDiff(before, after)
    .map((change) => {
      const lines = [
        `diff --agent a/${change.path} b/${change.path}`,
        `--- ${change.before ? `a/${change.path}` : '/dev/null'}`,
        `+++ ${change.after ? `b/${change.path}` : '/dev/null'}`,
      ];
      const beforeBytes = change.before
        ? Buffer.from(change.before.content, 'base64')
        : Buffer.alloc(0);
      const afterBytes = change.after
        ? Buffer.from(change.after.content, 'base64')
        : Buffer.alloc(0);

      if (beforeBytes.includes(0) || afterBytes.includes(0)) {
        lines.push('Binary contents differ');
      } else {
        const beforeLines = beforeBytes.toString('utf8').split('\n');
        const afterLines = afterBytes.toString('utf8').split('\n');

        lines.push(
          `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
          ...beforeLines.map((line) => `-${line}`),
          ...afterLines.map((line) => `+${line}`),
        );
      }

      return lines.join('\n');
    })
    .join('\n');
}

export function rollbackPreflight(
  policy: Policy,
  initial: Tree,
  expected: Tree,
  current: Tree,
): Change[] {
  const changes = treeDiff(initial, expected);

  for (const change of changes) {
    policy.path(change.path, true);
    if (
      current[change.path]?.hash !== change.after?.hash ||
      current[change.path]?.mode !== change.after?.mode
    ) {
      throw new Error(`Rollback conflict: ${change.path}; no files restored`);
    }

    if (
      change.before &&
      hash(Buffer.from(change.before.content, 'base64')) !== change.before.hash
    ) {
      throw new Error('Corrupt rollback snapshot');
    }
  }

  return changes;
}

export function restoreFiles(policy: Policy, changes: Change[], faults?: FaultHook): void {
  for (const change of changes) {
    const path = policy.path(change.path, true);

    if (change.before) {
      mkdirSync(dirname(path), { recursive: true });
      // Parent checks run again after directory creation.
      policy.path(change.path, true);
      writeFileSync(path, Buffer.from(change.before.content, 'base64'), {
        mode: change.before.mode,
      });
      chmodSync(path, change.before.mode);
    } else if (existsSync(path)) {
      unlinkSync(path);
    }

    faults?.('after_rollback_write');
  }
}
