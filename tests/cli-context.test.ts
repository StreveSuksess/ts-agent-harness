import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { startTask } from '../src/cli/start.js';
import { rememberTurn, type ConversationTurn } from '../src/cli/conversation-context.js';
import { demoResponses, fixture, FIXED_ORDER } from './helpers.js';

test('a follow-up sees the previous reply and files, and starts with fresh approvals and tool calls', async (t) => {
  const f = fixture(t, demoResponses());
  const options = {
    command: 'run' as const,
    flags: new Map([
      ['workspace', f.workspace],
      ['policy', f.policyFile],
      ['mode', 'auto'],
    ]),
  };
  const first = startTask(f.runtime, options, 'Исправь скидку');
  assert.equal(first.messages[1]?.content, first.prompt);
  await f.runtime.run(first.id);
  f.runtime.approvePlan(first.id, true);
  const completed = await f.runtime.run(first.id);
  assert.equal(completed.status, 'completed');

  options.flags.delete('workspace');
  const followUp = startTask(f.runtime, options, 'Объясни исправление', {
    workspace: completed.workspace,
    history: rememberTurn([], completed),
  });
  assert.notEqual(followUp.id, first.id);
  assert.equal(followUp.workspace, completed.workspace);
  assert.equal(readFileSync(resolve(followUp.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  const saved = f.store.get(followUp.id);
  assert.equal(saved.prompt, 'Объясни исправление');
  const context = saved.messages[1]!;
  assert.equal(context.role, 'user');
  assert.ok(context.content?.includes(first.prompt));
  assert.ok(context.content?.includes(completed.final!));
  assert.match(context.content!, /"changedFiles":\["order.py"\]/);
  assert.equal(saved.messages[2]?.content, saved.prompt);
  assert.equal(saved.phase, 'plan');
  assert.deepEqual(saved.calls, {});
  assert.deepEqual(saved.decisions, []);
  assert.equal(saved.spent.modelRequests, 0);
  assert.ok(saved.messages.every((message) => !message.tool_calls && message.role !== 'tool'));
});

test('only bounded recent turn summaries are retained, including the reason a turn failed', (t) => {
  const run = fixture(t).start();
  let history: ConversationTurn[] = [];
  for (let n = 1; n <= 10; n++) {
    history = rememberTurn(history, {
      ...run,
      prompt: n + 'п'.repeat(10000),
      final: 'а'.repeat(10000),
      status: 'failed',
      reason: 'missing evidence',
    });
  }
  assert.equal(history.length, 4);
  assert.match(history[0]!.prompt, /^7/);
  assert.match(history.at(-1)!.prompt, /^10.*…$/);
  assert.equal(history.at(-1)!.reason, 'missing evidence');
  assert.ok(JSON.stringify(history).length < 6000);
});
