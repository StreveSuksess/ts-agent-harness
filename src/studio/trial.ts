import { randomUUID } from 'node:crypto';
import { Store } from '../store.js';
import { Runtime } from '../runtime.js';
import { ChatModel } from '../model.js';
import type { Limits, Verification } from '../types.js';
import { prepareExtensions } from '../extensions/index.js';
import { localUrl } from './laya.js';
import { statistics } from './stats.js';

export interface TrialOptions {
  workspace: string;
  policyFile: string;
  dbFile: string;
  prompt: string;
  trackerFixture: string;
  skills: boolean;
  skillDir?: string;
  limits: Partial<Limits>;
  verification: Verification;
  systemNote?: string;
  sessionId?: string;
}
export async function executeTrial(options: TrialOptions) {
  const baseUrl = localUrl(process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:11434/v1').href;
  const model = new ChatModel({
    baseUrl,
    apiKey: process.env.OPENAI_API_KEY ?? 'ollama',
    model: process.env.OPENAI_MODEL ?? 'harness-qwen3:4b-local',
    generation: { max_tokens: 384, temperature: 0.2 },
  });
  const extensions = await prepareExtensions({
    workspace: options.workspace,
    skills: options.skills,
    market: false,
    trackerFixture: options.trackerFixture,
    ...(options.skillDir ? { skillDir: options.skillDir } : {}),
  });
  const store = new Store(options.dbFile);
  try {
    const runtime = new Runtime(store, model);
    const started = runtime.start({
      ...options,
      extensions,
      sessionId: options.sessionId ?? randomUUID(),
      plan: false,
      mode: 'auto',
    });
    const run = await runtime.run(started.id);
    const events = run.events ?? [];
    return { run, events, stats: statistics(events) };
  } finally {
    store.close();
  }
}
