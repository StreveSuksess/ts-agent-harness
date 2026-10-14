import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InjectedCrash } from '../src/types.js';
import { call, fixture, reply, FIXED_ORDER, demoResponses } from './helpers.js';

test('model request budget prevents the request before it starts', async t => {
  const f = fixture(t); const r = f.start({ limits: { modelRequests: 0 } });
  const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'blocked'); assert.match(state.reason!, /modelRequests/); assert.equal(state.spent.modelRequests, 0);
});
test('tool-call batch is all-or-nothing when toolCalls is exhausted', async t => {
  const f = fixture(t, [reply(call('a', 'read_file', { path: 'order.py' }), call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ limits: { toolCalls: 1 } }); const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'blocked'); assert.equal(Object.keys(state.calls).length, 0); assert.equal(state.spent.toolCalls, 0);
  assert.notEqual(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  const spent = structuredClone(state.spent); f.reopen(); await f.runtime.run(r.id);
  assert.deepEqual(f.store.get(r.id).spent, spent);
});
test('side-effect budget rejects a batch including its read calls before any execution', async t => {
  const f = fixture(t, [reply(call('a', 'read_file', { path: 'order.py' }), call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ limits: { sideEffects: 0 } }); const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'blocked'); assert.equal(Object.keys(state.calls).length, 0); assert.equal(state.spent.sideEffects, 0);
});
test('result output fits the remaining UTF-8 byte budget and is explicitly incomplete', async t => {
  const f = fixture(t, [reply(call('a', 'read_file', { path: 'big.txt' }), call('b', 'read_file', { path: 'order.py' }))]);
  writeFileSync(resolve(f.workspace, 'big.txt'), 'Ж'.repeat(1000));
  const r = f.start({ limits: { resultBytes: 50 } }); const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'blocked'); assert.match(state.reason!, /resultBytes/);
  const output = state.messages.find(m => m.tool_call_id === 'a')!.content!;
  assert.ok(Buffer.byteLength(output) <= 50); assert.equal(JSON.parse(output).truncated, true); assert.ok(state.spent.resultBytes <= 50);
  assert.equal(state.calls.b?.attempts.length, 0);
});
test('crash after atomic reservation retains counters and forbids refunds/reexecution on resume', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))], p => { if (p === 'after_reservation') throw new InjectedCrash('crash'); });
  const r = f.start({ limits: { resultBytes: 500 } }); await assert.rejects(() => f.runtime.run(r.id), InjectedCrash);
  const spent = structuredClone(f.store.get(r.id).spent);
  assert.deepEqual(spent, { modelRequests: 1, toolCalls: 1, sideEffects: 1, resultBytes: 500 });
  assert.notEqual(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  f.reopen(); await f.runtime.run(r.id); assert.deepEqual(f.store.get(r.id).spent, spent);
  assert.throws(() => f.runtime.resolve(r.id, 'retry'), /result budget/);
  f.runtime.resolve(r.id, 'fail'); assert.deepEqual(f.store.get(r.id).spent, spent);
});
test('plan approval and resume preserve all counters across phases', async t => {
  const responses = demoResponses(); const f = fixture(t, responses.slice(0, 2));
  const r = f.start({ plan: true }); await f.runtime.run(r.id);
  const spent = structuredClone(f.store.get(r.id).spent);
  f.reopen(responses.slice(2)); f.runtime.approvePlan(r.id, true);
  assert.deepEqual(f.store.get(r.id).spent, spent);
  const done = await f.runtime.run(r.id);
  assert.equal(done.status, 'completed'); assert.ok(done.spent.modelRequests > spent.modelRequests); assert.ok(done.spent.toolCalls > spent.toolCalls);
});
