/**
 * energy-model.js — the dashboard data model.
 *
 * The UI reads ONLY this object, never Home Assistant state objects.
 * Signs are settled here too: different Deye integrations report battery and
 * grid power with different polarity, so the direction is detected
 * automatically (or pinned manually in CONFIG.powerDirection).
 *
 * Internal conventions (after normalisation):
 *   battery.power  > 0  — charging (energy goes INTO the battery)
 *   grid.power     > 0  — import   (energy comes FROM the grid)
 */

import { LEARN_KEY } from './config.js';
import { isNum, log, clamp } from './utils.js';
import { num } from './entity-manager.js';

const OFFLINE_WORDS = /(off|standby|stand_by|sleep|shutdown|stop|idle|disconnect|waiting)/i;
const FAULT_WORDS = /(fault|error|alarm|fail)/i;
const ONLINE_WORDS = /(normal|running|run|grid|generat|on_?grid|self|work|active|charg|discharg|bypass|eps|hybrid)/i;

/* ───────────────────── polarity detection ───────────────────── */

/**
 * SignLearner — works out sensor polarity from three independent signals:
 *   1) daily energy counters (strongest: "sold" grows => that sign means export);
 *   2) SOC changes (battery only — again a fact, not a guess);
 *   3) the power balance pv + grid_import = load + battery_charge (fallback).
 * The result is cached in localStorage so it is not re-learned on every load.
 */
class SignLearner {
  constructor(kind, positiveName, negativeName) {
    this.kind = kind;                    // 'battery' | 'grid'
    this.positiveName = positiveName;    // meaning of a positive reading
    this.negativeName = negativeName;
    this.votes = 0;                      // >0 → positiveName, <0 → negativeName
    this.err = { pos: 0, neg: 0 };
    this.samples = 0;
    this.resolved = null;
    this.source = 'default';
  }

  toJSON() { return { votes: this.votes, err: this.err, samples: this.samples, resolved: this.resolved, source: this.source }; }

  restore(data) {
    if (!data) return;
    this.votes = data.votes || 0;
    this.err = data.err || { pos: 0, neg: 0 };
    this.samples = data.samples || 0;
    this.resolved = data.resolved || null;
    this.source = data.source || 'default';
  }

  /** Vote from hard evidence (energy counter / SOC); weight is its strength. */
  vote(positiveMeans, weight = 1) {
    this.votes += (positiveMeans === this.positiveName ? weight : -weight);
    this.votes = clamp(this.votes, -20, 20);
    if (Math.abs(this.votes) >= 2) {
      const next = this.votes > 0 ? this.positiveName : this.negativeName;
      if (next !== this.resolved) log(`${this.kind} polarity: ${next} (from evidence, votes=${this.votes})`);
      this.resolved = next;
      this.source = 'evidence';
    }
  }

  /** Fallback signal: the residual of the power balance. */
  observeBalance(errPos, errNeg) {
    if (!isNum(errPos) || !isNum(errNeg)) return;
    this.err.pos += errPos;
    this.err.neg += errNeg;
    this.samples++;
    if (this.source === 'evidence') return;             // facts outrank the balance
    if (this.samples < 3) return;
    const better = this.err.pos <= this.err.neg ? this.positiveName : this.negativeName;
    const lo = Math.min(this.err.pos, this.err.neg);
    const hi = Math.max(this.err.pos, this.err.neg);
    if (hi > 0 && lo / hi > 0.75) return;               // difference is not convincing
    if (better !== this.resolved) log(`${this.kind} polarity: ${better} (from the balance, ${this.samples} samples)`);
    this.resolved = better;
    this.source = 'balance';
  }

  get value() { return this.resolved || this.positiveName; }
  get confidence() {
    if (this.source === 'evidence') return Math.min(1, Math.abs(this.votes) / 5);
    if (this.source === 'balance') {
      const lo = Math.min(this.err.pos, this.err.neg);
      const hi = Math.max(this.err.pos, this.err.neg);
      return hi > 0 ? clamp(1 - lo / hi, 0, 1) : 0;
    }
    return 0;
  }
}

/* ─────────────────────────── the model ─────────────────────────── */

export class EnergyModel {
  constructor(config) {
    this.config = config;
    this.batteryLearner = new SignLearner('battery', 'charge_positive', 'discharge_positive');
    this.gridLearner = new SignLearner('grid', 'import_positive', 'export_positive');
    this._restoreLearned();
    // Keys match the role names _counterVote actually reads and writes.
    this._prev = {
      soc: null, gridImportToday: null, gridExportToday: null,
      batteryChargeToday: null, batteryDischargeToday: null,
    };
    this._peakPv = 0;
  }

  setConfig(config) { this.config = config; }

  _restoreLearned() {
    try {
      const raw = localStorage.getItem(LEARN_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.batteryLearner.restore(data.battery);
      this.gridLearner.restore(data.grid);
      log('restored learned polarity:', data);
    } catch (e) { /* not critical */ }
  }

  _persistLearned() {
    try {
      localStorage.setItem(LEARN_KEY, JSON.stringify({ battery: this.batteryLearner, grid: this.gridLearner }));
    } catch (e) { /* not critical */ }
  }

  resetLearned() {
    this.batteryLearner = new SignLearner('battery', 'charge_positive', 'discharge_positive');
    this.gridLearner = new SignLearner('grid', 'import_positive', 'export_positive');
    try { localStorage.removeItem(LEARN_KEY); } catch (e) {}
  }

  /**
   * Builds the model from normalised values (EntityManager.values).
   * @param {Object} values
   * @param {Object} meta {connection, lastUpdate}
   */
  build(values, meta = {}) {
    const g = (k) => num(values, k);
    const txt = (k) => (values[k] && typeof values[k].value === 'string' ? values[k].value : null);

    /* ── PV ── */
    const strings = [];
    for (const i of [1, 2, 3, 4]) {
      const p = g(`pv${i}Power`), v = g(`pv${i}Voltage`), c = g(`pv${i}Current`);
      if (p !== null || v !== null || c !== null) {
        strings.push({ key: `PV${i}`, power: p !== null ? p : (isNum(v) && isNum(c) ? (v * c) / 1000 : null), voltage: v, current: c });
      }
    }
    let pvPower = g('pvPower');
    if (pvPower === null && strings.length) {
      const s = strings.filter((x) => isNum(x.power));
      pvPower = s.length ? s.reduce((a, x) => a + x.power, 0) : null;
    }
    if (isNum(pvPower)) pvPower = Math.max(0, pvPower);

    /* ── Battery ── */
    const batteryRaw = g('batteryPower');
    const chargeP = g('batteryChargePower');
    const dischargeP = g('batteryDischargePower');
    const soc = g('batterySoc');
    const statusText = txt('batteryStatus');

    /* ── Grid ── */
    const gridRaw = g('gridPower');
    const importP = g('gridImportPower');
    const exportP = g('gridExportPower');

    /* ── Generator ── */
    const generatorPower = g('generatorPower');
    const generatorToday = g('generatorToday');
    const generatorRelevant = (isNum(generatorPower) && generatorPower > 0.015)
      || (isNum(generatorToday) && generatorToday > 0.01);

    /* ── Load ── */
    // 'inverted' is for sensors that report consumption as a negative number.
    // Taking abs() unconditionally (as an earlier version did) made the setting
    // a no-op and silently masked the very sign problem it exists to fix.
    let load = g('loadPower');
    if (isNum(load)) {
      if (this.config.powerDirection.load === 'inverted') load = -load;
      load = Math.max(0, load);
    }

    /* ── learn the polarity ── */
    // The generator is passed separately: coercing a missing PV reading to zero
    // here would let the balance vote run as if the array produced nothing,
    // which is routine when the inverter drops off the Modbus bus — and the
    // learned sign is persisted.
    this._learn({
      values, soc, batteryRaw, gridRaw, load, statusText, pvPower,
      generatorPower: generatorRelevant && isNum(generatorPower) ? generatorPower : null,
    });

    /* ── apply the polarity ── */
    let batteryPower = null; // + = charging
    if (isNum(chargeP) || isNum(dischargeP)) {
      batteryPower = (isNum(chargeP) ? chargeP : 0) - (isNum(dischargeP) ? dischargeP : 0);
    } else if (isNum(batteryRaw)) {
      batteryPower = this.batterySign === 'charge_positive' ? batteryRaw : -batteryRaw;
    }

    let gridPower = null; // + = import
    if (isNum(importP) || isNum(exportP)) {
      gridPower = (isNum(importP) ? importP : 0) - (isNum(exportP) ? exportP : 0);
    } else if (isNum(gridRaw)) {
      gridPower = this.gridSign === 'import_positive' ? gridRaw : -gridRaw;
    }

    // Treat very small readings as zero (sensor noise of about +/-10 W)
    const dead = 0.012;
    if (isNum(batteryPower) && Math.abs(batteryPower) < dead) batteryPower = 0;
    if (isNum(gridPower) && Math.abs(gridPower) < dead) gridPower = 0;

    /* ── Inverter ── */
    const invStatus = txt('inverterStatus');
    const alarm = txt('inverterAlarm');
    let inverterPower = g('inverterPower');
    if (inverterPower === null && isNum(load)) inverterPower = load;
    const ratedPowerKw = this.config.ratedPowerKw || null;

    const state = {
      pv: {
        power: pvPower,
        today: g('pvToday'),
        total: g('pvTotal'),
        strings,
      },
      battery: {
        soc,
        power: batteryPower,
        charging: isNum(batteryPower) && batteryPower > 0,
        discharging: isNum(batteryPower) && batteryPower < 0,
        voltage: g('batteryVoltage'),
        // Show current with the same convention as power: the magnitude is
        // measured, the direction comes from normalised power (else "+6 kW / -117 A").
        current: alignSign(g('batteryCurrent'), batteryPower),
        temperature: g('batteryTemperature'),
        soh: g('batterySoh'),
        status: statusText,
        chargeToday: g('batteryChargeToday'),
        dischargeToday: g('batteryDischargeToday'),
        capacity: g('batteryCapacity'),
        timeToFull: null,
        timeToEmpty: null,
      },
      grid: {
        power: gridPower,
        importing: isNum(gridPower) && gridPower > 0,
        exporting: isNum(gridPower) && gridPower < 0,
        todayImport: g('gridImportToday'),
        todayExport: g('gridExportToday'),
        voltage: g('gridVoltage'),
        frequency: g('gridFrequency'),
      },
      load: {
        power: load,
        today: g('loadToday'),
        total: g('loadTotal'),
      },
      generator: {
        power: generatorPower,
        today: g('generatorToday'),
        total: g('generatorTotal'),
        voltage: g('generatorVoltage'),
        status: txt('generatorStatus'),
        running: isNum(generatorPower) && generatorPower > 0.015,
        // "Relevant" drives the diagram and the card: once the generator has run
        // today the daily counter keeps it visible until midnight, so the layout
        // changes shape at most once a day.
        relevant: generatorRelevant,
      },
      inverter: {
        power: inverterPower,
        temperature: g('inverterTemperature'),
        statusText: invStatus,
        alarm: alarm && !/^(0|none|no|ok|normal)$/i.test(alarm) ? alarm : null,
        ratedPowerKw,
        efficiency: null,
        state: 'unknown',
        online: false,
      },
      phases: {
        l1: phase(values, 'phaseA'),
        l2: phase(values, 'phaseB'),
        l3: phase(values, 'phaseC'),
      },
      meta: {
        lastUpdate: meta.lastUpdate || null,
        connection: meta.connection || 'connected',
        demo: !!meta.demo,
        signs: {
          battery: { value: this.batterySign, source: this.batteryLearner.source, confidence: this.batteryLearner.confidence, mode: this.config.powerDirection.battery },
          grid: { value: this.gridSign, source: this.gridLearner.source, confidence: this.gridLearner.confidence, mode: this.config.powerDirection.grid },
        },
        balance: null,
        scaleKw: null,
      },
    };

    /* ── derived values ── */
    // Capacity: from settings, otherwise from an entity (ha-solarman has battery_capacity)
    const capacity = isNum(this.config.batteryCapacityKwh) ? this.config.batteryCapacityKwh : g('batteryCapacity');
    if (isNum(capacity) && isNum(soc) && isNum(batteryPower) && Math.abs(batteryPower) > 0.1) {
      if (batteryPower > 0) state.battery.timeToFull = (capacity * (100 - soc) / 100) / batteryPower;
      else state.battery.timeToEmpty = (capacity * soc / 100) / -batteryPower;
    }

    const dcIn = (isNum(pvPower) ? pvPower : 0)
      + (generatorRelevant && isNum(generatorPower) ? generatorPower : 0)
      + (isNum(batteryPower) && batteryPower < 0 ? -batteryPower : 0);
    if (isNum(inverterPower) && dcIn > 0.3 && inverterPower > 0.1) {
      const eff = (inverterPower / dcIn) * 100;
      if (eff > 50 && eff <= 100) state.inverter.efficiency = eff;
    }

    // Balance residual — an indicator of data quality or a wrong sign.
    // The generator is a source like PV: leaving it out would raise a false
    // "balance is off" warning whenever it runs.
    if (isNum(pvPower) && isNum(load) && isNum(gridPower) && isNum(batteryPower)) {
      const genIn = generatorRelevant && isNum(generatorPower) ? generatorPower : 0;
      state.meta.balance = pvPower + genIn + gridPower - load - batteryPower;
    }

    state.inverter.state = this._inverterState(values, state);
    state.inverter.online = state.inverter.state === 'online';

    // Animation scale: rated power, or the largest plausible value seen so far.
    // The peak decays slowly and ignores absurd readings, so one glitched sample
    // cannot pin every flow at the slowest animation speed for the whole session.
    const PLAUSIBLE_KW = 150;
    const observed = [pvPower || 0, generatorPower || 0, Math.abs(batteryPower || 0), Math.abs(gridPower || 0), load || 0]
      .filter((v) => v <= PLAUSIBLE_KW);
    this._peakPv = Math.max(this._peakPv * 0.999, ...observed);
    state.meta.scaleKw = ratedPowerKw || Math.max(1, this._peakPv);

    return state;
  }

  get batterySign() {
    const mode = this.config.powerDirection.battery;
    return mode === 'auto' ? this.batteryLearner.value : mode;
  }

  get gridSign() {
    const mode = this.config.powerDirection.grid;
    return mode === 'auto' ? this.gridLearner.value : mode;
  }

  _learn({ values, soc, batteryRaw, gridRaw, pvPower, generatorPower, load, statusText }) {
    let dirty = false;

    // 1. Battery status text — direct evidence.
    if (isNum(batteryRaw) && Math.abs(batteryRaw) > 0.15 && statusText) {
      const t = statusText.toLowerCase();
      const isCharge = /charg/.test(t) && !/dischar/.test(t);
      const isDischarge = /dischar/.test(t);
      if (isCharge || isDischarge) {
        const positiveMeans = (batteryRaw > 0) === isCharge ? 'charge_positive' : 'discharge_positive';
        this.batteryLearner.vote(positiveMeans, 2);   // one sample is enough
        dirty = true;
      }
    }

    // 2. SOC change — a fact: if SOC went up, the battery was charging.
    if (isNum(soc) && isNum(batteryRaw) && Math.abs(batteryRaw) > 0.15) {
      const prev = this._prev.soc;
      if (isNum(prev) && Math.abs(soc - prev) >= 0.4) {
        const positiveMeans = (batteryRaw > 0) === (soc > prev) ? 'charge_positive' : 'discharge_positive';
        this.batteryLearner.vote(positiveMeans, 2);
        dirty = true;
      }
      if (!isNum(prev) || Math.abs(soc - prev) >= 0.4) this._prev.soc = soc;
    }

    // 3. Daily energy counters — facts for both the grid and the battery.
    dirty = this._counterVote(values, 'gridImportToday', gridRaw, this.gridLearner, 'import_positive', 'export_positive') || dirty;
    dirty = this._counterVote(values, 'gridExportToday', gridRaw, this.gridLearner, 'export_positive', 'import_positive') || dirty;
    dirty = this._counterVote(values, 'batteryChargeToday', batteryRaw, this.batteryLearner, 'charge_positive', 'discharge_positive') || dirty;
    dirty = this._counterVote(values, 'batteryDischargeToday', batteryRaw, this.batteryLearner, 'discharge_positive', 'charge_positive') || dirty;

    // 4. Fallback signal — the power balance. A running generator has to be part
    //    of the input, otherwise the residual would favour the wrong sign.
    const sourcePower = isNum(pvPower) ? pvPower + (isNum(generatorPower) ? generatorPower : 0) : null;
    if (isNum(sourcePower) && isNum(load) && isNum(gridRaw) && isNum(batteryRaw) &&
        (Math.abs(gridRaw) > 0.2 || Math.abs(batteryRaw) > 0.2)) {
      const resid = (bat, grid) => Math.abs(sourcePower + grid - load - bat);
      // battery
      this.batteryLearner.observeBalance(
        resid(batteryRaw, this.gridSign === 'import_positive' ? gridRaw : -gridRaw),
        resid(-batteryRaw, this.gridSign === 'import_positive' ? gridRaw : -gridRaw));
      // grid
      const bat = this.batterySign === 'charge_positive' ? batteryRaw : -batteryRaw;
      this.gridLearner.observeBalance(resid(bat, gridRaw), resid(bat, -gridRaw));
      dirty = true;
    }

    if (dirty) this._persistLearnedThrottled();
  }

  _counterVote(values, counterKey, rawPower, learner, positiveMeans, negativeMeans) {
    const v = values[counterKey];
    if (!v || !isNum(v.value) || !isNum(rawPower) || Math.abs(rawPower) < 0.2) return false;
    const prev = this._prev[counterKey];
    this._prev[counterKey] = v.value;
    if (!isNum(prev)) return false;
    const delta = v.value - prev;
    if (delta <= 0.004 || delta > 5) return false;   // counter grew (and did not reset at midnight)
    learner.vote(rawPower > 0 ? positiveMeans : negativeMeans, 3);
    return true;
  }

  _persistLearnedThrottled() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => { this._persistTimer = null; this._persistLearned(); }, 5000);
  }

  _inverterState(values, state) {
    const status = state.inverter.statusText;
    if (state.inverter.alarm) return 'fault';
    if (status) {
      if (FAULT_WORDS.test(status)) return 'fault';
      if (OFFLINE_WORDS.test(status) && !ONLINE_WORDS.test(status)) return 'standby';
      if (ONLINE_WORDS.test(status)) return 'online';
    }
    const keyRoles = ['pvPower', 'batterySoc', 'batteryPower', 'gridPower', 'loadPower', 'inverterPower'];
    const mapped = keyRoles.map((k) => values[k]).filter((v) => v && v.entityId);
    if (!mapped.length) return 'unknown';
    if (mapped.every((v) => !v.available)) return 'offline';
    if (mapped.every((v) => v.stale)) return 'stale';
    return 'online';
  }
}

/** |value| carrying the sign of reference (when reference is known and non-zero). */
function alignSign(value, reference) {
  if (!isNum(value) || !isNum(reference) || reference === 0) return value;
  return Math.abs(value) * Math.sign(reference);
}

function phase(values, prefix) {
  const p = num(values, `${prefix}Power`);
  const v = num(values, `${prefix}Voltage`);
  const c = num(values, `${prefix}Current`);
  if (p === null && v === null && c === null) return null;
  return { power: p !== null ? p : (isNum(v) && isNum(c) ? (v * c) / 1000 : null), voltage: v, current: c };
}
