import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../store.js';
import { Runtime } from '../runtime.js';
import { ChatModel } from '../model.js';
import { localUrl } from './laya.js';
import { prepareExtensions } from '../extensions/index.js';
import { defaultExtensionState } from '../extensions/market.js';
import { projectRoot } from '../cli/paths.js';
import {
  rememberTurn,
  conversationContext,
  type ConversationTurn,
} from '../cli/conversation-context.js';
import { formatReview } from '../cli/presentation.js';
import { diagnose } from './doctor.js';
import { statistics } from './stats.js';
import type { StudioSettings } from './settings.js';
import type { RunState } from '../types.js';

export const studioDir = join(projectRoot, '.agent/studio');
export const studioPolicy = join(projectRoot, 'configs/studio-policy.json');
export const generatorName = () => process.env.OPENAI_MODEL ?? 'harness-qwen3:4b-local';
export function localGenerator() {
  return new ChatModel({
    baseUrl: localUrl(process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:11434/v1').href,
    apiKey: process.env.OPENAI_API_KEY ?? 'ollama',
    model: generatorName(),
    generation: { temperature: 0.2 },
  });
}
export function publicRun(run: RunState) {
  return {
    id: run.id,
    revision: run.revision,
    prompt: run.prompt,
    createdAt: run.createdAt,
    status: run.status,
    phase: run.phase,
    final: run.final,
    reason: run.reason,
    plan: run.plan,
    pending: run.pending[0]?.call,
    review: formatReview(run),
    tasks: run.tasks,
    workspace: run.workspace,
    events: run.events ?? [],
    stats: statistics(run.events ?? []),
  };
}
export class StudioSessions {
  readonly store: Store;
  readonly runtime: Runtime;
  constructor(
    readonly dir = studioDir,
    onSave?: (s: RunState) => void,
  ) {
    this.store = new Store(join(dir, 'runs.sqlite'), onSave);
    this.runtime = new Runtime(this.store, { complete: (m, t) => localGenerator().complete(m, t) });
  }
  all() {
    const map = new Map<string, RunState[]>();
    for (const { id } of this.store.listRuns().reverse()) {
      const run = this.store.get(id);
      const key = run.sessionId ?? id;
      const rows = map.get(key) ?? [];
      rows.push(run);
      map.set(key, rows);
    }
    return map;
  }
  list() {
    return [...this.all()].reverse().map(([id, runs]) => {
      const events = runs.flatMap((r) => r.events ?? []);
      return {
        id,
        title: runs[0]!.prompt,
        createdAt: runs[0]!.createdAt,
        runs: runs.map(publicRun),
        stats: statistics(events),
        findings: diagnose(events),
      };
    });
  }
  async start(prompt: string, settings: StudioSettings, sessionId?: string): Promise<RunState> {
    if (!prompt.trim() || prompt.length > 12000)
      throw new Error('Запрос должен содержать от 1 до 12000 символов.');
    const previous = sessionId ? this.all().get(sessionId) : [];
    if (!previous) throw new Error('Сессия не найдена');
    const root = join(this.dir, 'workspaces');
    mkdirSync(root, { recursive: true });
    const workspace = previous[0]?.workspace ?? mkdtempSync(join(root, 'session-'));
    if (!previous.length)
      writeFileSync(
        join(workspace, 'notes.txt'),
        'Учебный трекер. Отчёты сохраняются в этой папке.\n',
      );
    const ext = await prepareExtensions({
      workspace,
      stateDir: defaultExtensionState,
      servers: settings.servers,
      disabledSkills: settings.disabledSkills,
    });
    return this.store.locked(workspace, async () => {
      const turns = sessionId ? this.all().get(sessionId)! : [];
      const last = turns.at(-1);
      if (last && !['failed', 'rolled_back', 'completed'].includes(last.status))
        throw new Error('Завершите или возобновите текущий запуск перед следующим запросом.');
      const memory = turns.reduce<ConversationTurn[]>((history, r) => rememberTurn(history, r), []);
      return this.runtime.start({
        sessionId: sessionId ?? randomUUID(),
        prompt: prompt.trim(),
        workspace,
        policyFile: studioPolicy,
        mode: settings.mode,
        plan: settings.plan,
        extensions: ext,
        verification: { kind: 'tool', tool: 'write_file' },
        systemNote:
          'This workspace is a study tracker. Reports are files in the workspace. Local Laya selects skills and external tools. If a remote source fails, report the limitation accurately. For no-plan execution save the requested output (or a concise answer in answer.txt) before completion. /no_think',
        ...(memory.length ? { conversationContext: conversationContext(memory) } : {}),
      });
    });
  }
}
