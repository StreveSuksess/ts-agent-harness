import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InjectedCrash } from '../src/types.js';
import { call, fixture, reply, FIXED_ORDER } from './helpers.js';

test('journal and rollback cover update/create/delete after restarting storage, preserving unrelated files', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }), call('new', 'write_file', { path: 'new.txt', content: 'new' })), reply(call('d', 'delete_file', { path: 'old.txt' }))]);
  writeFileSync(resolve(f.workspace, 'old.txt'), 'old');
  const original = readFileSync(resolve(f.workspace, 'order.py'));
  const r = f.start(); assert.equal((await f.runtime.run(r.id)).status, 'awaiting_action');
  f.runtime.approveAction(r.id, true); await f.runtime.run(r.id);
  const diff = f.runtime.diff(r.id); assert.match(diff, /order.py/); assert.match(diff, /new.txt/); assert.match(diff, /old.txt/);
  writeFileSync(resolve(f.workspace, 'unrelated.txt'), 'user');
  f.reopen(); const restored = await f.runtime.rollback(r.id);
  assert.equal(restored.status, 'rolled_back'); assert.deepEqual(readFileSync(resolve(f.workspace, 'order.py')), original);
  assert.equal(existsSync(resolve(f.workspace, 'new.txt')), false); assert.equal(readFileSync(resolve(f.workspace, 'old.txt'), 'utf8'), 'old');
  assert.equal(readFileSync(resolve(f.workspace, 'unrelated.txt'), 'utf8'), 'user');
});
test('rollback preflight detects one external edit and restores no files', async t => {
  const f = fixture(t, [reply(call('a', 'write_file', { path: 'aaa.txt', content: 'created' }), call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start(); await f.runtime.run(r.id);
  writeFileSync(resolve(f.workspace, 'order.py'), 'external edit'); f.reopen();
  await assert.rejects(() => f.runtime.rollback(r.id), /Rollback conflict/);
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), 'external edit');
  assert.equal(readFileSync(resolve(f.workspace, 'aaa.txt'), 'utf8'), 'created');
});
test('rollback rechecks current policy before restoring anything', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start(); await f.runtime.run(r.id); f.config.readOnlyFiles.push('order.py'); f.policy();
  await assert.rejects(() => f.runtime.rollback(r.id), /read-only/); assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
});
test('uncertain mutation cannot be rolled back until explicitly attributed', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))], p => { if (p === 'after_execute') throw new InjectedCrash('crash'); });
  const original = readFileSync(resolve(f.workspace, 'order.py'));
  const r = f.start(); await assert.rejects(() => f.runtime.run(r.id)); f.reopen();
  await assert.rejects(() => f.runtime.rollback(r.id), /uncertain/); await f.runtime.run(r.id);
  f.runtime.resolve(r.id, 'fail', true); f.reopen(); await f.runtime.rollback(r.id);
  assert.deepEqual(readFileSync(resolve(f.workspace, 'order.py')), original);
});
test('changes rejected as unattributed are not included in rollback', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))], p => { if (p === 'after_execute') throw new InjectedCrash('crash'); });
  const r = f.start(); await assert.rejects(() => f.runtime.run(r.id)); f.reopen(); await f.runtime.run(r.id);
  f.runtime.resolve(r.id, 'fail', false); assert.equal(Object.keys(f.store.get(r.id).changes).length, 0);
  await f.runtime.rollback(r.id); assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
});
test('interrupted rollback is durable and requires explicit completion', async t => {
  const f = fixture(t, [reply(call('a', 'write_file', { path: 'aaa.txt', content: 'created' }), call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const original = readFileSync(resolve(f.workspace, 'order.py'));
  const r = f.start(); await f.runtime.run(r.id);
  f.reopen([], p => { if (p === 'after_rollback_write') throw new InjectedCrash('crash'); });
  await assert.rejects(() => f.runtime.rollback(r.id), InjectedCrash);
  f.reopen(); assert.equal((await f.runtime.run(r.id)).status, 'uncertain');
  await assert.rejects(() => f.runtime.rollback(r.id), /uncertain/);
  await f.runtime.resolveRollback(r.id);
  assert.equal(f.store.get(r.id).status, 'rolled_back'); assert.equal(existsSync(resolve(f.workspace, 'aaa.txt')), false);
  assert.deepEqual(readFileSync(resolve(f.workspace, 'order.py')), original);
});
