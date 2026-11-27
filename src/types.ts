export type {
  Json,
  Args,
  ToolCall,
  Message,
  AssistantMessage,
  ToolDefinition,
  Model,
  ToolResult,
} from './types/protocol.js';

export type { Verification, PlanStep, Plan, Task } from './types/plan.js';

export type {
  Limits,
  PolicyConfig,
  FileState,
  Tree,
  Change,
  Attempt,
  CallRecord,
  Pending,
  RunStatus,
  RunState,
} from './types/run-state.js';

export class InjectedCrash extends Error {}

export type FaultHook = (
  point: 'after_reservation' | 'after_execute' | 'after_rollback_write',
) => void;

export const SIDE_EFFECTS = new Set(['write_file', 'delete_file', 'Bash', 'market_install']);

export const PROJECT_TOOLS = new Set([
  'list_files',
  'read_file',
  'write_file',
  'delete_file',
  'Bash',
]);

export const now = (): string => new Date().toISOString();
