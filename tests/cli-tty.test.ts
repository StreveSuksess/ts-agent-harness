import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import type { Message } from '../src/types.js';
import { call, demoPlan, demoResponses, fixture, FIXED_ORDER, reply } from './helpers.js';

const exec = promisify(execFile);

test('interactive terminal reviews plans, pauses safely, and resumes the same run through Bash', async (t) => {
  const f = fixture(t);
  const originalOrder = readFileSync(resolve(f.workspace, 'order.py'));
  const originalTests = readFileSync(resolve(f.workspace, 'test_order.py'));
  const feedback = 'покажи проверку скидки';
  const responses = demoResponses();
  responses.splice(2, 0, reply(call('revised-plan', 'submit_plan', { plan: demoPlan() })));
  const writeIndex = responses.findIndex((r) => r.tool_calls?.[0]?.id === 'fix');
  responses.splice(
    writeIndex,
    0,
    reply(call('bad-write', 'write_file', { path: 'order.py', content: 'discarded proposal' })),
  );

  let receivedFeedback = false;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString()) as { messages: Message[] };
    receivedFeedback ||= messages.some((m) => m.role === 'user' && m.content?.includes(feedback));
    const message = responses.shift();
    res.writeHead(message ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  async function interact(args: string[], dialogue: [string, string][]) {
    const child = await exec(
      'python3',
      [
        'tests/cli_terminal.py',
        JSON.stringify(dialogue),
        process.execPath,
        'dist/src/cli.js',
        ...args,
        '--db',
        f.db,
      ],
      {
        env: {
          PATH: process.env.PATH,
          OPENAI_API_KEY: 'test',
          OPENAI_MODEL: 'local-test',
          OPENAI_BASE_URL: baseUrl,
        },
      },
    );
    return child.stdout;
  }

  const plan = 'Принять план?';
  const action = 'Разрешить это действие?';
  const paused = await interact(
    ['run', 'Fix total', '--workspace', f.workspace, '--policy', f.policyFile],
    [
      [plan, 'нет ' + feedback],
      [plan, 'да'],
      [action, ''],
    ],
  );
  const [row] = f.store.listRuns();
  assert.ok(row);
  assert.equal(row.status, 'awaiting_action');
  assert.equal(receivedFeedback, true);
  assert.match(paused, /discarded proposal/);
  assert.deepEqual(readFileSync(resolve(f.workspace, 'order.py')), originalOrder);

  const finished = await interact(
    ['resume', row.id],
    [
      [action, 'нет'],
      [action, 'да'],
      [action, 'да'],
    ],
  );
  const run = f.store.get(row.id);
  assert.equal(run.status, 'completed', finished);
  assert.deepEqual(
    run.decisions.map((d) => d.choice),
    ['reject', 'approve', 'reject', 'approve', 'approve'],
  );
  assert.equal(run.calls['bad-write']?.attempts.length, 0);
  assert.equal(run.calls.tests?.result?.exitCode, 0);
  assert.equal(responses.length, 0);
  assert.match(finished, /exit 0/);
  assert.equal(readFileSync(resolve(f.workspace, 'order.py'), 'utf8'), FIXED_ORDER);
  assert.deepEqual(readFileSync(resolve(f.workspace, 'test_order.py')), originalTests);
  assert.equal(f.store.listRuns().length, 1);
});
