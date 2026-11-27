import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Runtime } from '../src/runtime.js';
import { prepareExtensions } from '../src/extensions/index.js';
import { statistics } from '../src/studio/stats.js';
import type { AssistantMessage, ToolDefinition } from '../src/types.js';
import { fixture, call, reply } from './helpers.js';

test('Laya receives metadata, determines both candidate sets and can decline a tool', async (t) => {
  const f = fixture(t);
  f.config.extensions = { allow: ['load_skill', 'mcp_tracker_list'], deny: [] };
  f.policy();
  const extensions = await prepareExtensions({ market: false });
  const run = f.start({ extensions, sessionId: 'route-selection' });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    requests++;
    assert.equal(url.pathname, '/v1/systemone');
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'multilingual');
    assert.equal(body.state.request, run.prompt);
    assert.equal(
      body.questions.skill.criteria['owner-summary'],
      extensions.skills.find((s) => s.name === 'owner-summary')!.description,
    );
    assert.deepEqual(Object.keys(body.questions.mcp.criteria), ['mcp_tracker_list', 'none']);
    for (const s of extensions.skills) assert.ok(!String(init.body).includes(s.content));
    return Response.json({
      answers: { skill: { choice: 'open-tasks' }, mcp: { choice: 'none' } },
      usage: { input_tokens: 17, output_tokens: 0 },
    });
  });
  const offers: ToolDefinition[][] = [];
  const replies: AssistantMessage[] = [
    reply(call('forged', 'mcp_tracker_list', {})),
    reply(call('forged_skill', 'load_skill', { name: 'release-notes' })),
    { role: 'assistant', content: 'Done' },
  ];
  const runtime = new Runtime(f.store, {
    async complete(_messages, definitions) {
      offers.push(definitions);
      return replies.shift()!;
    },
  });
  const result = await runtime.run(run.id);
  assert.equal(requests, 1);
  assert.equal(result.routing?.skill, 'open-tasks');
  assert.equal(result.routing?.mcp, null);
  assert.equal(result.spent.modelRequests, 4);
  assert.ok(
    offers.every(
      (ds) =>
        ds.some((d) => d.function.name === 'load_skill') &&
        !ds.some((d) => d.function.name === 'mcp_tracker_list'),
    ),
  );
  for (const id of ['forged', 'forged_skill']) {
    assert.equal(result.calls[id]?.attempts.length, 0);
    assert.match(result.calls[id]?.result?.error ?? '', /not selected by Laya/);
  }
  const stats = statistics(result.events!);
  assert.equal(stats.skills['open-tasks'], 1);
  assert.deepEqual(Object.keys(stats.mcp), []);
  assert.equal(stats.byModel.laya?.input, 17);
  assert.equal(stats.usage.complete, false);
});

test('a malformed Laya choice blocks the run before generation', async (t) => {
  const f = fixture(t);
  f.config.extensions = { allow: ['load_skill'], deny: [] };
  f.policy();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ answers: { skill: { choice: 'invented' } } }),
  );
  const extensions = await prepareExtensions({ market: false, servers: [] });
  const run = f.start({ extensions, sessionId: 'bad-route' });
  const result = await f.runtime.run(run.id);
  assert.equal(result.status, 'blocked');
  assert.match(result.reason ?? '', /Laya returned an unknown/);
  assert.equal(result.routing, undefined);
  assert.equal(result.spent.modelRequests, 1);
  assert.equal(result.events?.filter((e) => e.type === 'model_error').length, 1);
  assert.equal(result.events?.filter((e) => e.type === 'model_response').length, 0);
});

test('when both catalogs are empty, local routing consumes no model request', async (t) => {
  const f = fixture(t, [{ role: 'assistant', content: 'done' }]);
  const extensions = await prepareExtensions({ skills: false, market: false, servers: [] });
  const fetch = t.mock.method(globalThis, 'fetch');
  const result = await f.runtime.run(f.start({ extensions, sessionId: 'no-catalog' }).id);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(result.spent.modelRequests, 1);
  assert.ok(result.events?.some((e) => e.type === 'routing_skipped'));
  assert.ok(!result.events?.some((e) => e.type === 'laya_route'));
});

test('two discovered MCP services are independent Laya choices', async (t) => {
  const f = fixture(t, [{ role: 'assistant', content: 'done' }]);
  const spec = JSON.parse(readFileSync('configs/mcp.json', 'utf8')).servers.tracker;
  spec.entry = resolve('configs/mcp-server/tracker.mjs');
  const configFile = join(f.root, 'mcp.json');
  writeFileSync(configFile, JSON.stringify({ servers: { tracker: spec, archive: spec } }));
  f.config.extensions = { allow: ['mcp_tracker_list', 'mcp_archive_list'], deny: [] };
  f.policy();
  const extensions = await prepareExtensions({
    skills: false,
    market: false,
    servers: ['tracker', 'archive'],
    configFile,
  });
  t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
    const { questions } = JSON.parse(String(init.body));
    assert.deepEqual(Object.keys(questions.mcp.criteria), [
      'mcp_tracker_list',
      'mcp_archive_list',
      'none',
    ]);
    assert.equal(questions.skill, undefined);
    return Response.json({ answers: { mcp: { choice: 'mcp_archive_list' } } });
  });
  const result = await f.runtime.run(f.start({ extensions, sessionId: 'two-servers' }).id);
  assert.equal(result.routing?.mcp, 'mcp_archive_list');
  assert.deepEqual({ ...statistics(result.events!).mcp }, { 'archive/list': 1 });
});
