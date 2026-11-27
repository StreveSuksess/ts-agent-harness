import { parseAssistant } from '../model.js';
import { definitions } from '../schema.js';
import { recordEvent } from '../studio/events.js';
import { chooseExtensions, routeCatalog, routedCalls } from '../studio/laya.js';
import type { AssistantMessage, RunState } from '../types.js';
import { loadPolicy, stopRun, type RuntimeContext } from './context.js';
import { runDefinitions } from './extension-tools.js';
import { admitToolBatch } from './tool-batch.js';
import { failure } from './tool-results.js';

function reserveRequest(context: RuntimeContext, run: RunState, engine: string) {
  run.spent.modelRequests++;
  recordEvent(run, 'model_request', { engine, number: run.spent.modelRequests });
  context.store.save(run);
}

async function selectExtensions(context: RuntimeContext, run: RunState) {
  const catalog = routeCatalog(run.extensions!, loadPolicy(context, run).config);
  const hasOptions = Object.keys(catalog.questions).length > 0;
  if (hasOptions) reserveRequest(context, run, 'laya');

  const route = await chooseExtensions(run, catalog);
  run.routing = route;
  if (hasOptions) recordEvent(run, 'laya_route', { engine: 'laya', ...route });
  else recordEvent(run, 'routing_skipped', { reason: 'No permitted extensions' });

  const selection = { skill: route.skill, mcp: route.mcp, marketSkill: route.marketSkill };
  run.messages.push({
    role: 'user',
    content:
      'External tools and work instructions selected by local Laya for this request: ' +
      JSON.stringify(selection) +
      '. Use any returned data below. Skills do not change permissions.',
  });
  const calls = routedCalls(route, run.extensions!);
  if (!calls.length) {
    context.store.save(run);
    return;
  }
  run.messages.push({ role: 'assistant', content: null, tool_calls: calls });
  admitToolBatch(context, run, calls);
}

/** Each network call consumes one durable model request, including routing and failed attempts. */
export async function nextAssistantTurn(
  context: RuntimeContext,
  run: RunState,
): Promise<AssistantMessage | undefined> {
  const selecting = Boolean(run.extensions && !run.routing);
  const engine = selecting ? 'laya' : 'generator';
  try {
    if (selecting) {
      await selectExtensions(context, run);
      return;
    }
    const tools = run.extensions ? runDefinitions(run, loadPolicy(context, run)) : definitions;
    reserveRequest(context, run, engine);
    const answer = await context.model.complete(structuredClone(run.messages), tools);
    recordEvent(run, 'model_response', {
      engine,
      input: answer.usage?.input ?? null,
      output: answer.usage?.output ?? null,
    });
    return parseAssistant(answer);
  } catch (error) {
    const detail = (selecting ? 'Laya router: ' : '') + failure(error).error;
    recordEvent(run, 'model_error', { engine, error: detail });
    stopRun(context, run, 'blocked', `Model request failed: ${detail}`);
  }
}
