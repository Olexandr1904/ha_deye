/**
 * entity-manager.js — the layer between raw Home Assistant states and the model.
 *
 *   raw HA entity  →  normalizeValue()  →  values[role] = {value, unit, ...}
 *
 * The UI never touches Home Assistant state objects directly (see energy-model.js).
 * Updates are event-driven: subscribe to state_changed, recompute changed roles only.
 */

import { ROLES, ROLE_BY_KEY } from './config.js?v=1.2.1';
import { normalizeValue, rafThrottle, log, isNum } from './utils.js?v=1.2.1';

const UNAVAILABLE = new Set(['unavailable', 'unknown', 'none', '', 'null']);

export class EntityManager {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.values = {};            // roleKey -> normalised value object
    this.byEntity = new Map();   // entity_id -> Set(roleKey)
    this._cbs = new Set();
    this._unsub = null;
    this._staleTimer = null;
    this._emit = rafThrottle(() => {
      const changed = this._changed;
      this._changed = new Set();
      this._cbs.forEach((cb) => { try { cb(changed, this.values); } catch (e) { console.error('[DEYE]', e); } });
    });
    this._changed = new Set();
    this._rebuildIndex();
  }

  onUpdate(cb) { this._cbs.add(cb); return () => this._cbs.delete(cb); }

  setConfig(config) {
    this.config = config;
    this._rebuildIndex();
    this.refreshAll();
  }

  _rebuildIndex() {
    this.byEntity.clear();
    const map = (this.config && this.config.entities) || {};
    for (const role of ROLES) {
      const id = map[role.key];
      if (!id) continue;
      if (!this.byEntity.has(id)) this.byEntity.set(id, new Set());
      this.byEntity.get(id).add(role.key);
    }
    if (this.client && typeof this.client.setTrackedEntities === 'function') {
      this.client.setTrackedEntities([...this.byEntity.keys()]);
    }
  }

  get trackedIds() { return [...this.byEntity.keys()]; }

  get mappedCount() { return this.trackedIds.length; }

  start() {
    this.stop();
    this._unsub = this.client.onStateChanged((entityId, stateObj) => {
      const roles = this.byEntity.get(entityId);
      if (!roles) return;
      for (const role of roles) this._updateRole(role, stateObj);
      this._emit();
    });
    // One timer for the whole dashboard: re-evaluate staleness and "N min ago"
    // labels. This is not sensor polling — states arrive as events. It emits
    // unconditionally, because the "ago" label changes with the clock even when
    // no staleness flag flipped, and because the dashboard needs one guaranteed
    // heartbeat that does not depend on a sensor reporting or on a frame being
    // painted (a hidden tab gets neither).
    this._staleTimer = setInterval(() => {
      this._recomputeStale();
      this._emit();
    }, 30000);
    this.refreshAll();
  }

  stop() {
    if (this._unsub) { this._unsub(); this._unsub = null; }
    if (this._staleTimer) { clearInterval(this._staleTimer); this._staleTimer = null; }
  }

  /** Full recompute from the current Home Assistant snapshot (start, config change). */
  refreshAll() {
    const states = this.client.getStates();
    for (const role of ROLES) {
      const id = this.config.entities[role.key];
      this._updateRole(role.key, id ? states[id] : null);
    }
    this._emit();
  }

  _updateRole(roleKey, stateObj) {
    const role = ROLE_BY_KEY[roleKey];
    if (!role) return;
    const entityId = this.config.entities[roleKey] || null;

    if (!entityId) { this.values[roleKey] = emptyValue(role, null, 'unmapped'); this._changed.add(roleKey); return; }
    if (!stateObj) { this.values[roleKey] = emptyValue(role, entityId, 'missing'); this._changed.add(roleKey); return; }

    const rawState = stateObj.state;
    const attrs = stateObj.attributes || {};
    if (UNAVAILABLE.has(String(rawState).toLowerCase())) {
      const v = emptyValue(role, entityId, String(rawState).toLowerCase() === 'unavailable' ? 'unavailable' : 'unknown');
      v.name = attrs.friendly_name || entityId;
      this.values[roleKey] = v;
      this._changed.add(roleKey);
      return;
    }

    const norm = normalizeValue(role.kind, rawState, attrs.unit_of_measurement);
    const lastUpdated = stateObj.last_updated ? new Date(stateObj.last_updated) : new Date();
    const prev = this.values[roleKey];
    const value = {
      role: roleKey,
      kind: role.kind,
      value: norm.value,
      unit: norm.unit,
      rawState,
      rawUnit: attrs.unit_of_measurement || '',
      assumedUnit: norm.assumed,
      entityId,
      name: attrs.friendly_name || entityId,
      available: norm.value !== null,
      status: 'ok',
      lastUpdated,
      stale: this._isStale(lastUpdated),
      previous: prev && prev.available ? prev.value : null,
    };
    this.values[roleKey] = value;
    if (!prev || prev.value !== value.value || prev.status !== 'ok' || prev.stale !== value.stale) {
      this._changed.add(roleKey);
    }
    if (norm.assumed && (!prev || !prev.assumedUnit)) {
      log(`${entityId} has no unit_of_measurement — unit inferred from the value (${norm.value} ${norm.unit})`);
    }
  }

  _isStale(date) {
    const limit = (this.config.staleAfterSeconds || 600) * 1000;
    return !!date && Date.now() - date.getTime() > limit;
  }

  _recomputeStale() {
    let any = false;
    for (const [key, v] of Object.entries(this.values)) {
      if (!v || !v.lastUpdated) continue;
      const stale = this._isStale(v.lastUpdated);
      if (stale !== v.stale) { v.stale = stale; this._changed.add(key); any = true; }
    }
    return any;
  }

  /** The most recent update among the tracked entities. */
  get lastUpdate() {
    let latest = null;
    for (const v of Object.values(this.values)) {
      if (v && v.lastUpdated && (!latest || v.lastUpdated > latest)) latest = v.lastUpdated;
    }
    return latest;
  }

  /** Feeds the diagnostics table in the settings UI. */
  diagnostics() {
    return ROLES.map((role) => {
      const v = this.values[role.key] || emptyValue(role, null, 'unmapped');
      return {
        role: role.key, group: role.group, label: role.label, kind: role.kind,
        entityId: v.entityId, rawState: v.rawState, rawUnit: v.rawUnit,
        value: v.value, unit: v.unit, status: v.status, stale: v.stale,
        assumedUnit: v.assumedUnit, lastUpdated: v.lastUpdated,
      };
    });
  }
}

function emptyValue(role, entityId, status) {
  return {
    role: role.key, kind: role.kind, value: null, unit: '', rawState: null, rawUnit: '',
    assumedUnit: false, entityId, name: entityId || role.label, available: false,
    status, lastUpdated: null, stale: false, previous: null,
  };
}

/** Convenience accessor: a number or null. */
export function num(values, key) {
  const v = values[key];
  return v && isNum(v.value) ? v.value : null;
}
