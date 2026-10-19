import type { ToolResult } from './protocol.js';

export type Verification =
  | { kind: 'tool'; tool: string }
  | { kind: 'file_changed'; path: string }
  | { kind: 'bash'; command: string; exitCode: number };

export interface PlanStep {
  id: string;
  description: string;
  depends_on: string[];
  tools: string[];
  verification: Verification;
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  risks: string[];
  assumptions: string[];
  done_when: string;
}

export interface Task extends PlanStep {
  status: 'pending' | 'running' | 'completed';
  evidence?: { callId: string; result: ToolResult; verifiedAt: string };
}
