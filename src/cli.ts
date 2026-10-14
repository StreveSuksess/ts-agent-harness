#!/usr/bin/env node
import { resolve } from 'node:path';
import { Store } from './store.js';
import { Runtime } from './runtime.js';
import { ChatModel } from './model.js';
import { demo } from './demo.js';
import { InjectedCrash } from './types.js';
import type { FaultHook, RunState } from './types.js';

const HELP = `TypeScript coding harness (Node >=22.13, Bash, Python 3)
Usage: npm run agent -- COMMAND [run_id] [options]
  start --task TEXT [--workspace workspace] [--policy policy.example.json] [--mode safe|auto] [--no-plan]
  resume RUN_ID
  approve-plan RUN_ID --decision approve|reject
  approve-action RUN_ID --decision allow|deny
  resolve RUN_ID --decision retry|fail|abort [--attribute yes|no]
  status RUN_ID
  tasks RUN_ID
  diff RUN_ID
  rollback RUN_ID
  resolve-rollback RUN_ID
  demo                         offline scripted model, real tools, fresh disposable workspace
Options: --db .agent/state.sqlite; --fault after_reservation|after_execute|after_rollback_write
Model: OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL (.env is loaded by npm run agent).
No automatic replay of uncertain calls. Plan approval does not approve safe-mode actions.`;

function parse(argv: string[]): { command: string; id: string | undefined; flags: Map<string, string> } {
  const command = argv.shift() ?? 'help', flags = new Map<string, string>();
  const positional: string[] = [];
  const allowed = new Set(['--task', '--workspace', '--policy', '--mode', '--db', '--fault', '--decision', '--attribute', '--no-plan']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!allowed.has(arg) || flags.has(arg)) throw new Error(`Unknown/duplicate option: ${arg}`);
    if (arg === '--no-plan') { flags.set(arg, 'true'); continue; }
    const next = argv[++i];
    if (!next || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    flags.set(arg, next);
  }
  if (positional.length > 1) throw new Error('Unexpected positional arguments');
  return { command, id: positional[0], flags };
}
function show(run: RunState, runtime: Runtime): void {
  console.log(JSON.stringify({ run_id: run.id, status: run.status, phase: run.phase, reason: run.reason, final: run.final, spent: run.spent, reservedSideEffects: run.reservedSideEffects, limits: run.limits, plan: run.plan, pending: run.pending[0]?.call, decisions: run.decisions }, null, 2));
  runtime.printTasks(run);
}
async function main(): Promise<void> {
  const { command, id, flags } = parse(process.argv.slice(2));
  if (['help', '--help', '-h'].includes(command)) { console.log(HELP); return; }
  if (command === 'demo') { await demo(); return; }
  const store = new Store(resolve(flags.get('--db') ?? '.agent/state.sqlite'));
  let faults: FaultHook | undefined;
  if (flags.has('--fault')) {
    const point = flags.get('--fault')!;
    if (!['after_reservation', 'after_execute', 'after_rollback_write'].includes(point)) throw new Error('Invalid fault point');
    faults = p => { if (p === point) throw new InjectedCrash(`Injected crash at ${p}; use status/resume and explicit resolution`); };
  }
  const runtime = new Runtime(store, { complete: (messages, tools) => ChatModel.fromEnvironment().complete(messages, tools) }, { log: console.log, ...(faults ? { faults } : {}) });
  try {
    if (command === 'start') {
      const mode = flags.get('--mode') ?? 'safe';
      if (!['safe', 'auto'].includes(mode)) throw new Error('Mode must be safe or auto');
      const prompt = flags.get('--task'); if (!prompt) throw new Error('--task is required');
      const run = runtime.start({ workspace: resolve(flags.get('--workspace') ?? 'workspace'), policyFile: resolve(flags.get('--policy') ?? 'policy.example.json'), prompt, mode: mode as 'safe' | 'auto', plan: !flags.has('--no-plan') });
      console.log(`run_id=${run.id}`);
      show(await runtime.run(run.id), runtime); return;
    }
    if (!id) throw new Error('run_id is required');
    if (command === 'status') { show(store.get(id), runtime); return; }
    if (command === 'tasks') { runtime.printTasks(store.get(id)); return; }
    if (command === 'diff') { console.log(runtime.diff(id)); return; }
    if (command === 'rollback') { show(await runtime.rollback(id), runtime); return; }
    if (command === 'resolve-rollback') { await runtime.resolveRollback(id); show(store.get(id), runtime); return; }
    const decision = flags.get('--decision');
    if (command === 'approve-plan') {
      if (!['approve', 'reject'].includes(decision ?? '')) throw new Error('--decision must be approve or reject');
      runtime.approvePlan(id, decision === 'approve');
    } else if (command === 'approve-action') {
      if (!['allow', 'deny'].includes(decision ?? '')) throw new Error('--decision must be allow or deny');
      runtime.approveAction(id, decision === 'allow');
    } else if (command === 'resolve') {
      if (!['retry', 'fail', 'abort'].includes(decision ?? '')) throw new Error('--decision must be retry, fail or abort');
      const attr = flags.get('--attribute');
      if (attr !== undefined && !['yes', 'no'].includes(attr)) throw new Error('--attribute must be yes or no');
      runtime.resolve(id, decision as 'retry' | 'fail' | 'abort', attr === undefined ? undefined : attr === 'yes');
    } else if (command !== 'resume') throw new Error(`Unknown command: ${command}`);
    show(await runtime.run(id), runtime);
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
