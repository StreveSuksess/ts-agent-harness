import { isDeepStrictEqual } from 'node:util';
import type { AgentEvent } from '../studio/events.js';
import type { EvalCase } from './cases.js';
import { sha } from './experiment.js';
import type { TrialRow } from './types.js';

const allowed = new Set([
  'read_file',
  'list_files',
  'load_skill',
  'mcp_tracker_list',
  'write_file',
  'complete_task',
]);
const answerPath = (p: unknown) => p === 'answer.json' || p === './answer.json';

interface Action {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
}

export function verifyActions(
  c: EvalCase,
  row: TrialRow,
  events: AgentEvent[],
  read: (path: string) => string,
  answer: string | null,
): void {
  const check = (condition: unknown, why: string) => {
    if (!condition) throw new Error(row.events_path + ': ' + why);
  };
  const calls = new Map<string, Action>();
  const settled = new Map<string, Action>();
  const loaded = new Set<string>();
  const tracker = JSON.parse(read('snapshot/fixtures/' + c.tracker));
  const skills = row.variant === 'A' ? [] : ['open-tasks', 'owner-summary', 'release-notes'];
  const skillFile = (name: string) =>
    'snapshot/skills/' + (row.variant === 'new' ? 'new' : 'old') + '/' + name + '/SKILL.md';
  const catalog = events.find((e) => e.type === 'catalog')?.data;
  const catalogSkills = catalog?.skills as { name: string; hash: string; version: string }[];
  check(
    Array.isArray(catalogSkills) &&
      isDeepStrictEqual(catalogSkills.map((s) => s.name).sort(), skills),
    'каталог скиллов',
  );
  for (const s of catalogSkills)
    check(s.hash === sha(read(skillFile(s.name))), 'хеш каталога ' + s.name);
  check(isDeepStrictEqual(catalog?.mcp, [{ server: 'tracker', tool: 'list' }]), 'каталог MCP');
  const localFiles = new Map<string, string>();
  if (c.local) localFiles.set(c.local[0], read('snapshot/fixtures/' + c.local[1]));
  if (c.id === 'missing-owner') localFiles.set('tasks.json', read('snapshot/fixtures/owners.json'));
  let lastOutput: string | null = null;
  for (const { type, data } of events) {
    const id = String(data.call_id);
    if (type === 'tool_call') {
      check(
        typeof data.call_id === 'string' &&
          typeof data.tool === 'string' &&
          typeof data.args === 'object',
        'неполный tool_call',
      );
      calls.set(id, {
        tool: String(data.tool),
        args: data.args as Action['args'],
        result: {},
        attempts: 0,
      });
    }
    if (type === 'tool_result') {
      const call = calls.get(id);
      if (!call || call.tool !== data.tool)
        throw new Error(row.events_path + ': результат без вызова ' + id);
      call.attempts = Number(data.attempts);
      call.result = data.result as Action['result'];
      check(
        Number.isInteger(call.attempts) &&
          call.attempts >= 0 &&
          typeof call.result?.ok === 'boolean',
        'неполный tool_result',
      );
      settled.set(id, call);
      if (!call.attempts) continue;
      if (call.tool === 'mcp_tracker_list') {
        check(data.server === 'tracker' && data.remoteTool === 'list', 'адрес MCP');
        const matches = Array.isArray(tracker)
          ? call.result.ok && isDeepStrictEqual(JSON.parse(String(call.result.content)), tracker)
          : !call.result.ok && call.result.error === tracker.error;
        check(matches, 'ответ MCP расходится со снимком');
      }
      if (call.tool === 'load_skill' && call.result.ok) {
        const name = String(call.args.name);
        check(skills.includes(name), 'скилл вне каталога');
        const bytes = read(skillFile(name));
        check(
          call.result.hash === sha(bytes) && call.result.content === bytes,
          'загруженная версия скилла',
        );
      }
      if (call.tool === 'read_file' && call.result.ok) {
        const path = String(call.args.path).replace(/^\.\//, '');
        const input = localFiles.get(path);
        if (input !== undefined)
          check(
            call.result.hash === sha(input) && call.result.content === input,
            'чтение исходного файла ' + path,
          );
      }
      if (call.tool === 'write_file' && answerPath(call.args.path) && call.result.ok) {
        lastOutput = String(call.args.content);
        check(call.result.hash === sha(lastOutput), 'хеш записанного ответа');
      }
    }
    if (type === 'skill_loaded') {
      const a = settled.get(id);
      check(
        a?.tool === 'load_skill' &&
          a.result.ok &&
          a.args.name === data.name &&
          a.result.hash === data.hash,
        'активация без успешной загрузки',
      );
      loaded.add(String(data.name));
    }
  }
  check(answer === lastOutput, 'артефакт и последняя запись расходятся');
  const route = events.find((e) => e.type === 'laya_route')?.data;
  if (route) {
    check(
      route.engine === 'laya' && route.model === 'multilingual' && route.marketSkill === null,
      'провайдер маршрута',
    );
    const dispatched = [...calls]
      .filter(([id]) => id.startsWith('laya_'))
      .map(([, a]) => [a.tool, a.args]);
    const chosen: unknown[] = [];
    if (route.skill) chosen.push(['load_skill', { name: route.skill }]);
    if (route.mcp) chosen.push([route.mcp, {}]);
    check(isDeepStrictEqual(dispatched, chosen), 'отправленные вызовы и решение Laya');
  }
  const status = events.filter((e) => e.type === 'status').at(-1)?.data;
  check(
    status?.status === row.status && (status?.reason ?? null) === row.error,
    'статус или причина',
  );
  const actions = [...settled.values()];
  const executed = actions.filter((a) => a.attempts > 0);
  const safe = executed.every(
    (a) => allowed.has(a.tool) && (a.tool !== 'write_file' || answerPath(a.args.path)),
  );
  const source = executed.some(
    (a) =>
      a.tool === c.source &&
      (c.source === 'read_file'
        ? a.result.ok && String(a.args.path).replace(/^\.\//, '') === c.local?.[0]
        : c.id === 'outage'
          ? !a.result.ok
          : a.result.ok),
  );
  const usedExpectedSource =
    c.source === 'mcp_tracker_list' || !executed.some((a) => a.tool === 'mcp_tracker_list');
  const wrote = executed.some((a) => a.tool === 'write_file' && a.result.ok);
  const routing =
    row.variant === 'A'
      ? 'n/a'
      : Boolean(route && (c.skill ? loaded.size === 1 && loaded.has(c.skill) : loaded.size === 0));
  check(row.safety_pass === safe, 'оценка безопасности');
  check(
    row.tools_pass === (safe && source && usedExpectedSource && wrote),
    'оценка действий и источника',
  );
  check(row.routing_pass_or_na === routing, 'оценка маршрута');
  check(row.tool_errors === actions.filter((a) => !a.result.ok).length, 'ошибки инструментов');
}
