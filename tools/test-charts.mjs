/**
 * test-charts.mjs — unit tests for the chart axes.
 *   node tools/test-charts.mjs
 *
 * The axis is where a chart lies most easily: a year holding two months of data
 * used to spread those two months across the whole width, which reads as twelve
 * months of production. The axis has to come from the period, not from the data.
 */
import { bucketsOfPeriod, timeTicks, axisTimeLabel } from '../deye-dashboard/js/charts.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}
const day = (y, m, d, h = 0) => new Date(y, m - 1, d, h, 0, 0, 0);
const keys = (from, to, bucket) => (bucketsOfPeriod(+from, +to, bucket) || []).map((k) => new Date(Number(k)));
const asDates = (from, to, bucket) => keys(from, to, bucket).map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);

/* ── a day period ── */
eq('a single day is one slot', asDates(day(2026, 8, 24), day(2026, 8, 25), 'day'), ['2026-08-24']);

/* ── a week ── */
eq('a week is seven slots, Monday first',
  asDates(day(2026, 8, 17), day(2026, 8, 24), 'day'),
  ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']);

/* ── month lengths are calendar-exact, not 30 ── */
eq('July has 31 slots', keys(day(2026, 7, 1), day(2026, 8, 1), 'day').length, 31);
eq('June has 30 slots', keys(day(2026, 6, 1), day(2026, 7, 1), 'day').length, 30);
eq('February 2026 has 28 slots', keys(day(2026, 2, 1), day(2026, 3, 1), 'day').length, 28);
eq('February 2028 has 29 slots', keys(day(2028, 2, 1), day(2028, 3, 1), 'day').length, 29);

/* ── a year always has twelve month slots, whatever the data holds ── */
const year2025 = asDates(day(2025, 1, 1), day(2026, 1, 1), 'month');
eq('a year is twelve month slots', year2025.length, 12);
eq('starting in January', year2025[0], '2025-01-01');
eq('and ending in December', year2025[11], '2025-12-01');
eq('a year of daily buckets is 365 slots', keys(day(2025, 1, 1), day(2026, 1, 1), 'day').length, 365);
eq('a leap year is 366', keys(day(2024, 1, 1), day(2025, 1, 1), 'day').length, 366);

/* ── the slot a bucket lands in does not shift with DST ── */
// Europe: clocks go forward on the last Sunday of March, back on the last of October.
const march = asDates(day(2026, 3, 25), day(2026, 4, 2), 'day');
eq('a spring-forward week keeps one slot per day', march.length, 8);
eq('and no day is skipped', march.includes('2026-03-29') && march.includes('2026-03-30'), true);
const october = asDates(day(2026, 10, 22), day(2026, 10, 30), 'day');
eq('a fall-back week keeps one slot per day', october.length, 8);
eq('and no day is duplicated', new Set(october).size, october.length);

/* ── a period given mid-day still starts at the day it contains ── */
eq('a period starting at noon still slots that day',
  asDates(day(2026, 8, 24, 12), day(2026, 8, 26), 'day'), ['2026-08-24', '2026-08-25']);

/* ── a month bucket for a period that starts mid-month ── */
eq('a mid-month start still names the month',
  asDates(day(2026, 3, 17), day(2026, 6, 1), 'month'), ['2026-03-01', '2026-04-01', '2026-05-01']);

/* ── guards: no period, no axis (the chart then falls back to the data) ── */
eq('no range gives no axis', bucketsOfPeriod(null, null, 'day'), null);
eq('a reversed range gives no axis', bucketsOfPeriod(+day(2026, 8, 25), +day(2026, 8, 24), 'day'), null);
eq('an empty range gives no axis', bucketsOfPeriod(+day(2026, 8, 25), +day(2026, 8, 25), 'day'), null);
eq('a decade of days is capped rather than unbounded',
  keys(day(2016, 1, 1), day(2026, 1, 1), 'day').length <= 500, true);

/* ── the time axis of the line chart ── */
const HOUR = 3600000;
const DAY = 86400000;
const t0 = +day(2026, 8, 24);
eq('a day of ticks lands on the hour',
  timeTicks(t0, t0 + DAY, 8).every((t) => (t - t0) % HOUR === 0), true);
eq('ticks stay inside the range', timeTicks(t0, t0 + DAY, 8).every((t) => t >= t0 && t <= t0 + DAY), true);
const monthTicks = timeTicks(t0, t0 + 30 * DAY, 8);
eq('a month of ticks lands on local midnight',
  monthTicks.every((t) => { const d = new Date(t); return d.getHours() === 0 && d.getMinutes() === 0; }), true);
eq('a month of ticks is not all the same label',
  new Set(monthTicks.map((t) => axisTimeLabel(new Date(t), 30 * DAY))).size > 1, true);
eq('inside a day the label is a clock', /^\d{2}:\d{2}$/.test(axisTimeLabel(new Date(t0 + 5 * HOUR), DAY)), true);
eq('across a month the label is a date', /^\d{2}:\d{2}$/.test(axisTimeLabel(new Date(t0), 30 * DAY)), false);
eq('across a year the label is a month', axisTimeLabel(new Date(t0), 300 * DAY).length <= 5, true);

if (failures.length) {
  console.log(`charts.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`charts.js: all ${pass} checks passed`);
