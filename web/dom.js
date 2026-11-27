// All operator and model strings enter text nodes. No result is interpreted as markup.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on:')) node.addEventListener(key.slice(3), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(
    ...children.flat(Infinity).filter((x) => x !== undefined && x !== null && x !== false),
  );
  return node;
}
export const text = (tag, value, cls) => el(tag, { class: cls }, String(value ?? '—'));
export const button = (label, click, cls = 'outline', disabled = false) =>
  el('button', { type: 'button', class: cls, disabled, 'on:click': click }, label);
export const short = (value) => String(value || '').slice(0, 8);
export const pretty = (value) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
export function details(title, content, id) {
  return el(
    'details',
    { 'data-detail': id },
    el('summary', {}, title),
    el('pre', {}, pretty(content) ?? '—'),
  );
}
export const number = (n) =>
  typeof n === 'number' && Number.isFinite(n)
    ? new Intl.NumberFormat('ru-RU').format(n)
    : 'Нет данных';
export const when = (s) => {
  const date = new Date(s);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
export const statusNames = {
  running: 'В работе',
  completed: 'Готово',
  failed: 'Ошибка',
  awaiting_plan: 'План на проверке',
  awaiting_action: 'Запрос разрешения',
  conflict: 'Конфликт',
  blocked: 'Остановлен',
  uncertain: 'Требует разбора',
  rolled_back: 'Отменён',
};
export function chip(label, tone = '') {
  return text('span', label, 'chip ' + tone);
}
export function group(title, ...children) {
  return el('article', { class: 'panel' }, text('h2', title), ...children);
}
export function row(title, desc, ...actions) {
  return el(
    'div',
    { class: 'row' },
    el('div', { class: 'row-text' }, text('strong', title), desc ? text('p', desc) : null),
    el('div', { class: 'row-actions' }, actions),
  );
}
export const empty = (value) => text('p', value, 'muted');
export const sectionTitle = (name, count) =>
  el('div', { class: 'subhead' }, text('h3', name), count !== undefined ? chip(count) : null);
