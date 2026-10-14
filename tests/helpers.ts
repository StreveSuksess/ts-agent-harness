import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { Store } from '../src/store.js';
import { Runtime } from '../src/runtime.js';
import { ScriptedModel } from '../src/model.js';
import type { AssistantMessage, FaultHook, Model, PolicyConfig, RunState } from '../src/types.js';
export { call, reply, FIXED_ORDER, demoPlan, demoResponses } from '../src/demo.js';

export function fixture(t: TestContext, responses: AssistantMessage[] = [], faults?: FaultHook) {
  const root = mkdtempSync(resolve(tmpdir(), 'ts-harness-'));
  const workspace = resolve(root, 'workspace');
  cpSync(resolve('workspace'), workspace, { recursive: true });
  const policyFile = resolve(root, 'policy.json');
  const config = JSON.parse(readFileSync(resolve('policy.example.json'), 'utf8')) as PolicyConfig;
  writeFileSync(policyFile, JSON.stringify(config));
  const db = resolve(root, 'state.sqlite');
  let store = new Store(db);
  const make = (model: Model, hook?: FaultHook) => new Runtime(store, model, hook ? { faults: hook } : {});
  let runtime = make(new ScriptedModel(responses), faults);
  t.after(() => { try { store.close(); } catch { /* may already be closed */ } rmSync(root, { recursive: true, force: true }); });
  return {
    root, workspace, policyFile, db, config,
    get store() { return store; }, get runtime() { return runtime; },
    policy() { writeFileSync(policyFile, JSON.stringify(config)); },
    start(opts: Partial<Parameters<Runtime['start']>[0]> = {}): RunState { return runtime.start({ workspace, policyFile, prompt: 'Fix order; keep tests unchanged', mode: 'auto', plan: false, ...opts }); },
    reopen(responses: AssistantMessage[] = [], hook?: FaultHook) { store.close(); store = new Store(db); runtime = make(new ScriptedModel(responses), hook); return runtime; },
  };
}
