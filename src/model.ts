import type { AssistantMessage, Message, Model, ToolDefinition } from './types.js';

export function parseAssistant(value: unknown): AssistantMessage {
  if (!value || typeof value !== 'object') throw new Error('Invalid assistant response');
  const v = value as Record<string, unknown>;
  if (v.role !== 'assistant' || (v.content !== null && typeof v.content !== 'string')) throw new Error('Expected assistant role and string/null content');
  if (v.tool_calls !== undefined) {
    if (!Array.isArray(v.tool_calls) || v.tool_calls.length > 100) throw new Error('Invalid tool call array');
    const calls = v.tool_calls.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid tool call');
      const c = item as Record<string, unknown>, f = c.function as Record<string, unknown> | undefined;
      if (typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.id) || ['__proto__', 'constructor', 'prototype'].includes(c.id) || c.type !== 'function' || !f || typeof f.name !== 'string' || typeof f.arguments !== 'string') throw new Error('Invalid tool call protocol');
      return { id: c.id, type: 'function' as const, function: { name: f.name, arguments: f.arguments } };
    });
    return { role: 'assistant', content: v.content as string | null, tool_calls: calls };
  }
  return { role: 'assistant', content: v.content as string | null };
}
export class ChatModel implements Model {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly model: string;
  constructor(options: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }) {
    const url = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid API base URL');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.key = options.apiKey; this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }
  private readonly timeoutMs: number;
  async complete(messages: Message[], tools: ToolDefinition[]): Promise<AssistantMessage> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model: this.model, messages, tools, tool_choice: 'auto', stream: false }),
      signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Model API returned HTTP ${response.status}`); }
    if (!response.body) throw new Error('Empty model API response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4 * 1048576) { await reader.cancel(); throw new Error('Model response exceeds 4 MiB'); }
      chunks.push(next.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { choices?: { message?: unknown }[] };
    return parseAssistant(data.choices?.[0]?.message);
  }
  static fromEnvironment(): ChatModel {
    const { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;
    if (!OPENAI_BASE_URL || !OPENAI_API_KEY || !OPENAI_MODEL) throw new Error('Set OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL in .env or environment');
    return new ChatModel({ baseUrl: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY, model: OPENAI_MODEL });
  }
}
export class ScriptedModel implements Model {
  readonly seen: Message[][] = [];
  constructor(private readonly responses: AssistantMessage[]) {}
  async complete(messages: Message[]): Promise<AssistantMessage> {
    this.seen.push(structuredClone(messages));
    const next = this.responses.shift();
    if (!next) throw new Error('Scripted model has no more responses');
    return parseAssistant(next);
  }
}
