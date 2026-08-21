/**
 * history.js — historical data straight from Home Assistant.
 *
 * There is no own database: Recorder and Statistics already live in Home Assistant.
 *   - "Today"        -> history/history_during_period      (instantaneous power)
 *   - "7 / 30 days"  -> recorder/statistics_during_period  (daily energy)
 *
 * Every request is on demand (open the panel, switch the range) — never polling.
 */

import { normalizeValue, log, warn, startOfToday, startOfDaysAgo, downsample } from './utils.js';

const cache = new Map();
const TTL_MS = 60000;

function cacheKey(kind, ids, from, to, extra = '') {
  return `${kind}|${ids.join(',')}|${from}|${to}|${extra}`;
}

function fromCache(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  return null;
}

function toCache(key, v) {
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  return v;
}

export function clearHistoryCache() { cache.clear(); }

/**
 * Instantaneous power over a period.
 * @returns {Object<string, Array<[number, number]>>} entity_id -> [[ms, value(kW)], ...]
 */
export async function fetchPowerHistory(client, entityIds, kindByEntity, start, end = new Date(), maxPoints = 700) {
  const ids = entityIds.filter(Boolean);
  if (!ids.length) return {};
  const key = cacheKey('hist', ids, start.getTime(), Math.floor(end.getTime() / 60000));
  const cached = fromCache(key);
  if (cached) return cached;

  let raw;
  try {
    raw = await client.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: ids,
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    });
  } catch (e) {
    warn('history/history_during_period is unavailable:', e && e.message);
    return {};
  }

  const out = {};
  for (const [entityId, points] of Object.entries(raw || {})) {
    if (!Array.isArray(points)) continue;
    const kind = kindByEntity[entityId] || 'power';
    const unit = unitOf(client, entityId, points);
    const series = [];
    for (const p of points) {
      const value = p.s !== undefined ? p.s : p.state;
      const t = p.lu !== undefined ? p.lu * 1000 : (p.last_updated ? Date.parse(p.last_updated) : null);
      if (t === null) continue;
      const n = normalizeValue(kind, value, unit);
      if (n.value === null) continue;
      series.push([t, n.value]);
    }
    series.sort((a, b) => a[0] - b[0]);
    out[entityId] = series.length > maxPoints ? downsample(series, maxPoints) : series;
  }
  log('history:', Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(' '));
  return toCache(key, out);
}

function unitOf(client, entityId, points) {
  const st = client.getState(entityId);
  if (st && st.attributes && st.attributes.unit_of_measurement) return st.attributes.unit_of_measurement;
  const first = points && points[0];
  if (first && first.a && first.a.unit_of_measurement) return first.a.unit_of_measurement;
  return '';
}

/**
 * Daily energy for the last N days via Statistics.
 * @returns {Object<string, Array<{start:Date, value:number}>>}
 */
export async function fetchDailyEnergy(client, entityIds, days) {
  const ids = entityIds.filter(Boolean);
  if (!ids.length) return {};
  const start = startOfDaysAgo(days);
  const end = new Date();
  const key = cacheKey('stat', ids, start.getTime(), Math.floor(end.getTime() / 600000), 'day');
  const cached = fromCache(key);
  if (cached) return cached;

  const request = (types) => client.callWS({
    type: 'recorder/statistics_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    statistic_ids: ids,
    period: 'day',
    ...(types ? { types } : {}),
  });

  let raw;
  try {
    raw = await request(['change', 'sum', 'max', 'state']);
  } catch (e) {
    // Older Home Assistant versions reject the types parameter — retry without it.
    try {
      raw = await request(null);
    } catch (e2) {
      warn('recorder/statistics_during_period is unavailable:', e2 && e2.message);
      return {};
    }
  }

  const out = {};
  for (const [statId, rows] of Object.entries(raw || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const unit = (client.getState(statId) && client.getState(statId).attributes.unit_of_measurement) || 'kWh';
    const series = [];
    let prevSum = null;
    for (const r of rows) {
      const ts = typeof r.start === 'number' ? r.start : Date.parse(r.start);
      let v = null;
      if (r.change !== undefined && r.change !== null) v = r.change;
      else if (r.sum !== undefined && r.sum !== null) { v = prevSum === null ? null : r.sum - prevSum; prevSum = r.sum; }
      else if (r.max !== undefined && r.max !== null) v = r.max;          // daily sensor that resets
      if (v === null) continue;
      const n = normalizeValue('energy', v, unit);
      if (n.value === null) continue;
      series.push({ start: new Date(ts), value: Math.max(0, n.value) });
    }
    if (series.length) out[statId] = series;
  }
  log('statistics:', Object.entries(out).map(([k, v]) => `${k}=${v.length}d`).join(' '));
  return toCache(key, out);
}

/** Which entities have long-term statistics at all. */
export async function listStatisticIds(client, entityIds) {
  try {
    const list = await client.callWS({ type: 'recorder/list_statistic_ids', statistic_type: 'sum' });
    const set = new Set((list || []).map((s) => s.statistic_id));
    return entityIds.filter((id) => set.has(id));
  } catch (e) {
    return [];
  }
}

export { startOfToday, startOfDaysAgo };
