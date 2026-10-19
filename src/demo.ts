import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Runtime } from './runtime.js';
import { Store } from './store.js';
import { ScriptedModel } from './model.js';
import { hash } from './tools.js';
import type { AssistantMessage, Plan, ToolCall } from './types.js';

export const call = (id: string, name: string, args: object): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

export const reply = (...calls: ToolCall[]): AssistantMessage => ({
  role: 'assistant',
  content: null,
  tool_calls: calls,
});

export const FIXED_ORDER = `def calculate_total(prices: list[float], discount_percent: float) -> float:
    if not 0 <= discount_percent <= 100:
        raise ValueError("discount_percent must be between 0 and 100")
    return sum(prices) * (1 - discount_percent / 100)
`;

export const demoPlan = (): Plan => ({
  goal: 'Fix the order calculation and verify without changing tests',
  steps: [
    {
      id: 'inspect',
      description: 'Read the order implementation',
      depends_on: [],
      tools: ['read_file', 'list_files'],
      verification: { kind: 'tool', tool: 'read_file' },
    },
    {
      id: 'fix',
      description: 'Fix percentage discount and reject invalid discounts',
      depends_on: ['inspect'],
      tools: ['write_file', 'read_file'],
      verification: { kind: 'file_changed', path: 'order.py' },
    },
    {
      id: 'verify',
      description: 'Run the unchanged tests through Bash',
      depends_on: ['fix'],
      tools: ['Bash', 'read_file'],
      verification: { kind: 'bash', command: 'python3 -m unittest -v', exitCode: 0 },
    },
  ],
  risks: ['Invalid discount inputs must raise ValueError'],
  assumptions: ['Prices are numeric'],
  done_when: 'All unittest tests pass and test_order.py is unchanged',
});

export const demoResponses = (): AssistantMessage[] => [
  reply(
    call('find', 'list_files', { path: '.' }),
    call('read-tests', 'read_file', { path: 'test_order.py' }),
  ),
  reply(call('plan', 'submit_plan', { plan: demoPlan() })),
  reply(call('inspect', 'read_file', { path: 'order.py' })),
  reply(call('inspect-done', 'complete_task', { evidence_call_id: 'inspect' })),
  reply(call('fix', 'write_file', { path: 'order.py', content: FIXED_ORDER })),
  reply(call('fix-done', 'complete_task', { evidence_call_id: 'fix' })),
  reply(call('tests', 'Bash', { command: 'python3 -m unittest -v', cwd: '.' })),
  reply(call('verify-done', 'complete_task', { evidence_call_id: 'tests' })),
  {
    role: 'assistant',
    content:
      'Fixed percentage discount, validated its range, and verified unchanged tests with Bash.',
  },
];

export async function demo(root = resolve('.agent', 'demo', randomUUID())): Promise<string> {
  const workspace = resolve(root, 'workspace');

  mkdirSync(root, { recursive: true });
  cpSync(resolve('workspace'), workspace, { recursive: true });

  const policyFile = resolve(root, 'policy.json');

  writeFileSync(policyFile, readFileSync(resolve('policy.example.json')));

  const beforeTests = hash(readFileSync(resolve(workspace, 'test_order.py')));
  const store = new Store(resolve(root, 'state.sqlite'));
  const runtime = new Runtime(store, new ScriptedModel(demoResponses()), { log: console.log });

  console.log('OFFLINE DEMO: scripted model responses; tools, Bash, SQLite and rollback are real.');
  try {
    const start = runtime.start({
      workspace,
      policyFile,
      prompt: 'Fix order total; do not change tests',
      mode: 'auto',
    });

    console.log(`run_id=${start.id}\nstate=${store.file}`);

    const planned = await runtime.run(start.id);

    if (planned.status !== 'awaiting_plan') {
      throw new Error(`Demo failed to plan: ${planned.reason}`);
    }

    console.log('Demo command explicitly approves the scripted plan for its disposable workspace.');
    runtime.approvePlan(start.id, true);

    const done = await runtime.run(start.id);

    if (
      done.status !== 'completed' ||
      beforeTests !== hash(readFileSync(resolve(workspace, 'test_order.py')))
    ) {
      throw new Error(`Demo failed: ${done.reason}`);
    }

    console.log(
      `Bash result: ${JSON.stringify(done.calls.tests?.result)}\n${runtime.diff(start.id)}`,
    );
    console.log(`status=${done.status}\nbudget=${JSON.stringify(done.spent)}`);

    return start.id;
  } finally {
    store.close();
  }
}
