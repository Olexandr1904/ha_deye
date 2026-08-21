/**
 * power-flow.js — flow directions and energy distribution.
 *
 * The diagram is a star around the inverter (like Deye Cloud):
 *   PV / GRID / BATTERY  ⇄  INVERTER  ⇄  HOUSE
 * Direction and power of each link are measured quantities.
 *
 * On top of that the DISTRIBUTION is derived (pv->house, pv->battery, grid->house...).
 * That part is calculated, not measured: it follows from the power balance and is
 * shown in a separate block, so nothing derived is passed off as measured.
 */

import { isNum, clamp } from './utils.js';

/** Power below which a flow counts as absent (sensor noise). */
const IDLE_KW = 0.015;

export function computeFlow(state) {
  const pv = pos(state.pv.power);
  const bat = isNum(state.battery.power) ? state.battery.power : null;   // + = charging
  const grid = isNum(state.grid.power) ? state.grid.power : null;        // + = import
  const load = pos(state.load.power);

  const batCharge = bat !== null ? Math.max(0, bat) : null;
  const batDischarge = bat !== null ? Math.max(0, -bat) : null;
  const gridImport = grid !== null ? Math.max(0, grid) : null;
  const gridExport = grid !== null ? Math.max(0, -grid) : null;

  const scale = Math.max(1, state.meta.scaleKw || 1);

  const links = {
    solar: link(pv, 'toHub', scale),
    battery: bat === null ? link(null, 'toHub', scale)
      : link(Math.abs(bat), bat > 0 ? 'fromHub' : 'toHub', scale),
    grid: grid === null ? link(null, 'toHub', scale)
      : link(Math.abs(grid), grid > 0 ? 'toHub' : 'fromHub', scale),
    load: link(load, 'fromHub', scale),
  };

  /* ── distribution (greedy: self-consumption first) ── */
  const alloc = {
    pvToLoad: null, pvToBattery: null, pvToGrid: null,
    batteryToLoad: null, batteryToGrid: null,
    gridToLoad: null, gridToBattery: null,
  };

  // Only the load has to be known: a system without a total-PV sensor still
  // deserves a coverage breakdown. Sources that are not measured stay null
  // instead of having power attributed to them.
  if (load !== null) {
    let restPv = pv || 0;
    if (pv !== null) {
      alloc.pvToLoad = Math.min(restPv, load);
      restPv -= alloc.pvToLoad;
    }

    if (batCharge !== null) {
      if (pv !== null) {
        alloc.pvToBattery = Math.min(restPv, batCharge);
        restPv -= alloc.pvToBattery;
      }
      if (grid !== null) alloc.gridToBattery = Math.max(0, batCharge - (alloc.pvToBattery || 0));
    }
    if (gridExport !== null && pv !== null) {
      alloc.pvToGrid = Math.min(restPv, gridExport);
    }
    if (batDischarge !== null) {
      alloc.batteryToLoad = Math.min(batDischarge, Math.max(0, load - (alloc.pvToLoad || 0)));
      if (gridExport !== null) alloc.batteryToGrid = Math.max(0, gridExport - (alloc.pvToGrid || 0));
    }
    const covered = (alloc.pvToLoad || 0) + (alloc.batteryToLoad || 0);
    if (grid !== null) alloc.gridToLoad = Math.max(0, load - covered);
  }

  /* ── source mix covering the load ── */
  let mix = null;
  if (load !== null && load > IDLE_KW) {
    const fromPv = alloc.pvToLoad || 0;
    const fromBat = alloc.batteryToLoad || 0;
    const fromGrid = alloc.gridToLoad || 0;
    const total = fromPv + fromBat + fromGrid;
    if (total > 0) {
      mix = {
        pv: (fromPv / total) * 100,
        battery: (fromBat / total) * 100,
        grid: (fromGrid / total) * 100,
      };
    }
  }

  const selfSufficiency = mix ? clamp(mix.pv + mix.battery, 0, 100) : null;

  return {
    links, alloc, mix, selfSufficiency,
    parts: { pv, batCharge, batDischarge, gridImport, gridExport, load },
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
