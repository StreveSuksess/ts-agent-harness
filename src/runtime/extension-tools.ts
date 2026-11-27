import { definitions } from '../schema.js';
import { ajv } from '../schemas/common.js';
import { makePlanSchema } from '../schemas/plan.js';
import { validateExtension } from '../extensions/index.js';
import type { Policy } from '../policy.js';
import { PROJECT_TOOLS } from '../types.js';
import type { RunState, ToolCall, ToolDefinition, Args } from '../types.js';
import { extensionAllowed } from '../studio/laya.js';

export function taskTools(run: RunState, policy?: Policy): string[] {
  const additions = (run.extensions?.definitions ?? [])
    .map((d) => d.function.name)
    .filter((n) => n.startsWith('mcp_') || n === 'market_install');
  return [
    ...PROJECT_TOOLS,
    ...additions.filter(
      (name) => !policy || (extensionAllowed(policy.config, name) && permittedRoute(run, name)),
    ),
  ];
}
export function evidenceTool(run: RunState, name: string): boolean {
  return (
    PROJECT_TOOLS.has(name) ||
    !!run.extensions?.mcp.some((t) => t.definition.function.name === name)
  );
}
function permittedRoute(run: RunState, name: string): boolean {
  if (name === 'load_skill') return !!run.routing?.skill;
  if (name === 'market_search' || name === 'market_install') return !!run.routing?.marketSkill;
  return name === run.routing?.mcp;
}
export function runDefinitions(run: RunState, policy: Policy): ToolDefinition[] {
  if (!run.extensions) return definitions;
  const extra = run.extensions.definitions.filter(
    (d) => extensionAllowed(policy.config, d.function.name) && permittedRoute(run, d.function.name),
  );
  const names = taskTools(run, policy);
  const base = definitions.map((d) =>
    d.function.name === 'submit_plan'
      ? { ...d, function: { ...d.function, parameters: planArguments(names) } }
      : d,
  );
  return [...base, ...extra];
}
function planArguments(names: string[]) {
  return {
    type: 'object',
    properties: { plan: makePlanSchema(names) },
    required: ['plan'],
    additionalProperties: false,
  };
}
export function validateCall(run: RunState, policy: Policy, call: ToolCall): Args {
  const { name, arguments: raw } = call.function;
  if (!run.extensions) return policy.validate(call);
  if (name === 'submit_plan') {
    if (Buffer.byteLength(raw) > 2 * 1048576) throw new Error('Plan too large');
    const args: unknown = JSON.parse(raw);
    if (!ajv.validate(planArguments(taskTools(run, policy)), args))
      throw new Error('Invalid plan arguments: ' + ajv.errorsText(ajv.errors));
    return args as Args;
  }
  if (definitions.some((d) => d.function.name === name)) return policy.validate(call);
  if (!extensionAllowed(policy.config, name))
    throw new Error('Extension denied by workspace policy: ' + name);
  if (!permittedRoute(run, name)) throw new Error('Tool was not selected by Laya: ' + name);
  const args = validateExtension(run.extensions, name, raw);
  if (name === 'load_skill' && args.name !== run.routing?.skill)
    throw new Error('Skill was not selected by Laya');
  if (name === 'market_search' && args.query !== run.routing?.marketSkill)
    throw new Error('Market search must match the package selected by Laya');
  if (name === 'market_install' && args.name !== run.routing?.marketSkill)
    throw new Error('Market package was not selected by Laya');
  return args;
}
