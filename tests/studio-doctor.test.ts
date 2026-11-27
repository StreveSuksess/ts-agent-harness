import assert from 'node:assert/strict';
import test from 'node:test';
import { doctorReport } from '../src/studio/doctor.js';
import { statistics } from '../src/studio/stats.js';
import { eventData } from '../src/studio/event-data.js';
import type { AgentEvent } from '../src/studio/events.js';

function journal() {
  const rows: AgentEvent[] = [];
  function add(type: string, data: Record<string, unknown>, run_id = 'first') {
    rows.push({
      type,
      data,
      run_id,
      id: String(rows.length),
      session_id: 'test',
      time: new Date(0).toISOString(),
    });
  }
  function read(path: string, result: object, run = 'first') {
    const call_id = 'read-' + rows.length;
    add('tool_call', { tool: 'read_file', call_id, args: { path } }, run);
    add('tool_result', { tool: 'read_file', call_id, result, attempts: 1 }, run);
  }
  return { rows, add, read };
}

test('doctor links repeat errors and identical reads to actual event IDs in a single run', () => {
  const { rows, read } = journal();
  for (let i = 0; i < 2; i++) read('x', { ok: false, error: 'Permission denied' });
  for (let i = 0; i < 3; i++) read('report', { ok: true, hash: 'same' });
  const { findings, doctorUsage } = doctorReport(rows);
  assert.deepEqual(
    findings.map((f) => [f.kind, f.run_id, f.event_ids, f.count]),
    [
      ['repeated_error', 'first', ['1', '3'], 2],
      ['same_content', 'first', ['5', '7', '9'], 3],
    ],
  );
  assert.ok(findings.every((f) => f.suggestion.length > 0));
  assert.deepEqual(doctorUsage, { input: 0, output: 0 });
});

test('doctor leaves normal single errors, changing file hashes and independent runs alone', () => {
  const { rows, read } = journal();
  read('x', { ok: false, error: 'Permission denied' });
  read('y', { ok: false, error: 'Permission denied' });
  for (const hash of ['one', 'two', 'three']) read('report', { ok: true, hash });
  read('x', { ok: false, error: 'Permission denied' }, 'another');
  assert.deepEqual(doctorReport(rows).findings, []);
});

test('unknown and partial usage stay visible; a cached MCP result counts one execution', () => {
  const { rows, add } = journal();
  add('model_request', { engine: 'generator' });
  assert.deepEqual(statistics(rows).usage, { input: null, output: null, complete: false });
  add('model_response', { engine: 'generator', input: 12, output: null });
  add('model_request', { engine: 'laya' });
  add('laya_route', { engine: 'laya', input: 8, output: 0 });
  const mcp = {
    server: 'tracker',
    remoteTool: 'list',
    tool: 'mcp_tracker_list',
    call_id: 'remote',
    result: { ok: true },
    attempts: 1,
  };
  add('tool_result', mcp);
  add('tool_result', mcp);
  add('tool_result', mcp, 'another');
  const stats = statistics(rows);
  assert.deepEqual(stats.usage, { input: 20, output: 0, complete: false });
  assert.deepEqual(stats.byModel.laya, { input: 8, output: 0, complete: true });
  assert.equal(stats.mcp['tracker/list'], 2);
});

test('journal filters credential fields and configured provider key in tool text', (t) => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-provider-credential';
  t.after(() => {
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  });
  assert.deepEqual(
    eventData({
      args: { api_key: 'xxx', note: 'prefix test-provider-credential' },
      input_tokens: 1,
    }),
    { args: { api_key: '[redacted]', note: 'prefix [redacted]' }, input_tokens: 1 },
  );
});
