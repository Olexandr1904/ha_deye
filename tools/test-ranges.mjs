/**
 * test-ranges.mjs — unit tests for ranges.js. Plain node, no browser.
 *   node tools/test-ranges.mjs
 */
import * as R from '../deye-dashboard/js/ranges.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}
const iso = (d) => (d ? R.toDateInput(d) : null);
const isoT = (d) => (d ? `${R.toDateInput(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null);

/* A fixed "now": Saturday 22 August 2026, 15:40 local. */
const NOW = new Date(2026, 7, 22, 15, 40, 0, 0);
const view = (range, anchor, from, to) => ({
  range, anchor, customFrom: from || anchor, customTo: to || anchor,
});

/* ── day helpers ── */
eq('startOfWeek(Sat 22 Aug) = Mon 17 Aug', iso(R.startOfWeek(NOW)), '2026-08-17');
eq('startOfWeek(Mon) is idempotent', iso(R.startOfWeek(new Date(2026, 7, 17, 9))), '2026-08-17');
eq('startOfWeek(Sun 23 Aug) = Mon 17 Aug', iso(R.startOfWeek(new Date(2026, 7, 23))), '2026-08-17');
eq('startOfMonth', iso(R.startOfMonth(NOW)), '2026-08-01');
eq('startOfYear', iso(R.startOfYear(NOW)), '2026-01-01');
eq('addMonths from the 31st does not overflow', iso(R.addMonths(new Date(2026, 0, 31), 1)), '2026-02-01');
eq('addMonths across a year boundary', iso(R.addMonths(new Date(2026, 11, 15), 1)), '2027-01-01');
eq('toDateInput/fromDateInput round-trip', iso(R.fromDateInput('2026-03-09')), '2026-03-09');
eq('fromDateInput rejects junk', R.fromDateInput('nope'), null);

/* ── bounds of the current period: clamped to now ── */
{
  const b = R.periodBounds(view('day', R.startOfDay(NOW)), NOW);
  eq('day/today from', isoT(b.from), '2026-08-22 00:00');
  eq('day/today to is clamped to now', isoT(b.to), '2026-08-22 15:40');
  eq('day/today includes now', b.includesNow, true);
  eq('day step', b.step, 'power');
}
{
  const b = R.periodBounds(view('week', R.startOfDay(NOW)), NOW);
  eq('week from is Monday', isoT(b.from), '2026-08-17 00:00');
  eq('week to is clamped to now', isoT(b.to), '2026-08-22 15:40');
  eq('week step', b.step, 'day');
}
{
  const b = R.periodBounds(view('month', R.startOfDay(NOW)), NOW);
  eq('month from', iso(b.from), '2026-08-01');
  eq('month step', b.step, 'day');
  eq('month includes now', b.includesNow, true);
}
{
  const b = R.periodBounds(view('year', R.startOfDay(NOW)), NOW);
  eq('year from', iso(b.from), '2026-01-01');
  eq('year step', b.step, 'month');
}

/* ── bounds of a past period: full, unclamped ── */
{
  const b = R.periodBounds(view('day', new Date(2026, 7, 15)), NOW);
  eq('past day from', isoT(b.from), '2026-08-15 00:00');
  eq('past day to is the full boundary', isoT(b.to), '2026-08-16 00:00');
  eq('past day does not include now', b.includesNow, false);
}
{
  const b = R.periodBounds(view('month', new Date(2026, 6, 5)), NOW);
  eq('July from', iso(b.from), '2026-07-01');
  eq('July to', iso(b.to), '2026-08-01');
}
{
  const b = R.periodBounds(view('year', new Date(2025, 3, 3)), NOW);
  eq('2025 from', iso(b.from), '2025-01-01');
  eq('2025 to', iso(b.to), '2026-01-01');
}
/* February in a leap year and at a month end. */
{
  const b = R.periodBounds(view('month', new Date(2024, 1, 10)), NOW);
  eq('Feb 2024 (leap) to', iso(b.to), '2024-03-01');
}

/* ── historical mode and KPI source ── */
eq('today is live', R.isHistorical(view('day', R.startOfDay(NOW)), NOW), false);
eq('a past day is historical', R.isHistorical(view('day', new Date(2026, 7, 15)), NOW), true);
eq('the current month is live', R.isHistorical(view('month', R.startOfDay(NOW)), NOW), false);
eq('July is historical', R.isHistorical(view('month', new Date(2026, 6, 5)), NOW), true);
eq('this year is live', R.isHistorical(view('year', R.startOfDay(NOW)), NOW), false);
eq('live daily counters only for day/today', R.usesLiveCounters(view('day', R.startOfDay(NOW)), NOW), true);
eq('no live counters for the current month', R.usesLiveCounters(view('month', R.startOfDay(NOW)), NOW), false);
eq('no live counters for a past day', R.usesLiveCounters(view('day', new Date(2026, 7, 15)), NOW), false);

/* ── navigation ── */
eq('day back', iso(R.shiftPeriod(view('day', R.startOfDay(NOW)), -1).anchor), '2026-08-21');
eq('week back lands on the previous Monday', iso(R.shiftPeriod(view('week', R.startOfDay(NOW)), -1).anchor), '2026-08-10');
eq('month back', iso(R.shiftPeriod(view('month', R.startOfDay(NOW)), -1).anchor), '2026-07-01');
eq('month back across a year', iso(R.shiftPeriod(view('month', new Date(2026, 0, 15)), -1).anchor), '2025-12-01');
eq('year back', iso(R.shiftPeriod(view('year', R.startOfDay(NOW)), -1).anchor), '2025-01-01');
eq('forward is blocked on today', R.canGoForward(view('day', R.startOfDay(NOW)), NOW), false);
eq('forward is allowed from a past day', R.canGoForward(view('day', new Date(2026, 7, 15)), NOW), true);
eq('forward is blocked in the current month', R.canGoForward(view('month', R.startOfDay(NOW)), NOW), false);
eq('forward is allowed from July', R.canGoForward(view('month', new Date(2026, 6, 5)), NOW), true);
eq('forward is blocked in the current year', R.canGoForward(view('year', R.startOfDay(NOW)), NOW), false);

/* ── custom interval ── */
{
  const v = view('custom', new Date(2026, 7, 10), new Date(2026, 7, 1), new Date(2026, 7, 10));
  const b = R.periodBounds(v, NOW);
  eq('custom from', iso(b.from), '2026-08-01');
  eq('custom to is exclusive', iso(b.to), '2026-08-11');
  eq('custom 10 days aggregates by day', b.step, 'day');
  const back = R.shiftPeriod(v, -1);
  eq('custom shifts by its own length (from)', iso(back.customFrom), '2026-07-22');
  eq('custom shifts by its own length (to)', iso(back.customTo), '2026-07-31');
}
eq('custom of one day uses instantaneous power',
  R.periodBounds(view('custom', new Date(2026, 7, 10), new Date(2026, 7, 10), new Date(2026, 7, 10)), NOW).step, 'power');
eq('custom of two days still uses power',
  R.periodBounds(view('custom', new Date(2026, 7, 10), new Date(2026, 7, 9), new Date(2026, 7, 10)), NOW).step, 'power');
eq('custom of three days switches to daily buckets',
  R.periodBounds(view('custom', new Date(2026, 7, 10), new Date(2026, 7, 8), new Date(2026, 7, 10)), NOW).step, 'day');
eq('custom of a year aggregates monthly',
  R.periodBounds(view('custom', new Date(2026, 7, 10), new Date(2025, 7, 10), new Date(2026, 7, 10)), NOW).step, 'month');

/* ── stepFor boundaries ── */
eq('stepFor 48 h', R.stepFor(new Date(2026, 7, 1), new Date(2026, 7, 3)), 'power');
eq('stepFor 92 days', R.stepFor(new Date(2026, 0, 1), R.addDays(new Date(2026, 0, 1), 92)), 'day');
eq('stepFor 93 days', R.stepFor(new Date(2026, 0, 1), R.addDays(new Date(2026, 0, 1), 93)), 'month');

/* ── range switching keeps the anchor ── */
eq('month -> day keeps the anchor inside the month',
  iso(R.withRange(view('month', new Date(2026, 6, 5)), 'day', NOW).anchor), '2026-07-05');
{
  const v = R.withRange(view('month', new Date(2026, 6, 5)), 'custom', NOW);
  eq('month -> custom spans the whole month', [iso(v.customFrom), iso(v.customTo)], ['2026-07-01', '2026-07-31']);
}
eq('a future anchor is pulled back to today',
  iso(R.withRange(view('day', new Date(2027, 0, 1)), 'day', NOW).anchor), '2026-08-22');

/* ── labels ── */
eq('day label', R.periodLabel(view('day', new Date(2026, 7, 15)), NOW), '15 Aug 2026');
eq('month label', R.periodLabel(view('month', new Date(2026, 7, 15)), NOW), 'August 2026');
eq('year label', R.periodLabel(view('year', new Date(2026, 7, 15)), NOW), '2026');
eq('week label inside one month', R.periodLabel(view('week', new Date(2026, 7, 18)), NOW), '17 – 23 Aug 2026');
// en-GB abbreviates September as "Sept" — that is the locale's own choice.
eq('week label across two months', R.periodLabel(view('week', new Date(2026, 7, 31)), NOW), '31 Aug – 6 Sept 2026');
eq('defaultView is today', iso(R.defaultView('day', NOW).anchor), '2026-08-22');
eq('defaultView rejects an unknown range', R.defaultView('nonsense', NOW).range, 'day');

/* ── "Today" brings any selection back to the present ── */
// A custom interval's ends are its own, so moving its anchor moved nothing: the
// button on a past custom range used to do nothing at all.
const pastCustom = view('custom', new Date(2026, 7, 5), new Date(2026, 7, 1), new Date(2026, 7, 5));
const present = R.toPresent(pastCustom, NOW);
eq('a past custom range comes back to the present', R.periodBounds(present, NOW).includesNow, true);
eq('keeping its length, ending today', [iso(present.customFrom), iso(present.customTo), present.range], ['2026-08-18', '2026-08-22', 'custom']);
eq('a past week comes back to this week', iso(R.periodBounds(R.toPresent(view('week', new Date(2026, 6, 8)), NOW), NOW).from), '2026-08-17');
eq('a past day comes back to today', iso(R.toPresent(view('day', new Date(2026, 6, 8)), NOW).anchor), '2026-08-22');

if (failures.length) {
  console.log(`ranges.js: ${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log(`  x ${f}`));
  process.exit(1);
}
console.log(`ranges.js: all ${pass} checks passed`);
