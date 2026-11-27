import {
  el,
  text,
  button,
  details,
  group,
  row,
  short,
  number,
  pretty,
  when,
  empty,
  sectionTitle,
} from './dom.js';

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
    usage.complete ? null : empty('Часть данных о токенах недоступна.'),
    ...Object.entries(stats?.byModel ?? {}).map(([engine, u]) =>
      row(
        engine === 'laya' ? 'Laya' : engine === 'generator' ? 'Генератор' : engine,
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
          { 'data-detail': event.id, 'data-kind': event.type, class: 'event' },
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
