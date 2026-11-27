import { cliCommand, defaultDatabase } from './paths.js';
import type { RunSummary, Store } from '../store.js';
import { statusLabel } from './presentation.js';
import { dbOption, oneLine } from './terminal-text.js';

export function selectRunId(store: Store, input?: string): string {
  const db = dbOption(store.file === defaultDatabase ? undefined : store.file);
  const listCommand = `${cliCommand} runs${db}`;

  if (input === undefined) {
    const latest = store.listRuns(1)[0];

    if (!latest) {
      throw new Error(
        `В этой базе пока нет запусков. Начните задачу командой ${cliCommand} run${db}`,
      );
    }

    return latest.id;
  }

  const prefix = input.trim();

  if (!prefix || prefix === 'RUN_ID') {
    throw new Error('Укажите ID запуска или его начало из списка ' + listCommand);
  }

  const [first, second] = store.matchingRunIds(prefix);

  if (!first) {
    throw new Error(`Запуск «${oneLine(prefix)}» не найден. Посмотрите ID в ${listCommand}`);
  }

  if (first !== prefix && second) {
    throw new Error(
      `С «${oneLine(prefix)}» начинаются несколько ID. Уточните ID по ${listCommand}`,
    );
  }

  return first;
}

const localDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function formatHistory(runs: RunSummary[]): string {
  if (!runs.length) {
    return `История пуста. Начните первый запуск командой ${cliCommand}`;
  }

  const prefixes = new Set<string>();
  const collisions = new Set<string>();

  for (const { id } of runs) {
    const prefix = id.slice(0, 8);
    if (prefixes.has(prefix)) collisions.add(prefix);
    prefixes.add(prefix);
  }

  const lines = ['Запуски · сначала новые', ''];
  for (const run of runs) {
    const prefix = run.id.slice(0, 8);
    const id = collisions.has(prefix) ? run.id : prefix;
    const prompt = Array.from(oneLine(run.prompt));
    const preview = prompt.length > 72 ? prompt.slice(0, 71).join('') + '…' : prompt.join('');
    const date = localDate.format(new Date(run.createdAt));
    lines.push(`${oneLine(id)}  ${date}  ${statusLabel(run.status)}`, `  ${preview}`);
  }

  return lines.join('\n');
}
