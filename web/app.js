import { mountIcons } from './icons.js';
import { bindNavigation, fillExamples, historyLinks, modelName } from './workspace.js';
import { transcript, inspection } from './chat.js';
import { settingsPage } from './settings.js';
import { evaluationsPage, openTrial } from './evaluations.js';

const byId = (id) => document.getElementById(id);
function setText(id, value) {
  const node = byId(id);
  if (node.textContent !== value) node.textContent = value;
}
let data = { sessions: [] },
  page = 'chat',
  tab = 'events',
  eventFilter = 'all',
  configTab = 'skills',
  selected = null,
  busy = false;
let latestRequest = 0,
  connected = false,
  inspectorOpen = false,
  noticeTimer;
const cache = new Map();
const doctorReports = new Map();
function paint(id, key, render) {
  const signature = JSON.stringify(key);
  if (cache.get(id) === signature) return;
  cache.set(id, signature);
  const target = byId(id);
  const opened = new Set(
    Array.from(target.querySelectorAll('details[open]')).map((d) => d.dataset.detail),
  );
  const values = new Map(
    Array.from(target.querySelectorAll('input[type=text]')).map((n) => [
      n.getAttribute('aria-label'),
      n.value,
    ]),
  );
  const nearEnd = target.scrollTop + target.clientHeight >= target.scrollHeight - 60;
  const previousScroll = target.scrollTop;
  const content = render();
  target.replaceChildren(
    ...(Array.isArray(content) ? content.flat(Infinity) : [content]).filter(
      (n) => n !== null && n !== false && n !== undefined,
    ),
  );
  for (const d of target.querySelectorAll('details'))
    if (opened.has(d.dataset.detail)) d.open = true;
  for (const n of target.querySelectorAll('input[type=text]'))
    n.value = values.get(n.getAttribute('aria-label')) ?? '';
  target.scrollTop = id === 'transcript' && nearEnd ? target.scrollHeight : previousScroll;
}
function notify(message, error = false) {
  const box = byId('notice');
  box.hidden = false;
  box.className = error ? 'error' : '';
  box.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(
    () => {
      box.hidden = true;
    },
    error ? 8000 : 3500,
  );
}
async function refresh() {
  const request = ++latestRequest;
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const state = await res.json();
    if (request !== latestRequest) return;
    data = state;
    connected = true;
    setText('connection', 'Подключено');
    byId('light').className = 'online';
    render();
  } catch (error) {
    if (request !== latestRequest) return;
    connected = false;
    setText('connection', 'Нет связи · ' + error.message);
    byId('light').className = '';
    byId('send').disabled = true;
  }
}
async function action(name, input = {}, after) {
  if (busy) return;
  busy = true;
  byId('send').disabled = true;
  document.body.classList.add('busy');
  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: name, input }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'HTTP ' + response.status);
    after?.(result);
    if (name !== 'prompt' && name !== 'eval.events') notify('Действие выполнено');
    await refresh();
    return result;
  } catch (error) {
    notify(error.message, true);
    cache.clear();
    await refresh();
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    render();
  }
}
const drafts = new Map();
const pendingStatuses = new Set([
  'running',
  'awaiting_plan',
  'awaiting_action',
  'uncertain',
  'conflict',
  'blocked',
]);
function syncComposer(waiting) {
  const input = byId('prompt');
  byId('send').disabled = Boolean(busy || !connected || waiting || !input.value.trim());
}
function resizeComposer() {
  const input = byId('prompt');
  if (!input.clientWidth) return;
  input.style.height = 'auto';
  input.style.height = Math.min(180, Math.max(64, input.scrollHeight)) + 'px';
}
function changedPrompt() {
  const last = data.sessions?.find((s) => s.id === selected)?.runs?.at(-1);
  syncComposer(pendingStatuses.has(last?.status));
  resizeComposer();
}
function draft(value) {
  byId('prompt').value = value;
  changedPrompt();
  byId('prompt').focus();
}
function setSession(id) {
  const dest = '#chat' + (id ? '/' + encodeURIComponent(id) : '');
  if (location.hash !== dest) location.hash = dest;
  route();
}
function showEvents(kind, runId) {
  action('eval.events', { kind, runId }, ({ events, doctor }) => openTrial(runId, events, doctor));
}
function render() {
  const session = (data.sessions ?? []).find((s) => s.id === selected);
  const ctx = {
    action,
    draft,
    sessionId: session?.id,
    showEvents,
    openInspector(nextTab = 'events') {
      tab = nextTab;
      inspectorOpen = true;
      render();
      byId('inspect-close').focus();
    },
    eventFilter,
    filterEvents: (value) => {
      eventFilter = value;
      render();
    },
    openEvent: (id) => {
      tab = 'events';
      eventFilter = 'all';
      inspectorOpen = true;
      render();
      const item = byId('inspection').querySelector(
        'details[data-detail="' + CSS.escape(id) + '"]',
      );
      if (item) {
        item.open = true;
        item.querySelector('summary').focus();
        item.scrollIntoView({ block: 'nearest' });
      }
    },
    doctor: doctorReports.get(session?.id),
    diagnose: () =>
      action('doctor', { sessionId: session.id }, (result) => {
        doctorReports.set(session.id, result);
        render();
      }),
  };
  byId('issues').hidden = !data.errors?.length;
  setText('issues', (data.errors ?? []).join(' · '));
  const titles = { chat: 'Диалог', settings: 'Расширения', evals: 'Оценка качества' };
  for (const name of Object.keys(titles)) byId(name + '-page').hidden = name !== page;
  for (const a of document.querySelectorAll('[data-page]'))
    a.setAttribute('aria-current', String(a.dataset.page === page));
  setText('crumb', page === 'chat' ? (session?.title ?? 'Новый диалог') : titles[page]);
  byId('crumb').title = byId('crumb').textContent;
  byId('new-session').classList.toggle('current', page === 'chat' && !selected);
  paint(
    'sessions',
    [page, selected, (data.sessions ?? []).map((s) => [s.id, s.title, s.runs?.length])],
    () => historyLinks(data.sessions ?? [], page === 'chat' ? selected : null, setSession),
  );
  const inspectToggle = byId('inspect');
  inspectToggle.hidden = page !== 'chat' || !session;
  if (page === 'chat') {
    const runs = session?.runs ?? [];
    const last = runs.at(-1);
    const waiting = pendingStatuses.has(last?.status);
    const fresh = !runs.length;
    byId('chat-page').classList.toggle('fresh', fresh);
    byId('greeting').hidden = !fresh;
    byId('suggestions').hidden = !fresh;
    byId('transcript').hidden = fresh;
    setText('mode-hint', data.settings?.mode === 'auto' ? 'Автоматически' : 'С подтверждением');
    setText('model-name', modelName(data.model));
    byId('model-name').title = [data.model, data.router].filter(Boolean).join(' · ');
    syncComposer(waiting);
    byId('prompt').placeholder = waiting
      ? 'Дождитесь ответа или примите решение выше.'
      : runs.length
        ? 'Продолжите диалог…'
        : 'Поставьте задачу агенту…';
    paint(
      'transcript',
      [selected, runs.map(({ events, ...turn }) => [turn, events?.at(-1)?.id])],
      () => transcript(session, ctx),
    );
    byId('inspector').hidden = !inspectorOpen || fresh;
    byId('inspect').setAttribute('aria-expanded', String(inspectorOpen));
    byId('chat-page').classList.toggle('inspecting', inspectorOpen && !fresh);
    for (const b of document.querySelectorAll('[data-inspect]'))
      b.setAttribute('aria-pressed', String(b.dataset.inspect === tab));
    if (inspectorOpen)
      paint(
        'inspection',
        [
          selected,
          tab,
          eventFilter,
          tab === 'events'
            ? runs.map((r) => r.events)
            : tab === 'stats'
              ? session?.stats
              : [session?.findings, ctx.doctor],
        ],
        () => inspection(session, tab, ctx),
      );
  } else if (page === 'settings') {
    for (const b of document.querySelectorAll('[data-section]'))
      b.setAttribute('aria-pressed', String(b.dataset.section === configTab));
    paint('settings-panel', [configTab, data.skills, data.market, data.mcp, data.settings], () =>
      settingsPage(data, configTab, ctx),
    );
  } else
    paint('evaluations', [data.evaluations, data.market?.candidate], () =>
      evaluationsPage(data, ctx),
    );
}
function route() {
  const [section, id] = location.hash.slice(1).split('/');
  page = ['chat', 'settings', 'evals'].includes(section) ? section : 'chat';
  if (page === 'settings' && ['skills', 'mcp', 'market', 'mode'].includes(id)) configTab = id;
  if (page === 'chat') {
    let next = null;
    if (id) {
      try {
        next = decodeURIComponent(id);
      } catch {
        next = null;
      }
    }
    if (next !== selected) {
      drafts.set(selected, byId('prompt').value);
      selected = next;
      byId('prompt').value = drafts.get(selected) ?? '';
      doctorReports.delete(selected);
    }
  }
  render();
  if (page === 'chat') resizeComposer();
}
byId('new-session').onclick = () => {
  setSession(null);
  byId('prompt').focus();
};
byId('inspect').onclick = () => {
  inspectorOpen = !inspectorOpen;
  render();
  if (inspectorOpen) byId('inspect-close').focus();
};
byId('inspect-close').onclick = () => {
  inspectorOpen = false;
  render();
  byId('inspect').focus();
};
document.addEventListener('keydown', (e) => {
  if (
    e.key === 'Escape' &&
    page === 'chat' &&
    !byId('inspector').hidden &&
    !byId('main').inert &&
    !document.querySelector('dialog[open]')
  )
    byId('inspect-close').click();
});
byId('inspect-tabs').onclick = (e) => {
  if (e.target.dataset.inspect) {
    tab = e.target.dataset.inspect;
    render();
  }
};
byId('settings-tabs').onclick = (e) => {
  if (e.target.dataset.section) {
    location.hash = '#settings/' + e.target.dataset.section;
  }
};
byId('prompt').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
    e.preventDefault();
    if (!byId('send').disabled) byId('compose').requestSubmit();
  }
};
byId('compose').onsubmit = (e) => {
  e.preventDefault();
  const origin = selected;
  const original = byId('prompt').value;
  const prompt = original.trim();
  if (prompt && !byId('send').disabled)
    action('prompt', { ...(origin ? { sessionId: origin } : {}), prompt }, (result) => {
      if (selected !== origin) {
        if (drafts.get(origin) === original) drafts.delete(origin);
        return;
      }
      if (byId('prompt').value === original) byId('prompt').value = '';
      if (page === 'chat' && result.sessionId) setSession(result.sessionId);
    });
};
mountIcons();
bindNavigation({ sessions: () => data.sessions ?? [], openSession: setSession });
fillExamples(draft);
byId('prompt').addEventListener('input', changedPrompt);
window.addEventListener('resize', resizeComposer);
window.addEventListener('hashchange', route);
route();
async function poll() {
  await refresh();
  setTimeout(poll, document.hidden ? 4000 : 1000);
}
poll();
