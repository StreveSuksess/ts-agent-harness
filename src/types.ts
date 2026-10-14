export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Args = Record<string, Json>;
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface AssistantMessage extends Message { role: 'assistant' }
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}
export interface Model { complete(messages: Message[], tools: ToolDefinition[]): Promise<AssistantMessage> }
export interface Limits { modelRequests: number; toolCalls: number; sideEffects: number; resultBytes: number }
export interface PolicyConfig {
  commands: { allow: string[]; deny: string[] };
  directories: { allow: string[]; deny: string[] };
  readOnlyFiles: string[];
  timeoutMs: number; maxOutputBytes: number; maxFileBytes: number; maxTreeBytes: number;
  budgets: Limits;
}
export interface FileState { content: string; hash: string; mode: number }
export type Tree = Record<string, FileState>;
export interface Change { path: string; before: FileState | null; after: FileState | null }
export interface ToolResult {
  ok: boolean; error?: string; content?: string; files?: string[];
  stdout?: string; stderr?: string; exitCode?: number | null;
  timedOut?: boolean; truncated?: boolean; hash?: string;
  [key: string]: Json | undefined;
}
export type Verification =
  | { kind: 'tool'; tool: string }
  | { kind: 'file_changed'; path: string }
  | { kind: 'bash'; command: string; exitCode: number };
export interface PlanStep {
  id: string; description: string; depends_on: string[]; tools: string[]; verification: Verification;
}
export interface Plan { goal: string; steps: PlanStep[]; risks: string[]; assumptions: string[]; done_when: string }
export interface Task extends PlanStep {
  status: 'pending' | 'running' | 'completed';
  evidence?: { callId: string; result: ToolResult; verifiedAt: string };
}
export interface Attempt {
  number: number; startedAt: string; reservedBytes: number;
  status: 'started' | 'completed' | 'uncertain' | 'failed';
  before: Tree; after?: Tree; result?: ToolResult;
}
export interface CallRecord {
  call: ToolCall; fingerprint: string; phase: 'plan' | 'execute'; taskId: string | null;
  status: 'queued' | 'awaiting' | 'started' | 'completed' | 'uncertain';
  approved?: boolean; attempts: Attempt[]; result?: ToolResult; resultText?: string;
  sideReserved?: boolean;
}
export interface Pending { call: ToolCall; taskId: string | null; phase: 'plan' | 'execute'; error?: string }
export type RunStatus = 'running' | 'awaiting_plan' | 'awaiting_action' | 'uncertain' | 'blocked' | 'conflict' | 'completed' | 'failed' | 'rolled_back';
export interface RunState {
  id: string; revision: number; createdAt: string; workspace: string; policyFile: string;
  mode: 'safe' | 'auto'; phase: 'plan' | 'execute'; status: RunStatus;
  prompt: string; messages: Message[]; pending: Pending[]; calls: Record<string, CallRecord>;
  plan?: Plan; tasks: Task[]; activeTaskId: string | null;
  limits: Limits; spent: Limits; reservedSideEffects: number; initial: Tree; expected: Tree; journal: Change[][]; changes: Record<string, Change>;
  decisions: { at: string; kind: string; choice: string; callId?: string; attribute?: boolean }[];
  reason?: string; final?: string; rollbackStarted?: boolean;
}
export class InjectedCrash extends Error {}
export type FaultHook = (point: 'after_reservation' | 'after_execute' | 'after_rollback_write') => void;
export const SIDE_EFFECTS = new Set(['write_file', 'delete_file', 'Bash']);
export const PROJECT_TOOLS = new Set(['list_files', 'read_file', 'write_file', 'delete_file', 'Bash']);
export const now = (): string => new Date().toISOString();
