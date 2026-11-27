import { cliCommand } from './paths.js';
import type { Plan, RunState, RunStatus, ToolCall, Verification } from '../types.js';
import { dbOption, indented, oneLine, quotedArgument, terminalText } from './terminal-text.js';

const statuses: Record<RunStatus, string> = {
  running: 'В работе',
  awaiting_plan: 'План ждёт решения',
  awaiting_action: 'Действие ждёт разрешения',
  uncertain: 'Исход операции неизвестен',
  blocked: 'Запуск заблокирован',
  conflict: 'Конфликт файлов',
  completed: 'Завершён',
  failed: 'Завершён с ошибкой',
  rolled_back: 'Изменения отменены',
};

export function statusLabel(status: RunStatus): string {
  return statuses[status];
}

export function formatTasks(run: RunState): string {
  if (!run.tasks.length) return 'Задачи появятся после принятия плана.';
  const marks = { completed: 'x', running: '>', pending: ' ' };
  return run.tasks
    .map((task) => `[${marks[task.status]}] ${oneLine(task.id)}  ${oneLine(task.description)}`)
    .join('\n');
}

function verificationText(check: Verification): string {
  switch (check.kind) {
    case 'bash':
      return `${oneLine(check.command)} → exit ${check.exitCode}`;
    case 'tool':
      return `успешный вызов ${oneLine(check.tool)}`;
    case 'file_changed':
      return `изменение ${oneLine(check.path)}`;
  }
}

function planReview(plan: Plan): string {
  const lines = [`План   ${oneLine(plan.goal)}`];
  for (const [index, step] of plan.steps.entries()) {
    const deps = step.depends_on.length
      ? ` · после ${step.depends_on.map(oneLine).join(', ')}`
      : '';
    lines.push(
      `  ${index + 1}. ${oneLine(step.description)}  [${oneLine(step.id)}]${deps}`,
      `     ${step.tools.map(oneLine).join(', ')} · проверка — ${verificationText(step.verification)}`,
    );
  }
  if (plan.risks.length) lines.push('Риски        ' + plan.risks.map(oneLine).join(' · '));
  if (plan.assumptions.length)
    lines.push('Допущения    ' + plan.assumptions.map(oneLine).join(' · '));
  lines.push('Готово, когда ' + oneLine(plan.done_when));
  return lines.join('\n');
}

function actionReview(call: ToolCall): string {
  const lines = [`Запрошено разрешение на ${oneLine(call.function.name)}`];
  const args = JSON.parse(call.function.arguments) as Record<string, string>;
  for (const [key, value] of Object.entries(args)) {
    if (key === 'content') {
      lines.push(`Новое содержимое целиком (${Buffer.byteLength(value)} Б)`);
      // When controls are present, JSON escaping makes the exact content inspectable.
      const text = terminalText(value) === value ? value : quotedArgument(value);
      lines.push(indented(text));
    } else {
      lines.push(`  ${oneLine(key)} = ${quotedArgument(value)}`);
    }
  }
  return lines.join('\n');
}

export function formatReview(run: RunState): string {
  if (run.status === 'awaiting_plan' && run.plan) return planReview(run.plan);
  if (run.status === 'awaiting_action' && run.pending[0]) {
    return `Рабочая папка   ${oneLine(run.workspace)}\n${actionReview(run.pending[0].call)}`;
  }
  return '';
}

function lastToolError(run: RunState): string | undefined {
  for (let i = run.messages.length - 1; i >= 0; i--) {
    const message = run.messages[i]!;
    if (message.role !== 'tool' || !message.content) continue;
    try {
      const result = JSON.parse(message.content);
      if (result?.ok === false && typeof result.error === 'string') return oneLine(result.error);
    } catch {
      // Old runs may contain plain-text responses.
    }
  }
}

function commandHint(run: RunState, db: string | undefined): string | undefined {
  const id = oneLine(run.id);
  const cmd = (name: string) => `${cliCommand} ${name} ${id}${dbOption(db)}`;
  switch (run.status) {
    case 'awaiting_plan':
    case 'awaiting_action':
      return 'Продолжить в терминале   ' + cmd('resume');
    case 'uncertain':
      return run.rollbackStarted
        ? 'Проверьте изменения перед завершением отката.\n  ' +
            cmd('diff') +
            '\n  ' +
            cmd('resolve-rollback')
        : 'Проверьте изменения и выберите решение для команды resolve.\n  ' + cmd('diff');
    case 'blocked':
      if (run.reason?.startsWith('Budget exhausted')) {
        return 'Лимит исчерпан. Для продолжения создайте новый запуск с подходящим бюджетом.';
      }
      return 'После устранения причины   ' + cmd('resume');
    case 'conflict':
      return 'Проверьте файлы рабочей папки перед продолжением.\n  ' + cmd('diff');
    case 'failed':
      return 'Посмотреть ход запуска   ' + cmd('trace');
  }
}

export function formatRun(run: RunState, db?: string): string {
  const phase = run.phase === 'plan' ? 'планирование' : 'исполнение';
  const lines = [
    `${statusLabel(run.status)}  ·  ${phase}  ·  ${run.mode}`,
    'Запрос   ' + oneLine(run.prompt),
    'Папка    ' + oneLine(run.workspace),
    'ID       ' + oneLine(run.id),
  ];
  if (run.reason && run.status !== 'awaiting_action') {
    const reason =
      run.reason === 'Model ended without approved plan/completed task evidence'
        ? run.phase === 'plan'
          ? 'Модель закончила ответ до согласования плана.'
          : 'Модель закончила ответ, пока в плане остались задачи без подтверждения.'
        : oneLine(run.reason);
    lines.push('', 'Причина  ' + reason);
    if (run.status === 'failed') {
      const error = lastToolError(run);
      if (error) lines.push('Последняя ошибка инструмента  ' + error);
    }
  }
  if (run.tasks.length) lines.push('', formatTasks(run));
  const review = formatReview(run);
  if (review) lines.push('', review);
  if (run.final) lines.push('', 'Ответ модели', indented(run.final));
  const { spent, limits } = run;
  lines.push(
    '',
    `Запросы ${spent.modelRequests}/${limits.modelRequests}  ·  вызовы ${spent.toolCalls}/${limits.toolCalls}  ·  действия ${spent.sideEffects}/${limits.sideEffects}  ·  вывод ${spent.resultBytes}/${limits.resultBytes} Б`,
  );
  const hint = commandHint(run, db);
  if (hint) lines.push(hint);
  return lines.join('\n');
}
