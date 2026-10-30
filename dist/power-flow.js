/**
 * power-flow.js — flow directions and energy distribution.
 *
 * The diagram is a star around the inverter (like Deye Cloud):
 *   PV / GENERATOR / GRID / BATTERY  <->  INVERTER  <->  HOUSE
 * Direction and power of each link are measured quantities.
 *
 * On top of that the DISTRIBUTION is derived (pv->house, generator->battery,
 * grid->house...). That part is calculated, not measured: it follows from the
 * power balance and is shown in a separate block, so nothing derived is passed
 * off as measured.
 */

import { isNum, clamp } from './utils.js?v=1.2.1';

/** Power below which a flow counts as absent (sensor noise). */
const IDLE_KW = 0.015;

export function computeFlow(state) {
  const pv = pos(state.pv.power);
  const gen = pos(state.generator && state.generator.relevant ? state.generator.power : null);
  const bat = isNum(state.battery.power) ? state.battery.power : null;   // + = charging
  const grid = isNum(state.grid.power) ? state.grid.power : null;        // + = import
  const load = pos(state.load.power);

  const batCharge = bat !== null ? Math.max(0, bat) : null;
  const batDischarge = bat !== null ? Math.max(0, -bat) : null;
  const gridExport = grid !== null ? Math.max(0, -grid) : null;

  const scale = Math.max(1, state.meta.scaleKw || 1);

  const links = {
    solar: link(pv, 'toHub', scale),
    generator: link(gen, 'toHub', scale),
    battery: bat === null ? link(null, 'toHub', scale)
      : link(Math.abs(bat), bat > 0 ? 'fromHub' : 'toHub', scale),
    grid: grid === null ? link(null, 'toHub', scale)
      : link(Math.abs(grid), grid > 0 ? 'toHub' : 'fromHub', scale),
    load: link(load, 'fromHub', scale),
  };

  /* ── distribution: self-consumption first, grid last ── */
  const alloc = {
    pvToLoad: null, pvToBattery: null, pvToGrid: null,
    generatorToLoad: null, generatorToBattery: null, generatorToGrid: null,
    batteryToLoad: null, batteryToGrid: null,
    gridToLoad: null, gridToBattery: null,
  };

  // Only the load has to be known: a system without a total-PV sensor still
  // deserves a coverage breakdown. Sources that are not measured stay null
  // instead of having power attributed to them.
  if (load !== null) {
    let restPv = pv || 0;
    let restGen = gen || 0;
    let uncovered = load;

    if (pv !== null) {
      alloc.pvToLoad = Math.min(restPv, uncovered);
      restPv -= alloc.pvToLoad;
      uncovered -= alloc.pvToLoad;
    }
    if (gen !== null) {
      alloc.generatorToLoad = Math.min(restGen, uncovered);
      restGen -= alloc.generatorToLoad;
      uncovered -= alloc.generatorToLoad;
    }
    if (batDischarge !== null) {
      alloc.batteryToLoad = Math.min(batDischarge, uncovered);
      uncovered -= alloc.batteryToLoad;
    }
    if (grid !== null) alloc.gridToLoad = Math.max(0, uncovered);

    if (batCharge !== null) {
      let toCharge = batCharge;
      if (pv !== null) { alloc.pvToBattery = Math.min(restPv, toCharge); restPv -= alloc.pvToBattery; toCharge -= alloc.pvToBattery; }
      if (gen !== null) { alloc.generatorToBattery = Math.min(restGen, toCharge); restGen -= alloc.generatorToBattery; toCharge -= alloc.generatorToBattery; }
      if (grid !== null) alloc.gridToBattery = Math.max(0, toCharge);
    }
    if (gridExport !== null) {
      // Same cascade as the load and the charge passes. Without a generator
      // term the whole export used to land on the battery — even while it was
      // charging, which is impossible and read as a wrong polarity.
      let rest = gridExport;
      if (pv !== null) { alloc.pvToGrid = Math.min(restPv, rest); restPv -= alloc.pvToGrid; rest -= alloc.pvToGrid; }
      if (gen !== null) { alloc.generatorToGrid = Math.min(restGen, rest); restGen -= alloc.generatorToGrid; rest -= alloc.generatorToGrid; }
      if (batDischarge) alloc.batteryToGrid = Math.max(0, rest);
    }
  }

  /* ── source mix covering the load ── */
  let mix = null;
  if (load !== null && load > IDLE_KW) {
    const parts = {
      pv: alloc.pvToLoad || 0,
      generator: alloc.generatorToLoad || 0,
      battery: alloc.batteryToLoad || 0,
      grid: alloc.gridToLoad || 0,
    };
    const total = parts.pv + parts.generator + parts.battery + parts.grid;
    if (total > 0) {
      mix = {
        pv: (parts.pv / total) * 100,
        generator: (parts.generator / total) * 100,
        battery: (parts.battery / total) * 100,
        grid: (parts.grid / total) * 100,
      };
    }
  }

  // Everything that did not come from the grid. A generator burns fuel, but it
  // is still not a purchase from the utility, which is what this number means.
  const selfSufficiency = mix ? clamp(100 - mix.grid, 0, 100) : null;

  return {
    links, alloc, mix, selfSufficiency,
    parts: { pv, gen, batCharge, batDischarge, gridImport: grid !== null ? Math.max(0, grid) : null, gridExport, load },
  };
}

function pos(v) { return isNum(v) ? Math.max(0, v) : null; }

/**
 * Descriptor of one link for the renderer.
 *  active     — whether to animate at all
 *  intensity  — 0..1, drives speed and brightness
 *  duration   — seconds for one particle run
 */
function link(value, dir, scale) {
  const v = isNum(value) ? value : null;
  const active = v !== null && v > IDLE_KW;
  const intensity = active ? clamp(v / scale, 0.02, 1) : 0;
  // 0.02 -> slow (3.4 s), 1.0 -> fast (0.55 s). Non-linear so the difference reads.
  const duration = active ? clamp(3.4 - 2.85 * Math.sqrt(intensity), 0.55, 3.4) : 0;
  return { value: v, dir: active ? dir : 'idle', active, intensity, duration };
}
