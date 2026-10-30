/**
 * config.js — the single place where entities and settings are described.
 *
 * Configuration layers, lowest priority first (see the app bootstrap):
 *   DEFAULT_CONFIG  <-  panel_custom: config: (configuration.yaml)  <-  localStorage (UI)
 *
 * To hard-wire your own entities, edit DEFAULT_CONFIG.entities below, or
 * better set them in configuration.yaml or through the gear icon in the UI.
 */

import { RANGE_KEYS } from './ranges.js';
import { LANGUAGES } from './i18n.js';

export const VERSION = '1.2.2';

export const STORAGE_KEY = 'deye-dashboard:user-config:v1';
export const LEARN_KEY = 'deye-dashboard:learned:v1';

/** Canonical units of the internal data model. */
export const CANONICAL_UNITS = {
  power: 'kW',
  energy: 'kWh',
  percent: '%',
  voltage: 'V',
  current: 'A',
  temperature: '°C',
  frequency: 'Hz',
  number: '',
  text: '',
};

/** Multipliers to the canonical unit. Temperature is handled separately (offset). */
export const UNIT_FACTORS = {
  power: { w: 0.001, kw: 1, mw: 1000, va: 0.001, kva: 1, mva: 1000 },
  energy: { wh: 0.001, kwh: 1, mwh: 1000, gwh: 1e6, j: 2.7777e-7, kj: 2.7777e-4, mj: 0.27777 },
  percent: { '%': 1 },
  voltage: { mv: 0.001, v: 1, kv: 1000 },
  current: { ma: 0.001, a: 1, ka: 1000 },
  frequency: { hz: 1, khz: 1000 },
  temperature: {},
  number: {},
  text: {},
};

/**
 * ROLES — every "role" the dashboard knows about.
 *  key      — role name (used in CONFIG.entities and in the data model)
 *  group    — UI section
 *  kind     — quantity type (drives unit normalisation)
 *  label    — English name; Ukrainian comes from the i18n key `role.<key>`
 *  hints    — hints for entity auto-detection (discovery.js)
 *             any: [[regex, weight], ...] — matches add up
 *             not: [regex, ...]           — disqualifies a candidate
 *  optional — when false this is a key role (the dashboard is incomplete without it)
 */
export const ROLES = [
  // ────────────────────────────── SOLAR ──────────────────────────────
  { key: 'pvPower', group: 'solar', label: 'PV power (total)', kind: 'power', optional: false,
    hints: { any: [['pv_?power', 9], ['solar_?power', 8], ['total_?(dc_?)?(pv|solar|input)_?power', 9], ['(pv|solar).*power', 5], ['^.*_dc_power$', 3], ['photovolt', 6]],
             not: ['pv[1-9]', 'string_?[1-9]', 'mppt_?[1-9]', 'voltage', 'current', 'today', 'daily', 'yesterday', 'month', 'year', 'total_?energy', 'limit', 'max_', 'setting', 'apparent'] } },
  { key: 'pvToday', group: 'solar', label: 'PV energy today', kind: 'energy',
    hints: { any: [['(today|daily).*(production|pv|solar|yield|generation)', 9], ['(production|pv|solar|yield|generation).*(today|daily)', 9], ['energy_?today', 4]],
             not: ['total(?!_energy_today)', 'month', 'year', 'life', 'yesterday', 'load', 'consum', 'grid', 'import', 'export', 'sold', 'bought', 'battery', 'charge'] } },
  { key: 'pvTotal', group: 'solar', label: 'PV energy total', kind: 'energy',
    hints: { any: [['(total|lifetime|life).*(production|pv|solar|yield|generation)', 9], ['(production|pv|solar|yield).*(total|lifetime)', 9]],
             not: ['today', 'daily', 'month', 'year', 'load', 'consum', 'grid', 'import', 'export', 'battery'] } },

  { key: 'pv1Power', group: 'solar', label: 'PV1 power', kind: 'power',
    hints: { any: [['(pv|string|mppt)_?1_?.*power', 10]], not: ['voltage', 'current', 'today', 'total', 'energy'] } },
  { key: 'pv1Voltage', group: 'solar', label: 'PV1 voltage', kind: 'voltage',
    hints: { any: [['(pv|string|mppt)_?1_?.*volt', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv1Current', group: 'solar', label: 'PV1 current', kind: 'current',
    hints: { any: [['(pv|string|mppt)_?1_?.*curr', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv2Power', group: 'solar', label: 'PV2 power', kind: 'power',
    hints: { any: [['(pv|string|mppt)_?2_?.*power', 10]], not: ['voltage', 'current', 'today', 'total', 'energy'] } },
  { key: 'pv2Voltage', group: 'solar', label: 'PV2 voltage', kind: 'voltage',
    hints: { any: [['(pv|string|mppt)_?2_?.*volt', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv2Current', group: 'solar', label: 'PV2 current', kind: 'current',
    hints: { any: [['(pv|string|mppt)_?2_?.*curr', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv3Power', group: 'solar', label: 'PV3 power', kind: 'power',
    hints: { any: [['(pv|string|mppt)_?3_?.*power', 10]], not: ['voltage', 'current', 'today', 'total', 'energy'] } },
  { key: 'pv3Voltage', group: 'solar', label: 'PV3 voltage', kind: 'voltage',
    hints: { any: [['(pv|string|mppt)_?3_?.*volt', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv3Current', group: 'solar', label: 'PV3 current', kind: 'current',
    hints: { any: [['(pv|string|mppt)_?3_?.*curr', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv4Power', group: 'solar', label: 'PV4 power', kind: 'power',
    hints: { any: [['(pv|string|mppt)_?4_?.*power', 10]], not: ['voltage', 'current', 'today', 'total', 'energy'] } },
  { key: 'pv4Voltage', group: 'solar', label: 'PV4 voltage', kind: 'voltage',
    hints: { any: [['(pv|string|mppt)_?4_?.*volt', 10]], not: ['battery', 'grid', 'ac_'] } },
  { key: 'pv4Current', group: 'solar', label: 'PV4 current', kind: 'current',
    hints: { any: [['(pv|string|mppt)_?4_?.*curr', 10]], not: ['battery', 'grid', 'ac_'] } },

  // ───────────────────────────── BATTERY ─────────────────────────────
  { key: 'batterySoc', group: 'battery', label: 'Battery SOC', kind: 'percent', optional: false,
    hints: { any: [['battery.*soc', 10], ['soc', 7], ['battery.*(level|capacity_?remain|percent)', 8], ['state_?of_?charge', 9],
                   ['(^|_)battery$', 9]],
             not: ['soh', 'health', 'target', 'setting', 'min_', 'max_', 'shutdown', 'restart', 'low_', 'cell', 'imbalance'] } },
  { key: 'batteryPower', group: 'battery', label: 'Battery power', kind: 'power', optional: false,
    hints: { any: [['battery.*power', 10], ['bat_?power', 9]],
             not: ['today', 'daily', 'total', 'energy', 'charge_power_limit', 'max', 'limit', 'setting', 'charge_?power$', 'discharge_?power$'] } },
  { key: 'batteryChargePower', group: 'battery', label: 'Battery charge power (optional)', kind: 'power',
    hints: { any: [['battery.*charge.*power', 10], ['charge_?power', 6]], not: ['discharge', 'today', 'energy', 'limit', 'max', 'setting'] } },
  { key: 'batteryDischargePower', group: 'battery', label: 'Battery discharge power (optional)', kind: 'power',
    hints: { any: [['battery.*discharge.*power', 10], ['discharge_?power', 6]], not: ['today', 'energy', 'limit', 'max', 'setting'] } },
  { key: 'batteryVoltage', group: 'battery', label: 'Battery voltage', kind: 'voltage',
    hints: { any: [['(^|_)battery_voltage(_|$)', 11], ['battery.*volt', 10], ['bat_?volt', 9]],
             not: ['cell', 'max', 'min', 'setting', 'limit', 'float', 'absorb', 'equal', 'imbalance'] } },
  { key: 'batteryCurrent', group: 'battery', label: 'Battery current', kind: 'current',
    hints: { any: [['(^|_)battery_current(_|$)', 11], ['battery.*curr', 10], ['bat_?curr', 9]],
             not: ['max', 'min', 'setting', 'limit'] } },
  { key: 'batteryTemperature', group: 'battery', label: 'Battery temperature', kind: 'temperature',
    hints: { any: [['(^|_)battery_temperature(_|$)', 11], ['battery.*temp', 10], ['bat_?temp', 9]],
             not: ['max', 'min', 'setting', 'mos', 'cell'] } },
  { key: 'batterySoh', group: 'battery', label: 'Battery SOH', kind: 'percent',
    hints: { any: [['(^|_)battery_soh(_|$)', 11], ['soh', 9], ['state_?of_?health', 9], ['battery.*health', 8]], not: ['cell'] } },
  { key: 'batteryCapacity', group: 'battery', label: 'Battery capacity (kWh)', kind: 'energy',
    hints: { any: [['battery.*capacity', 10]], not: ['remain', 'today', 'daily', 'soc', 'percent', 'ah'] } },
  { key: 'batteryStatus', group: 'battery', label: 'Battery status (charging/discharging)', kind: 'text',
    hints: { any: [['battery.*(status|state|mode)', 9]], not: ['soc', 'soh', 'power', 'volt', 'curr', 'temp'] } },
  { key: 'batteryChargeToday', group: 'battery', label: 'Battery charged today', kind: 'energy',
    hints: { any: [['(today|daily).*battery.*charg', 10], ['battery.*charg.*(today|daily)', 10]], not: ['discharg', 'total', 'month', 'year'] } },
  { key: 'batteryDischargeToday', group: 'battery', label: 'Battery discharged today', kind: 'energy',
    hints: { any: [['(today|daily).*battery.*discharg', 10], ['battery.*discharg.*(today|daily)', 10]], not: ['total', 'month', 'year'] } },
  // Some Deye firmwares never populate the daily battery registers while the
  // lifetime ones count correctly, so these are the fallback for period totals.
  { key: 'batteryChargeTotal', group: 'battery', label: 'Battery charged total', kind: 'energy', optional: true,
    hints: { any: [['total.*battery.*charg', 10], ['battery.*charg.*total', 10]], not: ['discharg', 'today', 'daily', 'month', 'year'] } },
  { key: 'batteryDischargeTotal', group: 'battery', label: 'Battery discharged total', kind: 'energy', optional: true,
    hints: { any: [['total.*battery.*discharg', 10], ['battery.*discharg.*total', 10]], not: ['today', 'daily', 'month', 'year'] } },

  // ────────────────────────────── GRID ───────────────────────────────
  { key: 'gridPower', group: 'grid', label: 'Grid power (+/-)', kind: 'power', optional: false,
    hints: { any: [['total_?grid_?power', 10], ['grid_?power', 9], ['grid.*power', 6], ['meter.*power', 5], ['external.*power', 4]],
             not: ['today', 'daily', 'total_?energy', 'energy', 'limit', 'max', 'setting', 'ct_?ratio', 'l[123]', 'phase', 'apparent', 'frequency'] } },
  { key: 'gridImportPower', group: 'grid', label: 'Grid import power (optional)', kind: 'power',
    hints: { any: [['(import|buy|bought|purchas).*power', 9], ['grid.*import', 8]],
             not: ['today', 'energy', 'export', 'sold', 'max', 'limit', 'setting'] } },
  { key: 'gridExportPower', group: 'grid', label: 'Grid export power (optional)', kind: 'power',
    hints: { any: [['(export|sold|sell|feed).*power', 9], ['grid.*export', 8]],
             not: ['today', 'energy', 'import', 'bought', 'max', 'limit', 'setting'] } },
  { key: 'gridImportToday', group: 'grid', label: 'Grid import today', kind: 'energy',
    hints: { any: [['(today|daily).*(import|bought|buy|purchas)', 10], ['(import|bought|buy).*(today|daily)', 10]], not: ['export', 'sold', 'total', 'month', 'year'] } },
  { key: 'gridExportToday', group: 'grid', label: 'Grid export today', kind: 'energy',
    hints: { any: [['(today|daily).*(export|sold|sell|feed)', 10], ['(export|sold|sell).*(today|daily)', 10]], not: ['import', 'bought', 'total', 'month', 'year'] } },
  { key: 'gridVoltage', group: 'grid', label: 'Grid voltage', kind: 'voltage',
    hints: { any: [['grid.*volt', 9], ['ac.*volt', 6]], not: ['battery', 'pv', 'l[23]', 'setting', 'max', 'min'] } },
  { key: 'gridFrequency', group: 'grid', label: 'Grid frequency', kind: 'frequency',
    hints: { any: [['(grid|ac).*freq', 10], ['freq', 6]], not: ['setting', 'max', 'min'] } },

  // ────────────────────────────── LOAD ───────────────────────────────
  { key: 'loadPower', group: 'load', label: 'Load power', kind: 'power', optional: false,
    hints: { any: [['total_?load_?power', 10], ['load_?power', 9], ['(essential|consumption|house|home).*power', 7], ['load.*power', 6]],
             not: ['today', 'daily', 'energy', 'l[123]_', 'non_?essential', 'limit', 'max', 'setting', 'apparent', 'percent'] } },
  { key: 'loadToday', group: 'load', label: 'Load energy today', kind: 'energy',
    hints: { any: [['(today|daily).*(load|consum|usage)', 10], ['(load|consum|usage).*(today|daily)', 10]], not: ['total', 'month', 'year', 'grid', 'import', 'export'] } },
  { key: 'loadTotal', group: 'load', label: 'Load energy total', kind: 'energy',
    hints: { any: [['(total|lifetime).*(load|consum|usage)', 10], ['(load|consum).*(total|lifetime)', 10]], not: ['today', 'daily', 'month', 'year'] } },

  // ───────────────────────────── INVERTER ────────────────────────────
  { key: 'inverterPower', group: 'inverter', label: 'Inverter output power (AC)', kind: 'power',
    hints: { any: [['ac_?active_?power', 10], ['^inverter_?power(_|\\b|$)', 10], ['inverter.*(output|active).*power', 9],
                   ['output_?power', 7], ['operating_?power', 5], ['ac_?power', 6]],
             not: ['today', 'energy', 'l[123]', 'phase', 'apparent', 'reactive', 'limit', 'max', 'setting', 'pv', 'battery', 'loss', 'generator'] } },
  { key: 'inverterTemperature', group: 'inverter', label: 'Inverter temperature', kind: 'temperature',
    hints: { any: [['(radiator|heatsink|igbt)_?temp', 12], ['inverter_temp', 9], ['^temperature', 8], ['(ac|dc)_?temp', 6], ['temperature', 4]],
             not: ['battery', 'ambient', 'setting', 'max', 'min', 'cell', 'mos'] } },
  { key: 'inverterStatus', group: 'inverter', label: 'Inverter status', kind: 'text',
    hints: { any: [['(inverter|run|running|device|work|operat|system).*(status|state|mode)', 9], ['status', 5]], not: ['battery', 'grid_?status', 'alarm', 'fault'] } },
  { key: 'inverterAlarm', group: 'inverter', label: 'Alarm / fault', kind: 'text',
    hints: { any: [['device_(alarm|fault|error)', 11], ['(inverter|system).*(alarm|fault|error)', 9], ['(alarm|fault|error|warning)', 6]],
             not: ['count', 'code_?count', 'battery', 'cell'] } },

  /* ───────────────────────────── GENERATOR ─────────────────────────── */
  { key: 'generatorPower', group: 'generator', label: 'Generator power', kind: 'power',
    hints: { any: [['(generator|genset|gen)_?power', 10], ['generator', 6]],
             not: ['l[123]', 'phase', 'today', 'daily', 'energy', 'total', 'volt', 'curr', 'freq', 'limit', 'max', 'setting', 'runtime'] } },
  { key: 'generatorToday', group: 'generator', label: 'Generator energy today', kind: 'energy',
    hints: { any: [['(generator|genset).*(today|daily)', 10], ['(today|daily).*(generator|genset)', 10]],
             not: ['total', 'month', 'year'] } },
  { key: 'generatorTotal', group: 'generator', label: 'Generator energy total', kind: 'energy',
    hints: { any: [['(generator|genset).*(energy|total)', 9]], not: ['today', 'daily', 'month', 'year'] } },
  { key: 'generatorVoltage', group: 'generator', label: 'Generator voltage', kind: 'voltage',
    hints: { any: [['(generator|genset).*volt', 10]], not: ['l[23]', 'setting', 'max', 'min'] } },
  { key: 'generatorStatus', group: 'generator', label: 'Generator status', kind: 'text',
    hints: { any: [['(generator|genset).*(status|state|mode|running)', 10]], not: ['power', 'volt', 'curr', 'energy'] } },

  // ────────────────────────────── PHASES ─────────────────────────────
  { key: 'phaseAPower', group: 'phases', label: 'L1 power', kind: 'power',
    hints: { any: [['output_?l1_?.*power', 11], ['(load|ac)_?l1_?.*power', 9], ['grid_?l1_?.*power', 7],
                   ['(l1|phase_?a)_?.*power', 6]],
             not: ['volt', 'curr', 'energy', 'today', 'apparent', 'reactive', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseAVoltage', group: 'phases', label: 'L1 voltage', kind: 'voltage',
    hints: { any: [['output_?l1_?.*volt', 11], ['(load|ac)_?l1_?.*volt', 9], ['grid_?l1_?.*volt', 7],
                   ['(l1|phase_?a)_?.*volt', 6]],
             not: ['pv', 'battery', 'curr', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseACurrent', group: 'phases', label: 'L1 current', kind: 'current',
    hints: { any: [['output_?l1_?.*curr', 11], ['(load|ac)_?l1_?.*curr', 9], ['grid_?l1_?.*curr', 7],
                   ['(l1|phase_?a)_?.*curr', 6]],
             not: ['pv', 'battery', 'volt', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseBPower', group: 'phases', label: 'L2 power', kind: 'power',
    hints: { any: [['output_?l2_?.*power', 11], ['(load|ac)_?l2_?.*power', 9], ['grid_?l2_?.*power', 7],
                   ['(l2|phase_?b)_?.*power', 6]],
             not: ['volt', 'curr', 'energy', 'today', 'apparent', 'reactive', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseBVoltage', group: 'phases', label: 'L2 voltage', kind: 'voltage',
    hints: { any: [['output_?l2_?.*volt', 11], ['(load|ac)_?l2_?.*volt', 9], ['grid_?l2_?.*volt', 7],
                   ['(l2|phase_?b)_?.*volt', 6]],
             not: ['pv', 'battery', 'curr', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseBCurrent', group: 'phases', label: 'L2 current', kind: 'current',
    hints: { any: [['output_?l2_?.*curr', 11], ['(load|ac)_?l2_?.*curr', 9], ['grid_?l2_?.*curr', 7],
                   ['(l2|phase_?b)_?.*curr', 6]],
             not: ['pv', 'battery', 'volt', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseCPower', group: 'phases', label: 'L3 power', kind: 'power',
    hints: { any: [['output_?l3_?.*power', 11], ['(load|ac)_?l3_?.*power', 9], ['grid_?l3_?.*power', 7],
                   ['(l3|phase_?c)_?.*power', 6]],
             not: ['volt', 'curr', 'energy', 'today', 'apparent', 'reactive', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseCVoltage', group: 'phases', label: 'L3 voltage', kind: 'voltage',
    hints: { any: [['output_?l3_?.*volt', 11], ['(load|ac)_?l3_?.*volt', 9], ['grid_?l3_?.*volt', 7],
                   ['(l3|phase_?c)_?.*volt', 6]],
             not: ['pv', 'battery', 'curr', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
  { key: 'phaseCCurrent', group: 'phases', label: 'L3 current', kind: 'current',
    hints: { any: [['output_?l3_?.*curr', 11], ['(load|ac)_?l3_?.*curr', 9], ['grid_?l3_?.*curr', 7],
                   ['(l3|phase_?c)_?.*curr', 6]],
             not: ['pv', 'battery', 'volt', 'generator', 'ct[0-9]', 'internal', 'external', 'imbalance', 'cell', 'max', 'limit', 'setting'] } },
];

export const ROLE_BY_KEY = Object.fromEntries(ROLES.map((r) => [r.key, r]));

export const GROUPS = [
  { key: 'solar', label: 'Solar', color: 'var(--solar-color)' },
  { key: 'battery', label: 'Battery', color: 'var(--battery-color)' },
  { key: 'grid', label: 'Grid', color: 'var(--grid-color)' },
  { key: 'load', label: 'Load / House', color: 'var(--load-color)' },
  { key: 'generator', label: 'Generator', color: 'var(--generator-color)' },
  { key: 'inverter', label: 'Inverter', color: 'var(--inverter-color)' },
  { key: 'phases', label: 'Phases', color: 'var(--phase-color)' },
];

/** Default configuration. entities: null means "unset", so auto-detection runs. */
export const DEFAULT_CONFIG = {
  debug: false,
  title: 'DEYE ENERGY',
  /** Interface language: 'en' | 'uk' | 'auto' (follow the Home Assistant locale) */
  language: 'en',
  subtitle: '',
  /** Inverter rated power, kW — animation scale and the label under the hub. null = auto */
  ratedPowerKw: null,
  /** Battery capacity, kWh — for time-to-full/empty. null = take it from an entity */
  batteryCapacityKwh: null,
  /** Seconds without an update after which data counts as stale */
  staleAfterSeconds: 600,
  /** Signs and directions. auto = infer them from the data */
  powerDirection: {
    battery: 'auto', // auto | charge_positive | discharge_positive
    grid: 'auto',    // auto | import_positive | export_positive
    load: 'normal',  // normal | inverted
    pv: 'normal',
  },
  /**
   * Flow animation: 'auto' respects the system "reduce motion" preference,
   * 'on' animates regardless, 'off' never animates.
   */
  animations: 'auto',
  /** Phases card: auto (when data exists) | always | never */
  showPhases: 'auto',
  /** Chart: default period — day | week | month | year | custom. */
  chart: { defaultRange: 'day' },
  entities: Object.fromEntries(ROLES.map((r) => [r.key, null])),
};

/** Merge configuration layers (one level of nesting deep). */
export function mergeConfig(...layers) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        Object.assign(out[k], v);
      } else {
        out[k] = v;
      }
    }
  }
  // Migrate values stored by older versions so an existing browser keeps working.
  if (out.animations === true) out.animations = 'auto';
  if (out.animations === false) out.animations = 'off';
  const legacyRange = { today: 'day', '7d': 'week', '30d': 'month' }[out.chart.defaultRange];
  if (legacyRange) out.chart.defaultRange = legacyRange;

  // Anything unrecognised is replaced by the default rather than carried into
  // the rest of the code: these values arrive from localStorage and from
  // hand-written YAML, so they cannot be assumed to be one of ours.
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  out.animations = oneOf(out.animations, ['auto', 'on', 'off'], 'auto');
  out.showPhases = oneOf(out.showPhases, ['auto', 'always', 'never'], 'auto');
  out.chart.defaultRange = oneOf(out.chart.defaultRange, RANGE_KEYS, 'day');
  out.language = oneOf(out.language, ['auto', ...LANGUAGES.map((l) => l.code)], DEFAULT_CONFIG.language);
  out.powerDirection.battery = oneOf(out.powerDirection.battery, ['auto', 'charge_positive', 'discharge_positive'], 'auto');
  out.powerDirection.grid = oneOf(out.powerDirection.grid, ['auto', 'import_positive', 'export_positive'], 'auto');

  // entities: only known roles, and an empty string means "unset"
  for (const [k, v] of Object.entries(out.entities)) {
    if (!(k in DEFAULT_CONFIG.entities)) { delete out.entities[k]; continue; }
    if (typeof v === 'string' && v.trim() === '') out.entities[k] = null;
    else if (v !== null && typeof v !== 'string') out.entities[k] = null;
  }
  return out;
}

export function loadUserConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveUserConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch (e) {
    return false;
  }
}
