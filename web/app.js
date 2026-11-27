import { button, empty, short } from './dom.js';
import { transcript, inspection } from './chat.js';
import { settingsPage } from './settings.js';
import { evaluationsPage, openTrial } from './evaluations.js';

const byId = (id) => document.getElementById(id);
let data = { sessions: [] },
  page = 'chat',
  tab = 'events',
  eventFilter = 'all',
  configTab = 'skills',
  selected = null,
  busy = false;
let latestRequest = 0,
  connected = false,
  inspectorOpen = true,
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
    byId('connection').textContent = 'Подключено';
    byId('light').className = 'online';
    render();
  } catch (error) {
    if (request !== latestRequest) return;
    connected = false;
    byId('connection').textContent = 'Нет связи · ' + error.message;
    byId('light').className = '';
    byId('send').disabled = true;
  }
}
async function action(name, input = {}, after) {
  if (busy) return;
  busy = true;
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
function draft(value) {
  byId('prompt').value = value;
  byId('prompt').focus();
}
function setSession(id) {
  selected = id;
  const dest = '#chat' + (id ? '/' + encodeURIComponent(id) : '');
  if (location.hash !== dest) location.hash = dest;
  else render();
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
  byId('issues').textContent = (data.errors ?? []).join(' · ');
  const titles = { chat: 'Диалог', settings: 'Расширения', evals: 'Оценка качества' };
  for (const name of Object.keys(titles)) byId(name + '-page').hidden = name !== page;
  for (const a of document.querySelectorAll('[data-page]'))
    a.setAttribute('aria-current', String(a.dataset.page === page));
  byId('crumb').textContent = titles[page];
  paint(
    'sessions',
    [selected, (data.sessions ?? []).map((s) => [s.id, s.title, s.runs?.length])],
    () => {
      if (!data.sessions?.length) return empty('Сохранённых сессий пока нет');
      return data.sessions.map((s) =>
        button(
          s.title ?? short(s.id),
          () => setSession(s.id),
          'session-link' + (s.id === selected ? ' active' : ''),
        ),
      );
    },
  );
  if (page === 'chat') {
    byId('title').textContent = 'Диалог';
    byId('title').title = session?.title ?? '';
    byId('session-id').textContent = session ? 'СЕССИЯ / ' + short(session.id) : 'НОВАЯ СЕССИЯ';
    byId('mode-hint').textContent = [data.router, data.model, data.settings?.mode ?? 'safe']
      .filter(Boolean)
      .join(' · ');
    const runs = session?.runs ?? [];
    const last = runs.at(-1);
    const waiting =
      last &&
      ['running', 'awaiting_plan', 'awaiting_action', 'uncertain', 'conflict', 'blocked'].includes(
        last.status,
      );
    byId('send').disabled = Boolean(busy || !connected || waiting);
    byId('prompt').placeholder = waiting
      ? 'Дождитесь ответа или примите решение выше.'
      : runs.length
        ? 'Продолжите диалог…'
        : 'Что поручить агенту?';
    paint('transcript', [selected, runs.map(({ events, ...turn }) => turn)], () =>
      transcript(session, ctx),
    );
    byId('inspector').hidden = !inspectorOpen;
    byId('inspect').setAttribute('aria-expanded', String(inspectorOpen));
    byId('chat-page').classList.toggle('inspect-hidden', !inspectorOpen);
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
  if (page === 'chat') selected = id ? decodeURIComponent(id) : null;
  render();
}
byId('new-session').onclick = () => {
  setSession(null);
  draft('');
};
byId('inspect').onclick = () => {
  inspectorOpen = !inspectorOpen;
  render();
};
byId('inspect-tabs').onclick = (e) => {
  if (e.target.dataset.inspect) {
    tab = e.target.dataset.inspect;
    render();
  }
};
byId('settings-tabs').onclick = (e) => {
  if (e.target.dataset.section) {
    configTab = e.target.dataset.section;
    render();
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
  const prompt = byId('prompt').value.trim();
  if (prompt && !byId('send').disabled)
    action('prompt', { ...(selected ? { sessionId: selected } : {}), prompt }, (result) => {
      byId('prompt').value = '';
      if (result.sessionId) setSession(result.sessionId);
    });
};
window.addEventListener('hashchange', route);
route();
async function poll() {
  await refresh();
  setTimeout(poll, document.hidden ? 4000 : 1000);
}
poll();
