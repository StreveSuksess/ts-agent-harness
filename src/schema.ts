import { Ajv } from 'ajv';
import type { Args, Plan, PolicyConfig, ToolDefinition } from './types.js';

const ajv = new Ajv({ allErrors: true, strict: true });
const str = { type: 'string', minLength: 1, maxLength: 4096 };
const strings = { type: 'array', items: str, maxItems: 100 };
const object = (properties: object, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
const verification = { oneOf: [
  object({ kind: { const: 'tool' }, tool: { enum: ['read_file', 'list_files', 'write_file', 'delete_file', 'Bash'] } }, ['kind', 'tool']),
  object({ kind: { const: 'file_changed' }, path: str }, ['kind', 'path']),
  object({ kind: { const: 'bash' }, command: str, exitCode: { type: 'integer' } }, ['kind', 'command', 'exitCode']),
] };
export const planSchema = object({
  goal: str,
  steps: { type: 'array', minItems: 1, maxItems: 30, items: object({
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' }, description: str,
    depends_on: strings, tools: { type: 'array', minItems: 1, items: { enum: ['read_file', 'list_files', 'write_file', 'delete_file', 'Bash'] } }, verification,
  }, ['id', 'description', 'depends_on', 'tools', 'verification']) },
  risks: strings, assumptions: strings, done_when: str,
}, ['goal', 'steps', 'risks', 'assumptions', 'done_when']);
export const definitions: ToolDefinition[] = [
  { type: 'function', function: { name: 'list_files', description: 'List entries in a workspace-relative allowed directory. Symlinks and denied entries are hidden.', parameters: object({ path: str }, ['path']) } },
  { type: 'function', function: { name: 'read_file', description: 'Read a UTF-8 text file within allowed workspace directories.', parameters: object({ path: str }, ['path']) } },
  { type: 'function', function: { name: 'write_file', description: 'Create or replace a UTF-8 text file. Existing parent directory required. Test files may be protected by policy.', parameters: object({ path: str, content: { type: 'string', maxLength: 1048576 } }, ['path', 'content']) } },
  { type: 'function', function: { name: 'delete_file', description: 'Delete one file. Always requires explicit user approval.', parameters: object({ path: str }, ['path']) } },
  { type: 'function', function: { name: 'Bash', description: 'Run an exact policy-approved simple Bash command, with workspace-relative cwd. Output and time are bounded.', parameters: object({ command: str, cwd: str }, ['command', 'cwd']) } },
  { type: 'function', function: { name: 'submit_plan', description: 'Submit a structured plan for explicit user approval. No project changes. Tools may only be used for reading in the planning phase.', parameters: object({ plan: planSchema }, ['plan']) } },
  { type: 'function', function: { name: 'complete_task', description: 'Complete the current task using a saved successful project tool call as evidence. Runtime independently checks the plan verification condition.', parameters: object({ evidence_call_id: str }, ['evidence_call_id']) } },
];
const validators = new Map(definitions.map(d => [d.function.name, ajv.compile(d.function.parameters)]));
export function validateArguments(name: string, raw: string): Args {
  const validate = validators.get(name);
  if (!validate) throw new Error(`Unknown tool: ${name}`);
  if (Buffer.byteLength(raw) > 2 * 1048576) throw new Error('Arguments exceed 2 MiB');
  let args: unknown;
  try { args = JSON.parse(raw); } catch { throw new Error('Arguments must be valid JSON'); }
  if (!validate(args)) throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors)}`);
  return args as Args;
}
const budget = object(Object.fromEntries(['modelRequests', 'toolCalls', 'sideEffects', 'resultBytes'].map(k => [k, { type: 'integer', minimum: 0, maximum: 1_000_000_000 }])), ['modelRequests', 'toolCalls', 'sideEffects', 'resultBytes']);
const policySchema = object({
  commands: object({ allow: strings, deny: strings }, ['allow', 'deny']),
  directories: object({ allow: { ...strings, minItems: 1 }, deny: strings }, ['allow', 'deny']),
  readOnlyFiles: strings,
  timeoutMs: { type: 'integer', minimum: 1, maximum: 120000 },
  maxOutputBytes: { type: 'integer', minimum: 128, maximum: 1048576 },
  maxFileBytes: { type: 'integer', minimum: 1, maximum: 16777216 },
  maxTreeBytes: { type: 'integer', minimum: 1, maximum: 67108864 },
  budgets: budget,
}, ['commands', 'directories', 'readOnlyFiles', 'timeoutMs', 'maxOutputBytes', 'maxFileBytes', 'maxTreeBytes', 'budgets']);
const checkPolicy = ajv.compile<PolicyConfig>(policySchema);
export function validatePolicy(value: unknown): PolicyConfig {
  if (!checkPolicy(value)) throw new Error(`Invalid policy: ${ajv.errorsText(checkPolicy.errors)}`);
  return value as PolicyConfig;
}
export function validatePlan(value: unknown): Plan {
  const check = ajv.compile<Plan>(planSchema);
  if (!check(value)) throw new Error(`Invalid plan: ${ajv.errorsText(check.errors)}`);
  const plan = value as Plan;
  const ids = new Set(plan.steps.map(s => s.id));
  if (ids.size !== plan.steps.length) throw new Error('Task IDs must be unique');
  const done = new Set<string>();
  while (done.size < ids.size) {
    const ready = plan.steps.filter(s => !done.has(s.id) && s.depends_on.every(id => done.has(id)));
    if (!ready.length) throw new Error('Task dependencies contain a cycle or unknown ID');
    for (const step of ready) done.add(step.id);
  }
  return plan;
}
