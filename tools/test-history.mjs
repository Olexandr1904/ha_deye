/**
 * test-history.mjs — unit tests for history.js against a stub Home Assistant.
 *   node tools/test-history.mjs
 *
 * These exist because of a real defect: `statistics_during_period` answered a
 * one-day request with two day buckets, and summing what arrived reported two
 * days of export as one day's. Nothing in the browser suite could see it — the
 * demo answered exactly, and the checks only counted bars.
 */
import { fetchEnergyBars, fetchEnergyTotals, fetchSensorStats, clearHistoryCache } from '../deye-dashboard/js/history.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}
const near = (name, actual, expected, tol = 0.005) => eq(
  name, Math.abs((actual ?? NaN) - expected) <= tol ? true : `${actual} (wanted ${expected})`, true);

const ID = 'sensor.inverter_daily_energy_sold';
const day = (d, h = 0) => new Date(2026, 7, d, h, 0, 0, 0);

/**
 * A Home Assistant that answers the way the real one did: whole buckets that
 * touch the range, including the one starting exactly at end_time.
 */
function stubClient({ perDay = {}, inclusiveEnd = true, period = 'day', unit = 'kWh' } = {}) {
  const calls = [];
  return {
    calls,
    getState: () => ({ attributes: { unit_of_measurement: unit } }),
    async callWS(msg) {
      calls.push(msg);
      if (msg.type !== 'recorder/statistics_during_period') return null;
      const from = Date.parse(msg.start_time);
      const to = Date.parse(msg.end_time);
      const rows = [];
      if (msg.period === 'hour') {
        for (let t = from; inclusiveEnd ? t <= to : t < to; t += 3600000) {
          const d = new Date(t).getDate();
          const perHour = (perDay[d] || 0) / 24;
          rows.push({ start: t, change: perHour });
        }
      } else {
        const cursor = new Date(from); cursor.setHours(0, 0, 0, 0);
        while (inclusiveEnd ? +cursor <= to : +cursor < to) {
          rows.push({ start: +cursor, change: perDay[cursor.getDate()] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      return { [msg.statistic_ids[0]]: rows };
    },
  };
}

const EXPORT = { 22: 64.3, 23: 63.7, 24: 69.4, 25: 62.1 };

/* ── the defect: one day must be one day ── */
clearHistoryCache();
let client = stubClient({ perDay: EXPORT });
let totals = await fetchEnergyTotals(client, [ID], day(24), day(25), 'day');
near('a single past day totals that day alone', totals[ID], 69.4);
eq('and the day is not doubled by its neighbour', totals[ID] < 100, true);

clearHistoryCache();
client = stubClient({ perDay: EXPORT });
totals = await fetchEnergyTotals(client, [ID], day(22), day(23), 'day');
near('the same holds for a day further back', totals[ID], 64.3);

/* ── a short window is asked for in hourly buckets, so day alignment cannot bite ── */
clearHistoryCache();
client = stubClient({ perDay: EXPORT });
await fetchEnergyTotals(client, [ID], day(24), day(25), 'day');
eq('a one-day total is requested hourly', client.calls[0].period, 'hour');
clearHistoryCache();
client = stubClient({ perDay: EXPORT });
await fetchEnergyTotals(client, [ID], day(18), day(25), 'day');
eq('a week is requested hourly too', client.calls[0].period, 'hour');
clearHistoryCache();
client = stubClient({ perDay: EXPORT });
await fetchEnergyTotals(client, [ID], new Date(2026, 6, 1), new Date(2026, 7, 1), 'day');
eq('a month keeps the coarser buckets', client.calls[0].period, 'day');

/* ── a week of bars: seven days in, seven bars out ── */
clearHistoryCache();
client = stubClient({ perDay: { 17: 1, 18: 2, 19: 3, 20: 4, 21: 5, 22: 6, 23: 7, 24: 8 } });
let bars = await fetchEnergyBars(client, [ID], day(17), day(24), 'day');
eq('a week returns exactly its own days', bars[ID].length, 7);
eq('the days are the right ones', bars[ID].map((r) => r.start.getDate()), [17, 18, 19, 20, 21, 22, 23]);
near('and the total is the sum of those days', bars[ID].reduce((a, r) => a + r.value, 0), 28);

/* ── a backend that answers exactly is unaffected ── */
clearHistoryCache();
client = stubClient({ perDay: EXPORT, inclusiveEnd: false });
totals = await fetchEnergyTotals(client, [ID], day(24), day(25), 'day');
near('an exact backend gives the same answer', totals[ID], 69.4);

/* ── units are normalised, not assumed ── */
clearHistoryCache();
client = stubClient({ perDay: { 24: 69400 }, unit: 'Wh' });
totals = await fetchEnergyTotals(client, [ID], day(24), day(25), 'day');
near('watt-hours become kilowatt-hours', totals[ID], 69.4);

/* ── a sum-only backend still diffs against the right baseline ── */
clearHistoryCache();
const sumClient = {
  getState: () => ({ attributes: { unit_of_measurement: 'kWh' } }),
  async callWS(msg) {
    if (msg.type !== 'recorder/statistics_during_period') return null;
    // Cumulative sums, and one bucket too many at the end.
    return { [ID]: [
      { start: +day(24), sum: 1000 },
      { start: +day(25), sum: 1069.4 },
      { start: +day(26), sum: 1131.5 },
    ] };
  },
};
bars = await fetchEnergyBars(sumClient, [ID], day(25), day(26), 'day');
near('a sum-only response diffs against the bucket before the window', bars[ID][0].value, 69.4);
eq('and keeps only the requested bucket', bars[ID].length, 1);

/* ── the band chart clamps as well ── */
clearHistoryCache();
const bandClient = {
  getState: () => ({ attributes: { unit_of_measurement: 'V' } }),
  async callWS(msg) {
    if (msg.type !== 'recorder/statistics_during_period') return null;
    return { [ID]: [
      { start: +day(24), mean: 55, min: 50, max: 58 },
      { start: +day(25), mean: 57, min: 52, max: 59 },
    ] };
  },
};
const band = await fetchSensorStats(bandClient, ID, day(24), day(25), 'day', 'voltage');
eq('the band chart keeps only buckets inside the period', band.length, 1);
near('with the values of that bucket', band[0].mean, 55);

if (failures.length) {
  console.log(`history.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`history.js: all ${pass} checks passed`);
