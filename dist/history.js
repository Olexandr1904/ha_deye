/**
 * history.js — historical data straight from Home Assistant.
 *
 * There is no own database: Recorder and Statistics already live in Home
 * Assistant.
 *   - instantaneous power  -> history/history_during_period
 *   - energy per period    -> recorder/statistics_during_period (`change`)
 *   - sensor min/avg/max   -> recorder/statistics_during_period (`mean/min/max`)
 *
 * Every request is on demand — when the panel opens or the period changes —
 * never on a timer.
 */

import { normalizeValue, log, warn, downsample } from './utils.js?v=1.2.2';
import { t } from './i18n.js?v=1.2.2';

const cache = new Map();
const TTL_MS = 60000;
// A period that ended cannot change any more, so its answer is worth keeping
// for as long as the tab lives — navigating back and forth is free.
const CLOSED_TTL_MS = 6 * 3600 * 1000;

function cacheKey(kind, ids, from, to, extra = '') {
  // The end is rounded to the minute so a live period does not miss the cache
  // on every repaint, while a past period keys exactly.
  return `${kind}|${ids.join(',')}|${+from}|${Math.floor(+to / 60000)}|${extra}`;
}

/** A period whose end is in the past can never gain new data. */
function ttlFor(to) { return +to < Date.now() - 60000 ? CLOSED_TTL_MS : TTL_MS; }

function fromCache(key, to) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.t < ttlFor(to) ? hit.v : null;
}

function toCache(key, v) {
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return v;
}

export function clearHistoryCache() { cache.clear(); statIdCache = null; }

function unitOf(client, entityId, points) {
  const st = client.getState(entityId);
  if (st && st.attributes && st.attributes.unit_of_measurement) return st.attributes.unit_of_measurement;
  const first = points && points[0];
  if (first && first.a && first.a.unit_of_measurement) return first.a.unit_of_measurement;
  return '';
}

/* ─────────────────────── instantaneous values ─────────────────────── */

/**
 * States over a period, normalised to the canonical unit of each role kind.
 * @returns {Object<string, Array<[number, number]>>} entity_id -> [[ms, value]]
 */
export async function fetchPowerSeries(client, entityIds, from, to, { kinds = {}, maxPoints = 700 } = {}) {
  const ids = entityIds.filter(Boolean);
  if (!ids.length) return {};
  const key = cacheKey('hist', ids, from, to, `${ids.map((id) => kinds[id] || '').join(',')}|${maxPoints}`);
  const cached = fromCache(key, to);
  if (cached) return cached;

  let raw;
  try {
    raw = await client.callWS({
      type: 'history/history_during_period',
      start_time: new Date(from).toISOString(),
      end_time: new Date(to).toISOString(),
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
    const kind = kinds[entityId] || 'power';
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

/* ─────────────────────────── statistics ─────────────────────────── */

function requestStats(client, ids, from, to, period, types) {
  return client.callWS({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: new Date(to).toISOString(),
    statistic_ids: ids,
    period,
    ...(types ? { types } : {}),
  });
}

async function statsWithFallback(client, ids, from, to, period, types) {
  try {
    return await requestStats(client, ids, from, to, period, types);
  } catch (e) {
    // Older cores reject the `types` parameter outright.
    try {
      return await requestStats(client, ids, from, to, period, null);
    } catch (e2) {
      warn('recorder/statistics_during_period is unavailable:', e2 && e2.message);
      return null;
    }
  }
}

/**
 * Whether a bucket belongs to the window that was asked for.
 *
 * `statistics_during_period` is not strict about the far edge: asking for one
 * local day can come back with the next day's bucket as well, and summing what
 * arrives then reports two days as one. The window is half-open — the bucket
 * that starts exactly at `to` belongs to the next period, not this one.
 */
function inWindow(ts, from, to) { return ts >= +from && ts < +to; }

/**
 * Energy accumulated per bucket, for bar charts.
 * @param {string} period 'hour' | 'day' | 'month'
 * @returns {Object<string, Array<{start: Date, value: number}>>}
 */
export async function fetchEnergyBars(client, statIds, from, to, period = 'day') {
  const ids = statIds.filter(Boolean);
  if (!ids.length) return {};
  const key = cacheKey('bars', ids, from, to, period);
  const cached = fromCache(key, to);
  if (cached) return cached;

  const raw = await statsWithFallback(client, ids, from, to, period, ['change', 'sum', 'max', 'state']);
  if (!raw) return {};

  const out = {};
  for (const [statId, rows] of Object.entries(raw)) {
    if (!Array.isArray(rows) || !rows.length) continue;
    const st = client.getState(statId);
    const unit = (st && st.attributes && st.attributes.unit_of_measurement) || 'kWh';
    const series = [];
    let prevSum = null;
    let dropped = 0;
    for (const r of rows) {
      const ts = typeof r.start === 'number' ? r.start : Date.parse(r.start);
      // The baseline still has to advance through a bucket we do not keep,
      // otherwise a sum-diff would be taken against the wrong starting point.
      if (!inWindow(ts, from, to)) {
        if (r.sum !== undefined && r.sum !== null) prevSum = r.sum;
        dropped++;
        continue;
      }
      let v = null;
      if (r.change !== undefined && r.change !== null) v = r.change;
      else if (r.sum !== undefined && r.sum !== null) v = prevSum === null ? null : r.sum - prevSum;
      else if (r.max !== undefined && r.max !== null) v = r.max;   // daily sensor that resets
      // Always advance the baseline: a response mixing `change` and `sum` rows
      // would otherwise diff against a stale one.
      if (r.sum !== undefined && r.sum !== null) prevSum = r.sum;
      if (v === null) continue;
      const n = normalizeValue('energy', v, unit);
      if (n.value === null) continue;
      series.push({ start: new Date(ts), value: Math.max(0, n.value) });
    }
    if (dropped) log(`${statId}: dropped ${dropped} bucket(s) outside the requested period`);
    if (series.length) out[statId] = series;
  }
  log('energy bars:', Object.entries(out).map(([k, v]) => `${k}=${v.length}`).join(' '));
  return toCache(key, out);
}

/**
 * Sum of an energy statistic over the whole period — one number per entity,
 * used by the KPI row when it cannot read today's live counters.
 * @returns {Object<string, number>}
 */
export async function fetchEnergyTotals(client, statIds, from, to, period = 'day') {
  // Hourly buckets start on the hour, so a window running from local midnight to
  // local midnight contains a whole number of them however Home Assistant
  // chooses to align its day buckets. For a day or a week that is exact and
  // cheap; longer periods stay on the coarser buckets.
  const days = (to - from) / 86400000;
  const bars = await fetchEnergyBars(client, statIds, from, to, days <= 8 ? 'hour' : period);
  const out = {};
  for (const [id, rows] of Object.entries(bars)) {
    out[id] = rows.reduce((a, r) => a + r.value, 0);
  }
  return out;
}

/**
 * mean / min / max per bucket for one sensor — the band chart in the dialog.
 * @returns {Array<{start: Date, mean: number, min: number, max: number}>}
 */
export async function fetchSensorStats(client, statId, from, to, period = 'day', kind = 'power') {
  if (!statId) return [];
  const key = cacheKey('band', [statId], from, to, `${period}|${kind}`);
  const cached = fromCache(key, to);
  if (cached) return cached;

  const raw = await statsWithFallback(client, [statId], from, to, period, ['mean', 'min', 'max']);
  const rows = raw && raw[statId];
  if (!Array.isArray(rows)) return toCache(key, []);

  const st = client.getState(statId);
  const unit = (st && st.attributes && st.attributes.unit_of_measurement) || '';
  const conv = (v) => (v === null || v === undefined ? null : normalizeValue(kind, v, unit).value);
  const out = [];
  for (const r of rows) {
    const ts = typeof r.start === 'number' ? r.start : Date.parse(r.start);
    if (!inWindow(ts, from, to)) continue;
    const mean = conv(r.mean);
    if (mean === null) continue;
    out.push({
      start: new Date(ts),
      mean,
      min: conv(r.min) !== null ? conv(r.min) : mean,
      max: conv(r.max) !== null ? conv(r.max) : mean,
    });
  }
  return toCache(key, out);
}

/**
 * Why a period came back empty. The three cases need different remedies, so the
 * chart card and the sensor dialog must not diverge on the wording.
 * @param {string} step 'power' | 'day' | 'month'
 * @returns {Promise<{text: string, hint: string, reason: string}>}
 */
export async function explainEmpty(client, entityIds, step) {
  const ids = (entityIds || []).filter(Boolean);
  if (!ids.length) return { text: t('chart.noData'), hint: '', reason: 'none' };
  const withStats = await listStatisticIds(client, ids);
  if (!withStats.length && step !== 'power') {
    return { text: t('detail.noHistory'), hint: t('detail.noHistoryHint'), reason: 'no-statistics' };
  }
  if (step === 'power' && withStats.length) {
    // Recorder keeps detailed states for a limited window; statistics survive.
    return { text: t('detail.noDataPeriod'), hint: t('detail.dayTooOld'), reason: 'purged' };
  }
  return { text: t('detail.noDataPeriod'), hint: '', reason: 'no-data' };
}

/** Which of these entities have long-term statistics at all. */
export async function listStatisticIds(client, entityIds) {
  const all = await allStatisticIds(client);
  return (entityIds || []).filter((id) => all.has(id));
}

let statIdCache = null;

/** The whole set of statistic ids, fetched once per session. */
export async function allStatisticIds(client) {
  if (statIdCache) return statIdCache;
  try {
    const list = await client.callWS({ type: 'recorder/list_statistic_ids' });
    statIdCache = new Set((list || []).map((s) => s.statistic_id));
  } catch (e) {
    return new Set();          // do not cache a failure: the next call retries
  }
  return statIdCache;
}
