/**
 * icons.js — inline icons (no external files or CDN: works offline).
 * All icons use a 24x24 viewBox and stroke=currentColor to inherit the section colour.
 */

const wrap = (body, { size = 24, fill = 'none', sw = 1.6 } = {}) =>
  `<svg class="icn" viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" ` +
  `stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  sun: (o) => wrap(`<circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.4M12 19.4v2.4M4.6 12H2.2M21.8 12h-2.4M6.4 6.4 4.7 4.7M19.3 19.3l-1.7-1.7M17.6 6.4l1.7-1.7M4.7 19.3l1.7-1.7"/>`, o),

  battery: (o) => wrap(`<rect x="2.5" y="7" width="16" height="10" rx="2.6"/><path d="M21.5 10.5v3"/><path d="M10.8 9.6 8.4 13h3.2l-.8 2.4 3-3.6h-3.1z" fill="currentColor" stroke="none"/>`, o),

  house: (o) => wrap(`<path d="M3.5 10.6 12 3.6l8.5 7v9a1.4 1.4 0 0 1-1.4 1.4H4.9a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M9.4 21V14h5.2v7"/>`, o),

  grid: (o) => wrap(`<path d="M6.5 21 8.6 3.2M17.5 21 15.4 3.2"/><path d="M8.2 3.2h7.6"/><path d="M7.9 8.2h8.2M7.4 13.2h9.2"/><path d="M9.2 8.2 15 13.2M14.8 8.2 9 13.2"/><path d="M3.5 21h17"/>`, o),

  inverter: (o) => wrap(`<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="3"/><path d="M6.2 12.4c1.3-3.6 2.6-3.6 3.9 0s2.6 3.6 3.9 0 2.6-3.6 3.9 0"/>`, o),

  bolt: (o) => wrap(`<path d="M13.4 2.6 5.2 13.4h5.1l-1.7 8 8.2-10.8h-5.1z"/>`, o),

  gear: (o) => wrap(`<circle cx="12" cy="12" r="3.1"/><path d="M19.6 14.6a1.5 1.5 0 0 0 .3 1.65l.06.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.17a1.8 1.8 0 1 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06A1.8 1.8 0 1 1 4 16.4l.06-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H2.8a1.8 1.8 0 1 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65L3.9 7.5A1.8 1.8 0 1 1 6.45 4.95l.06.06a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V3.8a1.8 1.8 0 1 1 3.6 0v.09a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06A1.8 1.8 0 1 1 19.9 7.45l-.06.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.17a1.8 1.8 0 1 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.9z"/>`, o),

  menu: (o) => wrap(`<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/>`, o),

  close: (o) => wrap(`<path d="M6 6l12 12M18 6 6 18"/>`, o),

  refresh: (o) => wrap(`<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.8 4.4v4.4h-4.4"/>`, o),

  chart: (o) => wrap(`<path d="M3.5 20.5h17"/><path d="M4 15.5l4.5-5 3.6 3.2 3.4-5.4 3 3.4"/>`, o),

  thermometer: (o) => wrap(`<path d="M14 14.8V4.7a2 2 0 1 0-4 0v10.1a4 4 0 1 0 4 0z"/><path d="M12 9.5v6.7"/>`, o),

  clock: (o) => wrap(`<circle cx="12" cy="12" r="8.6"/><path d="M12 7.4V12l3.2 2"/>`, o),

  search: (o) => wrap(`<circle cx="10.8" cy="10.8" r="6.4"/><path d="M15.6 15.6 20.5 20.5"/>`, o),

  check: (o) => wrap(`<path d="M4.5 12.6 9.2 17.2 19.5 7"/>`, o),

  warning: (o) => wrap(`<path d="M10.7 3.9 2.6 18a1.5 1.5 0 0 0 1.3 2.2h16.2a1.5 1.5 0 0 0 1.3-2.2L13.3 3.9a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9v4.4M12 17.1h.01"/>`, o),

  wave: (o) => wrap(`<path d="M2.5 12c1.6-5 3.2-5 4.8 0s3.2 5 4.8 0 3.2-5 4.8 0 2.2 3.4 2.6 1.6"/>`, o),

  plug: (o) => wrap(`<path d="M9 2.5v5M15 2.5v5"/><path d="M5.5 7.5h13v3a6.5 6.5 0 0 1-13 0z"/><path d="M12 17v4.5"/>`, o),

  download: (o) => wrap(`<path d="M12 3.5v11.5"/><path d="M7.6 10.6 12 15l4.4-4.4"/><path d="M4 19.5h16"/>`, o),

  eye: (o) => wrap(`<path d="M2.2 12S5.6 5.6 12 5.6 21.8 12 21.8 12 18.4 18.4 12 18.4 2.2 12 2.2 12z"/><circle cx="12" cy="12" r="3"/>`, o),
};

export function icon(name, opts) {
  const f = ICONS[name];
  return f ? f(opts) : '';
}
