import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InjectedCrash } from '../src/types.js';
import { call, fixture, reply, FIXED_ORDER, demoResponses } from './helpers.js';
import { hash } from '../src/tools.js';

test('full dependent plan: Bash verifies fix, test file stays unchanged, task checklist has three completions', async t => {
  const f = fixture(t, demoResponses());
  const before = hash(readFileSync(resolve(f.workspace, 'test_order.py')));
  const r = f.start({ plan: true });
  assert.equal((await f.runtime.run(r.id)).status, 'awaiting_plan');
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), readFileSync('workspace/order.py', 'utf8'));
  f.runtime.approvePlan(r.id, true);
  const done = await f.runtime.run(r.id);
  assert.equal(done.status, 'completed'); assert.equal(done.tasks.length, 3);
  assert.ok(done.tasks.every(task => task.status === 'completed' && task.evidence));
  assert.equal(done.calls.tests?.result?.exitCode, 0);
  assert.equal(before, hash(readFileSync(resolve(f.workspace, 'test_order.py'))));
  assert.equal(done.calls.find?.taskId, null); assert.equal(done.calls.fix?.taskId, 'fix');
  const lines: string[] = []; const { Runtime } = await import('../src/runtime.js');
  new Runtime(f.store, { complete: async () => { throw new Error('not called'); } }, { log: line => lines.push(line) }).printTasks(done);
  assert.equal(lines.filter(line => line.startsWith('[x]')).length, 3);
  const spent = structuredClone(done.spent); f.reopen();
  assert.equal((await f.runtime.run(r.id)).status, 'completed'); assert.deepEqual(f.store.get(r.id).spent, spent);
});
test('multiple calls, malformed arguments and tool errors are returned with matching IDs', async t => {
  const f = fixture(t, [reply(call('a', 'read_file', { path: 'missing' }), call('b', 'read_file', { path: 42 }), call('c', 'read_file', { path: 'order.py' })), { role: 'assistant', content: 'Unable to finish' }]);
  const r = f.start(); await f.runtime.run(r.id);
  const tools = f.store.get(r.id).messages.filter(m => m.role === 'tool');
  assert.deepEqual(tools.map(m => m.tool_call_id), ['a', 'b', 'c']);
  assert.equal(JSON.parse(tools[0]!.content!).ok, false); assert.equal(JSON.parse(tools[2]!.content!).ok, true);
});
test('safe mode persists approval; rejection reaches model; auto deletion still requires approval', async t => {
  const f = fixture(t, [reply(call('write', 'write_file', { path: 'order.py', content: FIXED_ORDER })), reply(call('read', 'read_file', { path: 'order.py' })), reply(call('delete', 'delete_file', { path: 'order.py' }))]);
  const r = f.start({ mode: 'safe' });
  assert.equal((await f.runtime.run(r.id)).status, 'awaiting_action');
  f.reopen([reply(call('read', 'read_file', { path: 'order.py' })), reply(call('delete', 'delete_file', { path: 'order.py' }))]);
  f.runtime.approveAction(r.id, false);
  assert.equal((await f.runtime.run(r.id)).status, 'awaiting_action');
  const state = f.store.get(r.id);
  assert.match(state.calls.write?.result?.error ?? '', /denied/);
  assert.notEqual(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  const auto = fixture(t, [reply(call('d', 'delete_file', { path: 'order.py' }))]);
  assert.equal((await auto.runtime.run(auto.start().id)).status, 'awaiting_action');
});
test('approved safe action is revalidated against changed policy before execution', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ mode: 'safe' }); await f.runtime.run(r.id);
  f.runtime.approveAction(r.id, true);
  f.config.readOnlyFiles.push('order.py'); f.policy();
  await f.runtime.run(r.id);
  assert.match(f.store.get(r.id).calls.w?.result?.error ?? '', /read-only/);
});
test('completed IDs are cached; altered arguments produce a protocol error without another write', async t => {
  const w = call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER });
  const f = fixture(t, [reply(w), reply(w), reply(call('w', 'write_file', { path: 'order.py', content: 'bad' })), { role: 'assistant', content: 'done' }]);
  const r = f.start(); await f.runtime.run(r.id);
  const state = f.store.get(r.id);
  assert.equal(state.calls.w?.attempts.length, 1); assert.equal(state.spent.sideEffects, 1);
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  assert.match(state.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '', /Protocol error/);
});
test('conflicting duplicate IDs in one batch return a protocol error without a second mutation', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }), call('w', 'write_file', { path: 'order.py', content: 'bad' }))]);
  const r = f.start(); await f.runtime.run(r.id);
  const state = f.store.get(r.id);
  assert.equal(state.calls.w?.attempts.length, 1); assert.equal(state.spent.sideEffects, 1); assert.equal(state.reservedSideEffects, 0);
  assert.match(state.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '', /Protocol error/);
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
});
test('denied actions consume no side-effect execution budget', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ mode: 'safe' }); await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).reservedSideEffects, 1); assert.equal(f.store.get(r.id).spent.sideEffects, 0);
  f.runtime.approveAction(r.id, false);
  assert.equal(f.store.get(r.id).reservedSideEffects, 0); assert.equal(f.store.get(r.id).spent.sideEffects, 0);
});
test('invalidated policy yields a tool error instead of crashing the loop', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ mode: 'safe' }); await f.runtime.run(r.id); f.runtime.approveAction(r.id, true);
  writeFileSync(f.policyFile, '{}');
  await assert.doesNotReject(() => f.runtime.run(r.id));
  assert.match(f.store.get(r.id).calls.w?.result?.error ?? '', /Invalid policy/);
});
test('crash after write: no silent replay; attribution required; explicit retry is a new attempt', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))], point => { if (point === 'after_execute') throw new InjectedCrash('crash'); });
  const r = f.start(); await assert.rejects(() => f.runtime.run(r.id), InjectedCrash);
  const spent = structuredClone(f.store.get(r.id).spent);
  f.reopen(); assert.equal((await f.runtime.run(r.id)).status, 'uncertain');
  assert.equal(f.store.get(r.id).calls.w?.attempts.length, 1);
  assert.throws(() => f.runtime.resolve(r.id, 'retry'), /attribute/);
  assert.match(f.runtime.diff(r.id), /Uncertain changes/);
  f.runtime.resolve(r.id, 'retry', true);
  await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).calls.w?.attempts.length, 2);
  assert.equal(f.store.get(r.id).spent.sideEffects, spent.sideEffects + 1);
  assert.ok(f.store.get(r.id).spent.resultBytes >= spent.resultBytes);
});
test('uncertain Bash is never retried; fail delivers a result and abort ends the run', async t => {
  const f = fixture(t, [reply(call('b', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' }))], p => { if (p === 'after_execute') throw new InjectedCrash('crash'); });
  const r = f.start(); await assert.rejects(() => f.runtime.run(r.id));
  f.reopen(); await f.runtime.run(r.id);
  assert.throws(() => f.runtime.resolve(r.id, 'retry'), /not safely repeatable/);
  f.runtime.resolve(r.id, 'fail');
  assert.equal(f.store.get(r.id).calls.b?.status, 'completed');
  assert.match(f.store.get(r.id).messages.at(-1)?.content ?? '', /not replayed/);
  const g = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))], p => { if (p === 'after_reservation') throw new InjectedCrash('crash'); });
  const s = g.start(); await assert.rejects(() => g.runtime.run(s.id));
  g.reopen(); await g.runtime.run(s.id); g.runtime.resolve(s.id, 'abort');
  assert.equal(g.store.get(s.id).status, 'failed');
});
test('external changes stop a pending mutation before execution', async t => {
  const f = fixture(t, [reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start(); writeFileSync(resolve(f.workspace, 'new-file'), 'external');
  const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'conflict'); assert.equal(state.calls.w?.attempts.length, 0);
});
