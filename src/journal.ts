import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Policy } from './policy.js';
import { hash } from './tools.js';
import type { Change, FaultHook, Tree } from './types.js';

export function snapshot(policy: Policy): Tree {
  const tree: Tree = Object.create(null) as Tree;
  let total = 0, count = 0;
  function visit(directory: string, prefix: string): void {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const st = lstatSync(path);
      if (st.isSymbolicLink()) throw new Error(`Snapshot rejects symlink: ${relative}`);
      if (st.isDirectory()) { visit(path, relative); continue; }
      if (!st.isFile() || st.nlink > 1) throw new Error(`Snapshot rejects special/hardlinked file: ${relative}`);
      if (++count > 10000 || st.size > policy.config.maxFileBytes || total + st.size > policy.config.maxTreeBytes) throw new Error('Workspace snapshot exceeds configured limits');
      const content = readFileSync(path);
      total += content.length;
      tree[relative] = { content: content.toString('base64'), hash: hash(content), mode: st.mode & 0o777 };
    }
  }
  visit(policy.workspace, '');
  return tree;
}
export function treeDiff(before: Tree, after: Tree): Change[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(p => before[p]?.hash !== after[p]?.hash || before[p]?.mode !== after[p]?.mode)
    .map(path => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}
export function assertTree(expected: Tree, actual: Tree): void {
  const changes = treeDiff(expected, actual);
  if (changes.length) throw new Error(`External workspace conflict: ${changes.map(c => c.path).join(', ')}`);
}
export function displayDiff(before: Tree, after: Tree): string {
  return treeDiff(before, after).map(c => {
    const lines = [`diff --agent a/${c.path} b/${c.path}`, `--- ${c.before ? `a/${c.path}` : '/dev/null'}`, `+++ ${c.after ? `b/${c.path}` : '/dev/null'}`];
    const a = c.before ? Buffer.from(c.before.content, 'base64') : Buffer.alloc(0);
    const b = c.after ? Buffer.from(c.after.content, 'base64') : Buffer.alloc(0);
    if (a.includes(0) || b.includes(0)) lines.push('Binary contents differ');
    else {
      const old = a.toString('utf8').split('\n'), next = b.toString('utf8').split('\n');
      lines.push(`@@ -1,${old.length} +1,${next.length} @@`, ...old.map(l => `-${l}`), ...next.map(l => `+${l}`));
    }
    return lines.join('\n');
  }).join('\n');
}
export function rollbackPreflight(policy: Policy, initial: Tree, expected: Tree, current: Tree): Change[] {
  const changes = treeDiff(initial, expected);
  for (const c of changes) {
    policy.path(c.path, true);
    if (current[c.path]?.hash !== c.after?.hash || current[c.path]?.mode !== c.after?.mode) throw new Error(`Rollback conflict: ${c.path}; no files restored`);
    if (c.before && hash(Buffer.from(c.before.content, 'base64')) !== c.before.hash) throw new Error('Corrupt rollback snapshot');
  }
  return changes;
}
export function restoreFiles(policy: Policy, changes: Change[], faults?: FaultHook): void {
  for (const c of changes) {
    const path = policy.path(c.path, true);
    if (c.before) {
      mkdirSync(dirname(path), { recursive: true });
      // Parent checks run again after directory creation.
      policy.path(c.path, true);
      writeFileSync(path, Buffer.from(c.before.content, 'base64'), { mode: c.before.mode });
      chmodSync(path, c.before.mode);
    } else if (existsSync(path)) unlinkSync(path);
    faults?.('after_rollback_write');
  }
}
