import { examplePicker } from './examples.js';
import { el, text, button, details, group, chip, short, empty, number, pretty } from './dom.js';
const variants = {
  A: 'A · без скиллов',
  B: 'B · со скиллами',
  old: 'Прежний скилл',
  new: 'Кандидат',
};
function table(headings, rows) {
  return el(
    'div',
    { class: 'table-scroll' },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          headings.map((x) => text('th', x)),
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
function suite(report, ctx) {
  const kind = report.kind ?? 'ab';
  return group(
    kind === 'update' ? 'Прежняя версия и кандидат' : 'Со скиллами и без них',
    el(
      'div',
      { class: 'row' },
      chip(
        (report.completed ?? 0) + ' / ' + (report.total ?? 30) + ' попыток',
        report.completed === report.total ? 'success' : '',
      ),
      text('small', [report.source, report.status].filter(Boolean).join(' · ')),
    ),
    report.error ? text('p', report.error, 'reason') : null,
    report.decision ? rowDecision(report.decision) : null,
    report.groups?.length
      ? table(
          ['Сценарий', 'Версия', 'Успех', 'Выбор скилла', 'Токены вход / выход', 'MCP', 'Ошибки'],
          report.groups.map((g) => [
            g.case_id,
            variants[g.variant] ?? g.variant,
            `${g.outcomes}/${g.trials}`,
            g.routing_trials ? `${g.routing_passes}/${g.routing_trials}` : '—',
            `${number(g.input_tokens)} / ${number(g.output_tokens)}${g.complete_usage < g.trials ? ' *' : ''}`,
            number(g.mcp_calls),
            typeof g.errors === 'object' ? pretty(g.errors) : number(g.errors),
          ]),
        )
      : empty('Сводка появится после первых завершённых попыток.'),
    report.groups?.some((g) => g.complete_usage < g.trials)
      ? empty('* Для части запросов API не вернул полный usage.')
      : null,
    report.rows?.length
      ? el(
          'details',
          { 'data-detail': (report.id ?? kind) + '-trials' },
          el('summary', {}, 'Все попытки · ' + report.rows.length),
          table(
            ['Сценарий', 'Версия', 'Попытка', 'Проверка', 'Run / журнал'],
            report.rows.map((r) => [
              r.case_id,
              r.variant,
              String(r.trial),
              chip(r.outcome_pass ? 'Прошла' : 'Не прошла', r.outcome_pass ? 'success' : 'warn'),
              el(
                'div',
                {},
                button(short(r.run_id), () => ctx.showEvents(kind, r.run_id), 'text-button'),
                details('Метрики', r, r.run_id),
              ),
            ]),
          ),
        )
      : null,
  );
}
function rowDecision(d) {
  return el(
    'p',
    {},
    chip(d.accept ? 'Принято' : 'Отклонено', d.accept ? 'success' : 'warn'),
    ' ' + (d.reason ?? ''),
  );
}
export function evaluationsPage(state, ctx) {
  const reports = (state.evaluations ?? []).map((v) => v.summary ?? v);
  return [
    el(
      'div',
      { class: 'experiment-intro' },
      el(
        'div',
        {},
        text('h2', 'Сравнение A/B'),
        text(
          'p',
          'Пять сценариев, по три независимые попытки для каждой версии агента. Результаты проверяются по файлам и событиям.',
        ),
      ),
      button('Запустить сравнение', () => ctx.action('eval.start', { kind: 'ab' }), 'primary'),
    ),
    examplePicker(),
    state.market?.candidate
      ? button('Сравнить версии кандидата', () => ctx.action('market.evaluate'))
      : null,
    reports.map((r) => suite(r, ctx)),
    !reports.length ? empty('Здесь будут результаты запущенных сравнений.') : null,
  ];
}

export function openTrial(runId, events, doctor) {
  const logEntries = new Map();
  const log = el(
    'div',
    {},
    events.map((event) => {
      const entry = details(event.type + ' · ' + short(event.id), event, event.id);
      logEntries.set(event.id, entry);
      return entry;
    }),
  );
  function reveal(id) {
    const item = logEntries.get(id);
    if (!item) return;
    item.open = true;
    item.querySelector('summary').focus();
    item.scrollIntoView({ block: 'nearest' });
  }
  const findings = doctor?.findings ?? [];
  const dialog = el(
    'dialog',
    { class: 'event-modal', 'aria-label': 'События попытки' },
    el(
      'div',
      { class: 'row' },
      text('h2', 'События попытки'),
      button('Закрыть', () => dialog.close()),
    ),
    text('code', runId),
    doctor
      ? group(
          'Доктор попытки',
          findings.length
            ? findings.map((item) =>
                el(
                  'section',
                  {},
                  chip('Событий в основании · ' + number(item.count)),
                  text('p', item.interpretation),
                  text('p', item.suggestion, 'muted'),
                  el(
                    'div',
                    { class: 'buttons' },
                    item.event_ids.map((id) =>
                      button('Событие ' + short(id), () => reveal(id), 'text-button'),
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
  );
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
