import type { Message, ToolCall, ToolResult } from './protocol.js';
import type { Plan, Task } from './plan.js';

export interface Limits {
  modelRequests: number;
  toolCalls: number;
  sideEffects: number;
  resultBytes: number;
}

export interface PolicyConfig {
  commands: { allow: string[]; deny: string[] };
  directories: { allow: string[]; deny: string[] };
  readOnlyFiles: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  maxFileBytes: number;
  maxTreeBytes: number;
  budgets: Limits;
}

export interface FileState {
  content: string;
  hash: string;
  mode: number;
}

export type Tree = Record<string, FileState>;

export interface Change {
  path: string;
  before: FileState | null;
  after: FileState | null;
}

export interface Attempt {
  number: number;
  startedAt: string;
  reservedBytes: number;
  status: 'started' | 'completed' | 'uncertain' | 'failed';
  before: Tree;
  after?: Tree;
  result?: ToolResult;
}

export interface CallRecord {
  call: ToolCall;
  fingerprint: string;
  phase: 'plan' | 'execute';
  taskId: string | null;
  status: 'queued' | 'awaiting' | 'started' | 'completed' | 'uncertain';
  approved?: boolean;
  attempts: Attempt[];
  result?: ToolResult;
  resultText?: string;
  sideReserved?: boolean;
}

export interface Pending {
  call: ToolCall;
  taskId: string | null;
  phase: 'plan' | 'execute';
  error?: string;
}

export type RunStatus =
  | 'running'
  | 'awaiting_plan'
  | 'awaiting_action'
  | 'uncertain'
  | 'blocked'
  | 'conflict'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface RunState {
  id: string;
  revision: number;
  createdAt: string;
  workspace: string;
  policyFile: string;
  mode: 'safe' | 'auto';
  phase: 'plan' | 'execute';
  status: RunStatus;
  prompt: string;
  messages: Message[];
  pending: Pending[];
  calls: Record<string, CallRecord>;
  plan?: Plan;
  tasks: Task[];
  activeTaskId: string | null;
  limits: Limits;
  spent: Limits;
  reservedSideEffects: number;
  initial: Tree;
  expected: Tree;
  journal: Change[][];
  changes: Record<string, Change>;
  decisions: { at: string; kind: string; choice: string; callId?: string; attribute?: boolean }[];
  reason?: string;
  final?: string;
  rollbackStarted?: boolean;
}
