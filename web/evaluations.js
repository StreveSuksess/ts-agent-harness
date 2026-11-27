import { examplePicker } from './examples.js';
import { el, text, button, details, group, chip, short, empty, number, when } from './dom.js';

const variant = { A: 'Без скиллов', B: 'Со скиллами', old: 'Прежняя версия', new: 'Кандидат' };
const cases = {
  open: 'Открытые задачи',
  owners: 'По исполнителям',
  project: 'Имя проекта',
  'missing-owner': 'Не указан исполнитель',
  outage: 'Сбой MCP',
};

function table(heads, rows) {
  return el(
    'div',
    { class: 'table-scroll', role: 'region', 'aria-label': heads.join(', '), tabindex: 0 },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          heads.map((h) => el('th', { scope: 'col' }, h)),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((cells) =>
          el(
            'tr',
            {},
            cells.map((c) => el('td', {}, c ?? '—')),
          ),
        ),
      ),
    ),
  );
}

function comparison(report) {
  if (!report.overall?.length) return null;
  return el(
    'dl',
    { class: 'result-comparison', 'aria-label': 'Правильные ответы' },
    report.overall.map((g) =>
      el(
        'div',
        { class: 'result-variant' },
        el('dt', {}, variant[g.variant] ?? g.variant),
        el(
          'dd',
          {},
          el(
            'span',
            { class: 'result-ratio' },
            text('strong', g.outcomes),
            text('small', ' / ' + g.trials),
          ),
          el('meter', {
            min: 0,
            max: Math.max(1, g.trials),
            value: g.outcomes,
            'aria-label': 'Правильные ответы · ' + variant[g.variant],
          }),
        ),
      ),
    ),
  );
}

function drilldown(label, content, id) {
  return el(
    'details',
    { class: 'data-fold', 'data-detail': id },
    el('summary', {}, label),
    content,
  );
}

function suite(report, ctx) {
  const id = report.id ?? report.kind;
  const kind = report.kind ?? 'ab';
  const title = kind === 'update' ? 'Прежняя версия и кандидат' : 'Со скиллами и без них';
  const scenarios = (report.groups ?? []).map((g) => [
    cases[g.case_id] ?? g.case_id,
    variant[g.variant] ?? g.variant,
    `${g.outcomes}/${g.trials}`,
    g.routing_trials ? `${g.routing_passes}/${g.routing_trials}` : '—',
    `${number(g.input_tokens)} / ${number(g.output_tokens)}${g.complete_usage < g.trials ? ' *' : ''}`,
    number(g.mcp_calls),
    number(g.errors),
  ]);
  const attempts = (report.rows ?? []).map((r) => [
    cases[r.case_id] ?? r.case_id,
    variant[r.variant] ?? r.variant,
    r.trial,
    chip(r.outcome_pass ? 'Прошла' : 'Не прошла', r.outcome_pass ? 'success' : 'warn'),
    button(short(r.run_id), () => ctx.showEvents(kind, r.run_id), 'journal-link'),
    details('Метрики', r, r.run_id),
  ]);
  return el(
    'article',
    { class: 'panel report' },
    el(
      'header',
      { class: 'suite-title' },
      el(
        'div',
        {},
        text('h2', title),
        text('p', [report.source, report.status].filter(Boolean).join(' · '), 'suite-subtitle'),
      ),
      chip(`${report.completed ?? 0} / ${report.total ?? 30} попыток`),
    ),
    report.error ? text('p', report.error, 'reason') : null,
    report.overall?.length ? text('h3', 'Правильные ответы', 'metric-caption') : null,
    comparison(report),
    report.decision
      ? el(
          'div',
          { class: 'gate-decision' },
          chip(
            report.decision.accept ? 'Принято' : 'Отклонено',
            report.decision.accept ? 'success' : 'warn',
          ),
          text('span', report.decision.reason),
        )
      : null,
    scenarios.length
      ? drilldown(
          'Результаты по сценариям',
          [
            table(
              [
                'Сценарий',
                'Версия',
                'Успех',
                'Выбор скилла',
                'Токены вход / выход',
                'MCP',
                'Ошибки',
              ],
              scenarios,
            ),
            report.groups.some((g) => g.complete_usage < g.trials)
              ? empty('* Для части запросов модель не вернула расход токенов.')
              : null,
          ],
          id + '-groups',
        )
      : empty('Сводка появится после первых завершённых попыток.'),
    attempts.length
      ? drilldown(
          'Все попытки · ' + attempts.length,
          table(['Сценарий', 'Версия', 'Попытка', 'Проверка', 'Журнал', 'Метрики'], attempts),
          id + '-trials',
        )
      : null,
  );
}

export function evaluationsPage(state, ctx) {
  const reports = (state.evaluations ?? []).map((r) => r.summary ?? r);
  return [
    el(
      'div',
      { class: 'eval-actions' },
      text('p', '5 сценариев · 3 повтора на версию'),
      el(
        'div',
        { class: 'buttons' },
        state.market?.candidate
          ? button('Сравнить версии кандидата', () => ctx.action('market.evaluate'))
          : null,
        button('Запустить сравнение', () => ctx.action('eval.start', { kind: 'ab' }), 'primary'),
      ),
    ),
    reports.map((r) => suite(r, ctx)),
    !reports.length
      ? empty('Пока нет результатов. Запустите сравнение, чтобы получить первый отчёт.')
      : null,
    examplePicker(),
  ];
}

export function openTrial(runId, events, doctor) {
  const entries = new Map();
  const log = el(
    'div',
    { class: 'journal-list' },
    events.map((event) => {
      const item = el(
        'details',
        { 'data-detail': event.id },
        el(
          'summary',
          {},
          text('time', when(event.time)),
          text('b', event.type),
          text('code', short(event.id)),
        ),
        text('pre', JSON.stringify(event, null, 2)),
      );
      entries.set(event.id, item);
      return item;
    }),
  );
  function reveal(id) {
    const item = entries.get(id);
    if (!item) return;
    item.open = true;
    item.querySelector('summary').focus();
    item.scrollIntoView({ block: 'nearest' });
  }
  const dialog = el(
    'dialog',
    { class: 'event-modal', 'aria-label': 'События попытки' },
    el(
      'header',
      { class: 'modal-head' },
      el('div', {}, text('h2', 'События попытки'), text('code', runId)),
      button('Закрыть', () => dialog.close()),
    ),
    el(
      'div',
      { class: 'modal-scroll' },
      doctor
        ? group(
            'Доктор попытки',
            doctor.findings?.length
              ? doctor.findings.map((f) =>
                  el(
                    'section',
                    { class: 'finding-detail' },
                    text('strong', f.interpretation),
                    text('p', f.suggestion),
                    text('small', 'Событий в основании · ' + number(f.count)),
                    el(
                      'div',
                      { class: 'buttons' },
                      f.event_ids.map((id) =>
                        button('Событие ' + short(id), () => reveal(id), 'journal-link'),
                      ),
                    ),
                  ),
                )
              : empty('Подтверждённых находок нет.'),
            details('Расход доктора', doctor.doctorUsage, 'trial-doctor-usage'),
          )
        : null,
      text('h3', 'Журнал событий · ' + events.length),
      log,
    ),
  );
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
