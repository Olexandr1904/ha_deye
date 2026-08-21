/**
 * demo.js — demonstration data source.
 *
 * Two purposes: preview the dashboard before entities are mapped, and debug the
 * UI without access to the inverter. It fully mimics the HAClient interface.
 *
 * It deliberately reports battery power with "+ = discharge" polarity, which is
 * how the sign auto-detection gets exercised (see energy-model.js).
 */

import { log } from './utils.js';
import { STATUS } from './ha-client.js';

const P = 'sensor.deye_';

export class DemoClient {
  constructor() {
    this.mode = 'demo';
    this._states = {};
    this._stateCbs = new Set();
    this._statusCbs = new Set();
    this._ready = false;
    // ?hour=13 pins the time of day (handy for debugging and screenshots)
    const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('hour') : null;
    this._hourOverride = param !== null && param !== '' && Number.isFinite(Number(param)) ? Number(param) : null;
    this._sim = simulate(this._now());
    this._daily = this._initDaily();
    this._build();
  }

  get status() { return STATUS.CONNECTED; }
  get connected() { return true; }
  get isReady() { return this._ready; }
  getStates() { return this._states; }
  getState(id) { return this._states[id] || null; }
  listEntityIds() { return Object.keys(this._states); }
  setTrackedEntities() {}
  onStatus(cb) { this._statusCbs.add(cb); cb(STATUS.CONNECTED); return () => this._statusCbs.delete(cb); }
  onStateChanged(cb) { this._stateCbs.add(cb); return () => this._stateCbs.delete(cb); }
  onReady(cb) { if (this._ready) cb(); else this._readyCb = cb; return () => {}; }

  start() {
    this._ready = true;
    if (this._readyCb) this._readyCb();
    this._timer = setInterval(() => this._tick(), 2000);
    log('demo mode started');
  }

  destroy() { clearInterval(this._timer); this._stateCbs.clear(); }

  /** Current time, honouring the debug hour override. */
  _now() {
    const d = new Date();
    if (this._hourOverride !== null) d.setHours(Math.floor(this._hourOverride), Math.round((this._hourOverride % 1) * 60), 0, 0);
    return d;
  }

  _initDaily() {
    // Daily totals: integrate the curve from midnight to now.
    const now = this._now();
    const step = 5 / 60; // five minutes, expressed in hours
    const acc = { pv: 0, load: 0, imp: 0, exp: 0, chg: 0, dis: 0 };
    let soc = 42;
    for (let hour = 0; hour < now.getHours() + now.getMinutes() / 60; hour += step) {
      const d = new Date(now); d.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
      const sim = simulate(d, soc);
      soc = sim.soc;
      acc.pv += sim.pv * step;
      acc.load += sim.load * step;
      acc.imp += Math.max(0, sim.grid) * step;
      acc.exp += Math.max(0, -sim.grid) * step;
      acc.chg += Math.max(0, sim.battery) * step;
      acc.dis += Math.max(0, -sim.battery) * step;
    }
    this._soc = soc;
    return acc;
  }

  _tick() {
    const now = this._now();
    const sim = simulate(now, this._soc, 2 / 3600);
    this._soc = sim.soc;
    const dt = 2 / 3600;
    this._daily.pv += sim.pv * dt;
    this._daily.load += sim.load * dt;
    this._daily.imp += Math.max(0, sim.grid) * dt;
    this._daily.exp += Math.max(0, -sim.grid) * dt;
    this._daily.chg += Math.max(0, sim.battery) * dt;
    this._daily.dis += Math.max(0, -sim.battery) * dt;
    this._build(sim);
  }

  _set(id, state, unit, deviceClass, name, stateClass) {
    const prev = this._states[id];
    const str = typeof state === 'number' ? String(Math.round(state * 100) / 100) : String(state);
    if (prev && prev.state === str) return;
    const obj = {
      entity_id: id,
      state: str,
      attributes: {
        unit_of_measurement: unit || undefined,
        device_class: deviceClass || undefined,
        state_class: stateClass || undefined,
        friendly_name: name || id,
      },
      last_updated: new Date().toISOString(),
      last_changed: new Date().toISOString(),
    };
    this._states[id] = obj;
    if (this._ready) this._stateCbs.forEach((cb) => cb(id, obj));
  }

  _build(sim = this._sim) {
    this._sim = sim;
    const d = this._daily;
    const W = (kw) => kw * 1000;

    this._set(`${P}pv_power`, W(sim.pv), 'W', 'power', 'Deye PV power', 'measurement');
    this._set(`${P}pv1_power`, W(sim.pv * 0.54), 'W', 'power', 'Deye PV1 power', 'measurement');
    this._set(`${P}pv2_power`, W(sim.pv * 0.46), 'W', 'power', 'Deye PV2 power', 'measurement');
    this._set(`${P}pv1_voltage`, sim.pv > 0.05 ? 372 + sim.noise * 9 : 0, 'V', 'voltage', 'Deye PV1 voltage');
    this._set(`${P}pv2_voltage`, sim.pv > 0.05 ? 366 + sim.noise * 7 : 0, 'V', 'voltage', 'Deye PV2 voltage');
    this._set(`${P}pv1_current`, sim.pv > 0.05 ? (W(sim.pv * 0.54) / (372 + sim.noise * 9)) : 0, 'A', 'current', 'Deye PV1 current');
    this._set(`${P}pv2_current`, sim.pv > 0.05 ? (W(sim.pv * 0.46) / (366 + sim.noise * 7)) : 0, 'A', 'current', 'Deye PV2 current');

    // NOTE: "+" means discharge here (inverted polarity) to exercise auto-detection
    this._set(`${P}battery_power`, W(-sim.battery), 'W', 'power', 'Deye battery power', 'measurement');
    this._set(`${P}battery_soc`, sim.soc, '%', 'battery', 'Deye battery SOC', 'measurement');
    this._set(`${P}battery_voltage`, 51.2 + (sim.soc - 50) * 0.038, 'V', 'voltage', 'Deye battery voltage');
    this._set(`${P}battery_current`, W(-sim.battery) / 51.2, 'A', 'current', 'Deye battery current');
    this._set(`${P}battery_temperature`, 23.5 + sim.noise * 1.4, '°C', 'temperature', 'Deye battery temperature');
    this._set(`${P}battery_status`, sim.battery > 0.05 ? 'Charge' : sim.battery < -0.05 ? 'Discharge' : 'Standby', '', '', 'Deye battery status');
    this._set(`${P}battery_soh`, 98, '%', '', 'Deye battery SOH');

    this._set(`${P}total_grid_power`, W(sim.grid), 'W', 'power', 'Deye total grid power', 'measurement');
    this._set(`${P}total_load_power`, W(sim.load), 'W', 'power', 'Deye total load power', 'measurement');
    this._set(`${P}ac_active_power`, W(sim.load), 'W', 'power', 'Deye AC active power', 'measurement');

    this._set(`${P}daily_production`, d.pv, 'kWh', 'energy', 'Deye daily production', 'total_increasing');
    this._set(`${P}daily_load_consumption`, d.load, 'kWh', 'energy', 'Deye daily load consumption', 'total_increasing');
    this._set(`${P}daily_energy_bought`, d.imp, 'kWh', 'energy', 'Deye daily energy bought', 'total_increasing');
    this._set(`${P}daily_energy_sold`, d.exp, 'kWh', 'energy', 'Deye daily energy sold', 'total_increasing');
    this._set(`${P}daily_battery_charge`, d.chg, 'kWh', 'energy', 'Deye daily battery charge', 'total_increasing');
    this._set(`${P}daily_battery_discharge`, d.dis, 'kWh', 'energy', 'Deye daily battery discharge', 'total_increasing');
    this._set(`${P}total_production`, 18426 + d.pv, 'kWh', 'energy', 'Deye total production', 'total_increasing');

    this._set(`${P}radiator_temp`, 28 + sim.load * 1.7 + sim.pv * 0.5, '°C', 'temperature', 'Deye radiator temperature');
    this._set(`${P}ac_freq`, 50 + sim.noise * 0.03, 'Hz', 'frequency', 'Deye AC frequency');
    this._set(`${P}running_status`, 'Normal', '', '', 'Deye running status');

    const phases = [0.38, 0.33, 0.29];
    ['l1', 'l2', 'l3'].forEach((ph, i) => {
      this._set(`${P}ac_${ph}_power`, W(sim.load * phases[i]), 'W', 'power', `Deye AC ${ph.toUpperCase()} power`, 'measurement');
      this._set(`${P}ac_${ph}_voltage`, 229 + i * 1.4 + sim.noise * 2, 'V', 'voltage', `Deye AC ${ph.toUpperCase()} voltage`);
      this._set(`${P}ac_${ph}_current`, W(sim.load * phases[i]) / 230, 'A', 'current', `Deye AC ${ph.toUpperCase()} current`);
    });
  }

  /* ── fake WebSocket commands for history and statistics ── */
  async callWS(msg) {
    if (msg.type === 'get_states') return Object.values(this._states);
    if (msg.type === 'history/history_during_period') {
      const from = Date.parse(msg.start_time);
      const to = Date.parse(msg.end_time);
      const out = {};
      for (const id of msg.entity_ids) {
        const pts = [];
        let soc = 42;
        for (let t = from; t <= to; t += 5 * 60000) {
          const sim = simulate(new Date(t), soc);
          soc = sim.soc;
          pts.push({ s: String(Math.round(seriesValue(id, sim) * 1000)), lu: t / 1000 });
        }
        out[id] = pts;
      }
      return out;
    }
    if (msg.type === 'recorder/statistics_during_period') {
      const out = {};
      const days = Math.max(1, Math.ceil((Date.parse(msg.end_time) - Date.parse(msg.start_time)) / 86400000));
      for (const id of msg.statistic_ids) {
        const rows = [];
        for (let i = days - 1; i >= 0; i--) {
          const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - i);
          const weather = 0.55 + 0.45 * Math.abs(Math.sin(day.getDate() * 1.7 + day.getMonth()));
          const base = { daily_production: 41 * weather, daily_load_consumption: 17 + 4 * Math.sin(day.getDate()), daily_energy_bought: 4.4 * (1.2 - weather), daily_energy_sold: 16 * weather, daily_battery_charge: 11 * weather, daily_battery_discharge: 9.4 };
          const key = Object.keys(base).find((k) => id.includes(k));
          rows.push({ start: +day, end: +day + 86400000, change: key ? Math.max(0, base[key]) : 0 });
        }
        out[id] = rows;
      }
      return out;
    }
    if (msg.type === 'recorder/list_statistic_ids') {
      return Object.keys(this._states).filter((id) => (this._states[id].attributes.device_class === 'energy')).map((id) => ({ statistic_id: id }));
    }
    return null;
  }
}

function seriesValue(id, sim) {
  if (id.includes('battery_power')) return -sim.battery;
  if (id.includes('grid_power')) return sim.grid;
  if (id.includes('load_power') || id.includes('ac_active_power')) return sim.load;
  if (id.includes('pv1')) return sim.pv * 0.54;
  if (id.includes('pv2')) return sim.pv * 0.46;
  if (id.includes('pv')) return sim.pv;
  return sim.load;
}

/** Simple physical simulation: a solar curve, a house profile and a battery buffer. */
function simulate(date, socIn, stepHours = 5 / 60) {
  const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const seed = date.getDate() * 1.7 + date.getMonth();
  const clouds = 0.72 + 0.28 * Math.sin(hour * 1.9 + seed) * Math.sin(hour * 0.53 + seed * 0.7);
  const noise = Math.sin(hour * 37.1 + seed) * 0.5 + Math.sin(hour * 91.3) * 0.5;

  // Sun: 05:30 to 20:30, peaking at ~9.4 kW around 13:00
  const day = Math.sin((Math.PI * (hour - 5.5)) / 15);
  const pv = hour > 5.5 && hour < 20.5 ? Math.max(0, 9.4 * Math.pow(Math.max(0, day), 1.45) * clouds) : 0;

  // House: base consumption plus a morning and an evening peak
  const morning = 1.9 * Math.exp(-((hour - 7.6) ** 2) / 1.5);
  const evening = 2.6 * Math.exp(-((hour - 19.8) ** 2) / 2.6);
  const load = Math.max(0.24, 0.55 + morning + evening + 0.22 * noise);

  let soc = socIn === undefined ? 58 : socIn;
  const surplus = pv - load;

  // Battery: charge from the surplus (up to 6 kW), discharge on a deficit (up to 5 kW)
  // Near full or empty the power tapers, which is when export and import appear.
  const maxCharge = 6 * Math.min(1, Math.max(0, (100 - soc) / 11));
  const maxDischarge = 5 * Math.min(1, Math.max(0, (soc - 16) / 9));
  let battery = 0; // + = charging
  if (surplus > 0.08) battery = Math.min(surplus, maxCharge);
  else if (surplus < -0.08) battery = -Math.min(-surplus, maxDischarge);

  const grid = load + battery - pv;    // + = import

  // 20 kWh capacity. The step comes from the caller: the live tick advances by
  // two seconds, while history is integrated in five-minute steps.
  soc = Math.max(5, Math.min(100, soc + ((battery * stepHours) / 20) * 100));

  return { pv, load, battery, grid, soc, noise, clouds };
}

export { simulate };
