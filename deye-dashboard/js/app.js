/**
 * app.js — wiring: client -> entities -> model -> renderer + charts.
 *
 * Data flow (event-driven, no polling):
 *   HA state_changed -> EntityManager -> EnergyModel -> PowerFlow -> DashboardRenderer
 */

import { mergeConfig, loadUserConfig, saveUserConfig, VERSION } from './config.js';
import { HAClient, STATUS } from './ha-client.js';
import { DemoClient } from './demo.js';
import { EntityManager } from './entity-manager.js';
import { EnergyModel } from './energy-model.js';
import { computeFlow } from './power-flow.js';
import { DashboardRenderer } from './renderer.js';
import { SettingsUI } from './settings-ui.js';
import { TimeSeriesChart, DailyBarChart } from './charts.js';
import { fetchPowerHistory, fetchDailyEnergy, clearHistoryCache } from './history.js';
import { autoDetect } from './discovery.js';
import { setDebug, log, warn, h, isNum, startOfToday, formatEnergy, formatPower, rafThrottle } from './utils.js';
import { t, setLanguage, resolveLanguage, getLanguage, LANGUAGES } from './i18n.js';

const KEY_ROLES = ['pvPower', 'batterySoc', 'batteryPower', 'gridPower', 'loadPower'];
const CHART_REFRESH_MS = 120000;

export class DeyeDashboard {
  constructor(root, opts = {}) {
    this.root = root;                 // shadowRoot or a plain element
    this.opts = opts;
    this.panelConfig = opts.panelConfig || null;
    this.config = mergeConfig(this.panelConfig, loadUserConfig());
    // URL flags for debugging and deep links:
    //   ?deye_debug=1 logs · ?deye_range=7d range · ?deye_settings=1 open settings
    //   ?deye_noauto=1 skip entity auto-detection
    this.flags = readFlags();
    if (this.flags.debug) this.config.debug = true;
    setDebug(this.config.debug);
    this.range = this.flags.range || this.config.chart.defaultRange || 'today';
    this._lastChartFetch = 0;
    this._destroyed = false;
    this._scheduleUpdate = rafThrottle(() => this._applyUpdate());
  }

  /* ─────────────────────────── start-up ─────────────────────────── */

  async init({ hass = null, demo = false, standalone = null } = {}) {
    this._hassLanguage = hass && hass.locale ? hass.locale.language : null;
    setLanguage(resolveLanguage(this.config.language, this._hassLanguage));
    const container = h('div', { class: 'deye-root' });
    this.root.appendChild(container);
    this.container = container;

    this.renderer = new DashboardRenderer(container, {
      title: this.config.title,
      range: this.range,
      showPhases: this.config.showPhases,
      onOpenSettings: () => this.settings.open('entities'),
      onRangeChange: (r) => this.setRange(r),
      onToggleMenu: () => this.opts.onToggleMenu && this.opts.onToggleMenu(),
      onToggleLanguage: () => this.cycleLanguage(),
    });
    this.renderer.mount();
    this.renderer.setRange(this.range);
    this.renderer.observeFlowResize();

    this.client = demo ? new DemoClient() : new HAClient();
    this.entityManager = new EntityManager(this.client, this.config);
    this.model = new EnergyModel(this.config);

    this.settings = new SettingsUI({
      client: this.client,
      entityManager: this.entityManager,
      model: this.model,
      getConfig: () => this.config,
      onApply: (cfg) => this.applyConfig(cfg, true),
      onDemoToggle: () => this.opts.onDemoToggle && this.opts.onDemoToggle(),
      onSetLanguage: (code) => this.applyLanguage(code, { reopenSettings: 'options' }),
    });
    this.settings.mount(this.root);

    this.client.onStatus((st) => {
      this.renderer.setConnection(st);
      if (st === STATUS.CONNECTED && this.entityManager) {
        // After reconnecting: re-read the states and refresh the chart
        this.entityManager.refreshAll();
        this._lastChartFetch = 0;
      }
    });

    this.entityManager.onUpdate(() => this._scheduleUpdate());

    if (demo) {
      this.client.start();
      this._onReady();
    } else if (standalone) {
      this.renderer.setConnection(STATUS.CONNECTING);
      await this.client.connectStandalone(standalone.url, standalone.token);
      this._onReady();
    } else if (hass) {
      this.client.setHass(hass);
      this._onReady();
    }
    return this;
  }

  /** Called by the custom panel on every hass update. */
  setHass(hass) {
    if (this._destroyed || !this.client || this.client.mode === 'demo') return;
    const first = !this.client._hass;
    if (first && hass.locale) this._hassLanguage = hass.locale.language;
    this.client.setHass(hass);
    if (first) this._onReady();
  }

  _onReady() {
    if (this._readyDone) return;
    this._readyDone = true;

    const mapped = this.entityManager.mappedCount;
    if (!mapped && !this.flags.noauto) this._tryAutoDetect();

    this.entityManager.start();
    this._applyUpdate();
    this._loadChart(true);

    if (!this.entityManager.mappedCount) this._showOnboarding();
    else this.renderer.hideOnboarding();

    if (this.flags.settings) this.settings.open(this.flags.settings === '1' ? 'entities' : this.flags.settings);
  }

  /** First run: try to work out the entities ourselves. */
  _tryAutoDetect() {
    const states = this.client.getStates();
    if (!Object.keys(states).length) return;
    const { mapping, report, prefix } = autoDetect(states, {});
    const confident = report.filter((r) => r.entity_id && (r.confidence === 'high' || r.confidence === 'medium'));
    const keyFound = KEY_ROLES.filter((k) => mapping[k]).length;
    log(`auto-detection at start-up: ${confident.length} roles, key ${keyFound}/${KEY_ROLES.length}`);
    if (keyFound < 2) return;                       // too few — show the onboarding panel

    this.config = mergeConfig(this.config, { entities: mapping });
    this._autoDetected = { count: confident.length, prefix };
    this.entityManager.setConfig(this.config);
    this.model.setConfig(this.config);
  }

  /* ─────────────────────────── updates ─────────────────────────── */

  _applyUpdate() {
    if (this._destroyed) return;
    const values = this.entityManager.values;
    this.state = this.model.build(values, {
      lastUpdate: this.entityManager.lastUpdate,
      connection: this.client.status,
      demo: this.client.mode === 'demo',
    });
    this.flow = computeFlow(this.state);
    this.renderer.update(this.state, this.flow);
    this.renderer.setNotices(this._notices());

    // The "Today" chart refreshes at most once every two minutes, and only when
    // new data actually arrived — never on a timer of its own.
    if (this.range === 'today' && Date.now() - this._lastChartFetch > CHART_REFRESH_MS) this._loadChart();
  }

  _notices() {
    const list = [];
    const st = this.state;
    if (!st) return list;

    if (this.client.mode === 'demo') {
      list.push({
        id: 'demo', level: 'warn',
        text: t('notice.demo'),
        action: { label: t('notice.demoAction'), onClick: () => this.settings.open('entities') },
      });
    }

    const missing = KEY_ROLES.filter((k) => !this.config.entities[k]);
    if (missing.length && this.client.mode !== 'demo') {
      list.push({
        id: `missing-${missing.join(',')}`, level: 'warn',
        text: t('notice.missing', { list: missing.join(', ') }),
        action: { label: t('notice.missingAction'), onClick: () => this.settings.open('entities') },
      });
    }

    const assumed = Object.values(this.entityManager.values).filter((v) => v && v.assumedUnit && v.entityId);
    if (assumed.length) {
      list.push({
        id: `units-${assumed.length}`, level: 'warn',
        text: t('notice.units', {
          n: assumed.length,
          first: assumed[0].entityId,
          more: assumed.length > 1 ? t('notice.unitsMore') : '',
        }),
        action: { label: t('notice.unitsAction'), onClick: () => this.settings.open('diag') },
      });
    }

    // A balance residual almost always means a sensor polarity is wrong.
    const bal = st.meta.balance;
    if (isNum(bal)) {
      const tolerance = Math.max(0.6, (st.load.power || 0) * 0.18 + (st.pv.power || 0) * 0.06);
      if (Math.abs(bal) > tolerance) {
        list.push({
          id: 'balance', level: 'warn',
          text: t('notice.balance', { v: `${formatPower(bal, { signed: true }).value} ${formatPower(bal).unit}` }),
          action: { label: t('notice.balanceAction'), onClick: () => this.settings.open('options') },
        });
      }
    }

    if (this._autoDetected && !this._autoSaved && this.client.mode !== 'demo') {
      list.push({
        id: 'autodetected', level: 'info',
        text: t('notice.autodetected', {
          n: this._autoDetected.count,
          device: this._autoDetected.prefix
            ? t('notice.autodetectedDevice', { prefix: this._autoDetected.prefix.replace(/_$/, '') })
            : '',
        }),
        action: { label: t('notice.autodetectedAction'), onClick: () => { this.applyConfig(this.config, true); this._autoSaved = true; this._applyUpdate(); } },
      });
    }

    return list.slice(0, 3);
  }

  /* ─────────────────────── configuration and language ─────────────────── */

  applyConfig(cfg, persist = false) {
    this.config = mergeConfig(cfg);
    setDebug(this.config.debug);
    if (persist) saveUserConfig(this.config);
    this.entityManager.setConfig(this.config);
    this.model.setConfig(this.config);
    this.renderer.opts.showPhases = this.config.showPhases;
    clearHistoryCache();
    this._lastChartFetch = 0;
    if (this.entityManager.mappedCount) this.renderer.hideOnboarding();
    this._applyUpdate();
    this._loadChart(true);
    log('configuration applied', persist ? '(saved)' : '');
  }

  /** Topbar button: step to the next language in the list. */
  cycleLanguage() {
    const idx = LANGUAGES.findIndex((l) => l.code === getLanguage());
    const next = LANGUAGES[(idx + 1) % LANGUAGES.length].code;
    this.applyLanguage(next, { persist: true });
  }

  /**
   * Applies a language. Static labels are baked in at build time, so the
   * simplest correct way to re-translate them is to rebuild the DOM once.
   */
  applyLanguage(code, { persist = false, reopenSettings = null } = {}) {
    const resolved = resolveLanguage(code, this._hassLanguage);
    this.config.language = code;
    if (persist) saveUserConfig(this.config);
    if (!setLanguage(resolved) && !reopenSettings) return;
    this._remount();
    if (reopenSettings) this.settings.open(reopenSettings);
    log('language:', resolved);
  }

  /** Rebuilds the whole view (used after a language change). */
  _remount() {
    this.renderer.mount();
    this.renderer.setRange(this.range);
    this.renderer.observeFlowResize();
    // A fresh DOM starts at "connecting"; the client only reports on change.
    this.renderer.setConnection(this.client.status);
    this._applyUpdate();
    this._loadChart(true);
  }

  /* ─────────────────────────── onboarding ─────────────────────────── */

  _showOnboarding() {
    const states = this.client.getStates();
    const total = Object.keys(states).length;
    this.renderer.showOnboarding([
      h('p', { html: t('onboard.text', { n: total }) }),
      h('div', { class: 'onboard-actions' },
        h('button', {
          class: 'btn btn-primary', type: 'button', text: t('onboard.auto'),
          onclick: () => {
            const { mapping, report } = autoDetect(states, {});
            const found = report.filter((r) => r.entity_id).length;
            if (!found) { this.settings.open('entities'); return; }
            this.applyConfig(mergeConfig(this.config, { entities: mapping }), true);
            this.renderer.hideOnboarding();
          },
        }),
        h('button', { class: 'btn', type: 'button', text: t('onboard.manual'), onclick: () => this.settings.open('entities') }),
        this.opts.onDemoToggle ? h('button', { class: 'btn btn-ghost', type: 'button', text: t('onboard.demo'), onclick: () => this.opts.onDemoToggle() }) : null),
    ]);
  }

  /* ─────────────────────────── charts ─────────────────────────── */

  setRange(range) {
    if (this.range === range) return;
    this.range = range;
    this.renderer.setRange(range);
    this._loadChart(true);
  }

  async _loadChart(force = false) {
    const host = this.renderer.r.chartHost;
    if (!host) return;
    // A request that arrives mid-fetch must not be dropped: remember it and
    // replay it when the current one finishes, otherwise the highlighted tab
    // and the drawn chart disagree until the next data event.
    if (this._chartBusy) { this._chartQueued = { range: this.range, force: true }; return; }
    this._chartBusy = true;
    this.renderer.setChartBusy(true);
    this._lastChartFetch = Date.now();
    try {
      if (this.range === 'today') await this._loadTodayChart(host, force);
      else await this._loadDailyChart(host, this.range === '7d' ? 7 : 30, force);
    } catch (e) {
      warn('could not load the chart:', e);
    } finally {
      this._chartBusy = false;
      this.renderer.setChartBusy(false);
      const queued = this._chartQueued;
      this._chartQueued = null;
      if (queued && queued.range !== this.range) this._loadChart(true);
      else if (queued) this._loadChart(queued.force);
    }
  }

  async _loadTodayChart(host, force) {
    if (!(this.chart instanceof TimeSeriesChart) || force) {
      if (this.chart) this.chart.destroy();
      this.chart = new TimeSeriesChart(host, { height: chartHeight() });
    }
    const ent = this.config.entities;
    const ids = [ent.pvPower, ent.loadPower, ent.batteryPower, ent.gridPower].filter(Boolean);
    const from = startOfToday();
    const to = new Date();
    this.chart.setRange(from, to);
    if (!ids.length) { this.chart.setSeries([]); return; }

    const kinds = {};
    for (const id of ids) kinds[id] = 'power';
    const data = await fetchPowerHistory(this.client, ids, kinds, from, to);

    const batterySign = this.model.batterySign === 'charge_positive' ? 1 : -1;
    const gridSign = this.model.gridSign === 'import_positive' ? 1 : -1;

    const series = [];
    const add = (id, key, label, color, opts = {}) => {
      const pts = data[id];
      if (!pts || !pts.length) return;
      const scaled = opts.sign ? pts.map(([t, v]) => [t, v * opts.sign]) : pts;
      const last = scaled[scaled.length - 1][1];
      series.push({
        key, label, color, points: scaled, area: !!opts.area, signed: !!opts.signed,
        width: opts.width || 2,
        summary: `${formatPower(last, { signed: opts.signed }).value} ${formatPower(last).unit}`,
      });
    };
    add(ent.pvPower, 'pv', t('src.solar'), 'var(--solar-color)', { area: true, width: 2.2 });
    add(ent.loadPower, 'load', t('src.house'), 'var(--load-color)', {});
    add(ent.batteryPower, 'battery', t('src.battery'), 'var(--battery-color)', { sign: batterySign, signed: true });
    add(ent.gridPower, 'grid', t('src.grid'), 'var(--grid-color)', { sign: gridSign, signed: true });
    this.chart.setSeries(series);
  }

  async _loadDailyChart(host, days, force) {
    if (!(this.chart instanceof DailyBarChart) || force) {
      if (this.chart) this.chart.destroy();
      this.chart = new DailyBarChart(host, { height: chartHeight() });
    }
    const ent = this.config.entities;
    const defs = [
      [ent.pvToday, 'pv', t('src.solar'), 'var(--solar-color)'],
      [ent.loadToday, 'load', t('src.house'), 'var(--load-color)'],
      [ent.gridImportToday, 'import', t('series.import'), 'var(--grid-color)'],
      [ent.gridExportToday, 'export', t('series.export'), 'var(--battery-color)'],
    ].filter(([id]) => id);
    if (!defs.length) { this.chart.setSeries([]); return; }

    const data = await fetchDailyEnergy(this.client, defs.map(([id]) => id), days);
    const series = [];
    for (const [id, key, label, color] of defs) {
      const rows = data[id];
      if (!rows || !rows.length) continue;
      const total = rows.reduce((a, r) => a + r.value, 0);
      series.push({
        key, label, color,
        points: rows.map((r) => [+r.start, r.value]),
        summary: `${formatEnergy(total).value} ${formatEnergy(total).unit}`,
      });
    }
    this.chart.setSeries(series);
    if (!series.length) {
      warn('statistics unavailable — the sensors probably lack state_class / long-term statistics');
    }
  }

  destroy() {
    this._destroyed = true;
    if (this.entityManager) this.entityManager.stop();
    if (this.chart) this.chart.destroy();
    if (this.client) this.client.destroy && this.client.destroy();
  }
}

/** Parses the debug flags from the query string. */
function readFlags() {
  try {
    const p = new URLSearchParams(location.search);
    const range = p.get('deye_range');
    return {
      debug: p.get('deye_debug') === '1',
      noauto: p.get('deye_noauto') === '1',
      settings: p.get('deye_settings'),
      range: ['today', '7d', '30d'].includes(range) ? range : null,
    };
  } catch (e) {
    return {};
  }
}

function chartHeight() {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
  return w < 620 ? 210 : w < 1100 ? 250 : 300;
}

export { VERSION };
