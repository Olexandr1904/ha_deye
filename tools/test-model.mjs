/**
 * test-model.mjs — unit tests for the pure model functions.
 *   node tools/test-model.mjs
 *
 * power-flow.js decides what the diagram claims about where energy went. It is
 * pure arithmetic, so it deserves cheaper coverage than a browser run.
 */
import { computeFlow } from '../deye-dashboard/js/power-flow.js';
import { preferMovedCounter } from '../deye-dashboard/js/utils.js';
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
const near = (name, actual, expected, tol = 0.005) => eq(
  name, Math.abs((actual ?? NaN) - expected) <= tol ? true : `${actual} (wanted ${expected})`, true);
const ok = (name, cond, detail = '') => eq(name, cond ? true : `false ${detail}`, true);

/** A state object with only the fields computeFlow reads. */
const state = ({ pv = null, gen = null, genRelevant = undefined, battery = null, grid = null, load = null, scale = 12 } = {}) => ({
  pv: { power: pv },
  generator: { power: gen, relevant: genRelevant === undefined ? gen !== null : genRelevant },
  battery: { power: battery },     // + = charging
  grid: { power: grid },           // + = import
  load: { power: load },
  meta: { scaleKw: scale },
});

/* ── link directions follow the measured sign ── */
let f = computeFlow(state({ pv: 4, battery: 1.5, grid: -2, load: 4.5 }));
eq('solar always flows to the inverter', f.links.solar.dir, 'toHub');
eq('a charging battery is fed by the inverter', f.links.battery.dir, 'fromHub');
eq('an export leaves the inverter', f.links.grid.dir, 'fromHub');
eq('the house always draws from the inverter', f.links.load.dir, 'fromHub');
f = computeFlow(state({ pv: 0, battery: -2, grid: 1.2, load: 3.2 }));
eq('a discharging battery feeds the inverter', f.links.battery.dir, 'toHub');
eq('an import flows to the inverter', f.links.grid.dir, 'toHub');

/* ── the load coverage cascade: self-consumption first ── */
f = computeFlow(state({ pv: 6, battery: 2, grid: -1, load: 3 }));
near('solar covers the house first', f.alloc.pvToLoad, 3);
near('the surplus charges the battery', f.alloc.pvToBattery, 2);
near('what is left is exported', f.alloc.pvToGrid, 1);
eq('nothing is bought while exporting', f.alloc.gridToLoad, 0);
near('the mix is all solar', f.mix.pv, 100);
near('self-sufficiency is complete', f.selfSufficiency, 100);

/* ── the generator sits between solar and the battery ── */
f = computeFlow(state({ pv: 0.2, gen: 4.5, battery: 0.02, grid: -1.55, load: 3.13 }));
near('solar covers what it can', f.alloc.pvToLoad, 0.2);
near('the generator covers the rest of the house', f.alloc.generatorToLoad, 2.93);
near('the generator also charges the battery', f.alloc.generatorToBattery, 0.02);
near('and the generator is what is exported', f.alloc.generatorToGrid, 1.55);
eq('a charging battery is never credited with the export', f.alloc.batteryToGrid, null);
const exported = (f.alloc.pvToGrid || 0) + (f.alloc.generatorToGrid || 0) + (f.alloc.batteryToGrid || 0);
near('the export is fully attributed', exported, 1.55);
ok('the generator dominates the mix', f.mix.generator > 90, `${f.mix.generator}`);

/* ── a discharging battery may export ── */
f = computeFlow(state({ pv: 0, battery: -3, grid: -1, load: 2 }));
near('the battery covers the house', f.alloc.batteryToLoad, 2);
near('and exports the remainder', f.alloc.batteryToGrid, 1);
eq('no solar is invented', f.alloc.pvToGrid, 0);

/* ── an irrelevant generator contributes nothing ── */
f = computeFlow(state({ pv: 3, gen: 0, genRelevant: false, battery: 0, grid: 0, load: 3 }));
eq('an idle generator gets no attribution', f.alloc.generatorToLoad, null);
eq('and no share of the mix', f.mix.generator, 0);

/* ── missing sensors stay missing, they are not treated as zero ── */
f = computeFlow(state({ pv: null, battery: null, grid: null, load: 2 }));
eq('an unmeasured source gets no attribution', f.alloc.pvToLoad, null);
eq('an unmeasured grid is not credited', f.alloc.gridToLoad, null);
eq('with nothing measured there is no mix', f.mix, null);
eq('and no self-sufficiency claim', f.selfSufficiency, null);

f = computeFlow(state({ pv: 2, battery: null, grid: null, load: 5 }));
near('a known source still covers what it can', f.alloc.pvToLoad, 2);
eq('the shortfall is not blamed on the grid', f.alloc.gridToLoad, null);
near('the mix reports only what is known', f.mix.pv, 100);

/* ── a measured grid is credited with no more than it imported ── */
// A generator running but not mapped: 5.7 kW arrived from nowhere the panel
// could see. The cascade handed all of it to the grid, which read 0 W, and
// showed "Grid → Battery 5.20 kW" and an 80 % grid share of the house.
f = computeFlow(state({ pv: 0.132, battery: 5.2, grid: 0, load: 0.655 }));
near('solar still covers what it can', f.alloc.pvToLoad, 0.132);
eq('a grid at 0 W supplies nothing to the house', f.alloc.gridToLoad, 0);
eq('nor to the battery', f.alloc.gridToBattery, 0);
eq('so it takes no share of the mix', f.mix.grid, 0);

f = computeFlow(state({ pv: 0, battery: 2, grid: 1, load: 2 }));
near('an import serves the house first', f.alloc.gridToLoad, 1);
eq('and nothing is left of it for the battery', f.alloc.gridToBattery, 0);

/* ── no load reading means no distribution at all ── */
f = computeFlow(state({ pv: 4, battery: 1, grid: -3, load: null }));
eq('without a load sensor nothing is distributed', f.alloc.pvToLoad, null);
eq('and there is no mix', f.mix, null);
eq('but the links are still drawn', f.links.solar.dir, 'toHub');

/* ── an idle system does not animate ── */
f = computeFlow(state({ pv: 0, battery: 0, grid: 0, load: 0 }));
eq('every link is idle', Object.values(f.links).every((l) => l.dir === 'idle'), true);

/* ── the counter fallback ── */
eq('a moving daily counter wins', preferMovedCounter(11, 11), 11);
eq('a dead daily counter falls back to the lifetime one', preferMovedCounter(0, 9.4), 9.4);
eq('a missing daily counter falls back too', preferMovedCounter(null, 9.4), 9.4);
eq('a missing lifetime counter keeps the daily one', preferMovedCounter(11, null), 11);
eq('both missing stays missing', preferMovedCounter(null, null), null);
eq('the daily counter wins when it is larger', preferMovedCounter(12, 9), 12);
eq('a non-number is not a value', preferMovedCounter(undefined, NaN), null);

/* ── the inverter's alarm ── */
// A binary_sensor of device_class "problem" (e.g. "Inverter Has Faults") reads
// "off" when all is well; that once lit a FAULT badge over a healthy inverter.
const inverter = (alarm) => new EnergyModel(mergeConfig(null, {})).build({
  inverterAlarm: { value: alarm }, inverterStatus: { value: 'Normal' }, loadPower: { value: 0.3 },
}).inverter;
// A text role passes the state through untouched, so a numeric register reads
// "0.0" and a padded or spelled-out "all clear" has to be quiet as well.
for (const quiet of ['off', 'OFF', 'false', 'OK', ' OK ', 'Normal', '0', '0.0', '00', 'none', 'No fault', 'no_alarm', 'No errors']) {
  eq(`alarm "${quiet}" is no alarm`, inverter(quiet).alarm, null);
  eq(`and the inverter is not at fault with "${quiet}"`, inverter(quiet).state, 'online');
}
eq('a raised binary alarm is a fault', inverter('on').state, 'fault');
eq('a fault code is a fault', inverter('F13 Grid mode changed').state, 'fault');
eq('a numeric fault code is a fault', inverter('64').state, 'fault');
eq('a hex fault code is a fault, though parseFloat reads it as 0', inverter('0x0010').state, 'fault');
eq('the alarm is shown without its padding', inverter(' F13 ').alarm, 'F13');

if (failures.length) {
  console.log(`model: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f2 of failures) console.log(`  ✗ ${f2}`);
  process.exit(1);
}
console.log(`power-flow.js + utils.js + the inverter's alarm: all ${pass} checks passed`);
