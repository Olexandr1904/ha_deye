/**
 * app.js — wiring: client -> entities -> model -> renderer + charts.
 *
 * Data flow (event-driven, no polling):
 *   HA state_changed -> EntityManager -> EnergyModel -> PowerFlow -> DashboardRenderer
 */

import { mergeConfig, unknownRoles, loadUserConfig, saveUserConfig, VERSION, ROLE_BY_KEY } from './config.js';
import { HAClient, STATUS } from './ha-client.js';
import { DemoClient } from './demo.js';
import { EntityManager } from './entity-manager.js';
import { EnergyModel } from './energy-model.js';
import { computeFlow } from './power-flow.js';
import { DashboardRenderer } from './renderer.js';
import { SettingsUI } from './settings-ui.js';
import { DetailDialog } from './detail-dialog.js';
import { TimeSeriesChart, DailyBarChart } from './charts.js';
import { fetchPowerSeries, fetchEnergyBars, clearHistoryCache, explainEmpty } from './history.js';
import { autoDetect } from './discovery.js';
import { defaultView, periodBounds, usesLiveCounters, startOfDay } from './ranges.js';
import { setDebug, log, warn, h, isNum, clamp, formatEnergy, formatPower, rafThrottle, preferMovedCounter } from './utils.js';
import { t, setLanguage, resolveLanguage, getLanguage, LANGUAGES } from './i18n.js';

const KEY_ROLES = ['pvPower', 'batterySoc', 'batteryPower', 'gridPower', 'loadPower'];
const CHART_REFRESH_MS = 120000;

export class DeyeDashboard {
  constructor(root, opts = {}) {
    this.root = root;                 // shadowRoot or a plain element
    this.opts = opts;
    this.panelConfig = opts.panelConfig || null;
    const stored = loadUserConfig();
    this.config = mergeConfig(this.panelConfig, stored);
    // Roles this browser's saved mapping has never heard of, for _detectNewRoles.
    this._unknownRoles = unknownRoles(this.panelConfig, stored);
    // URL flags for debugging and deep links:
    //   ?deye_debug=1 logs · ?deye_range=week range · ?deye_settings=1 open settings
    //   ?deye_noauto=1 skip entity auto-detection
    this.flags = readFlags();
    if (this.flags.debug) this.config.debug = true;
    setDebug(this.config.debug);
    this.view = defaultView(this.flags.range || this.config.chart.defaultRange || 'day');
    // True while the selection still means "the current period". The anchor is a
    // fixed date, so at midnight today's view silently becomes yesterday's — the
    // dashboard would slide into historical mode on its own and stay there.
    this._followNow = true;
    this.energy = {};                  // per-quantity rows chosen for the selected period
    this.mode = 'live';
    this.periodKpi = null;
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
      showPhases: this.config.showPhases,
      onOpenSettings: () => this.settings.open('entities'),
      onViewChange: (v) => this.setView(v),
      onNow: () => this.setView({ ...this.view, anchor: startOfDay(new Date()) }),
      onOpenDetail: (role) => this.detail.open(role),
      onToggleMenu: () => this.opts.onToggleMenu && this.opts.onToggleMenu(),
      onToggleLanguage: () => this.cycleLanguage(),
    });
    this.renderer.mount();
    this.renderer.observeFlowResize();
    this.renderer.setAnimations(this.config.animations);

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
    this.settings.mount(this.container);

    this.detail = new DetailDialog({ client: this.client, getConfig: () => this.config });
    this.detail.mount(this.container);

    this.client.onStatus((st) => {
      this.renderer.setConnection(st);
      if (st === STATUS.CONNECTED && this.entityManager) {
        // After reconnecting: re-read the states and refresh the chart
        this.entityManager.refreshAll();
        this._lastChartFetch = 0;
      }
    });

    // The calendar check runs synchronously on every emit; only the rendering
    // is deferred to a frame. A tab in the background is given no frames, and
    // that is exactly the tab that is open when midnight passes.
    this.entityManager.onUpdate(() => {
      if (this._followCurrentPeriod()) { this._loadPeriod(true); return; }
      this._scheduleUpdate();
    });

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
    else if (!this.flags.noauto) this._detectNewRoles();

    this.entityManager.start();
    this._applyUpdate();
    this._refreshInteractive();
    this._loadPeriod(true);

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

  /**
   * A mapping saved by an older version has never heard of the roles added
   * since, and start-up detection above only runs when nothing is mapped — so
   * without this a generator connected later would never appear. Detect those
   * roles only: a mapped role is kept, a cleared one stays cleared, and the
   * result is offered for saving exactly as on a first run.
   */
  _detectNewRoles() {
    if (!this._unknownRoles.length) return;
    const states = this.client.getStates();
    if (!Object.keys(states).length) return;
    const { mapping, report, prefix } = autoDetect(states, { keepExisting: this.config.entities });
    const confident = new Set(report.filter((r) => r.confidence === 'high' || r.confidence === 'medium').map((r) => r.role));
    const found = Object.fromEntries(this._unknownRoles.filter((k) => mapping[k] && confident.has(k)).map((k) => [k, mapping[k]]));
    const n = Object.keys(found).length;
    log(`roles the saved mapping did not know: ${this._unknownRoles.length}, detected ${n}`);
    if (!n) return;
    this.config = mergeConfig(this.config, { entities: found });
    this._autoDetected = { count: n, prefix };
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
    this.renderer.update(this.state, this.flow, this._kpiValues());
    this.renderer.setNotices(this._notices());

    // A period that contains "now" refreshes at most once every two minutes, and
    // only when new data actually arrived — never on a timer of its own.
    if (this.mode === 'live' && Date.now() - this._lastChartFetch > CHART_REFRESH_MS) this._loadPeriod();
  }

  /**
   * KPI values for the selected period. Today's numbers come from the live
   * daily counters; any other period comes from long-term statistics.
   */
  _kpiValues() {
    if (!usesLiveCounters(this.view)) return this.periodKpi;
    const st = this.state;
    // A daily register that never leaves zero is a known Deye quirk, so where
    // statistics for the same quantity say otherwise, they win.
    const p = this.periodKpi || {};
    const live = (value, key) => preferMovedCounter(value, p[key]);
    return {
      solar: live(st.pv.today, 'solar'),
      consumption: live(st.load.today, 'consumption'),
      gridImport: live(st.grid.todayImport, 'gridImport'),
      gridExport: live(st.grid.todayExport, 'gridExport'),
      generator: st.generator.relevant ? live(st.generator.today, 'generator') : null,
      batteryCharged: live(st.battery.chargeToday, 'batteryCharged'),
      batteryUsed: live(st.battery.dischargeToday, 'batteryUsed'),
      selfSufficiency: this.flow.selfSufficiency,
    };
  }

  /**
   * Only roles with a mapped entity and a numeric history may open the sensor
   * dialog: a text sensor has nothing to plot.
   */
  _refreshInteractive() {
    const mapped = new Set(Object.entries(this.config.entities)
      .filter(([k, v]) => v && ROLE_BY_KEY[k] && ROLE_BY_KEY[k].kind !== 'text')
      .map(([k]) => k));
    this.renderer.setInteractiveRoles(mapped);
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
    this.renderer.setAnimations(this.config.animations);
    this._refreshInteractive();
    if (this.entityManager.mappedCount) this.renderer.hideOnboarding();
    this._applyUpdate();
    this._loadPeriod(true);
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
    this.renderer.observeFlowResize();
    this.renderer.setAnimations(this.config.animations);
    // A fresh DOM starts at "connecting"; the client only reports on change.
    this.renderer.setConnection(this.client.status);
    this._refreshInteractive();
    this._applyUpdate();
    this._loadPeriod(true);
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

  /* ─────────────────────── period, chart and KPI ─────────────────────── */

  /** Applies a new time selection: mode, header, chart and KPI. */
  setView(view, { follow } = {}) {
    this.view = view;
    this._followNow = follow !== undefined ? follow : periodBounds(view).includesNow;
    this._loadPeriod(true);
  }

  /**
   * Re-anchors a "current period" selection when the calendar moved on. Called
   * from every update, so the panel survives midnight (and a laptop waking up
   * days later) without anyone pressing Now.
   */
  _followCurrentPeriod() {
    if (!this._followNow) return false;
    // A custom interval has fixed ends: moving its anchor would not bring the
    // present into it, and re-checking forever is how a render loop hangs.
    if (this.view.range === 'custom') return false;
    if (periodBounds(this.view).includesNow) return false;
    const next = { ...this.view, anchor: startOfDay(new Date()) };
    if (!periodBounds(next).includesNow) return false;   // never adopt a view that does not help
    this.view = next;
    log('the calendar moved on — re-anchoring the view to the current period');
    return true;
  }

  /**
   * Loads everything the selected period needs. `includesNow` decides the mode:
   * a period containing the present keeps the live diagram and cards, a period
   * strictly in the past hides them.
   */
  async _loadPeriod(force = false) {
    const bounds = periodBounds(this.view);
    this.mode = bounds.includesNow ? 'live' : 'history';
    this.renderer.setView(this.view, bounds.step);
    this.renderer.setMode(this.mode, this.view);
    this._lastChartFetch = Date.now();

    // A request arriving mid-fetch is remembered, never dropped.
    if (this._periodBusy) { this._periodQueued = true; return; }
    this._periodBusy = true;
    this.renderer.setChartBusy(true);
    try {
      this.energy = await this._loadEnergyData(bounds);
      await this._loadChart(bounds, force);
      await this._loadPeriodKpi(bounds);
      this._applyUpdate();
    } catch (e) {
      // A silent catch here once left the chart blank with no explanation and no
      // console entry unless debug logging happened to be on. A failure must be
      // visible in the card and loud in the console.
      warn('could not load the period:', e);
      console.error('[deye] the period could not be loaded:', e);
      if (this.chart) { this.chart.setEmptyText(t('chart.loadFailed'), String((e && e.message) || e)); this.chart.setSeries([]); }
    } finally {
      this._periodBusy = false;
      this.renderer.setChartBusy(false);
      if (this._periodQueued) { this._periodQueued = false; this._loadPeriod(true); }
    }
  }

  /**
   * Which entities can answer for each energy quantity, best first. A daily
   * counter is the natural source; the lifetime counter is the fallback for
   * firmwares that leave the daily one at zero, and for periods that predate
   * the daily counter's statistics.
   */
  _energySources() {
    const ent = this.config.entities;
    return {
      solar: [ent.pvToday, ent.pvTotal],
      consumption: [ent.loadToday, ent.loadTotal],
      gridImport: [ent.gridImportToday],
      gridExport: [ent.gridExportToday],
      generator: [ent.generatorToday, ent.generatorTotal],
      batteryCharged: [ent.batteryChargeToday, ent.batteryChargeTotal],
      batteryUsed: [ent.batteryDischargeToday, ent.batteryDischargeTotal],
    };
  }

  /**
   * Fetches the period once and picks, per quantity, the counter that actually
   * accounted for the energy. Everything the period shows — the bars, the legend
   * totals and the KPI tiles — is then derived from the same rows, so the chart
   * and the tiles cannot disagree about the same period.
   */
  async _loadEnergyData(bounds) {
    const sources = this._energySources();
    const ids = [...new Set(Object.values(sources).flat().filter(Boolean))];
    if (!ids.length) return {};
    // A day is summed from hourly buckets: exact whatever the backend does with
    // day alignment. Longer periods use the buckets the chart draws.
    const period = bounds.step === 'power' ? 'hour' : bounds.step;
    const bars = await fetchEnergyBars(this.client, ids, bounds.from, bounds.to, period);
    const out = {};
    for (const [key, candidates] of Object.entries(sources)) {
      let best = null;
      for (const id of candidates.filter(Boolean)) {
        const rows = bars[id];
        if (!rows || !rows.length) continue;
        const total = rows.reduce((a, r) => a + r.value, 0);
        if (!best || total > best.total) best = { id, rows, total };
      }
      if (best) out[key] = best;
    }
    return out;
  }

  async _loadChart(bounds, force) {
    const host = this.renderer.r.chartHost;
    if (!host) return;
    if (bounds.step === 'power') await this._loadPowerChart(host, bounds, force);
    else await this._loadEnergyChart(host, bounds, force);
  }

  /** Instantaneous power: signed lines from the history API. */
  async _loadPowerChart(host, bounds, force) {
    if (!(this.chart instanceof TimeSeriesChart) || force) {
      if (this.chart) this.chart.destroy();
      this.chart = new TimeSeriesChart(host, { height: chartHeight() });
      this._chartBucket = null;
    }
    const ent = this.config.entities;
    const withGen = !!(this.state && this.state.generator && this.state.generator.relevant);
    const defs = [
      [ent.pvPower, 'pv', t('src.solar'), 'var(--solar-color)', { area: true, width: 2.2 }],
      [withGen ? ent.generatorPower : null, 'generator', t('src.generator'), 'var(--generator-color)', {}],
      [ent.loadPower, 'load', t('src.house'), 'var(--load-color)', {}],
      [ent.batteryPower, 'battery', t('src.battery'), 'var(--battery-color)',
        { sign: this.model.batterySign === 'charge_positive' ? 1 : -1, signed: true }],
      [ent.gridPower, 'grid', t('src.grid'), 'var(--grid-color)',
        { sign: this.model.gridSign === 'import_positive' ? 1 : -1, signed: true }],
    ].filter(([id]) => id);

    this.chart.setRange(bounds.from, bounds.to);
    if (!defs.length) { this.chart.setSeries([]); return; }
    this.chart.setEmptyText(t('chart.noData'));

    const ids = defs.map(([id]) => id);
    const kinds = Object.fromEntries(ids.map((id) => [id, 'power']));
    const data = await fetchPowerSeries(this.client, ids, bounds.from, bounds.to, { kinds });

    if (!ids.some((id) => (data[id] || []).length)) await this._explainEmptyChart(bounds, ids);
    const series = [];
    for (const [id, key, label, color, opts] of defs) {
      const pts = data[id];
      if (!pts || !pts.length) continue;
      const scaled = opts.sign ? pts.map(([ts, v]) => [ts, v * opts.sign]) : pts;
      const last = scaled[scaled.length - 1][1];
      series.push({
        key, label, color, points: scaled, area: !!opts.area, signed: !!opts.signed,
        width: opts.width || 2,
        summary: `${formatPower(last, { signed: opts.signed }).value} ${formatPower(last).unit}`,
      });
    }
    this.chart.setSeries(series);
  }

  /** Energy per bucket: grouped bars from long-term statistics. */
  async _loadEnergyChart(host, bounds, force) {
    const bucket = bounds.step;   // 'day' | 'month'
    if (!(this.chart instanceof DailyBarChart) || force || this._chartBucket !== bucket) {
      if (this.chart) this.chart.destroy();
      this.chart = new DailyBarChart(host, { height: chartHeight(), bucket });
      this._chartBucket = bucket;
    }
    // Every bucket of the period gets a slot, whether or not it holds data: the
    // x axis is a calendar, so two months of data must sit where those months
    // are, not spread across the year.
    this.chart.setRange(bounds.from, bounds.to);
    this.chart.setEmptyText(t('chart.noData'));

    const withGen = !!(this.state && this.state.generator && this.state.generator.relevant);
    const defs = [
      ['solar', 'pv', t('src.solar'), 'var(--solar-color)'],
      [withGen ? 'generator' : null, 'generator', t('src.generator'), 'var(--generator-color)'],
      ['consumption', 'load', t('src.house'), 'var(--load-color)'],
      ['gridImport', 'import', t('series.import'), 'var(--grid-color)'],
      ['gridExport', 'export', t('series.export'), 'var(--battery-color)'],
    ].filter(([key]) => key);

    const series = [];
    for (const [srcKey, key, label, color] of defs) {
      const picked = this.energy[srcKey];
      if (!picked) continue;
      series.push({
        key, label, color,
        points: picked.rows.map((r) => [+r.start, r.value]),
        summary: `${formatEnergy(picked.total).value} ${formatEnergy(picked.total).unit}`,
      });
    }
    this.chart.setSeries(series);
    if (!series.length) {
      const ids = [...new Set(Object.values(this._energySources()).flat().filter(Boolean))];
      await this._explainEmptyChart(bounds, ids);
    }
  }

  /**
   * Names the reason the chart came back empty, because the remedy differs: a
   * sensor without long-term statistics needs a `state_class`, an old day needs
   * the Month view, and a period before the data simply has nothing.
   */
  async _explainEmptyChart(bounds, ids) {
    const reason = await explainEmpty(this.client, ids, bounds.step);
    this.chart.setEmptyText(reason.text, reason.hint);
  }

  /**
   * KPI for a period that cannot use today's live counters. Self-sufficiency is
   * defined differently here on purpose: over a period it is the share of
   * consumption that was not bought from the grid.
   */
  async _loadPeriodKpi(bounds) {
    const kpi = {};
    for (const key of Object.keys(this._energySources())) {
      kpi[key] = this.energy[key] ? this.energy[key].total : null;
    }
    // Same relevance rule as the live tiles: an installation whose generator
    // sensors read zero should not grow a GENERATOR tile for every past period.
    if (!isNum(kpi.generator) || kpi.generator <= 0.01) kpi.generator = null;
    kpi.selfSufficiency = isNum(kpi.consumption) && kpi.consumption > 0 && isNum(kpi.gridImport)
      ? clamp(((kpi.consumption - kpi.gridImport) / kpi.consumption) * 100, 0, 100)
      : null;
    this.periodKpi = kpi;
  }

  destroy() {
    this._destroyed = true;
    if (this.entityManager) this.entityManager.stop();
    if (this.chart) this.chart.destroy();
    if (this.detail) this.detail.close();
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
      range: ['day', 'week', 'month', 'year', 'custom'].includes(range) ? range : null,
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
