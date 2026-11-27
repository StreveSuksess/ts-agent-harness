import { eventData } from './event-data.js';
import { randomUUID } from 'node:crypto';
import type { RunState } from '../types.js';

export interface AgentEvent {
  id: string;
  time: string;
  session_id: string;
  run_id: string;
  type: string;
  data: Record<string, unknown>;
}

export function recordEvent(run: RunState, type: string, data: AgentEvent['data']): void {
  if (!run.sessionId) return;
  (run.events ??= []).push({
    id: randomUUID(),
    time: new Date().toISOString(),
    session_id: run.sessionId,
    run_id: run.id,
    type,
    data: eventData(data),
  });
}

function decoded(raw: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw ?? '{}') as Record<string, unknown>;
  } catch {
    return { text: raw };
  }
}

/** Saved inside the same optimistic SQLite transaction as the corresponding state. */
export function captureEvents(run: RunState): void {
  if (!run.sessionId) return;
  const cursor = run.auditCursor ?? { messages: 0, decisions: 0, status: '' };
  if (!run.auditCursor) {
    recordEvent(run, 'user_request', { prompt: run.prompt });
    if (run.extensions) {
      recordEvent(run, 'catalog', {
        skills: run.extensions.skills.map(({ name, description, version, hash }) => ({
          name,
          description,
          version,
          hash,
        })),
        mcp: run.extensions.mcp.map((t) => ({ server: t.server, tool: t.name })),
      });
      for (const message of run.extensions.errors)
        recordEvent(run, 'catalog_error', { error: message });
    }
  }
  for (const decision of run.decisions.slice(cursor.decisions))
    recordEvent(run, 'decision', { ...decision });
  for (const msg of run.messages.slice(cursor.messages)) {
    for (const call of msg.tool_calls ?? []) {
      recordEvent(run, 'tool_call', {
        call_id: call.id,
        tool: call.function.name,
        args: decoded(call.function.arguments),
      });
    }
    if (msg.role === 'tool') {
      const id = msg.tool_call_id ?? '';
      const record = run.calls[id];
      const tool = record?.call.function.name;
      const result = decoded(msg.content);
      const mcp = run.extensions?.mcp.find((t) => t.definition.function.name === tool);
      recordEvent(run, 'tool_result', {
        call_id: id,
        tool,
        result,
        ...(mcp ? { server: mcp.server, remoteTool: mcp.name } : {}),
        attempts: record?.attempts.length ?? 0,
      });
      if (
        tool === 'load_skill' &&
        result.ok &&
        !run.events?.some((e) => e.type === 'skill_loaded' && e.data.call_id === id)
      ) {
        recordEvent(run, 'skill_loaded', {
          call_id: id,
          name: decoded(record!.call.function.arguments).name,
          version: record?.result?.version,
          hash: record?.result?.hash,
        });
      }
    }
    if (msg.role === 'assistant' && msg.content)
      recordEvent(run, 'assistant_text', { text: msg.content });
  }
  if (cursor.status !== run.status)
    recordEvent(run, 'status', { status: run.status, reason: run.reason });
  run.auditCursor = {
    messages: run.messages.length,
    decisions: run.decisions.length,
    status: run.status,
  };
}
