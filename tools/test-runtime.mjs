/**
 * test-runtime.mjs — unit tests for js/battery-runtime.js.
 *   node tools/test-runtime.mjs
 *
 * How long the battery lasts at the house's present consumption, and whether it
 * reaches the morning given the solar forecast. The numbers are a real install:
 * 11.2 kWh of battery, the inverter cuts the battery off at 10 %, the house
 * draws about 0.5 kW.
 */
import { usableKwh, runtimeHours, forecastRuntime, parseForecastSlots, mergeSlots, RollingMean } from '../deye-dashboard/js/battery-runtime.js';
import { EnergyModel } from '../deye-dashboard/js/energy-model.js';
import { mergeConfig } from '../deye-dashboard/js/config.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}
const near = (name, actual, expected, tol = 0.01) => eq(
  name, Math.abs((actual ?? NaN) - expected) <= tol ? true : `${actual} (wanted ${expected})`, true);

const CAP = 11.2, RESERVE = 10, LOAD = 0.5;
const MIN = 60000, HOUR = 3600000;
const at = (d, h, m = 0) => +new Date(2026, 9, d, h, m, 0, 0);
/** Half-hour forecast slots [startMs, kW] from `from` for `count` slots. */
const slots = (from, count, kw) => Array.from({ length: count }, (_, i) => [from + i * 30 * MIN, typeof kw === 'function' ? kw(i) : kw]);

/* ── what is left above the cut-off, and how long it lasts ── */
near('energy above the cut-off', usableKwh(CAP, 99, RESERVE), 9.968, 0.001);
eq('below the cut-off nothing is left', usableKwh(CAP, 8, RESERVE), 0);
eq('without a capacity there is no answer', usableKwh(null, 99, RESERVE), null);
eq('without a cut-off the battery runs to empty', usableKwh(10, 50), 5);
near('at the house\'s 0.5 kW: 19 h 56 min', runtimeHours(usableKwh(CAP, 99, RESERVE), LOAD), 19.936, 0.001);
eq('a house drawing nothing gives no figure', runtimeHours(9.968, 0), null);
eq('an unknown load gives no figure', runtimeHours(9.968, null), null);

/* ── the evening: no sun until morning ── */
// 40 % at 22:00 is 3.36 kWh above the cut-off; at 0.5 kW that is 6.72 h, so
// the cut-off comes at 04:43, two hours before the forecast has any sun.
const evening = [...slots(at(31, 22), 18, 0), ...slots(at(32, 7), 4, (i) => [0.24, 0.5, 1.0, 1.5][i])];
let f = forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: evening });
eq('the evening battery reaches the cut-off', f && typeof f.reachesAt, 'number');
near('at 04:43, to the minute', f && (f.reachesAt - at(32, 4, 43.2)) / MIN, 0, 0.5);

/* ── the day: full now, sun until 17:00, sun again at 07:00 ── */
// 12:30-17:00 the sun gives 0.3 kW against the house's 0.5 (-0.9 kWh), the
// night takes 7 kWh, 07:00-08:00 breaks even, then the sun wins. From
// 11.088 kWh the lowest point is 3.188 kWh = 28.5 % at 07:00.
const day = [
  ...slots(at(31, 12, 30), 9, 0.3),
  ...slots(at(31, 17), 28, 0),
  ...slots(at(32, 7), 2, 0.5),
  ...slots(at(32, 8), 6, 1.5),
];
f = forecastRuntime({ now: at(31, 12, 30), socPct: 99, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: day });
eq('a full battery holds until the sun returns', f && f.reachesAt, null);
near('its lowest point is 28.5 %', f && f.minPct, 28.46, 0.05);
eq('reached at 07:00 tomorrow', f && f.minAt, at(32, 7));

/* ── the battery cannot hold more than it holds ── */
// Two hours of 3 kW sun against 0.5 kW would add 5 kWh; capped at 11.2, the
// night afterwards starts from full, not from 15.6 kWh.
f = forecastRuntime({ now: at(31, 12), socPct: 95, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD,
  slots: [...slots(at(31, 12), 4, 3), ...slots(at(31, 14), 4, 0)] });
near('a surplus stops at full capacity', f && f.minPct, ((CAP - 1) / CAP) * 100, 0.05);

/* ── the slot under way counts only from now ── */
f = forecastRuntime({ now: at(31, 22, 15), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: evening });
near('a quarter of an hour later the cut-off is a quarter of an hour later', f && (f.reachesAt - at(32, 4, 58.2)) / MIN, 0, 0.5);

/* ── no forecast, no claim ── */
eq('without forecast slots there is no answer', forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: [] }), null);
eq('a forecast that ended is no answer', forecastRuntime({ now: at(33, 12), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: evening }), null);
eq('without a load there is no answer', forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: null, slots: evening }), null);

/* ── a forecast that ends, or has a hole, says no more than it knows ── */
// Only today's forecast, at 22:00: it ends at midnight with the battery still
// draining. "Lasts — lowest 31 % at 00:00" would be a promise about a night it
// never saw; the answer is open-ended.
f = forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: slots(at(31, 0), 48, 0) });
eq('a forecast ending in the dark is open-ended', f && [f.reachesAt, f.open], [null, true]);
near('with the battery where the forecast ends', f && f.minPct, 31.07, 0.05);
eq('at the end of the forecast', f && f.minAt, at(32, 0));
eq('a forecast that starts after now is no answer',
  forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: slots(at(32, 0), 48, 0) }), null);
f = forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD,
  slots: [[at(31, 22), 0], [at(31, 23, 30), 5], [at(31, 24), 5]] });
eq('a hole in the forecast ends it there', f && [f.open, f.minAt], [true, at(31, 22, 30)]);

/* ── at the cut-off already ── */
f = forecastRuntime({ now: at(31, 22), socPct: 5, capacityKwh: CAP, reservePct: RESERVE, loadKw: LOAD, slots: evening });
eq('a battery at or below the cut-off says so', f && [f.atCutoff, f.minPct], [true, 5]);
eq('a zero capacity is no capacity', usableKwh(0, 50, RESERVE), null);
eq('and gives no forecast', forecastRuntime({ now: at(31, 22), socPct: 40, capacityKwh: 0, reservePct: RESERVE, loadKw: LOAD, slots: evening }), null);

/* ── Solcast's detailedForecast, as the attribute arrives ── */
const solcast = [
  { period_start: '2026-11-01T07:30:00+02:00', pv_estimate: 0.5, pv_estimate10: 0.3, pv_estimate90: 0.6 },
  { period_start: '2026-11-01T07:00:00+02:00', pv_estimate: 0.24, pv_estimate10: 0.1, pv_estimate90: 0.3 },
  { period_start: 'not a time', pv_estimate: 1 },
  { period_start: '2026-11-01T08:00:00+02:00', pv_estimate: null },
];
eq('slots become [ms, kW] in time order, broken ones dropped', parseForecastSlots(solcast),
  [[Date.parse('2026-11-01T07:00:00+02:00'), 0.24], [Date.parse('2026-11-01T07:30:00+02:00'), 0.5]]);
eq('a missing attribute is no slots', parseForecastSlots(undefined), []);
eq('today and tomorrow merge without duplicates', parseForecastSlots(solcast, solcast).length, 2);
eq('parsed lists merge in time order without duplicates', mergeSlots([[2, 0.5], [1, 0.2]], [[2, 0.5], [3, 1]], null), [[1, 0.2], [2, 0.5], [3, 1]]);

/* ── the house's consumption, averaged over ten minutes ── */
// A fridge doubles the load for a few minutes at a time; an estimate taken from
// the instantaneous reading would halve and double with it.
const avg = new RollingMean(10 * MIN);
avg.push(0, 0.3);
avg.push(5 * MIN, 0.9);
near('five minutes at 0.3 and five at 0.9 average 0.6', avg.mean(10 * MIN), 0.6, 1e-9);
avg.push(20 * MIN, 0.1);
near('only the last ten minutes count', avg.mean(20 * MIN), 0.9, 1e-9);
near('and the newest reading weighs by how long it has held', avg.mean(25 * MIN), 0.5, 1e-9);
eq('an empty average is no answer', new RollingMean(10 * MIN).mean(0), null);
const pinned = new RollingMean(10 * MIN);
for (let i = 0; i < 500; i++) pinned.push(0, 0.4 + i / 10000);
eq('readings at one instant replace each other instead of piling up', pinned.samples.length, 1);
const single = new RollingMean(10 * MIN); single.push(0, 0.42);
near('one reading is its own average', single.mean(0), 0.42, 1e-9);

/* ── the model: time on battery, through build() ── */
const model = new EnergyModel(mergeConfig(null, {}));
const v = (o) => Object.fromEntries(Object.entries(o).map(([k, value]) => [k, { value }]));
const base = { batterySoc: 99, batteryCapacity: CAP, batteryShutdownSoc: RESERVE, loadPower: LOAD, pvPower: 0, batteryPower: -0.5, gridPower: 0 };
let st = model.build(v(base), { now: at(31, 22) });
near('the card\'s time on battery: 19 h 56 min', st.battery.runtime && st.battery.runtime.hours, 19.936, 0.001);
st = model.build(v({ ...base, loadPower: null }), { now: at(31, 22, 1) });
eq('a load that went unavailable gives no time on battery', st.battery.runtime, null);
st = model.build(v({ ...base, loadPower: 0.9 }), { now: at(31, 22, 2) });
near('and the old readings do not linger once it is back', st.battery.runtime && st.battery.runtime.loadKw, 0.9, 1e-9);
model.setConfig(mergeConfig(null, { powerDirection: { load: 'normal' } }));
st = model.build(v({ ...base, loadPower: 0.3 }), { now: at(31, 22, 3) });
near('a settings change starts the average afresh', st.battery.runtime && st.battery.runtime.loadKw, 0.3, 1e-9);
st = model.build(v({ ...base, batterySoc: 10 }), { now: at(31, 22, 4) });
eq('at the cut-off the card says so', st.battery.runtime && st.battery.runtime.atCutoff, true);

if (failures.length) {
  console.log(`battery-runtime.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const x of failures) console.log(`  ✗ ${x}`);
  process.exit(1);
}
console.log(`battery-runtime.js: all ${pass} checks passed`);
