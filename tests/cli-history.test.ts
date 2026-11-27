import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import test from 'node:test';
import { formatHistory, selectRunId } from '../src/cli/history.js';
import { Store } from '../src/store.js';
import { fixture } from './helpers.js';

test('legacy rows are listed by creation time, then insertion order, after reopen', (t) => {
  const f = fixture(t);
  const filename = join(f.root, 'legacy.sqlite');
  const legacy = new DatabaseSync(filename);
  legacy.exec(
    'CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)',
  );
  const insert = legacy.prepare('INSERT INTO runs VALUES (?, 1, ?)');
  const createdAt = '2026-10-20T12:00:00.000Z';
  for (const [id, time] of [
    ['abcdefff1', createdAt],
    ['abcdefff2', createdAt],
    ['older', '2026-10-19T12:00:00.000Z'],
  ] as const) {
    insert.run(
      id,
      JSON.stringify({
        id,
        createdAt: time,
        prompt: 'Исправь тесты',
        workspace: f.workspace,
        status: 'running',
        messages: [],
        expected: { file: { content: 'unneeded' } },
      }),
    );
  }
  legacy.close();

  const store = new Store(filename);
  t.after(() => store.close());
  const rows = store.listRuns();
  assert.deepEqual(
    rows.map((row) => row.id),
    ['abcdefff2', 'abcdefff1', 'older'],
  );
  assert.deepEqual(rows[0], {
    id: 'abcdefff2',
    createdAt,
    prompt: 'Исправь тесты',
    workspace: f.workspace,
    status: 'running',
  });
  assert.equal(selectRunId(store), 'abcdefff2');
  assert.equal(selectRunId(store, 'old'), 'older');
  assert.equal(selectRunId(store, 'abcdefff1'), 'abcdefff1');
  assert.throws(() => selectRunId(store, 'abcdefff'), /несколько/i);
  assert.throws(() => selectRunId(store, 'RUN_ID'), /runs/);
  assert.throws(() => selectRunId(store, '%'), /runs/);
  assert.throws(() => selectRunId(store, ''), /ID/i);
  assert.deepEqual(f.store.listRuns(), []);
  assert.throws(() => selectRunId(f.store), /запуск/i);
  assert.match(formatHistory([]), /запуск/i);

  const history = formatHistory(rows);
  for (const row of rows) assert.ok(history.includes(row.id));
});

test('history renders compact usable IDs and terminal-safe one-line task previews', (t) => {
  const f = fixture(t);
  const run = f.start({ prompt: '\u001b[2JЗапусти\nтесты\rснова' });
  const view = formatHistory(f.store.listRuns());
  assert.ok(view.includes(run.id.slice(0, 8)));
  assert.ok(view.includes('Запусти'));
  assert.doesNotMatch(view, /\u001b|\r|Запусти\n/);
  assert.equal(selectRunId(f.store, run.id.slice(0, 8)), run.id);
});

test('live observers see committed revisions, including from another connection', (t) => {
  const f = fixture(t);
  const run = f.start();
  const seen: number[] = [];
  const store = new Store(f.db, (state) => {
    assert.equal(f.store.get(state.id).revision, state.revision);
    seen.push(state.revision);
  });
  t.after(() => store.close());
  const stale = f.store.get(run.id);
  store.save(run);
  assert.throws(() => store.save(stale), /Concurrent/);
  assert.deepEqual(seen, [run.revision]);
});
