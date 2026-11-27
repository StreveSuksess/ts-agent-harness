import type { AgentEvent } from './events.js';
import { statistics } from './stats.js';
export interface Finding {
  kind: string;
  run_id: string;
  event_ids: string[];
  count: number;
  interpretation: string;
  suggestion: string;
}
export function diagnose(events: AgentEvent[]): Finding[] {
  const findings: Finding[] = [];
  const runs = new Map<string, AgentEvent[]>();
  for (const event of events) {
    const rows = runs.get(event.run_id) ?? [];
    rows.push(event);
    runs.set(event.run_id, rows);
  }
  for (const [run_id, rows] of runs) {
    const repeated = new Map<string, AgentEvent[]>(),
      unchanged = new Map<string, AgentEvent[]>();
    const calls = new Map<string, AgentEvent>();
    for (const e of rows) {
      if (e.type === 'tool_call') calls.set(String(e.data.call_id), e);
      if (e.type !== 'tool_result') continue;
      const r = e.data.result as { ok?: boolean; error?: string; hash?: string };
      const c = calls.get(String(e.data.call_id));
      const args = c?.data.args as Record<string, unknown> | undefined;
      if (!r?.ok && r?.error) {
        const key = JSON.stringify([e.data.tool, args, r.error]);
        const list = repeated.get(key) ?? [];
        list.push(e);
        repeated.set(key, list);
      }
      if (r?.ok && e.data.tool === 'read_file' && r.hash && args?.path) {
        const key = JSON.stringify([args.path, r.hash]);
        const list = unchanged.get(key) ?? [];
        list.push(e);
        unchanged.set(key, list);
      }
    }
    for (const list of repeated.values())
      if (list.length >= 2)
        findings.push({
          kind: 'repeated_error',
          run_id,
          event_ids: list.map((e) => e.id),
          count: list.length,
          interpretation: 'Один инструмент с теми же аргументами несколько раз вернул одну ошибку.',
          suggestion:
            'После первого отказа уточните источник данных или разрешённые аргументы, затем смените действие.',
        });
    for (const list of unchanged.values())
      if (list.length >= 3)
        findings.push({
          kind: 'same_content',
          run_id,
          event_ids: list.map((e) => e.id),
          count: list.length,
          interpretation:
            'Один путь трижды или чаще читался с одинаковым хешем. Повтор мог быть нужен для проверки.',
          suggestion:
            'Сверьте цель повторных чтений. Для повторного анализа используйте сохранённое содержание и хеш.',
        });
    const failed = rows.filter(
      (e) =>
        e.type === 'status' &&
        e.data.status === 'failed' &&
        String(e.data.reason).includes('evidence'),
    );
    if (failed.length)
      findings.push({
        kind: 'missing_evidence',
        run_id,
        event_ids: failed.map((e) => e.id),
        count: failed.length,
        interpretation: 'Агент закончил ответ до подтверждения результата задачи.',
        suggestion:
          'В инструкции шага укажите проверяемый файл или команду и завершите задачу через complete_task.',
      });
  }
  return findings;
}
export function doctorReport(events: AgentEvent[]) {
  const ids = [...new Set(events.map((e) => e.run_id))];
  return {
    method: 'deterministic-v1',
    doctorUsage: { input: 0, output: 0 },
    limits:
      'Стоимость отдельного инструмента в токенах неизвестна. Совпадение результатов не доказывает бесполезность вызова.',
    stats: statistics(events),
    runs: ids.map((run_id) => ({
      run_id,
      stats: statistics(events.filter((e) => e.run_id === run_id)),
    })),
    findings: diagnose(events),
  };
}
