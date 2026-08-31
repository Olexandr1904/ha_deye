/** utils.js — formatting, DOM/SVG helpers, chart maths. */

import { UNIT_FACTORS, CANONICAL_UNITS } from './config.js?v=1.2.0';
import { t, localeTag } from './i18n.js?v=1.2.0';

/* ───────────────────────────── logging ───────────────────────────── */

let DEBUG = false;
export function setDebug(v) { DEBUG = !!v; }
export function log(...args) { if (DEBUG) console.log('%c[DEYE]', 'color:#ffb43a;font-weight:600', ...args); }
export function warn(...args) { console.warn('[DEYE]', ...args); }
export function error(...args) { console.error('[DEYE]', ...args); }

/* ───────────────────────────── numbers ───────────────────────────── */

export const DASH = '—';

export function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

export function round(v, digits = 2) {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

function group(str) {
  // 1234.5 -> 1 234.5 (thin non-breaking space as the thousands separator)
  const [i, f] = String(str).split('.');
  const sign = i.startsWith('-') ? '-' : '';
  const digits = sign ? i.slice(1) : i;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return sign + grouped + (f ? '.' + f : '');
}

export function formatNumber(v, digits = 1) {
  if (!isNum(v)) return DASH;
  const fixed = v.toFixed(digits);
  // -0.02 rounded to one decimal gives "-0.0"; the minus sign only confuses.
  return group(/^-0(\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed);
}

/**
 * Power: the input is always kW (the canonical unit).
 * Returns {value, unit} — strings ready for the UI.
 */
export function formatPower(kw, { signed = false, forceKw = false } = {}) {
  if (!isNum(kw)) return { value: DASH, unit: '' };
  const a = Math.abs(kw);
  const sign = signed && kw > 0 ? '+' : '';
  if (!forceKw && a < 1) {
    const w = Math.round(kw * 1000);
    if (w === 0) return { value: '0', unit: t('unit.W') };
    return { value: sign + group(w), unit: t('unit.W') };
  }
  const digits = a < 10 ? 2 : a < 100 ? 1 : 0;
  return { value: sign + group(kw.toFixed(digits)), unit: t('unit.kW') };
}

/** Energy: the input is kWh. */
export function formatEnergy(kwh, { signed = false } = {}) {
  if (!isNum(kwh)) return { value: DASH, unit: '' };
  const a = Math.abs(kwh);
  const sign = signed && kwh > 0 ? '+' : '';
  if (a >= 1000) return { value: sign + group((kwh / 1000).toFixed(2)), unit: t('unit.MWh') };
  const digits = a < 10 ? 2 : a < 100 ? 1 : 1;
  return { value: sign + group(kwh.toFixed(digits)), unit: t('unit.kWh') };
}

/** Generic formatter driven by the role kind. */
export function formatByKind(kind, value, opts = {}) {
  switch (kind) {
    case 'power': return formatPower(value, opts);
    case 'energy': return formatEnergy(value, opts);
    case 'percent': return { value: isNum(value) ? formatNumber(value, value % 1 === 0 ? 0 : 1) : DASH, unit: '%' };
    case 'voltage': return { value: formatNumber(value, Math.abs(value) >= 100 ? 0 : 1), unit: t('unit.V') };
    case 'current': return { value: formatNumber(value, 1), unit: t('unit.A') };
    case 'temperature': return { value: formatNumber(value, 1), unit: t('unit.C') };
    case 'frequency': return { value: formatNumber(value, 2), unit: t('unit.Hz') };
    case 'text': return { value: value == null || value === '' ? DASH : String(value), unit: '' };
    default: return { value: formatNumber(value, 1), unit: '' };
  }
}

/* ────────────────────────── unit normalization ───────────────────── */

/**
 * Converts a raw Home Assistant value to the canonical unit for this kind.
 * @returns {{value:number|null, unit:string, assumed:boolean}}
 */
export function normalizeValue(kind, rawState, rawUnit) {
  if (kind === 'text') {
    return { value: rawState == null ? null : String(rawState), unit: '', assumed: false };
  }
  const num = typeof rawState === 'number' ? rawState : parseFloat(String(rawState).replace(',', '.'));
  if (!Number.isFinite(num)) return { value: null, unit: CANONICAL_UNITS[kind] || '', assumed: false };

  const canonical = CANONICAL_UNITS[kind] || '';
  const unit = (rawUnit || '').trim();

  if (kind === 'temperature') {
    if (/^°?\s*f$/i.test(unit)) return { value: (num - 32) * (5 / 9), unit: '°C', assumed: false };
    if (/^k$/i.test(unit)) return { value: num - 273.15, unit: '°C', assumed: false };
    return { value: num, unit: '°C', assumed: !unit };
  }

  const table = UNIT_FACTORS[kind] || {};
  const key = unit.toLowerCase().replace(/\s+/g, '');
  if (key && table[key] !== undefined) {
    return { value: num * table[key], unit: canonical, assumed: false };
  }

  // Unit missing or unknown — careful heuristics.
  if (kind === 'power') {
    // 7840 is clearly watts; 7.84 is clearly kilowatts
    const factor = Math.abs(num) > 50 ? 0.001 : 1;
    return { value: num * factor, unit: canonical, assumed: true };
  }
  if (kind === 'energy') {
    const factor = Math.abs(num) > 5000 ? 0.001 : 1;
    return { value: num * factor, unit: canonical, assumed: true };
  }
  return { value: num, unit: canonical || unit, assumed: !!unit };
}

/**
 * Two counters that should agree on the same energy, one of which may be dead.
 *
 * Deye firmwares differ: on some, "battery charged today" never leaves zero
 * while the lifetime counter increments correctly. When they disagree the larger
 * one is the real number — a broken register reads zero, it does not invent
 * energy — so this prefers the daily counter and falls back to the lifetime one.
 */
export function preferMovedCounter(daily, total) {
  const d = isNum(daily) ? daily : null;
  const t = isNum(total) ? total : null;
  if (d === null) return t;
  if (t === null) return d;
  return t > d ? t : d;
}

/* ───────────────────────────── time ───────────────────────────── */

export function fmtClock(date = new Date(), withSeconds = true) {
  try {
    return new Intl.DateTimeFormat(localeTag(), {
      hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false,
    }).format(date);
  } catch (e) {
    return date.toISOString().slice(11, withSeconds ? 19 : 16);
  }
}

export function fmtDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

export function fmtDayShort(date) {
  try {
    return new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short' }).format(date);
  } catch (e) {
    return date.toISOString().slice(5, 10);
  }
}

export function fmtMonthShort(date) {
  try {
    return new Intl.DateTimeFormat(localeTag(), { month: 'short' }).format(date);
  } catch (e) {
    return date.toISOString().slice(5, 7);
  }
}

export function fmtAgo(date) {
  if (!date) return DASH;
  const secs = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (secs < 60) return t('time.agoSec', { v: secs });
  if (secs < 3600) return t('time.agoMin', { v: Math.floor(secs / 60) });
  if (secs < 86400) return t('time.agoHour', { v: Math.floor(secs / 3600) });
  return t('time.agoDay', { v: Math.floor(secs / 86400) });
}

/** Duration in hours -> "2 h 05 min". */
export function fmtHours(hours) {
  if (!isNum(hours) || hours <= 0) return DASH;
  if (hours >= 48) return t('time.days', { v: Math.round(hours / 24) });
  const hh = Math.floor(hours);
  const mm = Math.round((hours - hh) * 60);
  return hh ? t('time.hoursMinutes', { h: hh, m: String(mm).padStart(2, '0') }) : t('time.minutes', { m: mm });
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfDaysAgo(days) {
  const d = startOfToday();
  d.setDate(d.getDate() - days + 1);
  return d;
}

/* ───────────────────────────── DOM ───────────────────────────── */

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs, true);
  append(node, children);
  return node;
}

function applyAttrs(node, attrs, isSvg = false) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (!isSvg && k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
}

function append(node, children) {
  for (const c of children.flat(4)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Updates textContent only when the value actually changed. */
export function setText(node, value) {
  if (!node) return false;
  const str = value === null || value === undefined ? DASH : String(value);
  if (node.textContent !== str) { node.textContent = str; return true; }
  return false;
}

export function setAttr(node, name, value) {
  if (!node) return;
  if (value === null || value === undefined || value === false) node.removeAttribute(name);
  else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value === true ? '' : value);
}

export function toggleClass(node, name, on) {
  if (node) node.classList.toggle(name, !!on);
}

export function setStyleVar(node, name, value) {
  if (node && node.style.getPropertyValue(name) !== String(value)) node.style.setProperty(name, value);
}

/* ───────────────────────── scheduling ───────────────────────── */

const nextFrame = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (cb) => setTimeout(cb, 16);

/** Coalesces several calls into a single animation frame. */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    nextFrame(() => { queued = false; fn(...lastArgs); });
  };
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ───────────────────────── chart math ───────────────────────── */

/** "Nice" axis ticks. */
export function niceTicks(min, max, count = 5) {
  if (!isNum(min) || !isNum(max)) return { ticks: [0, 1], min: 0, max: 1 };
  if (min === max) { min = Math.min(0, min); max = max === 0 ? 1 : max * 1.2; }
  // A constant negative series would otherwise leave max === min and divide by zero.
  if (max <= min) max = min + Math.max(1, Math.abs(min) * 0.2);
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) ticks.push(round(v, 10));
  return { ticks, min: niceMin, max: niceMax, step };
}

/**
 * Smooth path through points (monotone cubic interpolation, Fritsch–Carlson).
 * points: [[x, y], ...] already in screen coordinates.
 */
export function monotonePath(points) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0][0]},${points[0][1]}`;
  if (n === 2) return `M${points[0][0]},${points[0][1]}L${points[1][0]},${points[1][1]}`;

  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1][0] - points[i][0];
    dy[i] = points[i + 1][1] - points[i][1];
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  t[n - 1] = m[n - 2];

  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/** Data decimation (Largest-Triangle-Three-Buckets). */
export function downsample(data, threshold) {
  const n = data.length;
  if (threshold >= n || threshold <= 2) return data;
  const sampled = [data[0]];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0, avgY = 0, cnt = 0;
    for (let j = rangeStart; j < rangeEnd; j++) { avgX += data[j][0]; avgY += data[j][1]; cnt++; }
    if (cnt) { avgX /= cnt; avgY /= cnt; }
    const bucketStart = Math.floor(i * every) + 1;
    const bucketEnd = Math.floor((i + 1) * every) + 1;
    let maxArea = -1, maxIdx = bucketStart;
    for (let j = bucketStart; j < Math.min(bucketEnd, n); j++) {
      const area = Math.abs((data[a][0] - avgX) * (data[j][1] - data[a][1]) - (data[a][0] - data[j][0]) * (avgY - data[a][1]));
      if (area > maxArea) { maxArea = area; maxIdx = j; }
    }
    sampled.push(data[maxIdx]);
    a = maxIdx;
  }
  sampled.push(data[n - 1]);
  return sampled;
}

/* ───────────────────────── misc ───────────────────────── */

export function copyToClipboard(text) {
  try {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
  } catch (e) { /* ignore */ }
  return Promise.reject(new Error('clipboard unavailable'));
}
