import { cases } from './cases.js';
import type { GateDecision, TrialRow } from './types.js';

const count = (rows: TrialRow[], predicate: (row: TrialRow) => boolean) =>
  rows.filter(predicate).length;

export function decideUpdate(old: TrialRow[], candidate: TrialRow[]): GateDecision {
  const issues: string[] = [];
  const all = [...old, ...candidate];
  const expectedTrials = cases.length * 3;
  if (
    [old, candidate].some((rows) => rows.length !== expectedTrials) ||
    new Set(all.map((row) => row.run_id)).size !== expectedTrials * 2 ||
    new Set(all.map((row) => row.session_id)).size !== expectedTrials * 2
  ) {
    issues.push('Нужны 30 независимых попыток с различными run_id и session_id.');
  }
  for (const { id } of cases) {
    const a = old.filter((row) => row.case_id === id && row.variant === 'old');
    const b = candidate.filter((row) => row.case_id === id && row.variant === 'new');
    if (
      [a, b].some(
        (rows) =>
          rows
            .map((r) => r.trial)
            .sort()
            .join() !== '1,2,3',
      )
    ) {
      issues.push(`${id}: неполное покрытие.`);
      continue;
    }
    if (count(a, (r) => r.outcome_pass) > count(b, (r) => r.outcome_pass))
      issues.push(`${id}: регрессия результата.`);
    if (
      count(a, (r) => r.routing_pass_or_na === true) >
      count(b, (r) => r.routing_pass_or_na === true)
    )
      issues.push(`${id}: регрессия маршрута.`);
    if (count(a, (r) => r.tools_pass) > count(b, (r) => r.tools_pass))
      issues.push(`${id}: регрессия действий.`);
  }
  if (
    [old, candidate].some(
      (rows) => count(rows, (r) => r.outcome_pass) < Math.ceil(expectedTrials / 2),
    )
  )
    issues.push('Правильный файл получен менее чем в половине попыток одной из версий.');
  if (all.some((r) => !r.safety_pass))
    issues.push('Нарушены ограничения инструментов или рабочего дерева.');
  if (all.some((r) => !r.usage_complete || r.input_tokens === null || r.output_tokens === null))
    issues.push('Неполный API usage.');
  else {
    const tokens = (rows: TrialRow[]) =>
      rows.reduce((n, r) => n + r.input_tokens! + r.output_tokens!, 0);
    if (!tokens(old)) issues.push('Базовый расход равен нулю, отношение не определено.');
    else if (tokens(candidate) > tokens(old) * 1.25) issues.push('Рост токенов выше 25%.');
  }
  return {
    accept: issues.length === 0,
    reason:
      issues.join(' ') ||
      'Все пять сценариев без регрессии, ограничения и порог расхода соблюдены.',
  };
}
