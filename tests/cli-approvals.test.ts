import assert from 'node:assert/strict';
import test from 'node:test';
import { ApprovalChangedError } from '../src/runtime/approvals.js';
import { call, demoPlan, fixture, reply } from './helpers.js';

test('rejecting a plan persists feedback, and an old approval cannot accept its replacement', async (t) => {
  const f = fixture(t, [
    reply(call('first', 'submit_plan', { plan: demoPlan() })),
    reply(call('replacement', 'submit_plan', { plan: { ...demoPlan(), goal: 'Run all tests' } })),
  ]);
  const { id } = f.start({ plan: true });
  const first = await f.runtime.run(id);
  const feedback = 'Запусти python3 -m unittest -v.';
  f.runtime.approvePlan(id, false, { expectedRevision: first.revision, feedback });
  const second = await f.runtime.run(id);
  assert.equal(second.status, 'awaiting_plan');
  assert.equal(second.decisions.at(-1)?.feedback, feedback);
  assert.ok(second.messages.some((m) => m.role === 'user' && m.content?.includes(feedback)));

  assert.throws(
    () => f.runtime.approvePlan(id, true, { expectedRevision: first.revision }),
    ApprovalChangedError,
  );
  assert.equal(f.store.get(id).revision, second.revision);
  assert.throws(() => f.runtime.approvePlan(id, true, { feedback }), /комментарий/i);
  assert.equal(f.store.get(id).revision, second.revision);
  f.runtime.approvePlan(id, true);
  assert.equal(f.store.get(id).phase, 'execute');
});

test('an old decision on a write cannot allow the next pending write', async (t) => {
  const f = fixture(t, [
    reply(call('first', 'write_file', { path: 'order.py', content: 'first' })),
    reply(call('second', 'write_file', { path: 'order.py', content: 'second' })),
  ]);
  const { id } = f.start({ mode: 'safe' });
  const first = await f.runtime.run(id);
  f.runtime.approveAction(id, false);
  const second = await f.runtime.run(id);
  assert.equal(second.status, 'awaiting_action');
  assert.equal(second.pending[0]?.call.id, 'second');

  assert.throws(() => f.runtime.approveAction(id, true, first.revision), ApprovalChangedError);
  assert.equal(f.store.get(id).revision, second.revision);
  assert.notEqual(f.store.get(id).calls.second?.approved, true);
  f.runtime.approveAction(id, true, second.revision);
  assert.equal(f.store.get(id).calls.second?.approved, true);
});
