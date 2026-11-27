import {
  el,
  text,
  button,
  details,
  group,
  row,
  chip,
  short,
  number,
  pretty,
  when,
  empty,
  statusNames,
  sectionTitle,
} from './dom.js';

function review(run, ctx) {
  const isPlan = run.status === 'awaiting_plan';
  if (!isPlan && run.status !== 'awaiting_action') return null;
  const pending = run.pending?.call ?? run.pending;
  const notes = el('input', {
    type: 'text',
    maxlength: 1000,
    placeholder: 'Что изменить в плане?',
    'aria-label': 'Комментарий к отклонению плана',
  });
  const decide = (decision) =>
    ctx.action('decision', {
      runId: run.id,
      sessionId: ctx.sessionId,
      revision: run.revision,
      decision,
      ...(isPlan && notes.value ? { feedback: notes.value } : {}),
    });
  const plan = run.plan ?? {};
  const args = pending?.function?.arguments;
  let callArgs;
  try {
    callArgs = JSON.parse(args);
  } catch {
    callArgs = args;
  }
  const body = isPlan
    ? [
        text('h3', plan.goal ?? 'Проверка плана'),
        el(
          'ol',
          { class: 'plan-steps' },
          (plan.steps ?? []).map((step) =>
            el(
              'li',
              {},
              text('strong', step.description),
              text('small', (step.tools ?? []).join(' · ')),
              details(
                'Критерий и зависимости',
                { id: step.id, verification: step.verification, depends_on: step.depends_on },
                step.id,
              ),
            ),
          ),
        ),
        text('p', plan.done_when, 'muted'),
        details(
          'Риски и допущения',
          { risks: plan.risks, assumptions: plan.assumptions },
          run.id + '-risks',
        ),
        notes,
      ]
    : [
        text('h3', pending?.function?.name ?? 'Запрошенная операция'),
        text('small', 'Рабочая папка · ' + (run.workspace ?? '').split(/[\\/]/u).at(-1)),
        el('pre', {}, pretty(callArgs) ?? '—'),
      ];
  return el(
    'section',
    { class: 'review' },
    text('div', isPlan ? 'СОГЛАСОВАНИЕ ПЛАНА' : 'РАЗРЕШЕНИЕ НА ДЕЙСТВИЕ', 'eyebrow'),
    body,
    el(
      'div',
      { class: 'buttons' },
      button(isPlan ? 'Принять план' : 'Разрешить', () => decide('allow'), 'primary'),
      button('Отклонить', () => decide('deny')),
    ),
  );
}
export function transcript(session, ctx) {
  if (!session?.runs?.length)
    return el(
      'div',
      { class: 'welcome' },
      el('div', { class: 'terminal-mark', 'aria-hidden': 'true' }, '›_'),
      text('h2', 'Новый диалог'),
      text('p', 'Поставьте задачу агенту. Здесь появятся его план и результат.'),
      el(
        'div',
        { class: 'suggestions' },
        ...[
          'Сохрани список открытых задач из трекера.',
          'Составь сводку задач по исполнителям.',
        ].map((s) => button(s + ' ↗', () => ctx.draft(s), 'suggest')),
      ),
    );
  return session.runs.map((run) =>
    el(
      'article',
      { class: 'turn' },
      el('div', { class: 'byline' }, text('b', 'Вы'), text('code', short(run.id))),
      text('div', run.prompt, 'bubble'),
      el(
        'div',
        { class: 'byline' },
        text('b', 'Агент'),
        chip(statusNames[run.status] ?? run.status, run.status === 'completed' ? 'success' : ''),
      ),
      run.final ? text('div', run.final, 'reply') : null,
      run.reason && !['awaiting_action', 'awaiting_plan'].includes(run.status)
        ? text('p', run.reason, 'reason')
        : null,
      run.status === 'running'
        ? empty('Выполняется запрос. Ход работы виден в журнале событий.')
        : null,
      ['blocked', 'conflict'].includes(run.status)
        ? button('Продолжить запуск', () => ctx.action('resume', { runId: run.id }))
        : null,
      review(run, ctx),
      run.tasks?.length
        ? el(
            'details',
            { 'data-detail': run.id + '-tasks' },
            el('summary', {}, 'Задачи · ' + run.tasks.length),
            el(
              'ul',
              {},
              run.tasks.map((t) =>
                text(
                  'li',
                  (t.status === 'completed' ? '✓ ' : t.status === 'running' ? '→ ' : '• ') +
                    t.description,
                ),
              ),
            ),
          )
        : null,
    ),
  );
}
function counts(title, map) {
  return el(
    'div',
    {},
    sectionTitle(title, Object.keys(map ?? {}).length),
    Object.entries(map ?? {}).map(([key, count]) => row(key, '', text('b', count))),
  );
}
function metrics(stats) {
  const usage = stats?.usage ?? {};
  return el(
    'div',
    {},
    sectionTitle('Токены'),
    el(
      'div',
      { class: 'metric-grid' },
      ...[
        ['Вход', usage.input],
        ['Выход', usage.output],
        ['Запросы', stats?.modelRequests],
      ].map(([label, val]) =>
        el('div', { class: 'metric' }, text('small', label), text('b', number(val))),
      ),
    ),
    usage.complete ? null : empty('Usage предоставлен не полностью.'),
    ...Object.entries(stats?.byModel ?? {}).map(([engine, u]) =>
      row(
        engine,
        'вход ' +
          number(u.input) +
          ' · выход ' +
          number(u.output) +
          (u.complete ? '' : ' · неполные данные'),
      ),
    ),
    counts('Инструменты', stats?.tools),
    counts('Скиллы', stats?.skills),
    counts('MCP', stats?.mcp),
  );
}
const eventLabels = {
  laya_route: 'Выбор Laya',
  skill_loaded: 'Загрузка скилла',
  catalog: 'Каталог расширений',
  catalog_error: 'Ошибка каталога',
  assistant_text: 'Ответ агента',
  user_request: 'Сообщение',
  model_error: 'Ошибка модели',
  status: 'Статус запуска',
  tool_call: 'Запрос инструмента',
  tool_result: 'Ответ инструмента',
  model_request: 'Запрос модели',
  model_response: 'Ответ модели',
  usage: 'Расход модели',
  error: 'Ошибка',
  decision: 'Решение оператора',
};
function timeline(runs, ctx) {
  const events = runs.flatMap((r) => r.events ?? []);
  if (!events.length) return empty('Пока нет событий.');
  const relevant = events.filter((e) => {
    const d = e.data ?? {};
    if (ctx.eventFilter === 'extensions')
      return (
        ['laya_route', 'catalog', 'catalog_error', 'skill_loaded'].includes(e.type) ||
        Boolean(d.server) ||
        /^(mcp_|load_skill$|market_)/u.test(d.tool ?? '')
      );
    if (ctx.eventFilter === 'errors')
      return e.type.includes('error') || d.result?.ok === false || d.choice === 'reject';
    return true;
  });
  const filter = el(
    'select',
    { 'aria-label': 'Показать события' },
    [
      ['all', 'Все события'],
      ['extensions', 'Laya, скиллы и MCP'],
      ['errors', 'Ошибки и отказы'],
    ].map(([v, label]) => el('option', { value: v }, label)),
  );
  filter.value = ctx.eventFilter;
  filter.onchange = () => ctx.filterEvents(filter.value);
  return el(
    'div',
    { class: 'timeline' },
    sectionTitle('Журнал событий', relevant.length),
    filter,
    !relevant.length ? empty('Таких событий пока нет.') : null,
    relevant
      .slice()
      .reverse()
      .map((event) => {
        const d = event.data ?? {};
        const target =
          event.type === 'laya_route'
            ? [
                d.model,
                d.skill && 'скилл ' + d.skill,
                d.marketSkill && 'маркет ' + d.marketSkill,
                d.mcp && 'MCP ' + d.mcp,
              ]
                .filter(Boolean)
                .join(' · ')
            : (d.name ?? d.tool ?? d.server ?? d.engine ?? d.model ?? d.status ?? '');
        return el(
          'details',
          { 'data-detail': event.id, class: 'event' },
          el(
            'summary',
            {},
            el(
              'span',
              { class: 'event-line' },
              text('b', eventLabels[event.type] ?? event.type),
              text('time', when(event.time)),
            ),
            text('small', typeof target === 'string' ? target : event.type),
          ),
          text('code', event.id),
          text('pre', pretty(d)),
        );
      }),
  );
}
export function inspection(session, tab, ctx) {
  if (!session) return empty('Отправьте запрос или откройте сохранённую сессию.');
  if (tab === 'stats') return metrics(session.stats);
  if (tab === 'doctor')
    return el(
      'div',
      {},
      button('Разобрать сессию', ctx.diagnose),
      ctx.doctor
        ? el(
            'div',
            {},
            text('p', ctx.doctor.limits, 'muted'),
            details('Расход доктора', ctx.doctor.doctorUsage, session.id + '-doctor'),
            ...(ctx.doctor.runs ?? []).map((r) =>
              details('Расход запуска ' + short(r.run_id), r.stats, r.run_id + '-stats'),
            ),
          )
        : null,
      sectionTitle('Находки', session.findings?.length ?? 0),
      (session.findings ?? []).map((f) =>
        group(
          {
            repeated_error: 'Повтор ошибки',
            same_content: 'Повторное чтение',
            missing_evidence: 'Результат без проверки',
          }[f.kind] ?? f.kind,
          text('p', f.interpretation),
          text('p', f.suggestion),
          el(
            'details',
            { 'data-detail': f.run_id + f.kind },
            el('summary', {}, 'Основания · ' + number(f.count)),
            text('p', 'Запуск ' + f.run_id, 'muted'),
            (f.event_ids ?? []).map((id) =>
              button('Событие ' + short(id), () => ctx.openEvent(id), 'text-button'),
            ),
          ),
        ),
      ),
      !session.findings?.length
        ? empty('Диагнозы появятся при наличии подтверждающих событий.')
        : null,
    );
  return timeline(session.runs ?? [], ctx);
}
