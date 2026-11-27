import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fixture } from './helpers.js';
import {
  assertExtensionWorkspace,
  executeExtension,
  prepareExtensions,
} from '../src/extensions/index.js';
import { SkillMarket } from '../src/extensions/market.js';
import { defaultMcpConfig } from '../src/extensions/mcp-config.js';

function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'ext-boundary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('workspace cannot overlap catalog, fixture, server code or its read permissions through aliases', async (t) => {
  const root = scratch(t);
  const workspace = join(root, 'workspace');
  mkdirSync(workspace);
  const alias = join(root, 'alias');
  symlinkSync(workspace, alias);
  const opts = { workspace, servers: [], market: true };
  await assert.rejects(
    prepareExtensions({ ...opts, stateDir: join(alias, 'not-created') }),
    /outside the editable workspace/,
  );
  assert.equal(existsSync(join(workspace, 'not-created')), false);
  const configFile = join(root, 'mcp.json');
  const config = JSON.parse(readFileSync(defaultMcpConfig, 'utf8'));
  config.servers.tracker.entry = resolve('configs/mcp-server/tracker.mjs');
  config.servers.tracker.allowRead = [alias];
  writeFileSync(configFile, JSON.stringify(config));
  await assert.rejects(
    prepareExtensions({ configFile, workspace, market: false }),
    /outside the editable workspace/,
  );
  const s = await prepareExtensions({ configFile, market: false });
  assert.throws(() => assertExtensionWorkspace(s, workspace), /outside the editable workspace/);
  assertExtensionWorkspace(s, join(root, 'separate'));
});

test('stdio server sees only its own file permissions and no host environment or model key', async (t) => {
  const root = scratch(t);
  const configFile = join(root, 'mcp.json');
  const config = JSON.parse(readFileSync(defaultMcpConfig, 'utf8'));
  const file = join(root, 'inspect.mjs');
  const tracker = readFileSync(resolve('configs/mcp-server/tracker.mjs'), 'utf8');
  writeFileSync(
    file,
    tracker.replace(
      "const data = JSON.parse(process.env.TRACKER_DATA ?? '[]');",
      `const data = {env:Object.keys(process.env),write:process.permission.has('fs.write'),child:process.permission.has('child'),cwd:process.cwd()};`,
    ),
  );
  config.servers = { inspect: { ...config.servers.tracker, entry: file } };
  writeFileSync(configFile, JSON.stringify(config));
  const s = await prepareExtensions({ configFile, servers: ['inspect'], market: false });
  const original = process.env.HARNESS_ENV_CANARY;
  process.env.HARNESS_ENV_CANARY = 'test-only';
  t.after(() => {
    if (original === undefined) delete process.env.HARNESS_ENV_CANARY;
    else process.env.HARNESS_ENV_CANARY = original;
  });
  const info = JSON.parse((await executeExtension(s, 'mcp_inspect_list', {})).content!);
  assert.ok(
    !['HARNESS_ENV_CANARY', 'OPENAI_API_KEY', 'PATH', 'HOME'].some((key) => info.env.includes(key)),
  );
  assert.equal(info.write, false);
  assert.equal(info.child, false);
  assert.match(info.cwd, /harness-mcp-/);
  assert.equal(existsSync(info.cwd), false);
  writeFileSync(file, tracker);
  assert.match((await executeExtension(s, 'mcp_inspect_list', {})).error!, /current server policy/);
});

test('disabled market skills cannot be selected, searched, loaded or installed from a run', async (t) => {
  const stateDir = scratch(t);
  const market = new SkillMarket(stateDir);
  market.check();
  const s = await prepareExtensions({
    stateDir,
    disabledSkills: ['handoff-note', 'open-tasks'],
    servers: [],
  });
  assert.deepEqual(s.marketOffers, []);
  assert.deepEqual(
    JSON.parse((await executeExtension(s, 'market_search', { query: 'handoff' })).content!),
    [],
  );
  assert.equal((await executeExtension(s, 'market_install', { name: 'handoff-note' })).ok, false);
  assert.equal((await executeExtension(s, 'load_skill', { name: 'open-tasks' })).ok, false);
  market.configure({ source: 'v2' });
  market.check();
  assert.equal((await executeExtension(s, 'market_install', { name: 'stale-items' })).ok, false);
});

test('catalog and archive symlinks cannot escape their registration, failed review preserves the active package', async (t) => {
  const root = scratch(t);
  const registry = join(root, 'registry'),
    stateDir = join(root, 'state');
  cpSync('market', registry, { recursive: true });
  const foreign = join(root, 'outside');
  mkdirSync(foreign);
  const market = new SkillMarket(stateDir, registry);
  market.configure({ source: 'v2' });
  const old = market.check().candidate!.oldHash;
  symlinkSync(foreign, join(stateDir, 'packages'));
  await assert.rejects(
    market.review(async () => {
      throw new Error('unexpected evaluator call');
    }, root),
    /Invalid market archive directory/,
  );
  assert.equal(existsSync(join(foreign, old)), false);
  rmSync(join(registry, 'v2'), { recursive: true });
  symlinkSync(resolve('market/v2'), join(registry, 'v2'));
  assert.match(market.check().events.at(-1)!.detail, /symbolic link/);
  assert.equal(market.status().installed[0]!.hash, old);
  const outsideFile = join(foreign, 'original');
  writeFileSync(outsideFile, 'original');
  symlinkSync(outsideFile, join(stateDir, 'market.sqlite-journal'));
  assert.throws(() => market.status(), /database path/);
  assert.equal(readFileSync(outsideFile, 'utf8'), 'original');
});

test('parallel gate requests admit a single comparison and retain identifiable version events', async (t) => {
  const root = scratch(t);
  const market = new SkillMarket(root);
  market.configure({ source: 'v2' });
  const { oldHash, newHash } = market.check().candidate!;
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const review = market.review(async () => {
    await promise;
    return { accept: true, reason: 'fixture comparison', report: 'fixture.json' };
  }, root);
  await assert.rejects(
    market.review(async () => {
      throw new Error('unexpected second evaluator');
    }, root),
    /already running/,
  );
  finish();
  await review;
  const state = market.rollback();
  for (const e of state.events) {
    assert.ok(e.id && e.time);
    assert.equal(e.run_id, null);
    assert.equal(e.session_id, null);
    assert.equal(e.source, 'study-market/v2');
  }
  const row = state.events.find((e) => e.type === 'rollback')!;
  assert.equal(row.oldHash, newHash);
  assert.equal(row.newHash, oldHash);
  assert.equal(row.oldVersion, '2.0.0');
  assert.equal(row.newVersion, '1.0.0');
});

test('reopening a saved run after a market update retains its original SKILL content and hash', async (t) => {
  const f = fixture(t);
  const stateDir = join(f.root, 'market');
  const market = new SkillMarket(stateDir);
  const ext = await prepareExtensions({ stateDir, workspace: f.workspace, servers: [] });
  const run = f.start({ extensions: ext });
  const original = await executeExtension(ext, 'load_skill', { name: 'open-tasks' });
  market.configure({ source: 'v2' });
  market.check();
  await market.review(
    async () => ({ accept: true, reason: 'fixture gate pass', report: 'fixture/report.json' }),
    f.root,
  );
  f.reopen([]);
  const saved = f.store.get(run.id);
  const restored = await executeExtension(saved.extensions!, 'load_skill', { name: 'open-tasks' });
  assert.deepEqual(restored, original);
  const next = await prepareExtensions({ stateDir, workspace: f.workspace, servers: [] });
  assert.notEqual(
    (await executeExtension(next, 'load_skill', { name: 'open-tasks' })).hash,
    original.hash,
  );
});

test('one bad server config cannot stop another server from answering requests', async (t) => {
  const root = scratch(t),
    configFile = join(root, 'mcp.json');
  const config = JSON.parse(readFileSync(defaultMcpConfig, 'utf8'));
  config.servers.tracker.entry = resolve('configs/mcp-server/tracker.mjs');
  config.servers.broken = { ...config.servers.tracker, entry: 'missing-file.mjs' };
  writeFileSync(configFile, JSON.stringify(config));
  const s = await prepareExtensions({ servers: ['broken', 'tracker'], market: false, configFile });
  assert.match(s.errors.join(' '), /broken/);
  assert.equal((await executeExtension(s, 'mcp_tracker_list', {})).ok, true);
});

test('reserved Laya skip choice cannot become a local or market skill', async (t) => {
  const root = scratch(t);
  const skills = join(root, 'skills');
  mkdirSync(join(skills, 'none'), { recursive: true });
  writeFileSync(
    join(skills, 'none', 'SKILL.md'),
    '---\nname: none\ndescription: Reserved name\n---\nBody.',
  );
  const ext = await prepareExtensions({ skillDir: skills, market: false, servers: [] });
  assert.equal(ext.skills.length, 0);
  assert.match(ext.errors.join(' '), /Invalid skill name/);
  const registry = join(root, 'registry');
  cpSync('market', registry, { recursive: true });
  const file = join(registry, 'v1', 'catalog.json');
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  rows[1].name = 'none';
  rows[1].path = 'none/SKILL.md';
  writeFileSync(file, JSON.stringify(rows));
  const market = new SkillMarket(join(root, 'state'), registry);
  const state = market.check();
  assert.equal(state.events.at(-1)?.type, 'market_error');
  assert.deepEqual(state.available, []);
});
