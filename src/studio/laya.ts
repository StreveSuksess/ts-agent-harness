import type { ExtensionSnapshot } from '../extensions/index.js';
import type { PolicyConfig, RunState, ToolCall } from '../types.js';
import { tokenCount } from '../model.js';
import { SkillMarket } from '../extensions/market.js';

export interface LayaRoute {
  skill: string | null;
  marketSkill: string | null;
  mcp: string | null;
  model: string;
  input: number | null;
  output: number | null;
  confidence: Record<string, number>;
}

export function localUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Для локальной модели нужен адрес loopback без учётных данных и параметров');
  return url;
}
export function extensionAllowed(config: PolicyConfig, name: string): boolean {
  return !!config.extensions?.allow.includes(name) && !config.extensions.deny.includes(name);
}
type Option = { name: string; description: string };
type Question = { type: 'choice'; instructions: string; criteria: Record<string, string> };
function question(items: Option[], instructions: string): Question {
  return {
    type: 'choice',
    instructions,
    criteria: Object.fromEntries([
      ...items.map((p) => [p.name, p.description]),
      ['none', 'No suitable option for this request; use other ordinary tools.'],
    ]),
  };
}

/** Only names and descriptions reach this model. Nothing in the request is a grant of execution authority. */
export function routeCatalog(s: ExtensionSnapshot, config: PolicyConfig) {
  const installed = extensionAllowed(config, 'load_skill') ? s.skills : [];
  const available =
    s.market &&
    extensionAllowed(config, 'market_search') &&
    extensionAllowed(config, 'market_install')
      ? (s.marketOffers ?? new SkillMarket(s.stateDir).status().available).filter(
          (p) => !s.skills.some((i) => i.name === p.name),
        )
      : [];
  const mcp = s.mcp
    .filter((t) => extensionAllowed(config, t.definition.function.name))
    .map((t) => ({
      name: t.definition.function.name,
      description: t.definition.function.description,
    }));
  const questions: Record<string, Question> = {};
  if (installed.length || available.length)
    questions.skill = question(
      [...installed, ...available],
      'Select the single relevant workflow skill for the user request, or none if no description fits.',
    );
  if (mcp.length)
    questions.mcp = question(
      mcp,
      'Select the external data tool required by this request. Choose none if the task uses only local files.',
    );
  return { installed, questions };
}

export async function chooseExtensions(
  run: RunState,
  { installed, questions }: ReturnType<typeof routeCatalog>,
): Promise<LayaRoute> {
  const model = 'multilingual';
  const route: LayaRoute = {
    skill: null,
    marketSkill: null,
    mcp: null,
    model,
    input: null,
    output: null,
    confidence: {},
  };
  if (!Object.keys(questions).length) return route;
  const url = localUrl(process.env.LAYA_BASE_URL ?? 'http://127.0.0.1:18000');
  const context = run.messages.find((m) =>
    m.content?.startsWith('Earlier turns in this workspace'),
  )?.content;
  const response = await fetch(new URL('/v1/systemone', url), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      state: { request: run.prompt, ...(context ? { context } : {}) },
      questions,
    }),
  });
  if (!response.ok) throw new Error('Laya HTTP ' + response.status);
  const body = (await response.json()) as {
    answers?: Record<string, { choice?: string; confidence?: number }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  for (const [key, q] of Object.entries(questions)) {
    const answer = body.answers?.[key];
    const name = answer?.choice;
    if (typeof name !== 'string' || !Object.hasOwn(q.criteria, name))
      throw new Error('Laya returned an unknown or missing option for ' + key);
    if (typeof answer?.confidence === 'number' && Number.isFinite(answer.confidence))
      route.confidence[key] = answer.confidence;
    if (name === 'none') continue;
    if (key === 'mcp') route.mcp = name;
    else if (installed.some((p) => p.name === name)) route.skill = name;
    else route.marketSkill = name;
  }
  route.input = tokenCount(body.usage?.input_tokens);
  route.output = tokenCount(body.usage?.output_tokens);
  return route;
}

export function routedCalls(route: LayaRoute, s: ExtensionSnapshot): ToolCall[] {
  const calls: ToolCall[] = [];
  const add = (name: string, args: object) =>
    calls.push({
      id: 'laya_' + calls.length + '_' + name,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
  if (route.skill) add('load_skill', { name: route.skill });
  if (route.marketSkill) add('market_search', { query: route.marketSkill });
  const tool = s.mcp.find((t) => t.definition.function.name === route.mcp);
  if (tool && !(tool.definition.function.parameters as { required?: string[] }).required?.length)
    add(tool.definition.function.name, {});
  return calls;
}
