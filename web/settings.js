import { el, text, button, details, group, row, chip, short, pretty, when, empty } from './dom.js';

function toggle(label, value, apply) {
  const input = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': label,
    checked: Boolean(value),
  });
  input.addEventListener('change', () => apply(input.checked));
  return el('label', { class: 'switch' }, input, el('span', { 'aria-hidden': 'true' }));
}
function select(label, choices, value, apply) {
  const node = el(
    'select',
    { 'aria-label': label },
    choices.map(([key, title]) => el('option', { value: key }, title)),
  );
  node.value = value ?? choices[0][0];
  node.addEventListener('change', () => apply(node.value));
  return node;
}
function installed(state, ctx) {
  const list = state.skills ?? [];
  return group(
    'Установленные скиллы',
    !list.length ? empty('Каталог скиллов пуст. Откройте маркет для установки.') : null,
    list.map((skill) => {
      const enabled = skill.enabled ?? !(state.settings?.disabledSkills ?? []).includes(skill.name);
      return el(
        'div',
        { class: 'item' },
        row(
          skill.name,
          skill.description,
          chip(skill.version ?? 'локальный'),
          toggle('Включить ' + skill.name, enabled, (value) =>
            ctx.action('skill.toggle', { name: skill.name, enabled: value }),
          ),
        ),
        details(
          'Источник и ревизия',
          { source: skill.source, version: skill.version, hash: skill.hash },
          skill.name,
        ),
      );
    }),
  );
}
function servers(state, ctx) {
  return group(
    'MCP-серверы',
    empty(
      'Подключайте серверы из доверенной конфигурации. Схемы инструментов поступают от сервера.',
    ),
    (state.mcp ?? []).map((s) =>
      el(
        'div',
        { class: 'item' },
        row(
          s.name,
          s.error ?? (s.enabled ? 'Подключён к агенту' : 'Отключён'),
          chip((s.tools?.length ?? 0) + ' инстр.'),
          s.enabled
            ? button('Отключить', () => ctx.action('mcp.toggle', { name: s.name, enabled: false }))
            : button('Подключить', () => ctx.action('mcp.connect', { name: s.name }), 'primary'),
        ),
        s.enabled
          ? button(
              'Обновить инструменты',
              () => ctx.action('mcp.connect', { name: s.name }),
              'text-button',
            )
          : null,
        (s.tools ?? []).map((t) =>
          details(typeof t === 'string' ? t : t.name, t, s.name + (t.name ?? t)),
        ),
      ),
    ),
    !state.mcp?.length ? empty('В конфигурации нет доступных серверов.') : null,
  );
}
function searchSkills(available, ctx) {
  if (!available.length) return empty('Новых скиллов в текущем каталоге нет.');
  const suggestions = el('div');
  const search = el('input', {
    type: 'search',
    placeholder: 'Название или описание',
    'aria-label': 'Поиск скилла в маркете',
  });
  function apply() {
    const q = search.value.trim().toLocaleLowerCase();
    const matches = available.filter((s) =>
      (s.name + ' ' + s.description).toLocaleLowerCase().includes(q),
    );
    suggestions.replaceChildren(
      ...matches.map((s) =>
        row(
          s.name,
          s.description,
          chip(s.version),
          button('Установить', () => ctx.action('skill.install', { name: s.name }), 'primary'),
        ),
      ),
    );
    if (!matches.length) suggestions.append(empty('По этому запросу скиллы не найдены.'));
  }
  search.addEventListener('input', apply);
  apply();
  return el('div', {}, search, suggestions);
}
function marketPanel(state, ctx) {
  const m = state.market ?? {};
  const prefs = m.settings ?? state.settings ?? {};
  const configure = (updates) => ctx.action('settings', updates);
  const installedNames = new Set(
    [...(state.skills ?? []), ...(m.installed ?? [])].map((s) => s.name),
  );
  const available = (m.available ?? []).filter((s) => !installedNames.has(s.name));
  return [
    group(
      'Источник маркета',
      row(
        'Версия каталога',
        'Выбор снимка демонстрационного источника',
        select(
          'Версия каталога',
          [
            ['v1', 'Каталог v1'],
            ['v2', 'Каталог v2'],
          ],
          prefs.source,
          (v) => configure({ source: v }),
        ),
      ),
      row(
        'Проверка при запуске',
        'Проверять сведения о скиллах автоматически',
        toggle('Проверять маркет', prefs.check, (v) => configure({ check: v })),
      ),
      row(
        'Автообновление',
        'Проверять кандидата через eval перед применением',
        toggle('Автообновление', prefs.autoUpdate, (v) => configure({ autoUpdate: v })),
      ),
      button('Проверить сейчас', () => ctx.action('market.check')),
    ),
    group('Доступны для установки', searchSkills(available, ctx)),
    group(
      'Проверка обновления',
      m.candidate
        ? row(
            m.candidate.name,
            `${short(m.candidate.oldHash)} → ${short(m.candidate.newHash)}`,
            button('Проверить кандидата', () => ctx.action('market.evaluate'), 'primary'),
          )
        : empty('Кандидат обновления отсутствует.'),
      m.lastDecision
        ? el(
            'div',
            {},
            chip(m.lastDecision.accept ? 'Обновление принято' : 'Обновление отклонено'),
            text('p', m.lastDecision.reason),
            text('small', m.lastDecision.report),
          )
        : null,
      m.canRollback
        ? button('Откатить принятое обновление', () => ctx.action('market.rollback'))
        : null,
    ),
    group(
      'Журнал маркета',
      m.events?.length
        ? [...m.events]
            .reverse()
            .map((e, i) =>
              details(
                [when(e.time), e.type ?? e.kind ?? e.action, e.name].filter(Boolean).join(' · ') ||
                  'Событие',
                e,
                e.id ?? String(i),
              ),
            )
        : empty('Проверок ещё не было.'),
    ),
  ];
}
export function settingsPage(state, tab, ctx) {
  if (tab === 'mcp') return servers(state, ctx);
  if (tab === 'market') return marketPanel(state, ctx);
  if (tab === 'mode')
    return group(
      'Параметры новых запросов',
      row(
        'Режим',
        'Safe запрашивает разрешение перед изменением файлов и запуском Bash.',
        select(
          'Режим агента',
          [
            ['safe', 'Safe · с подтверждением'],
            ['auto', 'Auto · по policy'],
          ],
          state.settings?.mode,
          (v) => ctx.action('settings', { mode: v }),
        ),
      ),
      row(
        'Предварительный план',
        'Показывать план перед началом работы',
        toggle('Требовать план', state.settings?.plan !== false, (v) =>
          ctx.action('settings', { plan: v }),
        ),
      ),
    );
  return installed(state, ctx);
}
