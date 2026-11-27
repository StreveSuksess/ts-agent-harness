import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRun, formatTasks } from '../src/cli/presentation.js';
import { formatTrace } from '../src/cli/trace.js';
import { call, demoPlan, fixture, reply } from './helpers.js';

test('plan review includes dependencies, tools, proofs, assumptions and risks', (t) => {
  const run = fixture(t).start({ plan: true });
  run.plan = demoPlan();
  run.status = 'awaiting_plan';
  const page = formatRun(run);
  for (const detail of [
    'inspect',
    'после inspect',
    'write_file',
    'изменение order.py',
    'python3 -m unittest -v',
    'exit 0',
    ...run.plan.assumptions,
    ...run.plan.risks,
    run.plan.done_when,
    run.workspace,
  ])
    assert.ok(page.includes(detail), detail);
});

test('action review displays the complete proposed write, including its last line', (t) => {
  const run = fixture(t).start();
  const content = 'first\n' + 'x'.repeat(3500) + '\nlast\n';
  run.status = 'awaiting_action';
  run.pending.push({
    call: call('a', 'write_file', { path: 'order.py', content }),
    phase: 'execute',
    taskId: 'work',
  });
  const page = formatRun(run);
  assert.match(page, /write_file/);
  assert.match(page, /order\.py/);
  assert.ok(page.includes('x'.repeat(3500)));
  assert.match(page, /last/);
  assert.match(formatTasks(run), /\[>\] work/);
});

test('failed summary distinguishes a model claim from the unverified task', (t) => {
  const run = fixture(t).start();
  run.status = 'failed';
  run.reason = 'Model ended without approved plan/completed task evidence';
  run.final = 'tests passed';
  run.messages.push({
    role: 'tool',
    content: '{"ok":false,"error":"command denied"}',
    tool_call_id: 'x',
  });
  const page = formatRun(run, 'a b.sqlite');
  for (const detail of [
    'command denied',
    'Ответ модели',
    'tests passed',
    '[>] work',
    '--db',
    'a b.sqlite',
  ]) {
    assert.ok(page.includes(detail), detail);
  }
});

test('trace shows chronological proposals and results, bounds stdout, neutralizes terminal escapes', () => {
  const trace = formatTrace([
    { role: 'system', content: 'private instructions' },
    reply(
      call('r', 'read_file', { path: 'order.py' }),
      call('s', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' }),
    ),
    {
      role: 'tool',
      content: JSON.stringify({ ok: false, error: 'read failed' }),
      tool_call_id: 'r',
    },
    {
      role: 'tool',
      content: JSON.stringify({
        ok: false,
        exitCode: 1,
        stdout: 'A'.repeat(5000),
        stderr: '\u001b[2Jfailed\rtest',
      }),
      tool_call_id: 's',
    },
    { role: 'assistant', content: 'finished' },
  ]).join('\n');
  for (const detail of [
    'read_file',
    'order.py',
    'Bash',
    'python3 -m unittest -v',
    'read failed',
    'exit 1',
    'stdout',
    'stderr',
    'failed',
    'finished',
  ])
    assert.ok(trace.includes(detail), detail);
  assert.ok(trace.indexOf('Bash') < trace.indexOf('read failed'));
  assert.ok(trace.length < 2000);
  assert.doesNotMatch(trace, /[\u001b\r]|private instructions/);
});

test('trace tolerates malformed arguments and historical non-JSON results', () => {
  const tool = call('broken', 'Bash', {});
  tool.function.arguments = 'not JSON';
  assert.match(formatTrace([reply(tool)]).join(''), /not JSON/);
  assert.match(
    formatTrace([{ role: 'tool', content: 'old text', tool_call_id: 'broken' }]).join(''),
    /old text/,
  );
});
