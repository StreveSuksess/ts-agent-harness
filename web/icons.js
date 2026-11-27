const ns = 'http://www.w3.org/2000/svg';
const shapes = {
  brand: [
    'M2 8.1 12 2.4l10 5.7-10 5.8z',
    'M2 12.1l2.9-1.7 7.1 4.1 7.1-4.1 2.9 1.7-10 5.8z',
    'M2 16.2l2.9-1.7 7.1 4.1 7.1-4.1 2.9 1.7-10 5.7z',
  ],
  compose: [
    'M13 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-7',
    'm11 14 1-4 7.2-7.2a1.5 1.5 0 0 1 2.1 2.1L14 12.9z',
  ],
  search: ['M16 10.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 1 1 11 0', 'm15 15 5 5'],
  message: ['M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8L5 21v-3.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z'],
  layers: ['m3 8 9-5 9 5-9 5z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
  chart: ['M4 4v15a1 1 0 0 0 1 1h15', 'M8 15v-4m5 4V6m5 9v-6'],
  server: [
    'M5 4h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5 4Z',
    'M4 12h16M7 8h.4M7 16h.4',
  ],
  'panel-right': [
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    'M15 4v16',
  ],
  'panel-left': [
    'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z',
    'M9 4v16',
  ],
  folder: [
    'M3 7V5.5A1.5 1.5 0 0 1 4.5 4h5l2.5 3h7.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z',
  ],
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'arrow-up': ['M12 19V5m-6 6 6-6 6 6'],
  'arrow-up-right': ['M6 18 18 6M7 6h11v11'],
  sliders: ['M3 7h4m4 0h10M3 17h10m4 0h4M7 5v4m10 6v4'],
  terminal: ['m4 6 5 5-5 5m8 1h8'],
  lock: ['M6 10h12a1 1 0 0 1 1 1v9H5v-9a1 1 0 0 1 1-1Zm2 0V7a4 4 0 0 1 8 0v3'],
  shield: ['M12 3 4.5 6v5c0 4 3.1 7.3 7.5 10 4.4-2.7 7.5-6 7.5-10V6Z', 'm9 11.7 2.2 2.2 4-4.2'],
  list: ['M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1'],
  people: [
    'M15 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1',
    'M13 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    'M17 5a3 3 0 0 1 0 5.6M20 19v-1a4 4 0 0 0-3-3.9',
  ],
  file: ['M6 3h8l4 4v14H6Z', 'M14 3v5h4m-9 5h6m-6 3h4'],
  check: ['m4.5 12 5 5 10-10'],
  x: ['m6 6 12 12m0-12L6 18'],
  copy: ['M8 8h12v13H8z', 'M16 8V3H3v13h5'],
  alert: ['m12 3 9 17H3z', 'M12 9v4m0 3v.4'],
  activity: ['M2 12h5l3-8 4 16 3-8h5'],
  boxes: ['m3 7 5-3 5 3-5 3zM3 7v6l5 3 5-3V7M8 10v6m6-4 4-2 4 2-4 3-4-3v6l4 3 4-3v-6m-4 3v6'],
  'git-branch': [
    'M7 6v12m0-5c6 0 10-1 10-6',
    'M9 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0m0 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0M19 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  ],
  bot: ['M5 7h14v12H5zM12 3v4M9 12h.2m5.6 0h.2m-6 4h6'],
  sparkle: ['m12 3 2.6 6.4 6.4 2.6-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z'],
};
export function icon(name) {
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, val] of Object.entries({
    viewBox: '0 0 24 24',
    width: '20',
    height: '20',
    'aria-hidden': 'true',
    focusable: 'false',
    fill: name === 'brand' ? 'currentColor' : 'none',
    stroke: name === 'brand' ? 'none' : 'currentColor',
    'stroke-width': '1.65',
    'stroke-linejoin': 'round',
    'stroke-linecap': 'round',
    class: 'icon',
  }))
    svg.setAttribute(key, val);
  for (const path of shapes[name] ?? []) {
    const node = document.createElementNS(ns, 'path');
    node.setAttribute('d', path);
    svg.append(node);
  }
  return svg;
}
export function mountIcons(root = document) {
  for (const target of root.querySelectorAll('[data-icon]'))
    target.replaceChildren(icon(target.dataset.icon));
}
