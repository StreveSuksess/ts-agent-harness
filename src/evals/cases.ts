import { isDeepStrictEqual } from 'node:util';

export interface EvalCase {
  id: string;
  prompt: string;
  local?: [file: string, fixture: string];
  tracker: string;
  skill: string | null;
  source: 'read_file' | 'mcp_tracker_list';
  check(value: unknown): boolean;
}

function exactIds(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string') &&
    isDeepStrictEqual([...value].sort(), ['T31', 'T84', 'T93'])
  );
}

export const cases: EvalCase[] = [
  {
    id: 'open',
    prompt:
      'Прочитай задачи из MCP-трекера. Сохрани в answer.json JSON-массив идентификаторов всех открытых задач. Порядок не важен.',
    tracker: 'tracker.json',
    skill: 'open-tasks',
    source: 'mcp_tracker_list',
    check: exactIds,
  },
  {
    id: 'owners',
    prompt:
      'Прочитай tasks.json и сохрани в answer.json JSON-объект: ключ — имя владельца, значение — число его задач во всех статусах.',
    local: ['tasks.json', 'owners.json'],
    tracker: 'tracker.json',
    skill: 'owner-summary',
    source: 'read_file',
    check: (value) => isDeepStrictEqual(value, { Lena: 2, Kai: 3 }),
  },
  {
    id: 'project',
    prompt:
      'Прочитай project.json и сохрани значение поля display_name в answer.json как одну JSON-строку.',
    local: ['project.json', 'project.json'],
    tracker: 'tracker.json',
    skill: null,
    source: 'read_file',
    check: (value) => value === 'Полярная сова',
  },
  {
    id: 'missing-owner',
    prompt:
      'Прочитай request.json. Нужно число задач одного владельца: если в заявке есть поле owner, возьми его имя, посчитай задачи в tasks.json и сохрани {"count":число} в answer.json. Если нужного поля нет, сохрани {"missing":"имя отсутствующего поля"} без догадок.',
    local: ['request.json', 'request.json'],
    tracker: 'tracker.json',
    skill: 'owner-summary',
    source: 'read_file',
    check: (value) => isDeepStrictEqual(value, { missing: 'owner' }),
  },
  {
    id: 'outage',
    prompt:
      'Получи открытые задачи из MCP-трекера. В answer.json сохрани {"available":true,"ids":[...]} при успехе. Если сервис вернул ошибку, сохрани только логический признак available со значением false.',
    tracker: 'unavailable.json',
    skill: 'open-tasks',
    source: 'mcp_tracker_list',
    check: (value) => isDeepStrictEqual(value, { available: false }),
  },
];
