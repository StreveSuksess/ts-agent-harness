import { oneLine, terminalText } from '../cli/terminal-text.js';
import type { RunState } from '../types.js';
import { doctorReport } from './doctor.js';
import { statistics, type SessionStats, type Usage } from './stats.js';

function usageText(usage: Usage) {
  const number = (v: number | null) => (v === null ? 'неизвестно' : v.toLocaleString('ru-RU'));
  const partial =
    usage.complete || (usage.input === null && usage.output === null) ? '' : ' (частичные данные)';
  return `вход ${number(usage.input)} · выход ${number(usage.output)}${partial}`;
}

function counts(entries: Record<string, number>) {
  return (
    Object.entries(entries)
      .map(([name, n]) => `${oneLine(name)} × ${n}`)
      .join(', ') || '—'
  );
}

function activity(stats: SessionStats) {
  return [
    `Запросы к моделям  ${stats.modelRequests}   Ошибки  ${stats.errors}`,
    `Инструменты (${stats.uniqueTools})   ${counts(stats.tools)}`,
    `Скиллы (${stats.uniqueSkills})       ${counts(stats.skills)}`,
    'Выполнено через MCP   ' + counts(stats.mcp),
  ];
}

export function formatStatistics(runs: RunState[]): string {
  if (!runs.length) return 'В этой сессии ещё нет запусков.';
  const stats = statistics(runs.flatMap((r) => r.events ?? []));
  const lines = ['Сессия   ' + runs[0]!.sessionId, 'Токены   ' + usageText(stats.usage)];
  for (const [model, u] of Object.entries(stats.byModel))
    lines.push(`  ${model === 'laya' ? 'Laya' : 'Генератор'}   ${usageText(u)}`);
  lines.push(...activity(stats));
  for (const run of runs) {
    const one = statistics(run.events ?? []);
    lines.push(
      '',
      oneLine(run.id) + '   ' + oneLine(run.prompt),
      'Токены   ' + usageText(one.usage),
      ...activity(one),
    );
  }
  return lines.join('\n');
}

export function formatDoctor(report: ReturnType<typeof doctorReport>) {
  const lines = ['Диагностика сохранённых запусков'];
  if (!report.findings.length)
    lines.push(
      'Правила доктора не нашли повторяющихся ошибок, чтений или пропущенного подтверждения.',
    );
  for (const finding of report.findings) {
    lines.push(
      '',
      terminalText(finding.interpretation),
      `Запуск ${finding.run_id} · наблюдений ${finding.count}`,
      'События   ' + finding.event_ids.join(', '),
      terminalText(finding.suggestion),
    );
  }
  return [...lines, '', report.limits, 'Расход доктора   0 токенов'].join('\n');
}
