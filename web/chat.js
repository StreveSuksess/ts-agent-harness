import { button, el, short, statusNames, text } from './dom.js';
import { approval } from './approval.js';
import { icon } from './icons.js';

export { inspection } from './inspection.js';

function markedText(value) {
  return value.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/u).map((part) => {
    if (part.startsWith('`') && part.endsWith('`')) return text('code', part.slice(1, -1));
    if (part.startsWith('**') && part.endsWith('**')) return text('strong', part.slice(2, -2));
    return part;
  });
}

// Responses are untrusted. Render common Markdown constructs using text nodes only.
function answerBody(value) {
  const blocks = [];
  let code = null;
  for (const line of value.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      if (code === null) code = [];
      else {
        blocks.push(text('pre', code.join('\n'), 'answer-code'));
        code = null;
      }
    } else if (code !== null) code.push(line);
    else if (!line.trim()) blocks.push(el('div', { class: 'paragraph-gap' }));
    else if (/^#{1,6}\s/u.test(line))
      blocks.push(el('h3', {}, markedText(line.replace(/^#{1,6}\s+/u, ''))));
    else if (/^[-*]\s/u.test(line))
      blocks.push(el('div', { class: 'answer-bullet' }, markedText(line.slice(2))));
    else blocks.push(el('div', {}, markedText(line)));
  }
  if (code !== null) blocks.push(text('pre', code.join('\n'), 'answer-code'));
  return el('div', { class: 'reply' }, blocks);
}

const tools = {
  write_file: 'Запись файла',
  read_file: 'Чтение файла',
  list_files: 'Список файлов',
  delete_file: 'Удаление файла',
  Bash: 'Команда Bash',
  load_skill: 'Загрузка скилла',
  complete_task: 'Проверка результата',
  submit_plan: 'План работы',
  market_install: 'Установка скилла',
  market_search: 'Поиск в маркете',
};

function activityTitle(event) {
  const d = event.data;
  if (event.type === 'tool_call')
    return [tools[d.tool] ?? d.tool, d.args?.path ?? d.args?.name ?? d.args?.command];
  if (event.type === 'laya_route')
    return [
      'Выбор Laya',
      [d.skill ?? d.marketSkill, d.mcp].filter(Boolean).join(' · ') || 'Без скилла и MCP',
    ];
  if (event.type === 'decision')
    return ['Решение пользователя', d.choice === 'reject' ? 'Отклонено' : 'Разрешено'];
  return ['Ошибка', d.error ?? d.result?.error];
}

function journal(run, ctx) {
  const entries = (run.events ?? []).filter(
    (e) =>
      ['tool_call', 'decision', 'laya_route', 'model_error', 'catalog_error'].includes(e.type) ||
      (e.type === 'tool_result' && e.data.result?.ok === false),
  );
  if (!entries.length) return null;
  const start = Date.parse(run.createdAt),
    end = Date.parse(run.events.at(-1).time);
  const elapsed = run.final && end >= start ? Math.round((end - start) / 1000) : null;
  return el(
    'details',
    { class: 'turn-activity', 'data-detail': run.id + '-activity' },
    el(
      'summary',
      {},
      icon('activity'),
      text('span', 'Ход работы'),
      elapsed === null ? null : text('span', elapsed + ' с', 'activity-time'),
      icon('chevron-right'),
    ),
    el(
      'ol',
      { class: 'trace-steps' },
      entries.map((e) => {
        const [label, meta] = activityTitle(e);
        const body = [el('span', {}, text('span', label), meta ? text('small', meta) : null)];
        return el(
          'li',
          {},
          ctx.openEvent
            ? el(
                'button',
                {
                  type: 'button',
                  title: 'Открыть событие в инспекторе',
                  'on:click': () => ctx.openEvent(e.id),
                },
                ...body,
                icon('arrow-up-right'),
              )
            : el('span', {}, ...body),
        );
      }),
    ),
  );
}

function outputs(run, ctx) {
  const proposals = new Map();
  const files = new Map();
  for (const event of run.events ?? []) {
    const d = event.data;
    if (event.type === 'tool_call' && d.tool === 'write_file') proposals.set(d.call_id, d.args);
    const args = proposals.get(d.call_id);
    if (
      event.type === 'tool_result' &&
      d.result?.ok &&
      typeof args?.path === 'string' &&
      typeof args?.content === 'string'
    )
      files.set(args.path, { content: args.content, event });
  }
  return [...files].map(([path, { content, event }]) =>
    el(
      'details',
      { class: 'thread-file', 'data-detail': event.id + '-file' },
      el(
        'summary',
        {},
        icon('file'),
        el('span', {}, text('b', path), text('small', 'Записан в рабочую папку')),
        icon('chevron-down'),
      ),
      text('pre', content, 'answer-code'),
      ctx.openEvent
        ? button('Показать запись в журнале', () => ctx.openEvent(event.id), 'thread-link')
        : null,
    ),
  );
}

function copyReply(value) {
  if (!navigator.clipboard?.writeText) return null;
  const copy = el(
    'button',
    {
      type: 'button',
      class: 'copy-reply',
      title: 'Копировать ответ',
      'aria-label': 'Копировать ответ',
    },
    icon('copy'),
  );
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      copy.replaceChildren(icon('check'), text('span', 'Скопировано'));
    } catch {
      copy.replaceChildren(icon('copy'), text('span', 'Копирование недоступно'));
    }
  };
  return copy;
}

function taskList(run) {
  if (!run.tasks?.length) return null;
  const done = run.tasks.filter((t) => t.status === 'completed').length;
  return el(
    'details',
    { 'data-detail': run.id + '-tasks', class: 'turn-tasks' },
    el(
      'summary',
      {},
      icon('list'),
      text('span', 'Задачи'),
      text('span', done + ' / ' + run.tasks.length),
      icon('chevron-down'),
    ),
    el(
      'ul',
      {},
      run.tasks.map((t) =>
        el(
          'li',
          {},
          icon(t.status === 'completed' ? 'check' : 'chevron-right'),
          text('span', t.description),
        ),
      ),
    ),
  );
}

function turn(run, ctx) {
  const waiting = ['awaiting_action', 'awaiting_plan'].includes(run.status);
  const time =
    run.createdAt &&
    new Date(run.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return el(
    'article',
    { class: 'turn', 'aria-label': 'Запуск ' + short(run.id) },
    el(
      'div',
      { class: 'user-message' },
      el('span', { class: 'sr' }, 'Вы'),
      text('div', run.prompt, 'bubble'),
      time ? text('time', time) : null,
    ),
    el(
      'div',
      { class: 'agent-message' },
      el(
        'div',
        { class: 'agent-byline' },
        icon('brand'),
        text('b', 'Агент'),
        run.status === 'completed'
          ? null
          : text('span', statusNames[run.status] ?? run.status, 'run-state'),
      ),
      journal(run, ctx),
      run.final ? answerBody(run.final) : null,
      run.reason && !waiting ? text('p', run.reason, 'run-reason') : null,
      ['blocked', 'conflict'].includes(run.status) && ctx.action
        ? button(
            'Продолжить запуск',
            () => ctx.action('resume', { runId: run.id }),
            'thread-button',
          )
        : null,
      outputs(run, ctx),
      approval(run, ctx),
      el('div', { class: 'turn-footer' }, taskList(run), run.final ? copyReply(run.final) : null),
    ),
  );
}

export function transcript(session, ctx) {
  return (session?.runs ?? []).map((run) => turn(run, ctx));
}
