import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePlan } from '../src/schema.js';
import { call, fixture, reply, FIXED_ORDER, demoPlan } from './helpers.js';

test('Plan Mode blocks Bash/write/delete before approval and permits project reads', async t => {
  const f = fixture(t, [
    reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }), call('b', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' }), call('d', 'delete_file', { path: 'order.py' }), call('r', 'read_file', { path: 'order.py' })),
    reply(call('p', 'submit_plan', { plan: demoPlan() })),
  ]);
  const r = f.start({ plan: true }); const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'awaiting_plan');
  for (const id of ['w', 'b', 'd']) { assert.equal(state.calls[id]?.attempts.length, 0); assert.match(state.calls[id]?.result?.error ?? '', /Plan Mode/); }
  assert.equal(state.calls.r?.result?.ok, true);
  assert.equal(state.journal.length, 0);
  assert.equal(state.spent.sideEffects, 0); assert.equal(state.reservedSideEffects, 0);
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), readFileSync('workspace/order.py', 'utf8'));
});
test('reject plan and approve a replacement; safe mode still requires write approval', async t => {
  const f = fixture(t, [reply(call('p1', 'submit_plan', { plan: demoPlan() })), reply(call('p2', 'submit_plan', { plan: demoPlan() })), reply(call('r', 'read_file', { path: 'order.py' })), reply(call('c', 'complete_task', { evidence_call_id: 'r' })), reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ plan: true, mode: 'safe' }); await f.runtime.run(r.id); f.runtime.approvePlan(r.id, false);
  assert.equal((await f.runtime.run(r.id)).status, 'awaiting_plan'); f.runtime.approvePlan(r.id, true);
  assert.equal((await f.runtime.run(r.id)).status, 'awaiting_action');
  assert.equal(f.store.get(r.id).tasks.find(t => t.id === 'verify')?.status, 'pending');
});
test('task completion rejects planning evidence and wrong verification; dependencies stay pending', async t => {
  const f = fixture(t, [reply(call('r', 'read_file', { path: 'order.py' })), reply(call('p', 'submit_plan', { plan: demoPlan() })), reply(call('fake', 'complete_task', { evidence_call_id: 'r' })), { role: 'assistant', content: 'All done' }]);
  const r = f.start({ plan: true }); await f.runtime.run(r.id); f.runtime.approvePlan(r.id, true);
  const state = await f.runtime.run(r.id);
  assert.equal(state.status, 'failed'); assert.match(state.calls.fake?.result?.error ?? '', /current task/);
  assert.deepEqual(state.tasks.map(t => t.status), ['running', 'pending', 'pending']);
});
test('plan schema rejects duplicate IDs, dependency cycles and unknown dependencies', () => {
  const duplicate = demoPlan(); duplicate.steps[1]!.id = 'inspect'; assert.throws(() => validatePlan(duplicate), /unique/);
  const cycle = demoPlan(); cycle.steps[0]!.depends_on = ['verify']; assert.throws(() => validatePlan(cycle), /cycle/);
  const unknown = demoPlan(); unknown.steps[1]!.depends_on = ['missing']; assert.throws(() => validatePlan(unknown), /unknown/);
});
test('mixed plan/task transitions cannot implicitly authorize later calls in a batch', async t => {
  const f = fixture(t, [reply(call('p', 'submit_plan', { plan: demoPlan() }), call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ plan: true }); await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).plan, undefined); assert.equal(f.store.get(r.id).journal.length, 0);
});
test('completed dependency task is not repeated after resume at the next safe approval', async t => {
  const f = fixture(t, [reply(call('p', 'submit_plan', { plan: demoPlan() })), reply(call('r', 'read_file', { path: 'order.py' })), reply(call('c', 'complete_task', { evidence_call_id: 'r' })), reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER }))]);
  const r = f.start({ plan: true, mode: 'safe' }); await f.runtime.run(r.id); f.runtime.approvePlan(r.id, true); await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).tasks[0]?.status, 'completed');
  f.reopen(); assert.equal((await f.runtime.run(r.id)).status, 'awaiting_action');
  f.runtime.approveAction(r.id, true); await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).calls.r?.attempts.length, 1); assert.equal(f.store.get(r.id).tasks[0]?.status, 'completed');
});
test('Bash evidence becomes stale if the workspace changed after the successful test', async t => {
  const plan = demoPlan(); plan.steps = [{ id: 'verify', description: 'Verify tests', depends_on: [], tools: ['Bash', 'write_file'], verification: { kind: 'bash', command: 'python3 -m unittest -v', exitCode: 0 } }];
  const f = fixture(t, [reply(call('p', 'submit_plan', { plan })), reply(call('w', 'write_file', { path: 'order.py', content: FIXED_ORDER })), reply(call('b', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' })), reply(call('bad', 'write_file', { path: 'order.py', content: 'broken' })), reply(call('done', 'complete_task', { evidence_call_id: 'b' }))]);
  const r = f.start({ plan: true }); await f.runtime.run(r.id); f.runtime.approvePlan(r.id, true); await f.runtime.run(r.id);
  assert.equal(f.store.get(r.id).tasks[0]?.status, 'running'); assert.match(f.store.get(r.id).calls.done?.result?.error ?? '', /conflict/);
});
