/**
 * demo.js — demonstration data source.
 *
 * Two purposes: preview the dashboard before entities are mapped, and debug the
 * UI without access to the inverter. It fully mimics the HAClient interface.
 *
 * It deliberately reports battery power with "+ = discharge" polarity, which is
 * how the sign auto-detection gets exercised (see energy-model.js).
 */

import { log } from './utils.js?v=1.3.0';
import { STATUS } from './ha-client.js?v=1.3.0';

const P = 'sensor.deye_';

/**
 * The simulated system has a history: nothing before this date, and detailed
 * states are kept for a limited window while statistics survive — exactly the
 * asymmetry a real Recorder has.
 */
const INSTALLED = new Date(2026, 0, 1);
const DETAIL_RETENTION_DAYS = 120;

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
    // The daily replay first: it is what establishes the current SOC. Building
    // the snapshot before it would publish simulate()'s default 58 %, so the
    // very first paint disagreed with the entity until the first tick.
    this._daily = this._initDaily();
    this._sim = simulate(this._now(), this._soc, 2 / 3600);
    this._soc = this._sim.soc;
    this._build();
  }

  get status() { return STATUS.CONNECTED; }
  get connected() { return true; }
  get isReady() { return this._ready; }
  /** The demo's clock (pinned by ?hour=), which the model's time-based figures follow. */
  now() { return this._now().getTime(); }
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
    const acc = { pv: 0, load: 0, imp: 0, exp: 0, chg: 0, dis: 0, gen: 0 };
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
      acc.gen += sim.generator * step;
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
    this._daily.gen += sim.generator * dt;
    this._build(sim);
  }

  _set(id, state, unit, deviceClass, name, stateClass, extra = null) {
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
        ...(extra || {}),
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
    this._set(`${P}pv1_voltage`, sim.pv > 0.05 ? 372 + sim.noise * 9 : 0, 'V', 'voltage', 'Deye PV1 voltage', 'measurement');
    this._set(`${P}pv2_voltage`, sim.pv > 0.05 ? 366 + sim.noise * 7 : 0, 'V', 'voltage', 'Deye PV2 voltage', 'measurement');
    this._set(`${P}pv1_current`, sim.pv > 0.05 ? (W(sim.pv * 0.54) / (372 + sim.noise * 9)) : 0, 'A', 'current', 'Deye PV1 current', 'measurement');
    this._set(`${P}pv2_current`, sim.pv > 0.05 ? (W(sim.pv * 0.46) / (366 + sim.noise * 7)) : 0, 'A', 'current', 'Deye PV2 current', 'measurement');

    // NOTE: "+" means discharge here (inverted polarity) to exercise auto-detection
    this._set(`${P}battery_power`, W(-sim.battery), 'W', 'power', 'Deye battery power', 'measurement');
    this._set(`${P}battery_soc`, sim.soc, '%', 'battery', 'Deye battery SOC', 'measurement');
    this._set(`${P}battery_voltage`, 51.2 + (sim.soc - 50) * 0.038, 'V', 'voltage', 'Deye battery voltage', 'measurement');
    this._set(`${P}battery_current`, W(-sim.battery) / 51.2, 'A', 'current', 'Deye battery current', 'measurement');
    this._set(`${P}battery_temperature`, 23.5 + sim.noise * 1.4, '°C', 'temperature', 'Deye battery temperature', 'measurement');
    this._set(`${P}battery_status`, sim.battery > 0.05 ? 'Charge' : sim.battery < -0.05 ? 'Discharge' : 'Standby', '', '', 'Deye battery status');
    this._set(`${P}battery_soh`, 98, '%', '', 'Deye battery SOH');
    // The simulated battery's size, and the inverter's cut-off — a setpoint, as
    // on the real inverter. Time on battery is counted against both.
    this._set(`${P}battery_capacity`, 20, 'kWh', 'energy_storage', 'Deye battery capacity');
    this._set('number.deye_battery_shutdown_soc', 10, '%', '', 'Deye battery shutdown SOC');
    // A solar forecast in Solcast's shape: the day's kWh as the state, the
    // half-hour slots in detailedForecast. The same sun curve, without its noise.
    for (const [suffix, offset, label] of [['today', 0, 'Today'], ['tomorrow', 1, 'Tomorrow']]) {
      const slots = this._forecast(offset);
      this._set(`sensor.solcast_pv_forecast_forecast_${suffix}`, slots.reduce((a, x) => a + x.pv_estimate / 2, 0), 'kWh', 'energy',
        `Solcast PV Forecast Forecast ${label}`, undefined, { detailedForecast: slots });
    }

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
    // The real inverter exposes lifetime battery counters next to the daily ones.
    this._set(`${P}total_battery_charge`, 9741 + d.chg, 'kWh', 'energy', 'Deye total battery charge', 'total_increasing');
    this._set(`${P}total_battery_discharge`, 8903 + d.dis, 'kWh', 'energy', 'Deye total battery discharge', 'total_increasing');

    // The generator runs in the evening, so ?hour=20 exercises the five-spoke
    // diagram, the fourth coverage segment and the generator card.
    this._set(`${P}generator_power`, W(sim.generator), 'W', 'power', 'Deye generator power', 'measurement');
    this._set(`${P}generator_energy_today`, d.gen, 'kWh', 'energy', 'Deye generator energy today', 'total_increasing');
    this._set(`${P}generator_energy_total`, 214 + d.gen, 'kWh', 'energy', 'Deye generator energy total', 'total_increasing');
    this._set(`${P}generator_voltage`, sim.generator > 0.05 ? 231 + sim.noise * 2 : 0, 'V', 'voltage', 'Deye generator voltage', 'measurement');
    this._set(`${P}generator_status`, sim.generator > 0.05 ? 'Running' : 'Stopped', '', '', 'Deye generator status');

    this._set(`${P}radiator_temp`, 28 + sim.load * 1.7 + sim.pv * 0.5, '°C', 'temperature', 'Deye radiator temperature', 'measurement');
    this._set(`${P}ac_freq`, 50 + sim.noise * 0.03, 'Hz', 'frequency', 'Deye AC frequency', 'measurement');
    this._set(`${P}running_status`, 'Normal', '', '', 'Deye running status');

    const phases = [0.38, 0.33, 0.29];
    ['l1', 'l2', 'l3'].forEach((ph, i) => {
      this._set(`${P}ac_${ph}_power`, W(sim.load * phases[i]), 'W', 'power', `Deye AC ${ph.toUpperCase()} power`, 'measurement');
      this._set(`${P}ac_${ph}_voltage`, 229 + i * 1.4 + sim.noise * 2, 'V', 'voltage', `Deye AC ${ph.toUpperCase()} voltage`, 'measurement');
      this._set(`${P}ac_${ph}_current`, W(sim.load * phases[i]) / 230, 'A', 'current', `Deye AC ${ph.toUpperCase()} current`, 'measurement');
    });
  }

  /** Half-hour forecast slots for today (offset 0) or tomorrow (1), cached per day. */
  _forecast(offset) {
    const day = this._now(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() + offset);
    const key = `${day.getTime()}`;
    this._forecasts = this._forecasts || {};
    if (!this._forecasts[key]) {
      this._forecasts[key] = Array.from({ length: 48 }, (_, i) => {
        const start = new Date(day.getTime() + i * 30 * 60000);
        const pv = Math.round(simulate(new Date(start.getTime() + 15 * 60000), 50).pv * 1000) / 1000;
        return { period_start: start.toISOString(), pv_estimate: pv, pv_estimate10: Math.round(pv * 600) / 1000, pv_estimate90: Math.round(pv * 1200) / 1000 };
      });
    }
    return this._forecasts[key];
  }

  /**
   * A mean/min/max band for an instantaneous sensor, anchored to the sensor's
   * own current value so a voltage never reads 0 V for a whole year or swings
   * by half its magnitude.
   */
  _fakeBand(id, w) {
    const st = this._states[id];
    const nominal = st ? Math.abs(parseFloat(st.state)) : NaN;
    const base = Number.isFinite(nominal) && nominal > 0 ? nominal : 1;
    const spread = /volt|freq|soh|temp/.test(id) ? 0.06 : 0.45;   // stable quantities barely move
    return {
      mean: base * (1 - spread * 0.25 + spread * 0.5 * w),
      min: base * (1 - spread),
      max: base * (1 + spread * 0.6),
    };
  }

  /* ── fake WebSocket commands for history and statistics ── */
  async callWS(msg) {
    if (msg.type === 'get_states') return Object.values(this._states);
    if (msg.type === 'history/history_during_period') {
      const retentionStart = Date.now() - DETAIL_RETENTION_DAYS * 86400000;
      const from = Math.max(Date.parse(msg.start_time), +INSTALLED, retentionStart);
      const to = Date.parse(msg.end_time);
      const out = {};
      if (from >= to) {
        // Outside the retention window: statistics still answer, states do not.
        for (const id of msg.entity_ids) out[id] = [];
        return out;
      }
      for (const id of msg.entity_ids) {
        const pts = [];
        let soc = 42;
        for (let t = from; t <= to; t += 5 * 60000) {
          const sim = simulate(new Date(t), soc);
          soc = sim.soc;
          const dayFraction = (t - new Date(t).setHours(0, 0, 0, 0)) / 86400000;
          pts.push({ s: String(seriesValue(id, sim, dayFraction)), lu: t / 1000 });
        }
        out[id] = pts;
      }
      return out;
    }
    if (msg.type === 'recorder/statistics_during_period') {
      const from = new Date(Date.parse(msg.start_time));
      const to = new Date(Date.parse(msg.end_time));
      const period = msg.period || 'day';
      const types = msg.types || ['change'];
      const wantsBand = types.includes('mean');
      const out = {};

      // Deterministic pseudo-weather so a given date always looks the same.
      const weatherOf = (d) => 0.55 + 0.45 * Math.abs(Math.sin(d.getDate() * 1.7 + d.getMonth() * 2.3 + d.getFullYear()));
      const dailyOf = (d) => {
        const w = weatherOf(d);
        const gen = d.getDate() % 6 === 0 ? 9 : 0;   // the generator runs now and then
        return {
          daily_production: 41 * w,
          daily_load_consumption: 17 + 4 * Math.sin(d.getDate()),
          daily_energy_bought: 4.4 * (1.2 - w),
          daily_energy_sold: 16 * w,
          daily_battery_charge: 11 * w,
          daily_battery_discharge: 9.4,
          generator_energy_today: gen,
          // A lifetime counter's per-bucket change is the same energy as the
          // daily one's, which is what makes it a usable fallback.
          total_battery_charge: 11 * w,
          total_battery_discharge: 9.4,
          total_production: 41 * w,
          total_load_consumption: 17 + 4 * Math.sin(d.getDate()),
        };
      };
      const pick = (id, day) => {
        const table = dailyOf(day);
        // Longest key first: `total_battery_charge` must not match on `charge`.
        const key = Object.keys(table).sort((a, b) => b.length - a.length).find((k) => id.includes(k));
        return key ? Math.max(0, table[key]) : 0;
      };

      for (const id of msg.statistic_ids) {
        const rows = [];
        // No state_class, no statistics — exactly what Recorder would answer.
        if (!(this._states[id] && this._states[id].attributes.state_class)) { out[id] = rows; continue; }
        if (period === 'hour') {
          // The dashboard asks for hourly buckets when a total has to be exact.
          // A day's energy spread evenly over its hours keeps every sum equal to
          // the daily figure while exercising the same code path as the real one.
          const cursor = new Date(from); cursor.setMinutes(0, 0, 0);
          while (cursor < to) {
            if (cursor >= INSTALLED) {
              const row = { start: +cursor, end: +cursor + 3600000, change: pick(id, cursor) / 24 };
              if (wantsBand) Object.assign(row, this._fakeBand(id, weatherOf(cursor)));
              rows.push(row);
            }
            cursor.setHours(cursor.getHours() + 1);
          }
        } else if (period === 'month') {
          const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
          while (cursor < to) {
            const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            if (next <= INSTALLED) { cursor.setMonth(cursor.getMonth() + 1); continue; }
            let total = 0;
            for (let d = new Date(cursor); d < next && d < to; d.setDate(d.getDate() + 1)) {
              if (d >= INSTALLED) total += pick(id, d);
            }
            const row = { start: +cursor, end: +next, change: total };
            if (wantsBand) Object.assign(row, this._fakeBand(id, weatherOf(cursor)));
            rows.push(row);
            cursor.setMonth(cursor.getMonth() + 1);
          }
        } else {
          const cursor = new Date(from); cursor.setHours(0, 0, 0, 0);
          while (cursor < to) {
            if (cursor < INSTALLED) { cursor.setDate(cursor.getDate() + 1); continue; }
            const value = pick(id, cursor);
            const row = { start: +cursor, end: +cursor + 86400000, change: value };
            if (wantsBand) Object.assign(row, this._fakeBand(id, weatherOf(cursor)));
            rows.push(row);
            cursor.setDate(cursor.getDate() + 1);
          }
        }
        out[id] = rows;
      }
      return out;
    }
    if (msg.type === 'recorder/list_statistic_ids') {
      // Home Assistant keeps long-term statistics only for sensors that declare
      // a state_class — `sensor.deye_battery_soh` deliberately declares none, so
      // the "this sensor has no recorded history" path stays exercised.
      return Object.keys(this._states)
        .filter((id) => this._states[id].attributes.state_class)
        .map((id) => ({ statistic_id: id }));
    }
    return null;
  }
}

/**
 * A plausible history sample for any demo entity, already in that entity's own
 * unit — the dialog can be opened on any role, so returning watts for a
 * temperature sensor would produce nonsense like "680 °C".
 */
function seriesValue(id, sim, dayFraction = 0.5) {
  const kw = (v) => Math.round(v * 1000);                    // W
  const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  if (/soc$|battery$/.test(id)) return round(sim.soc, 1);
  if (id.includes('soh')) return 98;
  if (/temp/.test(id)) {
    if (id.includes('battery')) return round(23.5 + sim.noise * 1.4, 1);
    return round(28 + sim.load * 1.7 + sim.pv * 0.5, 1);
  }
  if (/volt/.test(id)) {
    if (id.includes('battery')) return round(51.2 + (sim.soc - 50) * 0.038, 2);
    if (id.includes('pv1')) return sim.pv > 0.05 ? round(372 + sim.noise * 9, 1) : 0;
    if (id.includes('pv2')) return sim.pv > 0.05 ? round(366 + sim.noise * 7, 1) : 0;
    if (id.includes('generator')) return sim.generator > 0.05 ? round(231 + sim.noise * 2, 1) : 0;
    return round(229 + sim.noise * 2, 1);
  }
  if (/curr/.test(id)) {
    if (id.includes('battery')) return round((-sim.battery * 1000) / 51.2, 2);
    if (id.includes('pv1')) return sim.pv > 0.05 ? round((sim.pv * 540) / 372, 2) : 0;
    if (id.includes('pv2')) return sim.pv > 0.05 ? round((sim.pv * 460) / 366, 2) : 0;
    return round((sim.load * 1000) / 3 / 230, 2);
  }
  if (/freq/.test(id)) return round(50 + sim.noise * 0.03, 2);
  // Accumulating counters: a share of the day's total, so the curve rises.
  if (/total_production/.test(id)) return round(18426 + 41 * dayFraction, 1);
  if (/daily_production|today_production/.test(id)) return round(41 * dayFraction, 2);
  if (/daily_load|load_consumption/.test(id)) return round(18 * dayFraction, 2);
  if (/energy_bought|energy_import/.test(id)) return round(3 * dayFraction, 2);
  if (/energy_sold|energy_export/.test(id)) return round(15 * dayFraction, 2);
  if (/battery_charge/.test(id)) return round(11 * dayFraction, 2);
  if (/battery_discharge/.test(id)) return round(9 * dayFraction, 2);
  if (/generator_energy_total/.test(id)) return round(214 + 4 * dayFraction, 2);
  if (/generator_energy/.test(id)) return round(Math.max(0, 4 * (dayFraction - 0.79)) * 12, 2);

  if (id.includes('generator_power')) return kw(sim.generator);
  if (id.includes('battery_power')) return kw(-sim.battery);
  if (id.includes('grid_power')) return kw(sim.grid);
  if (id.includes('load_power') || id.includes('ac_active_power')) return kw(sim.load);
  if (/l[123]_power/.test(id)) return kw(sim.load / 3);
  if (id.includes('pv1')) return kw(sim.pv * 0.54);
  if (id.includes('pv2')) return kw(sim.pv * 0.46);
  if (id.includes('pv')) return kw(sim.pv);
  return kw(sim.load);
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

  // Generator: a fixed evening window, deterministic so tests can rely on it.
  const generator = hour >= 19 && hour < 21 ? 4.5 : 0;

  let soc = socIn === undefined ? 58 : socIn;
  const surplus = pv + generator - load;

  // Battery: charge from the surplus (up to 6 kW), discharge on a deficit (up to 5 kW)
  // Near full or empty the power tapers, which is when export and import appear.
  const maxCharge = 6 * Math.min(1, Math.max(0, (100 - soc) / 11));
  const maxDischarge = 5 * Math.min(1, Math.max(0, (soc - 16) / 9));
  let battery = 0; // + = charging
  if (surplus > 0.08) battery = Math.min(surplus, maxCharge);
  else if (surplus < -0.08) battery = -Math.min(-surplus, maxDischarge);

  const grid = load + battery - pv - generator;    // + = import

  // 20 kWh capacity. The step comes from the caller: the live tick advances by
  // two seconds, while history is integrated in five-minute steps.
  soc = Math.max(5, Math.min(100, soc + ((battery * stepHours) / 20) * 100));

  return { pv, load, battery, grid, generator, soc, noise, clouds };
}

export { simulate };
