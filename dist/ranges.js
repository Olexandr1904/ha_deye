/**
 * ranges.js — calendar period arithmetic for the chart and the sensor dialog.
 *
 * Pure functions, no DOM, no Home Assistant: everything here is unit-testable
 * in plain node. A "view" is the whole time selection:
 *
 *   { range: 'day' | 'week' | 'month' | 'year' | 'custom',
 *     anchor: Date,                 // local midnight identifying the period
 *     customFrom: Date, customTo: Date }   // used when range === 'custom'
 *
 * Two conventions that are deliberate rather than accidental:
 *   - weeks start on Monday, always, with no locale-dependent variation;
 *   - `to` is exclusive and clamped to "now" when the period contains it, so a
 *     chart of today does not reserve empty space for hours that have not
 *     happened yet.
 */

import { localeTag } from './i18n.js?v=1.2.0';

export const RANGE_KEYS = ['day', 'week', 'month', 'year', 'custom'];

const DAY_MS = 86400000;

/* ─────────────────────────── date helpers ─────────────────────────── */

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7;        // Monday = 0
  x.setDate(x.getDate() - dow);
  return x;
}

export function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function startOfYear(d) {
  const x = startOfMonth(d);
  x.setMonth(0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addMonths(d, n) {
  // Anchored to the 1st so a 31st never overflows into the next month.
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

export function sameDay(a, b) {
  return a && b && startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** ISO yyyy-mm-dd in local time, for <input type="date">. */
export function toDateInput(d) {
  const x = startOfDay(d);
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${x.getFullYear()}-${m}-${day}`;
}

/** Parses yyyy-mm-dd as a local date (not UTC, which would shift the day). */
export function fromDateInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ─────────────────────────── aggregation step ─────────────────────────── */

/**
 * Which resolution to ask Home Assistant for.
 *   'power' — instantaneous states from the history API (line chart)
 *   'day' / 'month' — long-term statistics buckets (bar chart)
 */
export function stepFor(from, to) {
  // Measured in calendar days, not hours: a fall-back day is 25 hours long and
  // would otherwise push a two-day selection from a line chart to bars once a
  // year.
  const days = Math.round((to - from) / 86400000);
  const hours = (to - from) / 3600000;
  if (days <= 2 && hours <= 49) return 'power';
  if (days <= 92) return 'day';
  return 'month';
}

/* ─────────────────────────── period bounds ─────────────────────────── */

/** Unclamped period end — the exclusive boundary ignoring "now". */
function periodEnd(view) {
  const { range, anchor } = view;
  switch (range) {
    case 'day': return addDays(startOfDay(anchor), 1);
    case 'week': return addDays(startOfWeek(anchor), 7);
    case 'month': return addMonths(anchor, 1);
    case 'year': return startOfYear(addMonths(startOfYear(anchor), 12));
    case 'custom': return addDays(startOfDay(view.customTo || anchor), 1);
    default: return addDays(startOfDay(anchor), 1);
  }
}

function periodStart(view) {
  const { range, anchor } = view;
  switch (range) {
    case 'day': return startOfDay(anchor);
    case 'week': return startOfWeek(anchor);
    case 'month': return startOfMonth(anchor);
    case 'year': return startOfYear(anchor);
    case 'custom': return startOfDay(view.customFrom || anchor);
    default: return startOfDay(anchor);
  }
}

/**
 * @returns {{from: Date, to: Date, step: string, includesNow: boolean}}
 */
export function periodBounds(view, now = new Date()) {
  const from = periodStart(view);
  const end = periodEnd(view);
  const includesNow = now >= from && now < end;
  const to = includesNow ? new Date(now.getTime()) : end;
  const step = view.range === 'custom' ? stepFor(from, end)
    : view.range === 'day' ? 'power'
      : view.range === 'year' ? 'month' : 'day';
  return { from, to, step, includesNow };
}

/** True when the selection is strictly in the past — the historical mode. */
export function isHistorical(view, now = new Date()) {
  return !periodBounds(view, now).includesNow;
}

/** True when today's live daily counters can be used instead of statistics. */
export function usesLiveCounters(view, now = new Date()) {
  return view.range === 'day' && sameDay(view.anchor, now);
}

/* ─────────────────────────── navigation ─────────────────────────── */

export function shiftPeriod(view, delta) {
  const next = { ...view };
  switch (view.range) {
    case 'day': next.anchor = addDays(startOfDay(view.anchor), delta); break;
    case 'week': next.anchor = addDays(startOfWeek(view.anchor), 7 * delta); break;
    case 'month': next.anchor = addMonths(view.anchor, delta); break;
    case 'year': next.anchor = addMonths(startOfYear(view.anchor), 12 * delta); break;
    case 'custom': {
      const from = startOfDay(view.customFrom || view.anchor);
      const to = startOfDay(view.customTo || view.anchor);
      const span = Math.round((to - from) / DAY_MS) + 1;
      next.customFrom = addDays(from, span * delta);
      next.customTo = addDays(to, span * delta);
      next.anchor = next.customTo;
      break;
    }
    default: break;
  }
  return next;
}

/** Can the selection move forward without landing in the future? */
export function canGoForward(view, now = new Date()) {
  return periodEnd(view) <= now;
}

/**
 * Switching the range keeps the anchor, so "August 2026" -> Day lands on a day
 * inside August rather than jumping to today.
 */
export function withRange(view, range, now = new Date()) {
  const next = { ...view, range };
  if (range === 'custom') {
    const bounds = periodBounds(view, now);
    const today = startOfDay(now);
    next.customFrom = bounds.from;
    next.customTo = addDays(periodEnd(view), -1);
    if (next.customTo > today) next.customTo = today;      // never offer the future
    if (next.customFrom > next.customTo) next.customFrom = next.customTo;
    next.anchor = next.customTo;
  }
  // Never leave the selection in the future after a range change.
  if (periodStart(next) > now) next.anchor = startOfDay(now);
  return next;
}

/* ─────────────────────────── labels ─────────────────────────── */

function fmt(date, opts) {
  try {
    return new Intl.DateTimeFormat(localeTag(), opts).format(date);
  } catch (e) {
    return date.toISOString().slice(0, 10);
  }
}

export function periodLabel(view, now = new Date()) {
  const from = periodStart(view);
  const lastDay = addDays(periodEnd(view), -1);
  switch (view.range) {
    case 'day':
      return fmt(from, { day: 'numeric', month: 'short', year: 'numeric' });
    case 'month':
      return fmt(from, { month: 'long', year: 'numeric' });
    case 'year':
      return fmt(from, { year: 'numeric' });
    case 'week':
    case 'custom':
    default: {
      const sameMonth = from.getMonth() === lastDay.getMonth() && from.getFullYear() === lastDay.getFullYear();
      const left = sameMonth
        ? fmt(from, { day: 'numeric' })
        : fmt(from, { day: 'numeric', month: 'short' });
      const right = fmt(lastDay, { day: 'numeric', month: 'short', year: 'numeric' });
      return `${left} – ${right}`;
    }
  }
}

/** Default view: today, day range. */
export function defaultView(range = 'day', now = new Date()) {
  const anchor = startOfDay(now);
  return { range: RANGE_KEYS.includes(range) ? range : 'day', anchor, customFrom: anchor, customTo: anchor };
}
