/**
 * test-history.mjs — unit tests for history.js against a stub Home Assistant.
 *   node tools/test-history.mjs
 *
 * These exist because of a real defect: `statistics_during_period` answered a
 * one-day request with two day buckets, and summing what arrived reported two
 * days of export as one day's. Nothing in the browser suite could see it — the
 * demo answered exactly, and the checks only counted bars.
 */
import { fetchEnergyBars, fetchEnergyTotals, fetchSensorStats, fetchPowerSeries, clearHistoryCache, explainEmpty } from '../deye-dashboard/js/history.js';

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

/* ── a state holds until it changes ── */
// Home Assistant records changes, not samples. The generator read 0 W from
// midnight until it started at 10:11, and the chart drew a ten-hour ramp
// between those two points; the grid, at 0 W all day, had one point and no
// line at all.
const at = (h, m = 0, sec = 0) => +new Date(2026, 9, 31, h, m, sec, 0);
const histClient = (rows) => ({
  getState: () => ({ attributes: { unit_of_measurement: 'W' } }),
  async callWS(msg) { return msg.type === 'history/history_during_period' ? rows : null; },
});
const lu = (t, s) => ({ s: String(s), lu: t / 1000 });
clearHistoryCache();
let power = await fetchPowerSeries(histClient({
  'sensor.gen': [lu(at(0), 0), lu(at(10, 11), 6000), lu(at(10, 11, 5), 6005)],
  'sensor.grid': [lu(at(0), 0)],
}), ['sensor.gen', 'sensor.grid'], new Date(at(0)), new Date(at(11)));   // Dates, as periodBounds gives them
const gen = power['sensor.gen'];
eq('the value holds until the next change, then steps', gen.slice(0, 3), [[at(0), 0], [at(10, 11), 0], [at(10, 11), 6]]);
eq('the last value holds to the end of the window', gen[gen.length - 1], [at(11), 6.005]);
eq('a single state is a line across the window', power['sensor.grid'], [[at(0), 0], [at(11), 0]]);

// A sensor reporting every five seconds must not become a staircase.
clearHistoryCache();
const dense = Array.from({ length: 120 }, (_, i) => lu(at(10) + i * 5000, 500 + (i % 7) * 10));
power = await fetchPowerSeries(histClient({ 'sensor.load': dense }), ['sensor.load'], new Date(at(10)), new Date(at(10) + 120 * 5000));
eq('a dense series gains no extra points', power['sensor.load'].length, 120);

/* ── month buckets for a period that does not start or end on the 1st ── */
// Home Assistant widens a month request to whole months and labels each bucket
// with its 1st. A custom 17 March – 30 June either lost all of March (its
// bucket starts before the period) or, kept, would count 1–16 March as well.
function wholePeriodClient(perDay) {
  const calls = [];
  return {
    calls,
    getState: () => ({ attributes: { unit_of_measurement: 'kWh' } }),
    async callWS(msg) {
      calls.push(msg);
      if (msg.type !== 'recorder/statistics_during_period') return null;
      const from = new Date(Date.parse(msg.start_time));
      const to = new Date(Date.parse(msg.end_time));
      const rows = [];
      const sumDays = (a, b) => { let s = 0; for (const d = new Date(a); d < b; d.setDate(d.getDate() + 1)) s += perDay(d); return s; };
      if (msg.period === 'month') {
        const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
        for (; cursor <= to; cursor.setMonth(cursor.getMonth() + 1)) {
          const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
          rows.push({ start: +cursor, change: sumDays(cursor, next) });
        }
      } else if (msg.period === 'day') {
        const cursor = new Date(from); cursor.setHours(0, 0, 0, 0);
        for (; cursor <= to; cursor.setDate(cursor.getDate() + 1)) rows.push({ start: +cursor, change: perDay(cursor) });
      }
      if ((msg.types || []).includes('mean')) for (const r of rows) Object.assign(r, { mean: 230, min: 221, max: 244 });
      return { [msg.statistic_ids[0]]: rows };
    },
  };
}
const oneADay = () => 1;
const monthsOf = (rows) => rows.map((r) => [r.start.getMonth() + 1, Math.round(r.value * 1000) / 1000]);
clearHistoryCache();
client = wholePeriodClient(oneADay);
bars = await fetchEnergyBars(client, [ID], new Date(2026, 2, 17), new Date(2026, 6, 1), 'month');
eq('a period from the 17th keeps its first month, from the 17th only', monthsOf(bars[ID] || []), [[3, 15], [4, 30], [5, 31], [6, 30]]);
clearHistoryCache();
client = wholePeriodClient(oneADay);
bars = await fetchEnergyBars(client, [ID], new Date(2026, 3, 1), new Date(2026, 5, 16), 'month');
eq('a past period ending on the 15th counts its last month to the 15th', monthsOf(bars[ID] || []), [[4, 30], [5, 31], [6, 15]]);
clearHistoryCache();
client = wholePeriodClient(oneADay);
totals = await fetchEnergyTotals(client, [ID], new Date(2026, 2, 17), new Date(2026, 6, 1), 'month');
near('and the total is the days of the period', totals[ID], 106);
clearHistoryCache();
client = wholePeriodClient(oneADay);
bars = await fetchEnergyBars(client, [ID], new Date(2025, 0, 1), new Date(2026, 0, 1), 'month');
eq('a calendar year still asks for month buckets', client.calls[0].period, 'month');
near('and sums to its days', bars[ID].reduce((a, r) => a + r.value, 0), 365);
clearHistoryCache();
const monthBand = await fetchSensorStats(wholePeriodClient(oneADay), ID, new Date(2026, 2, 17), new Date(2026, 6, 1), 'month', 'voltage');
eq("the sensor dialog's band keeps the first month too", monthBand.map((r) => [r.start.getMonth() + 1, r.mean, r.min, r.max]),
  [[3, 230, 221, 244], [4, 230, 221, 244], [5, 230, 221, 244], [6, 230, 221, 244]]);

/* ── a daily counter whose statistics only have a maximum ── */
// A counter recorded as a measurement has max, not sum or change. Over a day
// bucket its maximum is the day's total; over hourly buckets it is the running
// total so far, and summing those reported a 12 kWh day as 150 kWh.
const maxClient = {
  getState: () => ({ attributes: { unit_of_measurement: 'kWh' } }),
  async callWS(msg) {
    if (msg.type !== 'recorder/statistics_during_period') return null;
    const from = Date.parse(msg.start_time), to = Date.parse(msg.end_time);
    const rows = [];
    if (msg.period === 'hour') {
      for (let t = from; t <= to; t += 3600000) rows.push({ start: t, max: 0.5 * (new Date(t).getHours() + 1) });
    } else {
      for (const d = new Date(from); +d <= to; d.setDate(d.getDate() + 1)) rows.push({ start: +d, max: 12 });
    }
    return { [ID]: rows };
  },
};
clearHistoryCache();
totals = await fetchEnergyTotals(maxClient, [ID], day(24), day(25), 'day');
near('a day of hourly maxima totals the day, not the sum of running totals', totals[ID], 12);
clearHistoryCache();
totals = await fetchEnergyTotals(maxClient, [ID], day(24), day(26), 'day');
near('and the counter starting again at midnight starts the next day afresh', totals[ID], 24);
clearHistoryCache();
bars = await fetchEnergyBars(maxClient, [ID], day(17), day(24), 'day');
eq('a day bucket of a daily counter is its maximum', bars[ID].map((r) => r.value), [12, 12, 12, 12, 12, 12, 12]);

/* ── a failure is a failure, not an empty period ── */
// Turned into "no data", a dropped request made the card say the sensors had
// no long-term statistics, or that the day's history had been purged.
const brokenClient = {
  getState: () => null,
  async callWS() { throw new Error('socket not open'); },
};
const rejects = async (fn) => { try { await fn(); return false; } catch (e) { return true; } };
clearHistoryCache();
eq('a failed history request is reported, not drawn as nothing',
  await rejects(() => fetchPowerSeries(brokenClient, ['sensor.load'], new Date(at(0)), new Date(at(11)))), true);
eq('a failed statistics request is reported too',
  await rejects(() => fetchEnergyBars(brokenClient, [ID], day(17), day(24), 'day')), true);
clearHistoryCache();
const why = await explainEmpty(brokenClient, [ID], 'day');
eq('an unknown answer does not claim the sensor has no statistics', why.reason !== 'no-statistics', true);

if (failures.length) {
  console.log(`history.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`history.js: all ${pass} checks passed`);
