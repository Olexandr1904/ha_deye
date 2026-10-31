/**
 * discovery.js — automatic matching of entities to dashboard roles.
 *
 * Works purely on what Home Assistant already exposes (hass.states):
 *  1) filter by domain and by unit_of_measurement / device_class (coarse cut);
 *  2) keyword scoring from ROLES[].hints;
 *  3) a second pass with a bonus for a shared entity_id prefix (same device).
 *
 * It saves nothing by itself — it returns a proposal for the user to confirm.
 */

import { ROLES, ROLE_BY_KEY } from './config.js?v=1.2.3';
import { log } from './utils.js?v=1.2.3';

/**
 * Measurements only. The number/input_number/select domains hold inverter SETPOINTS
 * (for example number.inverter_grid_max_export_power = 31 kW), and they must never
 * be read as current values.
 */
const ALLOWED_DOMAINS = new Set(['sensor', 'binary_sensor']);

/** Allowed units and device classes per quantity type. */
const KIND_GATE = {
  power: { units: ['w', 'kw', 'mw', 'va', 'kva'], classes: ['power', 'apparent_power'] },
  energy: { units: ['wh', 'kwh', 'mwh'], classes: ['energy'] },
  percent: { units: ['%'], classes: ['battery', 'power_factor'] },
  voltage: { units: ['v', 'mv', 'kv'], classes: ['voltage'] },
  current: { units: ['a', 'ma'], classes: ['current'] },
  temperature: { units: ['°c', 'c', '°f', 'f', 'k'], classes: ['temperature'] },
  frequency: { units: ['hz', 'khz'], classes: ['frequency'] },
  number: { units: null, classes: null },
  text: { units: null, classes: null },
};

/** Words that raise confidence: this really is an inverter or solar system. */
const DEVICE_HINTS = /(deye|solarman|sunsynk|sofar|solis|growatt|inverter|invertor|inverte|hybrid|pv_?inverter|ess)/i;

const compiled = new WeakMap();
function hintRegexes(role) {
  if (compiled.has(role)) return compiled.get(role);
  const any = (role.hints && role.hints.any || []).map(([p, w]) => [new RegExp(p, 'i'), w]);
  const not = (role.hints && role.hints.not || []).map((p) => new RegExp(p, 'i'));
  const obj = { any, not };
  compiled.set(role, obj);
  return obj;
}

export function entityInfo(stateObj) {
  const a = (stateObj && stateObj.attributes) || {};
  return {
    entity_id: stateObj ? stateObj.entity_id : null,
    name: a.friendly_name || (stateObj ? stateObj.entity_id : ''),
    unit: a.unit_of_measurement || '',
    deviceClass: a.device_class || '',
    stateClass: a.state_class || '',
    state: stateObj ? stateObj.state : null,
    available: !!stateObj && stateObj.state !== 'unavailable' && stateObj.state !== 'unknown',
  };
}

function passesGate(kind, info) {
  const gate = KIND_GATE[kind];
  if (!gate) return true;
  if (kind === 'text') {
    // Text roles: the state must not be a number with a unit
    return !info.unit;
  }
  if (!gate.units) return true;
  const u = info.unit.toLowerCase().replace(/\s+/g, '');
  if (u && gate.units.includes(u)) return true;
  if (gate.classes && gate.classes.includes(info.deviceClass)) return true;
  // Without a unit we only accept a device_class match; anything else
  // produces far too many false positives.
  return false;
}

/** Score one candidate for a role. Returns 0 when the candidate is unsuitable. */
export function scoreCandidate(role, info, { prefix = null } = {}) {
  const domain = (info.entity_id || '').split('.')[0];
  if (!ALLOWED_DOMAINS.has(domain)) return 0;
  if (!passesGate(role.kind, info)) return 0;

  const objectId = (info.entity_id || '').split('.').slice(1).join('.');
  const haystack = `${objectId} ${info.name}`.toLowerCase().replace(/[\s\-.]+/g, '_');

  const { any, not } = hintRegexes(role);
  for (const re of not) if (re.test(haystack)) return 0;

  let score = 0;
  for (const [re, w] of any) if (re.test(haystack)) score += w;
  if (score === 0) return 0;

  const gate = KIND_GATE[role.kind];
  if (gate && gate.classes && gate.classes.includes(info.deviceClass)) score += 2;
  if (DEVICE_HINTS.test(haystack)) score += 3;
  if (prefix && objectId.startsWith(prefix)) score += 4;
  if (!info.available) score -= 4;

  return Math.max(0, score);
}

/** All suitable candidates for a role, best score first. */
export function candidatesFor(roleKey, states, opts = {}) {
  const role = ROLE_BY_KEY[roleKey];
  if (!role) return [];
  const out = [];
  for (const id of Object.keys(states)) {
    const info = entityInfo(states[id]);
    const score = scoreCandidate(role, info, opts);
    if (score > 0) out.push({ ...info, score });
  }
  out.sort((a, b) => b.score - a.score || a.entity_id.localeCompare(b.entity_id));
  return out;
}

const ANCHOR_ROLES = ['pvPower', 'batterySoc', 'batteryPower', 'loadPower', 'gridPower', 'inverterPower'];

/**
 * Shared prefix of the anchor entities. Requiring ALL of them to match is wrong:
 * a single miss (a phone battery instead of the inverter SOC) would wipe it out.
 * So take the most common first token and derive the prefix only from the
 * entities that start with it.
 */
function commonPrefix(entityIds) {
  const lists = entityIds.filter(Boolean).map((id) => id.split('.').slice(1).join('.').split('_'));
  if (lists.length < 2) return null;

  const counts = new Map();
  for (const t of lists) counts.set(t[0], (counts.get(t[0]) || 0) + 1);
  let seed = null, best = 0;
  for (const [tok, n] of counts) if (n > best) { best = n; seed = tok; }
  if (best < 2) return null;

  const group = lists.filter((t) => t[0] === seed);
  const out = [];
  for (let i = 0; i < group[0].length; i++) {
    const tok = group[0][i];
    if (group.every((t) => t[i] === tok)) out.push(tok);
    else break;
  }
  return out.length ? out.join('_') + '_' : null;
}

/**
 * Full auto-detection.
 * @returns {{mapping:Object, report:Array, prefix:string|null}}
 */
export function autoDetect(states, { keepExisting = null } = {}) {
  // Pass 1 — no prefix bonus, just enough to find the anchor entities.
  const anchors = ANCHOR_ROLES.map((k) => {
    const best = candidatesFor(k, states)[0];
    return best && best.score >= 8 ? best.entity_id : null;
  }).filter(Boolean);
  const prefix = commonPrefix(anchors);
  if (prefix) log('detected shared device prefix:', prefix);

  const mapping = {};
  const report = [];
  const used = new Set();

  // Roles with more specific hints go first, so that pv1_power does not
  // steal the general pvPower slot and vice versa.
  const ordered = [...ROLES].sort((a, b) => maxWeight(b) - maxWeight(a));

  for (const role of ordered) {
    if (keepExisting && keepExisting[role.key]) {
      mapping[role.key] = keepExisting[role.key];
      used.add(keepExisting[role.key]);
      report.push({ role: role.key, entity_id: keepExisting[role.key], confidence: 'manual', score: null, alternatives: [] });
      continue;
    }
    const cands = candidatesFor(role.key, states, { prefix }).filter((c) => !used.has(c.entity_id));
    const best = cands[0];
    if (!best) {
      mapping[role.key] = null;
      report.push({ role: role.key, entity_id: null, confidence: 'none', score: 0, alternatives: [] });
      continue;
    }
    const margin = best.score - (cands[1] ? cands[1].score : 0);
    const confidence = best.score >= 10 && margin >= 3 ? 'high' : best.score >= 7 ? 'medium' : 'low';
    mapping[role.key] = best.entity_id;
    used.add(best.entity_id);
    report.push({
      role: role.key, entity_id: best.entity_id, confidence, score: best.score,
      name: best.name, unit: best.unit, state: best.state,
      alternatives: cands.slice(1, 4).map((c) => ({ entity_id: c.entity_id, score: c.score, name: c.name })),
    });
  }

  const found = report.filter((r) => r.entity_id).length;
  log(`auto-detection: ${found}/${ROLES.length} roles`);
  return { mapping, report, prefix };
}

function maxWeight(role) {
  const list = (role.hints && role.hints.any) || [];
  return list.reduce((m, [, w]) => Math.max(m, w), 0);
}

/** Heuristic: does this Home Assistant look like it has a solar system at all. */
export function looksLikeSolarSystem(states) {
  let hits = 0;
  for (const id of Object.keys(states)) {
    if (DEVICE_HINTS.test(id)) { hits++; if (hits > 2) return true; }
  }
  return false;
}
