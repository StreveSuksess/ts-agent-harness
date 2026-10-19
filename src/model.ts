import type { AssistantMessage, Message, Model, ToolDefinition } from './types.js';

export function parseAssistant(value: unknown): AssistantMessage {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid assistant response');
  }

  const assistantMessage = value as Record<string, unknown>;

  if (
    assistantMessage.role !== 'assistant' ||
    (assistantMessage.content !== null && typeof assistantMessage.content !== 'string')
  ) {
    throw new Error('Expected assistant role and string/null content');
  }

  if (assistantMessage.tool_calls !== undefined) {
    if (!Array.isArray(assistantMessage.tool_calls) || assistantMessage.tool_calls.length > 100) {
      throw new Error('Invalid tool call array');
    }

    const calls = assistantMessage.tool_calls.map((item: unknown) => {
      if (!item || typeof item !== 'object') {
        throw new Error('Invalid tool call');
      }

      const toolCall = item as Record<string, unknown>;
      const functionCall = toolCall.function as Record<string, unknown> | undefined;

      if (
        typeof toolCall.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(toolCall.id) ||
        ['__proto__', 'constructor', 'prototype'].includes(toolCall.id) ||
        toolCall.type !== 'function' ||
        !functionCall ||
        typeof functionCall.name !== 'string' ||
        typeof functionCall.arguments !== 'string'
      ) {
        throw new Error('Invalid tool call protocol');
      }

      return {
        id: toolCall.id,
        type: 'function' as const,
        function: { name: functionCall.name, arguments: functionCall.arguments },
      };
    });

    return {
      role: 'assistant',
      content: assistantMessage.content as string | null,
      tool_calls: calls,
    };
  }

  return { role: 'assistant', content: assistantMessage.content as string | null };
}

export class ChatModel implements Model {
  private readonly baseUrl: string;

  private readonly key: string;

  private readonly model: string;

  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }) {
    const url = new URL(options.baseUrl);

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Invalid API base URL');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.key = options.apiKey;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  async complete(messages: Message[], tools: ToolDefinition[]): Promise<AssistantMessage> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools,
        tool_choice: 'auto',
        stream: false,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: 'error',
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Model API returned HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Empty model API response');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;

    while (true) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      bytes += chunk.value.byteLength;
      if (bytes > 4 * 1048576) {
        await reader.cancel();
        throw new Error('Model response exceeds 4 MiB');
      }

      chunks.push(chunk.value);
    }

    const responseBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      choices?: { message?: unknown }[];
    };

    return parseAssistant(responseBody.choices?.[0]?.message);
  }

  static fromEnvironment(): ChatModel {
    const { OPENAI_BASE_URL, OPENAI_API_KEY, OPENAI_MODEL } = process.env;

    if (!OPENAI_BASE_URL || !OPENAI_API_KEY || !OPENAI_MODEL) {
      throw new Error(
        'Set OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL in .env or environment',
      );
    }

    return new ChatModel({ baseUrl: OPENAI_BASE_URL, apiKey: OPENAI_API_KEY, model: OPENAI_MODEL });
  }
}

export class ScriptedModel implements Model {
  readonly seen: Message[][] = [];

  constructor(private readonly responses: AssistantMessage[]) {}

  async complete(messages: Message[]): Promise<AssistantMessage> {
    this.seen.push(structuredClone(messages));

    const response = this.responses.shift();

    if (!response) {
      throw new Error('Scripted model has no more responses');
    }

    return parseAssistant(response);
  }
}
