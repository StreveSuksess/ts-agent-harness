import { el, text } from './dom.js';
import { icon } from './icons.js';

const id = (name) => document.getElementById(name);
const compact = window.matchMedia('(max-width: 760px)');
const examples = [
  [
    'list',
    'Показать открытые задачи',
    'Прочитай задачи из MCP-трекера. Сохрани идентификаторы открытых задач в файле open.json.',
  ],
  [
    'people',
    'Собрать сводку по исполнителям',
    'Прочитай задачи из MCP-трекера и сгруппируй их по исполнителям. Сохрани сводку в owners.md.',
  ],
  [
    'file',
    'Подготовить отчёт по трекеру',
    'Прочитай задачи из MCP-трекера. Составь короткий отчёт с открытыми и завершёнными задачами в report.md.',
  ],
];

export function fillExamples(draft) {
  const nodes = examples.map(([symbol, title, prompt]) =>
    el(
      'button',
      { type: 'button', class: 'prompt-example', 'on:click': () => draft(prompt) },
      el('span', { class: 'example-icon' }, icon(symbol)),
      text('span', title),
      icon('arrow-up-right'),
    ),
  );
  id('prompt-examples').replaceChildren(...nodes);
}

function dateGroup(raw) {
  if (!raw) return 'Ранее';
  const date = new Date(raw);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  if (date >= midnight) return 'Сегодня';
  midnight.setDate(midnight.getDate() - 1);
  return date >= midnight ? 'Вчера' : 'Ранее';
}
export function historyLinks(sessions, selected, open) {
  if (!sessions.length) return text('p', 'Здесь появятся ваши диалоги', 'no-history');
  const nodes = [];
  let group = '';
  for (const s of [...sessions].sort((a, b) =>
    String(b.runs?.at(-1)?.createdAt ?? b.createdAt).localeCompare(
      String(a.runs?.at(-1)?.createdAt ?? a.createdAt),
    ),
  )) {
    const previous = s.runs?.at(-1);
    const next = dateGroup(previous?.createdAt ?? s.createdAt);
    if (group !== next) {
      group = next;
      nodes.push(text('div', group, 'history-date'));
    }
    nodes.push(
      el(
        'button',
        {
          type: 'button',
          title: s.title,
          class: 'session-link',
          'aria-current': s.id === selected ? 'page' : undefined,
          'on:click': () => open(s.id),
        },
        icon('message'),
        text('span', s.title),
      ),
    );
  }
  return nodes;
}
export function modelName(raw = '') {
  const m = /qwen(\d+(?:\.\d+)?)[-: ](\d+(?:\.\d+)?)b/i.exec(raw);
  return m ? `Qwen${m[1]} · ${m[2]}B` : raw;
}
export function bindNavigation({ sessions, openSession }) {
  const main = id('main');
  document.querySelector('.skip-link').onclick = (event) => {
    event.preventDefault();
    main.focus();
  };
  const rail = id('rail'),
    shade = id('rail-backdrop'),
    opener = id('rail-open');
  let hiddenByUser = false,
    drawerOpen = false;
  function sync() {
    const visible = compact.matches ? drawerOpen : !hiddenByUser;
    document.body.classList.toggle('rail-hidden', !visible);
    rail.inert = !visible;
    main.inert = compact.matches && visible;
    shade.hidden = !(visible && compact.matches);
    opener.setAttribute('aria-expanded', String(visible));
  }
  function close(restore = false) {
    if (compact.matches) drawerOpen = false;
    else hiddenByUser = true;
    sync();
    if (restore) opener.focus();
  }
  function closeDrawer() {
    if (compact.matches) close();
  }
  opener.onclick = () => {
    hiddenByUser = false;
    drawerOpen = true;
    sync();
    rail.querySelector('.rail-close').focus();
  };
  rail.querySelector('.rail-close').onclick = () => close(true);
  shade.onclick = () => close(true);
  rail.addEventListener(
    'click',
    (e) => {
      if (compact.matches && e.target.closest('a,.session-link,#new-session')) {
        closeDrawer();
        main.focus();
      }
    },
    { capture: true },
  );
  compact.addEventListener('change', () => {
    drawerOpen = false;
    sync();
  });
  sync();

  const dialog = id('search-dialog'),
    field = id('search-input'),
    results = id('search-results');
  function populate() {
    const term = field.value.trim().toLocaleLowerCase('ru');
    const matches = sessions().filter((s) =>
      [s.title, ...s.runs.map((r) => r.prompt)].some((p) =>
        p?.toLocaleLowerCase('ru').includes(term),
      ),
    );
    results.replaceChildren(
      ...matches.map((s) =>
        el(
          'button',
          {
            type: 'button',
            class: 'found-session',
            'on:click': () => {
              dialog.close();
              closeDrawer();
              openSession(s.id);
              main.focus();
            },
          },
          icon('message'),
          text('span', s.title),
          icon('chevron-right'),
        ),
      ),
    );
    if (!matches.length)
      results.append(
        text(
          'p',
          term ? 'Диалогов с таким запросом нет.' : 'Сохранённых диалогов пока нет.',
          'no-history',
        ),
      );
  }
  function showSearch() {
    if (dialog.open) return;
    field.value = '';
    populate();
    dialog.showModal();
    field.focus();
  }
  field.oninput = populate;
  dialog.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = [field, ...results.querySelectorAll('button')];
      const next = Math.max(
        0,
        Math.min(
          list.length - 1,
          list.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1),
        ),
      );
      e.preventDefault();
      list[next].focus();
    } else if (e.key === 'Enter' && document.activeElement === field) {
      results.querySelector('button')?.click();
    }
  };
  id('search').onclick = showSearch;
  id('close-search').onclick = () => dialog.close();
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    }
  });
  if (!/Mac|iPhone|iPad/.test(navigator.platform)) id('search-key').textContent = 'Ctrl K';
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      dialog.open ? dialog.close() : showSearch();
      return;
    }
    if (compact.matches && drawerOpen && !dialog.open) {
      if (e.key === 'Escape') close(true);
      if (e.key === 'Tab') {
        const items = [...rail.querySelectorAll('a[href],button:not([disabled])')],
          idx = items.indexOf(document.activeElement);
        if (e.shiftKey && idx === 0) {
          e.preventDefault();
          items.at(-1)?.focus();
        }
        if (!e.shiftKey && idx === items.length - 1) {
          e.preventDefault();
          items[0]?.focus();
        }
      }
    }
  });
}
