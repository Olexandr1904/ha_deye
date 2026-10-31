/**
 * battery-runtime.js — how long the battery lasts.
 *
 * Two answers, both from the house's consumption rather than from what the
 * battery happens to deliver this minute (which is near zero whenever the sun
 * covers the house, and would read as days):
 *
 *   - at the present consumption, with nothing else feeding the house;
 *   - through the solar forecast: half-hour slots, the present consumption held
 *     constant, the battery charged by any surplus up to its capacity. Either it
 *     reaches the inverter's cut-off at a given time, or it holds and the lowest
 *     point says by how much.
 *
 * Energy is counted only down to the cut-off (the inverter's shutdown SOC):
 * below it the battery is not used, so it is not part of the answer.
 */

import { isNum } from './utils.js?v=1.3.0';

const HOUR_MS = 3600000;
const SLOT_MS = 30 * 60000;

/** Energy above the cut-off, kWh. */
export function usableKwh(capacityKwh, socPct, reservePct = 0) {
  if (!isNum(capacityKwh) || capacityKwh <= 0 || !isNum(socPct)) return null;
  const reserve = isNum(reservePct) ? reservePct : 0;
  return Math.max(0, (capacityKwh * (socPct - reserve)) / 100);
}

/** Hours the usable energy lasts at loadKw; null when the house draws nothing. */
export function runtimeHours(usable, loadKw) {
  if (!isNum(usable) || !isNum(loadKw) || loadKw <= 0.01) return null;
  return usable / loadKw;
}

/**
 * Simulates the battery through the forecast from `now`.
 * @param {Object} o
 * @param {number} o.now           ms
 * @param {number} o.socPct
 * @param {number} o.capacityKwh
 * @param {number} [o.reservePct]  the inverter's shutdown SOC
 * @param {number} o.loadKw        held constant
 * @param {Array<[number, number]>} o.slots [startMs, solar kW], sorted
 * @returns {null | {reachesAt: number|null, minPct: number, minAt: number, open?: true, atCutoff?: true}}
 *   null when the forecast does not cover now. reachesAt is when the cut-off
 *   comes; otherwise minPct/minAt is the lowest point. `open` means the forecast
 *   ended (or broke off) while the battery was still draining, so the lowest
 *   point is only where the forecast stopped looking; `atCutoff` that the
 *   battery is there already.
 */
export function forecastRuntime({ now, socPct, capacityKwh, reservePct = 0, loadKw, slots }) {
  if (!isNum(now) || !isNum(socPct) || !isNum(capacityKwh) || capacityKwh <= 0 || !isNum(loadKw) || !Array.isArray(slots)) return null;
  const reservePctSafe = isNum(reservePct) ? reservePct : 0;
  const reserve = (capacityKwh * reservePctSafe) / 100;
  let energy = (capacityKwh * socPct) / 100;

  // The forecast has to say something about now: a list that starts later, or
  // ended earlier, would leave the time in between to guesswork.
  const first = slots.findIndex(([start], i) => slotEnd(slots, i) > now);
  if (first < 0 || slots[first][0] > now) return null;
  if (energy <= reserve) return { reachesAt: now, minPct: socPct, minAt: now, atCutoff: true };

  let minEnergy = energy;
  let minAt = now;
  let lastNet = 0;
  let horizon = now;
  for (let i = first; i < slots.length; i++) {
    const [start, pv] = slots[i];
    const end = slotEnd(slots, i);
    if (!isNum(pv)) break;
    const from = Math.max(start, now);
    const hours = (end - from) / HOUR_MS;
    const net = pv - loadKw;                         // kW into the battery
    if (net < 0 && energy + net * hours <= reserve) {
      const reachesAt = from + ((energy - reserve) / -net) * HOUR_MS;
      return { reachesAt, minPct: reservePctSafe, minAt: reachesAt };
    }
    energy = Math.min(capacityKwh, energy + net * hours);
    if (energy < minEnergy) { minEnergy = energy; minAt = end; }
    lastNet = net;
    horizon = end;
    // A hole in the forecast ends it: whatever comes after is not continuous.
    if (i + 1 < slots.length && slots[i + 1][0] > end) break;
  }
  const result = { reachesAt: null, minPct: (minEnergy / capacityKwh) * 100, minAt };
  if (minAt === horizon && lastNet < 0) result.open = true;
  return result;
}

/** End of slot i: the next slot's start when it follows on, else one slot length. */
function slotEnd(slots, i) {
  const step = slotStep(slots);
  const next = slots[i + 1];
  return next && next[0] <= slots[i][0] + step ? next[0] : slots[i][0] + step;
}

/** The forecast's own slot length: the smallest step between starts. */
function slotStep(slots) {
  if (slots._step) return slots._step;
  let step = Infinity;
  for (let i = 1; i < slots.length; i++) {
    const d = slots[i][0] - slots[i - 1][0];
    if (d > 0 && d < step) step = d;
  }
  const value = Number.isFinite(step) ? step : SLOT_MS;
  Object.defineProperty(slots, '_step', { value, enumerable: false });
  return value;
}

/**
 * Forecast slots from one or more `detailedForecast` attributes (Solcast's
 * shape: {period_start, pv_estimate kW}) as [startMs, kW], in time order, one
 * per start — today's and tomorrow's lists overlap at nothing, but a repeated
 * list must not count twice. Anything unparseable is dropped.
 */
export function parseForecastSlots(...lists) {
  const byStart = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const slot of list) {
      const start = slot ? Date.parse(slot.period_start) : NaN;
      const kw = slot ? slot.pv_estimate : null;
      if (Number.isFinite(start) && isNum(kw)) byStart.set(start, kw);
    }
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]);
}

/** Already parsed [startMs, kW] lists, merged in time order, one slot per start. */
export function mergeSlots(...lists) {
  const byStart = new Map();
  for (const list of lists) if (Array.isArray(list)) for (const [start, kw] of list) byStart.set(start, kw);
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * A time-weighted mean over the last `windowMs`: each reading counts for as
 * long as it held. The reading that was current when the window opened is kept
 * as its anchor.
 */
export class RollingMean {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.samples = [];
  }

  push(t, value) {
    if (!isNum(t) || !isNum(value)) return;
    const last = this.samples[this.samples.length - 1];
    if (last && t < last[0]) return;
    // The demo pins its clock with ?hour=, so every update arrives at the same
    // instant: replace, or the list would grow for as long as the page is open.
    if (last && t === last[0]) { last[1] = value; return; }
    this.samples.push([t, value]);
    const from = t - this.windowMs;
    while (this.samples.length > 1 && this.samples[1][0] <= from) this.samples.shift();
  }

  reset() { this.samples = []; }

  mean(now) {
    const s = this.samples;
    if (!s.length) return null;
    const from = now - this.windowMs;
    let sum = 0, span = 0;
    for (let i = 0; i < s.length; i++) {
      const a = Math.max(s[i][0], from);
      const b = i + 1 < s.length ? s[i + 1][0] : now;
      if (b <= a) continue;
      sum += s[i][1] * (b - a);
      span += b - a;
    }
    return span > 0 ? sum / span : s[s.length - 1][1];
  }
}
