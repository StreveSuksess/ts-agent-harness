export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Args = Record<string, Json>;

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AssistantMessage extends Message {
  role: 'assistant';
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface Model {
  complete(messages: Message[], tools: ToolDefinition[]): Promise<AssistantMessage>;
}

export interface ToolResult {
  ok: boolean;
  error?: string;
  content?: string;
  files?: string[];
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  truncated?: boolean;
  hash?: string;
  [key: string]: Json | undefined;
}
