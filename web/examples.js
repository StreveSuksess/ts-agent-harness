import { el, text, button, details, group, short } from './dom.js';
import { transcript } from './chat.js';

function archiveContent(record) {
  const { session, doctor, events, artifacts } = record;
  return [
    text('p', 'Сессия ' + session.session_id, 'muted'),
    ...transcript({ runs: session.turns }, {}),
    group(
      'Файлы агента',
      Object.entries(artifacts).map(([name, content]) =>
        el('div', {}, text('b', name), text('pre', content)),
      ),
    ),
    details('Расход сессии', session.stats, 'archive-stats'),
    details('Отчёт доктора', doctor, 'archive-doctor'),
    el(
      'details',
      {},
      el('summary', {}, 'События · ' + events.length),
      events.map((e) => details(e.type + ' · ' + short(e.run_id), e, e.id)),
    ),
  ];
}

async function openExample(kind, label) {
  const content = el('div', {}, 'Загрузка…');
  const dialog = el(
    'dialog',
    { class: 'event-modal', 'aria-label': label },
    el(
      'div',
      { class: 'row' },
      text('h2', label),
      button('Закрыть', () => dialog.close()),
    ),
    content,
  );
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
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
    text('p', 'Два записанных диалога с файлами, событиями и отчётом доктора.'),
    el(
      'div',
      { class: 'buttons' },
      button('Запрос с указанием MCP', () => openExample('explicit', 'Запрос с указанием MCP')),
      button('Неоднозначный запрос', () => openExample('ambiguous', 'Неоднозначный запрос')),
    ),
  );
}
