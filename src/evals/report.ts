import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cases } from './cases.js';
import { decideUpdate } from './gate.js';
import type { EvalSummary, Group, Kind, TrialRow, Variant } from './types.js';

export function atomicWrite(path: string, text: string): void {
  const tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((n, v) => n + v, 0);
export const variantsFor = (kind: Kind): Variant[] => (kind === 'ab' ? ['A', 'B'] : ['old', 'new']);

export function aggregateGroup(rows: TrialRow[], case_id: string, variant: Variant): Group {
  const totals = (field: 'input_tokens' | 'output_tokens') =>
    rows.some((r) => r[field] !== null) ? rows.reduce((n, r) => n + (r[field] ?? 0), 0) : null;
  return {
    case_id,
    variant,
    trials: rows.length,
    outcomes: rows.filter((r) => r.outcome_pass).length,
    routing_passes: rows.filter((r) => r.routing_pass_or_na === true).length,
    routing_trials: rows.filter((r) => r.routing_pass_or_na !== 'n/a').length,
    complete_usage: rows.filter((r) => r.usage_complete).length,
    input_tokens: totals('input_tokens'),
    output_tokens: totals('output_tokens'),
    tool_calls: rows.reduce((n, r) => n + sum(r.tools), 0),
    mcp_calls: rows.reduce((n, r) => n + sum(r.mcp_calls), 0),
    errors: rows.filter((r) => r.error).length,
  };
}

export function writeSummary(dir: string, kind: Kind, rows: TrialRow[]): EvalSummary {
  const groups = cases.flatMap((c) =>
    variantsFor(kind).map((v) =>
      aggregateGroup(
        rows.filter((r) => r.case_id === c.id && r.variant === v),
        c.id,
        v,
      ),
    ),
  );
  const overall = variantsFor(kind).map((v) =>
    aggregateGroup(
      rows.filter((r) => r.variant === v),
      'Всего',
      v,
    ),
  );
  const summary: EvalSummary = {
    kind,
    total: 30,
    completed: rows.length,
    groups,
    overall,
    rows: [...rows],
  };
  if (kind === 'update' && rows.length === 30)
    summary.decision = decideUpdate(
      rows.filter((r) => r.variant === 'old'),
      rows.filter((r) => r.variant === 'new'),
    );
  atomicWrite(join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  atomicWrite(
    join(dir, 'trials.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
  );
  const text = [
    `# ${kind === 'ab' ? 'Влияние поддержки скиллов' : 'Проверка кандидата обновления'}\n`,
    `Завершено попыток: ${rows.length} из 30.\n`,
    '| Сценарий | Версия | Правильные файлы | Верный выбор | Полный usage | Вход* | Выход* | Инструменты | MCP | Ошибки запуска |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...[...groups, ...overall].map(
      (g) =>
        `| ${g.case_id} | ${g.variant} | ${g.outcomes}/${g.trials} | ${g.routing_trials ? g.routing_passes + '/' + g.routing_trials : 'н/п'} | ${g.complete_usage}/${g.trials} | ${g.input_tokens ?? 'unknown'} | ${g.output_tokens ?? 'unknown'} | ${g.tool_calls} | ${g.mcp_calls} | ${g.errors} |`,
    ),
    '\n*Сумма только доступных значений API; полнота указана отдельно. Ошибки исполнения инструмента видны в строках trials.jsonl и событиях, включая ожидаемый отказ трекера.\n',
  ];
  for (const g of overall) {
    if (g.routing_trials)
      text.push(
        `Ошибки выбора скилла, ${g.variant}: ${g.routing_trials - g.routing_passes} из ${g.routing_trials}.\n`,
      );
  }
  if (summary.decision)
    text.push(
      '**Решение:** ' +
        (summary.decision.accept ? 'принять. ' : 'отклонить. ') +
        summary.decision.reason +
        '\n',
    );
  if (rows.length === 30 && kind === 'ab') {
    const diff = groups
      .filter((g) => ['open', 'owners'].includes(g.case_id))
      .reduce((n, g) => n + (g.variant === 'B' ? g.outcomes : -g.outcomes), 0);
    text.push(
      `На двух целевых сценариях разница B минус A составила ${diff} успешных попыток из шести. ${diff > 0 ? 'Наблюдение согласуется с гипотезой.' : 'Гипотеза об улучшении на этом наборе не подтвердилась.'} Три повтора на сценарий ограничивают обобщение.\n`,
    );
  }
  if (rows.length >= 2) {
    const [a, b] = rows;
    if (a && b) {
      text.push('## Первая парная попытка\n');
      for (const row of [a, b]) {
        const events = readFileSync(join(dir, row.events_path), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
        const actions = events
          .filter((e) => e.type === 'tool_call')
          .map((e) => e.data.tool ?? e.data.name);
        text.push(
          `- [${row.variant} · ${row.run_id}](${row.events_path}) — ${actions.join(' → ') || 'вызовов нет'}. Результат проверяющего скрипта: ${row.outcome_pass ? 'верный файл' : 'ошибка файла'}. Выбранные скиллы: ${Object.keys(row.skill_activations).join(', ') || 'нет'}.`,
        );
      }
      if (a.usage_complete && b.usage_complete) {
        const total = (r: TrialRow) => r.input_tokens! + r.output_tokens!;
        text.push(
          `\nОбщий расход API в этой паре: ${a.variant} — ${total(a)}, ${b.variant} — ${total(b)} токенов. Разница — ${total(b) - total(a)}. Показатель включает и маршрутизацию Laya, и генерацию ответа.`,
        );
      }
      text.push(
        `\n${a.outcome_pass === b.outcome_pass ? 'Различия в действиях этой пары не привели к различию по внешнему критерию.' : 'Две последовательности дали разный фактический результат.'} Число обращений и сообщения инструментов доступны по ссылкам.\n`,
      );
    }
  }
  text.push(
    '## Журналы попыток\n',
    ...rows.map(
      (r) =>
        `- [${r.case_id} · ${r.variant}${r.trial}](${r.events_path}) — ${r.status}, outcome=${r.outcome_pass}, маршрут=${r.routing_pass_or_na}`,
    ),
  );
  atomicWrite(join(dir, 'summary.md'), text.join('\n') + '\n');
  return summary;
}
