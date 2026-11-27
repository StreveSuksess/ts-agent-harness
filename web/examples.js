import { el, text, button, details, group, short, showTemporaryDialog } from './dom.js';
import { transcript } from './chat.js';

function archiveContent(record) {
  const { session, doctor, events, artifacts } = record;
  const runs = session.turns.map((turn) => ({
    ...turn,
    events: events.filter((e) => e.run_id === turn.id),
  }));
  return [
    text('code', session.session_id, 'archive-session-id'),
    el('div', { class: 'archive-thread' }, transcript({ runs }, { readOnly: true })),
    group(
      'Файлы агента',
      Object.entries(artifacts).map(([name, content]) =>
        el('div', { class: 'archive-file' }, text('strong', name), text('pre', content)),
      ),
    ),
    details('Расход сессии', session.stats, 'archive-stats'),
    details('Отчёт доктора', doctor, 'archive-doctor'),
    el(
      'details',
      { 'data-detail': 'archive-journal' },
      el('summary', {}, 'События · ' + events.length),
      events.map((e) => details(e.type + ' · ' + short(e.id), e, e.id)),
    ),
  ];
}

async function openExample(kind, label) {
  const content = el('div', { class: 'modal-scroll' }, 'Загрузка…');
  const dialog = el(
    'dialog',
    { class: 'event-modal', 'aria-label': label },
    el(
      'header',
      { class: 'modal-head' },
      text('h2', label),
      button('Закрыть', () => dialog.close()),
    ),
    content,
  );
  showTemporaryDialog(dialog);
  try {
    const response = await fetch('/api/examples/' + kind);
    if (!response.ok) throw new Error('Архив недоступен · HTTP ' + response.status);
    content.replaceChildren(...archiveContent(await response.json()));
  } catch (error) {
    content.textContent = error.message;
  }
}
export function examplePicker() {
  return el(
    'details',
    { 'data-detail': 'archive-examples', class: 'archive-examples' },
    el('summary', {}, 'Диалоги из материалов сдачи'),
    el(
      'div',
      { class: 'archive-links' },
      [
        ['explicit', 'Запрос с указанием MCP'],
        ['ambiguous', 'Неоднозначный запрос'],
      ].map(([kind, label]) => button(label, () => openExample(kind, label), 'archive-link')),
    ),
  );
}
