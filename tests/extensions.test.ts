import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { executeExtension, prepareExtensions, validateExtension } from '../src/extensions/index.js';
import { SkillMarket } from '../src/extensions/market.js';
import { defaultMcpConfig } from '../src/extensions/mcp-config.js';

function scratch(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'extensions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('skills discovered independently, descriptor errors isolated, bodies available only through loader', async (t) => {
  const root = scratch(t);
  cpSync('skills', join(root, 'skills'), { recursive: true });
  for (const name of ['new-topic', 'broken']) mkdirSync(join(root, 'skills', name));
  writeFileSync(
    join(root, 'skills/new-topic/SKILL.md'),
    '---\nname: new-topic\ndescription: >-\n  Two lines\n  of description.\n---\nPrivate procedure.',
  );
  writeFileSync(join(root, 'skills/broken/SKILL.md'), 'Missing header');
  const s = await prepareExtensions({
    skillDir: join(root, 'skills'),
    market: false,
    servers: [],
    disabledSkills: ['owner-summary'],
  });
  assert.match(s.errors.join(' '), /broken/);
  assert.equal(s.skills.length, 3);
  assert.equal(
    s.skills.find((p) => p.name === 'new-topic')?.description,
    'Two lines of description.',
  );
  assert.equal((await executeExtension(s, 'load_skill', { name: 'owner-summary' })).ok, false);
  assert.match(
    (await executeExtension(s, 'load_skill', { name: 'new-topic' })).content!,
    /Private procedure/,
  );
  assert.throws(() => validateExtension(s, 'load_skill', '{"name":9}'), /Invalid/);
  const a = await prepareExtensions({ skills: false, market: false, servers: [] });
  assert.deepEqual(a.definitions, []);
  assert.deepEqual(a.skills, []);
});

test('MCP negotiates a real stdio session; supports additional configured servers and live revocation', async (t) => {
  const root = scratch(t);
  const configFile = join(root, 'mcp.json');
  const config = JSON.parse(readFileSync(defaultMcpConfig, 'utf8'));
  config.servers.tracker.entry = resolve('configs/mcp-server/tracker.mjs');
  config.servers.study = { ...config.servers.tracker };
  writeFileSync(configFile, JSON.stringify(config));
  const trackerFixture = join(root, 'data.json');
  writeFileSync(trackerFixture, JSON.stringify([{ id: 'case-42', status: 'open' }]));
  const opts = { market: false, configFile, trackerFixture, servers: ['tracker', 'study'] };
  const s = await prepareExtensions(opts);
  assert.deepEqual(s.errors, []);
  assert.ok(s.definitions.some((d) => d.function.name === 'mcp_study_list'));
  assert.deepEqual(JSON.parse((await executeExtension(s, 'mcp_tracker_list', {})).content!), [
    { id: 'case-42', status: 'open' },
  ]);
  writeFileSync(trackerFixture, JSON.stringify({ error: 'Tracker is currently unavailable' }));
  const failing = await prepareExtensions(opts);
  const failure = await executeExtension(failing, 'mcp_tracker_list', {});
  assert.equal(failure.ok, false);
  assert.match(failure.error!, /unavailable/);
  assert.equal((await executeExtension(s, 'mcp_tracker_delete', {})).ok, false);
  assert.equal((await executeExtension(s, 'mcp_tracker_list', { file: 'secret' })).ok, false);
  config.servers.tracker.readOnlyTools = [];
  writeFileSync(configFile, JSON.stringify(config));
  assert.match((await executeExtension(s, 'mcp_tracker_list', {})).error!, /current server policy/);
});

test('a server that never acknowledges initialize times out and leaves local skills available', async (t) => {
  const root = scratch(t);
  const configFile = join(root, 'servers.json');
  writeFileSync(join(root, 'slow.mjs'), 'process.stdin.resume()');
  writeFileSync(
    configFile,
    JSON.stringify({
      servers: {
        slow: {
          command: 'node',
          entry: 'slow.mjs',
          args: [],
          allowRead: [],
          readOnlyTools: ['list'],
          timeoutMs: 80,
        },
      },
    }),
  );
  const s = await prepareExtensions({ configFile, market: false, servers: ['slow'] });
  assert.match(s.errors.join(' '), /MCP timeout/);
  assert.equal(s.mcp.length, 0);
  assert.equal(s.skills.length, 3);
});

test('market installation is explicit, candidate gated, accepted update does not change active snapshots, rollback persists', async (t) => {
  const root = scratch(t),
    market = new SkillMarket(root);
  const initial = market.check();
  assert.deepEqual(
    initial.available.map((p) => p.name),
    ['handoff-note'],
  );
  const events = market.check().events.length;
  assert.equal(events, initial.events.length);
  const s1 = await prepareExtensions({ stateDir: root, servers: [] });
  assert.match(
    (await executeExtension(s1, 'market_search', { query: 'handover' })).content!,
    /handoff-note/,
  );
  assert.equal((await executeExtension(s1, 'market_install', { name: 'handoff-note' })).ok, true);
  assert.equal((await executeExtension(s1, 'load_skill', { name: 'handoff-note' })).ok, false);
  const s2 = await prepareExtensions({ stateDir: root, servers: [] });
  assert.equal((await executeExtension(s2, 'load_skill', { name: 'handoff-note' })).ok, true);
  market.configure({ source: 'v2', check: false, autoUpdate: false });
  assert.equal(market.check().candidate, undefined);
  const state = market.check({ force: true });
  const old = state.installed.find((p) => p.name === 'open-tasks')!;
  const { newHash } = state.candidate!;
  assert.ok(state.available.some((row) => row.name === 'stale-items'));
  assert.notEqual(old.hash, newHash);
  await market.review(async (files) => {
    assert.equal(readFileSync(join(files.oldSkillDir, 'SKILL.md'), 'utf8'), old.content);
    assert.notEqual(readFileSync(join(files.newSkillDir, 'SKILL.md'), 'utf8'), old.content);
    return { accept: true, reason: 'fixture gate pass', report: 'fixture/report.json' };
  }, root);
  const after = await prepareExtensions({ stateDir: root, servers: [] });
  assert.equal(after.skills.find((p) => p.name === 'open-tasks')?.hash, newHash);
  assert.equal((await executeExtension(s2, 'load_skill', { name: 'open-tasks' })).hash, old.hash);
  const rolled = new SkillMarket(root).rollback();
  assert.equal(rolled.installed.find((p) => p.name === 'open-tasks')?.hash, old.hash);
  assert.equal(market.check({ force: true }).candidate, undefined);
  assert.equal(rolled.canRollback, false);
});

test('bad package, offline index, eval rejection and eval failure leave installed version usable', async (t) => {
  const root = scratch(t),
    registry = join(root, 'registry');
  cpSync('market', registry, { recursive: true });
  const market = new SkillMarket(root, registry);
  market.configure({ source: 'v2', autoUpdate: true });
  const candidate = market.check().candidate!;
  await assert.rejects(
    market.review(async () => {
      throw new Error('unavailable evaluator');
    }, root),
  );
  assert.equal(market.status().candidate?.newHash, candidate.newHash);
  const rejected = await market.review(
    async () => ({ accept: false, reason: 'tokens incomplete', report: 'fixture/report.json' }),
    root,
  );
  assert.equal(rejected.installed[0]?.hash, candidate.oldHash);
  assert.equal(rejected.lastDecision?.accept, false);
  assert.equal(market.check().candidate, undefined);
  const market2 = new SkillMarket(join(root, 'fresh'), registry);
  market2.configure({ source: 'v2' });
  writeFileSync(join(registry, 'v2/open-tasks/SKILL.md'), 'corrupt');
  assert.match(market2.check().events.at(-1)!.detail, /digest/);
  rmSync(join(registry, 'v2/catalog.json'));
  const offline = market2.check();
  assert.equal(offline.events.at(-1)!.type, 'market_error');
  assert.deepEqual(offline.available, []);
  assert.equal(market2.check().events.length, offline.events.length);
  assert.throws(() => market2.install('handoff-note'), /not in checked catalog/);
  assert.equal(market2.status().installed[0]?.hash, candidate.oldHash);
});
