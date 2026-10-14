import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

test('SQLite persists state across reopen and rejects stale revisions', t => {
  const f = fixture(t), r = f.start(); const stale = f.store.get(r.id);
  r.reason = 'updated'; f.store.save(r);
  assert.throws(() => f.store.save(stale), /Concurrent/);
  f.reopen(); assert.equal(f.store.get(r.id).reason, 'updated');
});
test('workspace lock rejects concurrent runs even in the same Node process', async t => {
  const f = fixture(t);
  await f.store.locked(f.workspace, async () => {
    await assert.rejects(() => f.store.locked(f.workspace, async () => undefined), /already in use/);
  });
  await f.store.locked(f.workspace, async () => undefined);
});
