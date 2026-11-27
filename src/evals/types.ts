export type Kind = 'ab' | 'update';
export type Variant = 'A' | 'B' | 'old' | 'new';
export interface TrialRow {
  case_id: string;
  variant: Variant;
  trial: number;
  run_id: string;
  session_id: string;
  status: string;
  outcome_pass: boolean;
  routing_pass_or_na: boolean | 'n/a';
  tools_pass: boolean;
  safety_pass: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  usage_complete: boolean;
  skill_activations: Record<string, number>;
  mcp_calls: Record<string, number>;
  tools: Record<string, number>;
  laya_route?: Record<string, unknown> | null;
  tool_errors: number;
  error: string | null;
  events_path: string;
}
export interface Group {
  case_id: string;
  variant: Variant;
  trials: number;
  outcomes: number;
  routing_passes: number;
  routing_trials: number;
  input_tokens: number | null;
  output_tokens: number | null;
  complete_usage: number;
  tool_calls: number;
  mcp_calls: number;
  errors: number;
}
export interface GateDecision {
  accept: boolean;
  reason: string;
}
export interface EvalSummary {
  kind: Kind;
  total: number;
  completed: number;
  groups: Group[];
  overall?: Group[];
  rows: TrialRow[];
  decision?: GateDecision;
}
