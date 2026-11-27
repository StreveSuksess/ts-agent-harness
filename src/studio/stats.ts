import type { AgentEvent } from './events.js';
export interface Usage {
  input: number | null;
  output: number | null;
  complete: boolean;
}
export interface SessionStats {
  usage: Usage;
  byModel: Record<string, Usage>;
  skills: Record<string, number>;
  tools: Record<string, number>;
  mcp: Record<string, number>;
  modelRequests: number;
  uniqueSkills: number;
  uniqueTools: number;
  errors: number;
}
function usage(events: AgentEvent[]): Usage {
  const responses = events.filter((e) => ['model_response', 'laya_route'].includes(e.type));
  const requests = events.filter((e) => e.type === 'model_request').length;
  function sum(key: string) {
    const values = responses
      .map((e) => e.data[key])
      .filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((n, v) => n + v, 0) : null;
  }
  return {
    input: sum('input'),
    output: sum('output'),
    complete:
      requests > 0 &&
      requests === responses.length &&
      responses.every((e) => typeof e.data.input === 'number' && typeof e.data.output === 'number'),
  };
}
export function statistics(events: AgentEvent[]): SessionStats {
  const skills: Record<string, number> = Object.create(null),
    tools: Record<string, number> = Object.create(null),
    mcp: Record<string, number> = Object.create(null);
  const engines = new Set<string>();
  const executed = new Set<string>();
  let errors = 0;
  for (const { type, data, run_id } of events) {
    if (data.engine) engines.add(String(data.engine));
    if (type === 'skill_loaded') {
      const name = String(data.name);
      skills[name] = (skills[name] ?? 0) + 1;
    }
    if (type === 'tool_call') {
      const name = String(data.tool);
      tools[name] = (tools[name] ?? 0) + 1;
    }
    if (type === 'tool_result') {
      const execution = JSON.stringify([run_id, data.call_id, data.attempts]);
      if (data.server && Number(data.attempts) > 0 && !executed.has(execution)) {
        executed.add(execution);
        const name = data.server + '/' + data.remoteTool;
        mcp[name] = (mcp[name] ?? 0) + 1;
      }
      if ((data.result as { ok?: boolean })?.ok === false) errors++;
    }
    if (type === 'model_error' || type === 'catalog_error') errors++;
  }
  return {
    usage: usage(events),
    byModel: Object.fromEntries(
      [...engines].map((e) => [e, usage(events.filter((v) => v.data.engine === e))]),
    ),
    modelRequests: events.filter((e) => e.type === 'model_request').length,
    skills,
    tools,
    mcp,
    uniqueSkills: Object.keys(skills).length,
    uniqueTools: Object.keys(tools).length,
    errors,
  };
}
