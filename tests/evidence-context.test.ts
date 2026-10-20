import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.js';
import type { Model } from '../src/types.js';
import { call, fixture, reply } from './helpers.js';

test('a model without transport IDs can complete a task using textual evidence context', async (t) => {
  const fixtureState = fixture(t);
  const opaqueCallId = 'provider_generated_7f9ac83d';
  let request = 0;

  const model: Model = {
    async complete(messages) {
      switch (request++) {
        case 0:
          return reply(call('planning_read', 'read_file', { path: 'order.py' }));
        case 1:
          return reply(
            call('plan', 'submit_plan', {
              plan: {
                goal: 'Inspect implementation',
                steps: [
                  {
                    id: 'inspect',
                    description: 'Read implementation',
                    depends_on: [],
                    tools: ['read_file'],
                    verification: { kind: 'tool', tool: 'read_file' },
                  },
                ],
                risks: [],
                assumptions: [],
                done_when: 'Implementation inspected',
              },
            }),
          );
        case 2:
          return reply(
            call(opaqueCallId, 'read_file', { path: 'order.py' }),
            call('failed_read', 'read_file', { path: 'missing.py' }),
          );
        case 3: {
          // Model templates may render only role/content and omit tool_call_id.
          const textMessages = messages.map(({ role, content }) => ({ role, content }));
          const context =
            textMessages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
          const candidates = [...context.matchAll(/"evidence_call_id":"([^\"]+)"/g)];
          assert.deepEqual(
            candidates.map((match) => match[1]),
            [opaqueCallId],
          );
          return reply(
            call('finish_inspect', 'complete_task', {
              evidence_call_id: candidates[0]![1],
            }),
          );
        }
        default:
          return { role: 'assistant', content: 'Inspected.' };
      }
    },
  };

  const runtime = new Runtime(fixtureState.store, model);
  const run = runtime.start({
    workspace: fixtureState.workspace,
    policyFile: fixtureState.policyFile,
    prompt: 'Inspect implementation',
    mode: 'auto',
  });

  assert.equal((await runtime.run(run.id)).status, 'awaiting_plan');
  runtime.approvePlan(run.id, true);

  const result = await runtime.run(run.id);
  assert.equal(result.status, 'completed', result.reason);
  assert.equal(result.tasks[0]?.evidence?.callId, opaqueCallId);
});
