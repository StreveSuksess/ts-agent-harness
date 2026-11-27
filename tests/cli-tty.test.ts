import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import type { AssistantMessage, Message } from '../src/types.js';
import { call, demoPlan, demoResponses, fixture, FIXED_ORDER, reply } from './helpers.js';

const exec = promisify(execFile);

async function terminalModel(
  t: TestContext,
  db: string,
  responses: AssistantMessage[],
  observe: (messages: Message[]) => void,
) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const { messages } = JSON.parse(Buffer.concat(chunks).toString()) as { messages: Message[] };
    observe(messages);
    const message = responses.shift();
    res.writeHead(message ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done) => server.close(() => done())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return async function interact(args: string[], dialogue: [string, string][]) {
    const child = await exec(
      'python3',
      [
        'tests/cli_terminal.py',
        JSON.stringify(dialogue),
        process.execPath,
        'dist/src/cli.js',
        ...args,
        '--db',
        db,
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
  };
}

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
  const interact = await terminalModel(t, f.db, responses, (messages) => {
    receivedFeedback ||= messages.some((m) => m.role === 'user' && m.content?.includes(feedback));
  });

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

test('bare CLI accepts successive prompts in the same example workspace and forwards turn context', async (t) => {
  const f = fixture(t);
  const firstPrompt = 'Назови функцию в order.py';
  const secondPrompt = 'Какой тип у результата той функции?';
  const firstAnswer = 'Я нашёл функцию calculate_total.';

  const inspectPlan = demoPlan();
  inspectPlan.steps = [inspectPlan.steps[0]!];
  function readAndAnswer(answer: string): AssistantMessage[] {
    return [
      reply(call('plan', 'submit_plan', { plan: inspectPlan })),
      reply(call('read', 'read_file', { path: 'order.py' })),
      reply(call('done', 'complete_task', { evidence_call_id: 'read' })),
      { role: 'assistant', content: answer },
    ];
  }

  const responses = [...readAndAnswer(firstAnswer), ...readAndAnswer('Тип результата — float.')];
  let followup: Message[] | undefined;
  const interact = await terminalModel(t, f.db, responses, (messages) => {
    if (!followup && messages.some((m) => m.role === 'user' && m.content === secondPrompt)) {
      followup = messages;
    }
  });

  try {
    const output = await interact(
      [],
      [
        ['Что поручить агенту?', firstPrompt],
        ['Принять план?', 'да'],
        ['Следующий запрос', secondPrompt],
        ['Принять план?', 'да'],
        ['Следующий запрос', '/exit'],
      ],
    );
    assert.match(output, /Тип результата — float/);
    assert.ok(followup, 'second prompt reached model');
    const context = followup.map((message) => message.content).join('\n');
    assert.ok(context.includes(firstPrompt));
    assert.ok(context.includes(firstAnswer));
    assert.equal(
      followup.some((message) => message.role === 'tool' || message.tool_calls?.length),
      false,
    );

    const runs = f.store.listRuns();
    assert.deepEqual(
      runs.map((run) => run.prompt),
      [secondPrompt, firstPrompt],
    );
    assert.equal(runs[0]!.workspace, runs[1]!.workspace);
    assert.equal(dirname(runs[0]!.workspace), resolve('.agent/workspaces'));
    for (const { id } of runs) {
      const run = f.store.get(id);
      assert.equal(run.status, 'completed');
      assert.equal(run.calls.read?.result?.ok, true);
    }
    assert.equal(responses.length, 0);
  } finally {
    for (const workspace of new Set(f.store.listRuns().map((run) => run.workspace))) {
      if (dirname(workspace) === resolve('.agent/workspaces')) {
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  }
});
