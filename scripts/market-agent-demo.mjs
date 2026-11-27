// Run after npm run build with local Laya and the generator running.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Runtime } from '../dist/src/runtime.js';
import { Store } from '../dist/src/store.js';
import { prepareExtensions } from '../dist/src/extensions/index.js';
import { SkillMarket } from '../dist/src/extensions/market.js';
import { generatorName, localGenerator, studioPolicy } from '../dist/src/studio/sessions.js';

const out = resolve(process.argv[2] ?? '.agent/market-agent-demo');
mkdirSync(out, { recursive: true });
if (existsSync(join(out, 'summary.json'))) throw new Error('Select a fresh output directory');
const directory = mkdtempSync(join(tmpdir(), 'market-agent-'));
const stateDir = join(directory, 'market');
const workspace = join(directory, 'workspace');
mkdirSync(workspace);
const market = new SkillMarket(stateDir);
market.check();
const store = new Store(join(directory, 'runs.sqlite'));
const runtime = new Runtime(store, localGenerator());
const sessionId = randomUUID();

async function trial(prompt, filename) {
  const extensions = await prepareExtensions({ stateDir, workspace });
  const started = runtime.start({
    sessionId,
    workspace,
    prompt,
    extensions,
    policyFile: studioPolicy,
    plan: false,
    mode: 'safe',
    limits: { modelRequests: 10, toolCalls: 18, sideEffects: 3 },
    verification: { kind: 'file_changed', path: filename },
    systemNote: 'Use the selected sources. Complete the requested file. /no_think',
  });
  let run = await runtime.run(started.id);
  while (run.status === 'awaiting_action') {
    const call = run.pending[0].call.function;
    const args = JSON.parse(call.arguments);
    // The demo operator pre-approves two enumerated actions in this disposable installation.
    const allow =
      (call.name === 'market_install' && args.name === 'handoff-note') ||
      (call.name === 'write_file' && args.path === filename);
    runtime.approveAction(run.id, allow, run.revision);
    run = await runtime.run(run.id);
  }
  const eventsFile = run.id + '.jsonl';
  writeFileSync(join(out, eventsFile), run.events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const file = join(workspace, filename);
  return {
    run_id: run.id,
    session_id: sessionId,
    status: run.status,
    prompt,
    reason: run.reason,
    route: run.routing,
    events: eventsFile,
    skills_at_start: extensions.skills.map((s) => s.name),
    output: existsSync(file) ? readFileSync(file, 'utf8') : null,
    actions: Object.values(run.calls).map((r) => ({
      call_id: r.call.id,
      name: r.call.function.name,
      ok: r.result?.ok,
      attempts: r.attempts.length,
    })),
  };
}

try {
  const first = await trial(
    'For my next shift handover I need a skill that reports owners, blockers and next actions. Find and install that skill from the local market. Write its installed name into receipt.txt.',
    'receipt.txt',
  );
  const trials = [first];
  if (market.status().installed.some((p) => p.name === 'handoff-note')) {
    trials.push(
      await trial(
        'Prepare a shift handover note from the external tracker, with owners, blockers and next actions. Save it in handover.txt.',
        'handover.txt',
      ),
    );
  }
  const result = {
    generator: generatorName(),
    router: 'Laya multilingual',
    approval:
      'Scripted demo operator allows only the requested install and two named output files.',
    trials,
    installed: market
      .status()
      .installed.map(({ name, version, source, hash }) => ({ name, version, source, hash })),
    market_events: market.status().events,
  };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(join(out, 'summary.json'));
  if (!first.actions.some((c) => c.name === 'market_install' && c.ok)) process.exitCode = 1;
} finally {
  store.close();
  rmSync(directory, { force: true, recursive: true });
}
