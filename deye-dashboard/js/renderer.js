/**
 * renderer.js — build the DOM once, then patch it in place.
 *
 * mount() creates the markup and caches node references; update(state, flow)
 * touches ONLY the text nodes and classes whose values actually changed.
 * Nothing is ever re-rendered wholesale.
 */

import { icon } from './icons.js';
import {
  h, s, setText, setAttr, toggleClass, setStyleVar, formatPower, formatEnergy, formatNumber,
  fmtClock, fmtAgo, fmtHours, isNum, clamp, DASH,
} from './utils.js';
import { t, getLanguage, LANGUAGES } from './i18n.js';
import { FLOW_LAYOUTS, LINK_KEYS, pickLayout } from './flow-layout.js';
import { DateNav } from './date-nav.js';
import { periodLabel } from './ranges.js';

/**
 * KPI tiles. Values arrive from the app as a plain object, because the source
 * differs by period: today's live daily counters, or long-term statistics.
 * `role` makes the tile open the sensor dialog when that period uses an entity.
 */
const KPI_DEFS = [
  { key: 'solar', label: 'kpi.pvToday', icon: 'sun', tone: 'solar', kind: 'energy', role: 'pvToday' },
  { key: 'consumption', label: 'kpi.consumption', icon: 'house', tone: 'load', kind: 'energy', role: 'loadToday' },
  { key: 'gridImport', label: 'kpi.gridImport', icon: 'grid', tone: 'grid', kind: 'energy', role: 'gridImportToday' },
  { key: 'gridExport', label: 'kpi.gridExport', icon: 'bolt', tone: 'grid', kind: 'energy', role: 'gridExportToday' },
  { key: 'generator', label: 'kpi.generator', icon: 'generator', tone: 'generator', kind: 'energy', optional: true, role: 'generatorToday' },
  { key: 'batteryCharged', label: 'kpi.batteryCharged', icon: 'battery', tone: 'battery', kind: 'energy', optional: true, role: 'batteryChargeToday' },
  { key: 'batteryUsed', label: 'kpi.batteryUsed', icon: 'battery', tone: 'battery', kind: 'energy', optional: true, role: 'batteryDischargeToday' },
  { key: 'selfSufficiency', label: 'kpi.selfSufficiency', icon: 'check', tone: 'accent', kind: 'percent', optional: true },
];

const STATUS_KEY = {
  online: 'inv.online', offline: 'inv.offline', standby: 'inv.standby',
  fault: 'inv.fault', stale: 'inv.stale', unknown: 'inv.unknown',
};
const invStatusText = (state) => t(STATUS_KEY[state] || 'inv.unknown');

export class DashboardRenderer {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.r = {};                // cached node references
    this.flowLayout = null;
  }

  /* ─────────────────────────── markup ─────────────────────────── */

  mount() {
    // A remount (language switch) must drop everything tied to the detached DOM:
    // the resize observer and the content caches that guard redundant redraws.
    if (this._flowRo) { this._flowRo.disconnect(); this._flowRo = null; }
    this.flowLayout = null;
    this._noticeKey = null;
    this._mixKey = null;
    this._allocKey = null;
    // Remove only what this renderer put here: the dialogs are siblings inside
    // the same container (so one data-anim covers them) and must survive a
    // language remount — wiping the container would leave them detached.
    if (this.app) this.app.remove();
    if (this.r.onboard) this.r.onboard.remove();
    this.app = h('div', { class: 'app' });
    this.app.append(this._buildTopbar(), this._buildNotices(), this._buildGrid());
    this.root.append(this.app, this._buildOnboarding());
    this._installFlowLayout();
    // One delegated listener for every value that can be drilled into.
    this.app.addEventListener('click', (e) => this._onValueActivate(e));
    this.app.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') this._onValueActivate(e);
    });
    return this.app;
  }

  /** Opens the sensor dialog for the nearest ancestor carrying data-role. */
  _onValueActivate(e) {
    const target = e.target.closest('[data-role]');
    if (!target || !target.dataset.role) return;
    if (target.getAttribute('aria-disabled') === 'true') return;
    // The role set is the authority: a row created after the last refresh has
    // no attributes yet and must not open an empty dialog.
    if (this._roleSet && !this._roleSet.has(target.dataset.role)) return;
    e.preventDefault();
    if (this.opts.onOpenDetail) this.opts.onOpenDetail(target.dataset.role);
  }

  /** Marks which roles actually have an entity, so only those look clickable. */
  setInteractiveRoles(roleSet) {
    this._roleSet = roleSet;
    for (const el of this.app.querySelectorAll('[data-role]')) this._markInteractive(el);
  }

  /**
   * Applies the affordances to one element. Rows built during an update (PV
   * strings, phases) are created long after setInteractiveRoles ran, so they
   * have to ask for the treatment themselves.
   */
  _markInteractive(el) {
    const ok = !!(this._roleSet && this._roleSet.has(el.dataset.role));
    toggleClass(el, 'is-clickable', ok);
    setAttr(el, 'role', ok ? 'button' : null);
    setAttr(el, 'tabindex', ok ? '0' : null);
    setAttr(el, 'aria-disabled', ok ? null : 'true');
  }

  /** live | history — hides the diagram and the detail cards in history mode. */
  setMode(mode, view) {
    setAttr(this.app, 'data-mode', mode);
    const historical = mode === 'history';
    setAttr(this.r.historyBar, 'hidden', !historical);
    if (historical && view) {
      setText(this.r.historyLabel, t('history.viewing', { period: periodLabel(view) }));
    }
  }

  /** auto | on | off — see the reduce-motion handling in dashboard.css. */
  setAnimations(mode) {
    const value = ['auto', 'on', 'off'].includes(mode) ? mode : 'auto';
    setAttr(this.app, 'data-anim', value);
    // The dialogs live outside .app, so the setting has to sit on the container
    // they share — otherwise "off" never reaches a spinner in a modal.
    if (this.root && this.root.setAttribute) setAttr(this.root, 'data-anim', value);
  }

  _buildTopbar() {
    const r = this.r;
    r.menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', title: t('ui.menu'), 'aria-label': t('ui.menu'), html: icon('menu', { size: 20 }), onclick: () => this.opts.onToggleMenu && this.opts.onToggleMenu() });
    r.statusDot = h('span', { class: 'dot' });
    r.statusText = h('span', { class: 'status-text', text: t('status.connecting') });
    r.statusChip = h('div', { class: 'status-chip', 'data-state': 'unknown' }, r.statusDot, r.statusText);
    r.lastUpdate = h('span', { class: 'lu-value', text: DASH });
    const lang = LANGUAGES.find((l) => l.code === getLanguage()) || LANGUAGES[0];
    r.langBtn = h('button', {
      class: 'icon-btn lang-btn', type: 'button', title: t('ui.language'), 'aria-label': t('ui.language'),
      text: lang.short, onclick: () => this.opts.onToggleLanguage && this.opts.onToggleLanguage(),
    });
    r.lastAgo = h('span', { class: 'lu-ago', text: '' });
    // The selected period drives the whole page (mode, KPI, chart), so its
    // control sits in the top bar rather than in one card's header — and the
    // brand no longer repeats today's date next to it.
    r.dateNav = new DateNav({
      compact: true, switcher: 'select', showNow: false,
      onChange: (v) => this.opts.onViewChange && this.opts.onViewChange(v),
    });
    r.settingsBtn = h('button', { class: 'icon-btn settings-btn', type: 'button', title: t('ui.settings'), 'aria-label': t('ui.settings'), html: icon('gear', { size: 19 }), onclick: () => this.opts.onOpenSettings && this.opts.onOpenSettings() });
    r.demoBadge = h('span', { class: 'badge badge-demo', text: t('badge.demo'), hidden: true });

    return h('header', { class: 'topbar' },
      r.menuBtn,
      h('div', { class: 'brand' },
        h('span', { class: 'brand-mark', html: icon('bolt', { size: 20 }) }),
        h('div', { class: 'brand-text' },
          h('div', { class: 'brand-title' }, h('span', { class: 'brand-title-main', text: this.opts.title || 'DEYE ENERGY' }), r.demoBadge))),
      h('div', { class: 'topbar-nav' }, r.dateNav.element),
      h('div', { class: 'topbar-spacer' }),
      h('div', { class: 'last-update' },
        h('span', { class: 'lu-label', text: t('ui.lastUpdate') }),
        h('span', { class: 'lu-line' }, r.lastUpdate, r.lastAgo)),
      r.statusChip,
      r.langBtn,
      r.settingsBtn);
  }

  _buildNotices() {
    const r = this.r;
    r.historyLabel = h('span', { class: 'history-label' });
    r.historyBar = h('div', { class: 'history-bar', hidden: true },
      h('span', { class: 'history-icon', html: icon('calendar', { size: 15 }) }),
      r.historyLabel,
      h('span', { class: 'history-hint', text: t('history.hint') }),
      h('button', {
        class: 'btn btn-ghost history-now', type: 'button', text: t('nav.today'),
        onclick: () => this.opts.onNow && this.opts.onNow(),
      }));
    r.notices = h('div', { class: 'notices' });
    return h('div', { class: 'above-grid' }, r.historyBar, r.notices);
  }

  _buildGrid() {
    // DOM order is the reading order; the visual layout comes from grid areas.
    return h('main', { class: 'grid' },
      this._buildFlowCard(),
      this._buildBatteryCard(),
      this._buildGridCard(),
      this._buildKpiRow(),
      this._buildChartCard(),
      h('div', { class: 'detail-row' },
        this._buildSolarCard(),
        this._buildGeneratorCard(),
        this._buildPhasesCard(),
        this._buildInverterCard()));
  }

  /* ─────────────────────────── flow diagram ─────────────────────────── */

  _buildFlowCard() {
    const r = this.r;
    r.flowSvg = s('svg', { class: 'flow-svg', viewBox: '0 0 1000 700', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
    r.flowLinks = {};
    const gLinks = s('g', { class: 'flow-links' });
    for (const key of LINK_KEYS) {
      const track = s('path', { class: 'link-track', fill: 'none' });
      const glow = s('path', { class: 'link-glow', fill: 'none' });
      const beads = s('path', { class: 'link-beads', fill: 'none' });
      const g = s('g', { class: `flow-link link-${key}`, 'data-dir': 'idle' }, track, glow, beads);
      r.flowLinks[key] = { g, track, glow, beads };
      gLinks.appendChild(g);
    }
    r.flowSvg.appendChild(gLinks);

    r.nodes = {};
    const nodesWrap = h('div', { class: 'flow-nodes' });
    nodesWrap.append(
      this._node('solar', t('node.solar'), 'sun', 'pvPower'),
      this._node('generator', t('node.generator'), 'generator', 'generatorPower'),
      this._node('grid', t('node.grid'), 'grid', 'gridPower'),
      this._node('house', t('node.house'), 'house', 'loadPower'),
      this._batteryNode(),
      this._inverterNode());

    r.flowLabels = {};
    const labelsWrap = h('div', { class: 'flow-labels' });
    for (const key of LINK_KEYS) {
      const arrow = h('span', { class: 'fl-arrow', html: '' });
      const val = h('span', { class: 'fl-value', text: DASH });
      const el = h('div', { class: `flow-label fl-${key}`, 'data-dir': 'idle' }, arrow, val);
      r.flowLabels[key] = { el, val, arrow };
      labelsWrap.appendChild(el);
    }

    r.flowStage = h('div', { class: 'flow-stage' }, r.flowSvg, nodesWrap, labelsWrap);

    // distribution (calculated, not measured)
    r.mixBar = h('div', { class: 'mix-bar' },
      h('span', { class: 'mix-seg mix-pv' }), h('span', { class: 'mix-seg mix-gen' }),
      h('span', { class: 'mix-seg mix-batt' }), h('span', { class: 'mix-seg mix-grid' }));
    r.mixLegend = h('div', { class: 'mix-legend' });
    r.allocList = h('div', { class: 'alloc-list' });
    r.flowFooter = h('div', { class: 'flow-footer' },
      h('div', { class: 'flow-footer-head' },
        h('span', { class: 'section-label', text: t('flow.coverage') }),
        h('span', { class: 'hint', title: t('flow.calculatedHint'), text: t('flow.calculated') })),
      r.mixBar, r.mixLegend, r.allocList);

    return card('card-flow', { title: t('card.flow'), icon: 'chart', hideHeader: true }, r.flowStage, r.flowFooter);
  }

  _node(key, label, iconName, role) {
    const r = this.r;
    const num = h('span', { class: 'node-num', text: DASH });
    const unit = h('span', { class: 'node-unit', text: '' });
    const sub = h('span', { class: 'node-sub', text: '' });
    const node = h('div', {
      class: `flow-node node-${key} tone-${key === 'house' ? 'load' : key}`,
      dataset: role ? { role } : {},
    },
      h('div', { class: 'node-glow' }),
      h('div', { class: 'node-body' },
        h('span', { class: 'node-icon', html: icon(iconName, { size: 22 }) }),
        h('span', { class: 'node-label', text: label }),
        h('span', { class: 'node-value' }, num, unit),
        sub));
    r.nodes[key] = { node, num, unit, sub };
    return node;
  }

  _batteryNode() {
    const r = this.r;
    const num = h('span', { class: 'node-num', text: DASH });
    const unit = h('span', { class: 'node-unit', text: '%' });
    const sub = h('span', { class: 'node-sub', text: '' });
    const level = h('span', { class: 'node-level-fill' });
    const node = h('div', { class: 'flow-node node-battery tone-battery', dataset: { role: 'batterySoc' } },
      h('div', { class: 'node-glow' }),
      h('div', { class: 'node-body' },
        h('span', { class: 'node-icon', html: icon('battery', { size: 22 }) }),
        h('span', { class: 'node-label', text: t('node.battery') }),
        h('span', { class: 'node-value' }, num, unit),
        h('span', { class: 'node-level' }, level),
        sub));
    r.nodes.battery = { node, num, unit, sub, level };
    return node;
  }

  _inverterNode() {
    const r = this.r;
    const power = h('span', { class: 'inv-power-num', text: DASH });
    const powerUnit = h('span', { class: 'inv-power-unit', text: '' });
    const statusText = h('span', { class: 'inv-status-text', text: t('inv.unknown') });
    const rated = h('span', { class: 'inv-rated', text: '' });
    const node = h('div', { class: 'flow-node node-inverter', 'data-state': 'unknown' },
      h('div', { class: 'inv-ring' }),
      h('div', { class: 'inv-body' },
        h('span', { class: 'inv-name', text: 'DEYE' }),
        h('span', { class: 'inv-power' }, power, powerUnit),
        rated,
        h('span', { class: 'inv-status' }, h('span', { class: 'inv-dot' }), statusText)));
    r.nodes.inverter = { node, power, powerUnit, statusText, rated };
    return node;
  }

  _installFlowLayout(force) {
    const width = this.r.flowStage ? this.r.flowStage.clientWidth : 0;
    const want = pickLayout(width, !!this._hasGenerator);
    if (!force && want === this.flowLayout) return;
    this.flowLayout = want;
    const L = FLOW_LAYOUTS[want];
    const r = this.r;

    setAttr(r.flowSvg, 'viewBox', `0 0 ${L.viewBox[0]} ${L.viewBox[1]}`);
    r.flowStage.style.setProperty('--flow-aspect', `${L.viewBox[0]} / ${L.viewBox[1]}`);
    // Constrain the WIDTH: if the height were capped instead, the SVG and the
    // HTML nodes would scale differently and the links would miss the nodes.
    r.flowStage.style.setProperty('--flow-ratio', String(L.viewBox[0] / L.viewBox[1]));
    r.flowStage.style.setProperty('--flow-max-h', L.maxHeight || '62vh');
    r.flowStage.style.setProperty('--node-size', `${L.nodeSize}%`);
    r.flowStage.style.setProperty('--hub-size', `${L.hubSize}%`);
    r.flowStage.dataset.layout = want;

    // A node or link absent from this layout (the generator, most of the time)
    // is hidden rather than left at stale coordinates.
    for (const [key, node] of Object.entries(r.nodes)) {
      const pos = L.nodes[key];
      setAttr(node.node, 'hidden', !pos);
      if (!pos) continue;
      node.node.style.left = `${pos.x}%`;
      node.node.style.top = `${pos.y}%`;
    }
    for (const [key, link] of Object.entries(r.flowLinks)) {
      const d = L.paths[key] || '';
      setAttr(link.g, 'hidden', !d);
      setAttr(link.track, 'd', d);
      setAttr(link.glow, 'd', d);
      setAttr(link.beads, 'd', d);
    }
    for (const [key, label] of Object.entries(r.flowLabels)) {
      const pos = L.labels[key];
      setAttr(label.el, 'hidden', !pos);
      if (!pos) continue;
      label.el.style.left = `${pos.x}%`;
      label.el.style.top = `${pos.y}%`;
      label.el.dataset.align = pos.align;
    }

    // Arrows depend on the geometry, so rebuild them right away instead of
    // waiting for the next sensor update (with Modbus that can be tens of seconds).
    if (this._lastFlow) {
      for (const [key, link] of Object.entries(this._lastFlow.links)) {
        const label = r.flowLabels[key];
        if (label) label.arrow.innerHTML = link.dir === 'idle' ? '' : arrowFor(key, link.dir, want);
      }
    }
  }

  observeFlowResize() {
    if (!this.r.flowStage || this._flowRo) return;
    // Switching the layout changes the width of the observed element. Doing that
    // inside the callback makes ResizeObserver complain with "loop completed with
    // undelivered notifications", so the change is deferred — but not to a frame
    // alone: a page that has stopped producing frames would keep a stale layout,
    // so a timer races the frame and whichever arrives first wins.
    this._flowRo = new ResizeObserver(() => {
      if (this._flowPending) return;
      this._flowPending = true;
      const run = () => {
        if (!this._flowPending) return;
        this._flowPending = false;
        this._installFlowLayout();
      };
      requestAnimationFrame(run);
      setTimeout(run, 120);
    });
    this._flowRo.observe(this.r.flowStage);
  }

  /* ─────────────────────────── battery card ─────────────────────────── */

  _buildBatteryCard() {
    const r = this.r;
    const socNum = h('span', { class: 'big-num', text: DASH });
    const socUnit = h('span', { class: 'big-unit', text: '%' });
    const powerNum = h('span', { class: 'batt-power-num', text: DASH });
    const powerUnit = h('span', { class: 'batt-power-unit', text: '' });
    const mode = h('span', { class: 'batt-mode', text: '' });

    const fill = s('rect', { class: 'batt-fill', x: 14, y: 20, width: 92, height: 172, rx: 9 });
    const fillWrap = s('g', { class: 'batt-fill-wrap' }, fill);
    const stripes = s('g', { class: 'batt-stripes' });
    for (let i = 0; i < 9; i++) {
      stripes.appendChild(s('rect', { x: 10, y: i * 26, width: 100, height: 9, rx: 4.5, opacity: 0.18, fill: 'var(--bg-0)' }));
    }
    const clipId = 'battclip';
    const svg = s('svg', { class: 'batt-svg', viewBox: '0 0 120 210', 'aria-hidden': 'true' },
      s('defs', {}, s('clipPath', { id: clipId }, s('rect', { x: 14, y: 20, width: 92, height: 172, rx: 12 }))),
      s('rect', { class: 'batt-cap', x: 45, y: 2, width: 30, height: 10, rx: 4 }),
      s('rect', { class: 'batt-shell', x: 8, y: 14, width: 104, height: 182, rx: 18 }),
      s('g', { 'clip-path': `url(#${clipId})` }, fillWrap, stripes),
      s('g', { class: 'batt-ticks' },
        ...[20, 50, 80].map((p) => s('line', { x1: 14, x2: 31, y1: 20 + 172 * (1 - p / 100), y2: 20 + 172 * (1 - p / 100) }))));

    r.battery = {
      socNum, socUnit, powerNum, powerUnit, mode, fillWrap,
      rows: {},
      card: null,
    };

    const rowsWrap = h('div', { class: 'stat-rows' });
    for (const [key, label, role] of [
      ['voltage', t('stat.voltage'), 'batteryVoltage'],
      ['current', t('stat.current'), 'batteryCurrent'],
      ['temperature', t('stat.temperature'), 'batteryTemperature'],
      ['soh', t('stat.health'), 'batterySoh'],
      ['eta', t('stat.timeToFull'), null],
      ['cycleToday', t('stat.chargeDischarge'), null],
    ]) {
      const row = statRow(label, role);
      r.battery.rows[key] = row;
      rowsWrap.appendChild(row.node);
    }

    const cardEl = card('card-battery tone-battery', { title: t('card.battery'), icon: 'battery' },
      h('div', { class: 'batt-main' },
        h('div', { class: 'batt-visual' }, svg),
        h('div', { class: 'batt-readout' },
          h('div', { class: 'big-value' }, socNum, socUnit),
          h('div', { class: 'batt-power' }, powerNum, powerUnit),
          mode)),
      rowsWrap);
    r.battery.card = cardEl;
    return cardEl;
  }

  /* ─────────────────────────── KPI ─────────────────────────── */

  _buildKpiRow() {
    const r = this.r;
    r.kpi = {};
    const row = h('section', { class: 'kpi-row' });
    for (const def of KPI_DEFS) {
      const num = h('span', { class: 'kpi-num', text: DASH });
      const unit = h('span', { class: 'kpi-unit', text: '' });
      const node = h('article', {
        class: `kpi tone-${def.tone}`, 'data-key': def.key,
        dataset: def.role ? { role: def.role } : {},
      },
        h('div', { class: 'kpi-head' },
          h('span', { class: 'kpi-icon', html: icon(def.icon, { size: 15 }) }),
          h('span', { class: 'kpi-label', text: t(def.label) })),
        h('div', { class: 'kpi-value' }, num, unit));
      r.kpi[def.key] = { node, num, unit, def };
      row.appendChild(node);
    }
    return row;
  }

  /* ─────────────────────────── chart ─────────────────────────── */

  _buildChartCard() {
    const r = this.r;
    // The nav is built here, not injected, so a language switch rebuilds its
    // labels along with the rest of the DOM.

    r.chartHost = h('div', { class: 'chart-host' });
    r.chartTitle = h('span', { class: 'card-title-text', text: t('chart.power') });
    r.chartSpinner = h('span', { class: 'spinner', hidden: true });
    return card('card-chart', {
      titleEl: r.chartTitle,
      icon: 'chart',
      extra: h('div', { class: 'card-actions' }, r.chartSpinner),
    }, r.chartHost);
  }

  /** Reflects the selected period in the header and the nav. */
  setView(view, step) {
    this.r.dateNav.setView(view);
    setText(this.r.chartTitle, t(step === 'power' ? 'chart.power' : 'chart.energy'));
  }

  setChartBusy(busy) { setAttr(this.r.chartSpinner, 'hidden', !busy); }

  /* ─────────────────────────── solar / grid / phases / inverter ───────── */

  _buildSolarCard() {
    const r = this.r;
    r.solar = { strings: [], rows: {} };
    r.solarStrings = h('div', { class: 'string-list' });
    const rowsWrap = h('div', { class: 'stat-rows' });
    for (const [key, label, role] of [
      ['power', t('stat.pvPower'), 'pvPower'],
      ['today', t('stat.today'), 'pvToday'],
      ['total', t('stat.total'), 'pvTotal'],
    ]) {
      const row = statRow(label, role);
      r.solar.rows[key] = row;
      rowsWrap.appendChild(row.node);
    }
    r.solar.card = card('card-solar tone-solar', { title: t('card.solar'), icon: 'sun' }, rowsWrap, r.solarStrings);
    return r.solar.card;
  }

  _buildGridCard() {
    const r = this.r;
    const num = h('span', { class: 'big-num', text: DASH });
    const unit = h('span', { class: 'big-unit', text: '' });
    const badge = h('span', { class: 'dir-badge', text: t('grid.idle') });
    r.grid = { num, unit, badge, rows: {} };
    const rowsWrap = h('div', { class: 'stat-rows' });
    for (const [key, label, role] of [
      ['import', t('stat.importToday'), 'gridImportToday'],
      ['export', t('stat.exportToday'), 'gridExportToday'],
      ['voltage', t('stat.voltage'), 'gridVoltage'],
      ['frequency', t('stat.frequency'), 'gridFrequency'],
    ]) {
      const row = statRow(label, role);
      r.grid.rows[key] = row;
      rowsWrap.appendChild(row.node);
    }
    r.grid.card = card('card-grid tone-grid', { title: t('card.grid'), icon: 'grid' },
      h('div', { class: 'card-hero' }, h('div', { class: 'big-value' }, num, unit), badge), rowsWrap);
    return r.grid.card;
  }

  _buildPhasesCard() {
    const r = this.r;
    r.phases = {};
    const wrap = h('div', { class: 'phase-list' });
    for (const [key, label, role] of [['l1', 'L1', 'phaseAPower'], ['l2', 'L2', 'phaseBPower'], ['l3', 'L3', 'phaseCPower']]) {
      const value = h('span', { class: 'phase-value', text: DASH });
      const meta = h('span', { class: 'phase-meta', text: '' });
      const bar = h('span', { class: 'bar-fill' });
      const node = h('div', { class: 'phase-row', dataset: { role } },
        h('div', { class: 'phase-head' },
          h('span', { class: 'phase-name', text: label }), value),
        h('span', { class: 'bar' }, bar),
        meta);
      r.phases[key] = { node, value, meta, bar };
      wrap.appendChild(node);
    }
    r.phasesCard = card('card-phases tone-phase', { title: t('card.phases'), icon: 'wave' }, wrap);
    return r.phasesCard;
  }

  _buildGeneratorCard() {
    const r = this.r;
    const num = h('span', { class: 'big-num', text: DASH });
    const unit = h('span', { class: 'big-unit', text: '' });
    const badge = h('span', { class: 'dir-badge', text: t('gen.stopped') });
    r.generator = { num, unit, badge, rows: {} };
    const rowsWrap = h('div', { class: 'stat-rows' });
    for (const [key, label, role] of [
      ['today', t('stat.today'), 'generatorToday'],
      ['total', t('stat.total'), 'generatorTotal'],
      ['voltage', t('stat.voltage'), 'generatorVoltage'],
    ]) {
      const row = statRow(label, role);
      r.generator.rows[key] = row;
      rowsWrap.appendChild(row.node);
    }
    r.generatorCard = card('card-generator tone-generator', { title: t('card.generator'), icon: 'generator' },
      h('div', { class: 'card-hero' }, h('div', { class: 'big-value' }, num, unit), badge), rowsWrap);
    setAttr(r.generatorCard, 'hidden', true);
    return r.generatorCard;
  }

  _updateGenerator(state) {
    const g = this.r.generator;
    const st = state.generator || {};
    setAttr(this.r.generatorCard, 'hidden', !st.relevant);
    if (!st.relevant) return;
    const f = formatPower(st.power);
    setText(g.num, f.value);
    setText(g.unit, f.unit);
    setText(g.badge, st.running ? t('gen.running') : t('gen.stopped'));
    setAttr(g.badge, 'data-state', st.running ? 'online' : 'standby');
    setRow(g.rows.today, st.today, 'energy');
    setRow(g.rows.total, st.total, 'energy');
    setRow(g.rows.voltage, st.voltage, 'voltage');
    setAttr(g.rows.voltage.node, 'hidden', !isNum(st.voltage));
    setAttr(g.rows.total.node, 'hidden', !isNum(st.total));
  }

  _buildInverterCard() {
    const r = this.r;
    const num = h('span', { class: 'big-num', text: DASH });
    const unit = h('span', { class: 'big-unit', text: '' });
    const badge = h('span', { class: 'dir-badge', text: t('inv.unknown') });
    r.inverter = { num, unit, badge, rows: {} };
    const rowsWrap = h('div', { class: 'stat-rows' });
    for (const [key, label, role] of [
      ['temperature', t('stat.temperature'), 'inverterTemperature'],
      ['efficiency', t('stat.efficiency'), null],
      ['frequency', t('stat.gridFrequency'), 'gridFrequency'],
      ['rated', t('stat.ratedPower'), null],
      ['alarm', t('stat.alarm'), 'inverterAlarm'],
    ]) {
      const row = statRow(label, role);
      r.inverter.rows[key] = row;
      rowsWrap.appendChild(row.node);
    }
    r.inverter.card = card('card-inverter tone-inverter', { title: t('card.inverter'), icon: 'inverter' },
      h('div', { class: 'card-hero' }, h('div', { class: 'big-value' }, num, unit), badge), rowsWrap);
    return r.inverter.card;
  }

  /* ─────────────────────────── onboarding ─────────────────────────── */

  _buildOnboarding() {
    const r = this.r;
    r.onboardBody = h('div', { class: 'onboard-body' });
    r.onboard = h('div', { class: 'onboard', hidden: true },
      h('div', { class: 'onboard-panel' },
        h('div', { class: 'onboard-icon', html: icon('bolt', { size: 30 }) }),
        h('h2', { class: 'onboard-title', text: t('onboard.title') }),
        r.onboardBody));
    return r.onboard;
  }

  showOnboarding(children) {
    this.r.onboardBody.innerHTML = '';
    for (const c of [].concat(children)) this.r.onboardBody.appendChild(c);
    setAttr(this.r.onboard, 'hidden', false);
  }

  hideOnboarding() { setAttr(this.r.onboard, 'hidden', true); }

  /* ─────────────────────────── status and notices ───────────────── */

  setConnection(status) {
    const map = {
      connected: [t('status.connected'), 'ok'],
      connecting: [t('status.connecting'), 'warn'],
      disconnected: [t('status.disconnected'), 'bad'],
    };
    const [text, state] = map[status] || map.disconnected;
    setText(this.r.statusText, text);
    setAttr(this.r.statusChip, 'data-state', state);
  }

  setNotices(list) {
    const wrap = this.r.notices;
    // The key must include the text: ids are static while the text carries live
    // values (the balance residual), and keying on ids alone froze them.
    const key = list.map((n) => `${n.id}\u0000${n.text}`).join('|');
    if (this._noticeKey === key) return;
    this._noticeKey = key;
    wrap.innerHTML = '';
    for (const n of list) {
      wrap.appendChild(h('div', { class: `notice notice-${n.level || 'info'}` },
        h('span', { class: 'notice-icon', html: icon(n.level === 'warn' ? 'warning' : 'eye', { size: 15 }) }),
        h('span', { class: 'notice-text', html: n.text }),
        n.action ? h('button', { class: 'notice-action', type: 'button', text: n.action.label, onclick: n.action.onClick }) : null));
    }
  }

  /* ─────────────────────────── updates ─────────────────────────── */

  update(state, flow, kpi) {
    // Remember the latest data: after a layout switch the direction arrows must
    // be redrawn, otherwise they keep the glyphs of the previous geometry.
    this._lastState = state;
    this._lastFlow = flow;
    this._updateHeader(state);
    this._updateFlow(state, flow);
    this._updateBattery(state);
    this._updateKpi(kpi);
    this._updateSolar(state);
    this._updateGrid(state);
    this._updatePhases(state);
    this._updateInverter(state);
    this._updateGenerator(state);
  }

  _updateHeader(state) {
    const lu = state.meta.lastUpdate;
    setText(this.r.lastUpdate, lu ? fmtClock(lu) : DASH);
    setText(this.r.lastAgo, lu ? fmtAgo(lu) : '');
    setAttr(this.r.demoBadge, 'hidden', !state.meta.demo);
  }

  _updateFlow(state, flow) {
    const r = this.r;
    const { links } = flow;

    // nodes
    this._setBig(r.nodes.solar, formatPower(state.pv.power));
    setText(r.nodes.solar.sub, isNum(state.pv.today) ? t('node.todayEnergy', { v: formatEnergy(state.pv.today).value }) : '');

    const gridAbs = isNum(state.grid.power) ? Math.abs(state.grid.power) : null;
    this._setBig(r.nodes.grid, formatPower(gridAbs));
    setText(r.nodes.grid.sub, state.grid.importing ? t('node.importing') : state.grid.exporting ? t('node.exporting') : isNum(state.grid.power) ? t('node.idle') : '');

    this._setBig(r.nodes.house, formatPower(state.load.power));
    setText(r.nodes.house.sub, isNum(state.load.today) ? t('node.todayEnergy', { v: formatEnergy(state.load.today).value }) : '');

    // A generator appearing or disappearing changes the diagram shape.
    const hasGen = !!(state.generator && state.generator.relevant);
    if (hasGen !== this._hasGenerator) {
      this._hasGenerator = hasGen;
      this._installFlowLayout(true);
    } else {
      // Re-check the geometry on every data event as well. ResizeObserver only
      // delivers during a rendering opportunity, so a page that is not painting
      // (a hidden tab, a screenshot in flight) would otherwise keep a layout
      // that no longer matches its width. The call is a no-op when it matches.
      this._installFlowLayout();
    }
    if (hasGen) {
      this._setBig(r.nodes.generator, formatPower(state.generator.power));
      setText(r.nodes.generator.sub, isNum(state.generator.today)
        ? t('node.todayEnergy', { v: formatEnergy(state.generator.today).value })
        : (state.generator.running ? t('gen.running') : t('gen.stopped')));
    }

    const soc = state.battery.soc;
    this._setBig(r.nodes.battery, { value: isNum(soc) ? formatNumber(soc, soc % 1 === 0 ? 0 : 1) : DASH, unit: '%' });
    const bp = state.battery.power;
    setText(r.nodes.battery.sub, isNum(bp) && Math.abs(bp) > 0.015
      ? `${formatPower(bp, { signed: true }).value} ${formatPower(bp, { signed: true }).unit}`
      : isNum(bp) ? t('node.idle') : '');
    setStyleVar(r.nodes.battery.level, '--level', `${isNum(soc) ? clamp(soc, 0, 100) : 0}%`);
    setAttr(r.nodes.battery.node, 'data-band', socBand(soc));
    toggleClass(r.nodes.battery.node, 'is-charging', !!state.battery.charging);

    // inverter hub
    const inv = r.nodes.inverter;
    const invPower = formatPower(state.inverter.power);
    setText(inv.power, invPower.value);
    setText(inv.powerUnit, invPower.unit);
    setText(inv.statusText, invStatusText(state.inverter.state));
    setAttr(inv.node, 'data-state', state.inverter.state);
    setText(inv.rated, isNum(state.inverter.ratedPowerKw) ? t('node.rated', { v: formatNumber(state.inverter.ratedPowerKw, 0) }) : '');

    // links
    for (const [key, link] of Object.entries(links)) {
      const refs = r.flowLinks[key];
      const label = r.flowLabels[key];
      if (!refs) continue;
      setAttr(refs.g, 'data-dir', link.dir);
      setStyleVar(refs.g, '--dur', `${link.duration || 1}s`);
      setStyleVar(refs.g, '--intensity', link.intensity.toFixed(3));
      const f = formatPower(link.value);
      setText(label.val, link.value === null ? DASH : `${f.value} ${f.unit}`);
      setAttr(label.el, 'data-dir', link.dir);
      label.arrow.innerHTML = link.dir === 'idle' ? '' : arrowFor(key, link.dir, this.flowLayout);
      toggleClass(label.el, 'is-idle', !link.active);
    }

    // source mix
    const mix = flow.mix;
    const segs = r.mixBar.children;
    const parts = [mix ? mix.pv : 0, mix ? mix.generator : 0, mix ? mix.battery : 0, mix ? mix.grid : 0];
    parts.forEach((val, i) => {
      setStyleVar(segs[i], '--w', `${val}%`);
      toggleClass(segs[i], 'is-zero', val < 0.5);
    });
    toggleClass(r.mixBar, 'is-empty', !mix);

    const legendKey = mix ? `${Math.round(mix.pv)}/${Math.round(mix.generator)}/${Math.round(mix.battery)}/${Math.round(mix.grid)}` : 'none';
    if (this._mixKey !== legendKey) {
      this._mixKey = legendKey;
      r.mixLegend.innerHTML = '';
      if (mix) {
        for (const [cls, label, val] of [
          ['pv', t('src.solar'), mix.pv], ['gen', t('src.generator'), mix.generator],
          ['batt', t('src.battery'), mix.battery], ['grid', t('src.grid'), mix.grid],
        ]) {
          if (val < 0.5) continue;
          r.mixLegend.appendChild(h('span', { class: `mix-item mix-${cls}` },
            h('i'), `${label} ${Math.round(val)}%`));
        }
      } else {
        r.mixLegend.appendChild(h('span', { class: 'mix-item is-muted', text: t('flow.noLoadData') }));
      }
    }

    const pair = (from, to) => `${t('src.' + from)} → ${t('src.' + to)}`;
    const allocPairs = [
      [pair('solar', 'house'), flow.alloc.pvToLoad, 'solar'],
      [pair('solar', 'battery'), flow.alloc.pvToBattery, 'solar'],
      [pair('solar', 'grid'), flow.alloc.pvToGrid, 'solar'],
      [pair('generator', 'house'), flow.alloc.generatorToLoad, 'generator'],
      [pair('generator', 'battery'), flow.alloc.generatorToBattery, 'generator'],
      [pair('generator', 'grid'), flow.alloc.generatorToGrid, 'generator'],
      [pair('battery', 'house'), flow.alloc.batteryToLoad, 'battery'],
      [pair('battery', 'grid'), flow.alloc.batteryToGrid, 'battery'],
      [pair('grid', 'house'), flow.alloc.gridToLoad, 'grid'],
      [pair('grid', 'battery'), flow.alloc.gridToBattery, 'grid'],
    ].filter(([, v]) => isNum(v) && v > 0.02);
    const allocKey = allocPairs.map(([l, v]) => `${l}${v.toFixed(2)}`).join('|');
    if (this._allocKey !== allocKey) {
      this._allocKey = allocKey;
      r.allocList.innerHTML = '';
      for (const [label, value, tone] of allocPairs) {
        const f = formatPower(value);
        r.allocList.appendChild(h('span', { class: `alloc-chip tone-${tone}` },
          h('span', { class: 'alloc-label', text: label }),
          h('span', { class: 'alloc-value', text: `${f.value} ${f.unit}` })));
      }
      if (!allocPairs.length) r.allocList.appendChild(h('span', { class: 'alloc-chip is-muted', text: t('flow.noFlows') }));
    }
  }

  _updateBattery(state) {
    const b = this.r.battery;
    const st = state.battery;
    const soc = st.soc;
    setText(b.socNum, isNum(soc) ? formatNumber(soc, soc % 1 === 0 ? 0 : 1) : DASH);
    const p = formatPower(st.power, { signed: true });
    setText(b.powerNum, p.value);
    setText(b.powerUnit, p.unit);
    setText(b.mode, st.charging ? t('batt.charging') : st.discharging ? t('batt.discharging') : isNum(st.power) ? t('batt.idle') : (st.status || ''));
    setAttr(b.card, 'data-band', socBand(soc));
    setAttr(b.card, 'data-mode', st.charging ? 'charge' : st.discharging ? 'discharge' : 'idle');

    // The fill level is shifted with a transform (smooth, no SVG attribute animation).
    const level = isNum(soc) ? clamp(soc, 0, 100) : 0;
    const shift = (172 * (100 - level)) / 100;
    const transform = `translateY(${shift.toFixed(1)}px)`;
    if (b.fillWrap.style.transform !== transform) {
      if (!this._battInit) { b.fillWrap.style.transition = 'none'; this._battInit = true; requestAnimationFrame(() => { b.fillWrap.style.transition = ''; }); }
      b.fillWrap.style.transform = transform;
    }

    setRow(b.rows.voltage, st.voltage, 'voltage');
    setRow(b.rows.current, st.current, 'current');
    setRow(b.rows.temperature, st.temperature, 'temperature');
    setRow(b.rows.soh, st.soh, 'percent');

    const eta = st.charging ? st.timeToFull : st.discharging ? st.timeToEmpty : null;
    setText(b.rows.eta.label, t(st.charging ? 'stat.timeToFull' : 'stat.timeToEmpty'));
    setText(b.rows.eta.value, isNum(eta) ? fmtHours(eta) : DASH);
    setAttr(b.rows.eta.node, 'hidden', !isNum(eta));

    const cy = [];
    let cyUnit = '';
    if (isNum(st.chargeToday)) { const f = formatEnergy(st.chargeToday); cy.push(`+${f.value}`); cyUnit = f.unit; }
    if (isNum(st.dischargeToday)) { const f = formatEnergy(st.dischargeToday); cy.push(`−${f.value}`); cyUnit = f.unit; }
    setText(b.rows.cycleToday.value, cy.length ? `${cy.join(' / ')} ${cyUnit}` : DASH);
    setAttr(b.rows.cycleToday.node, 'hidden', !cy.length);
  }

  /** @param {Object} kpi values by KPI key, produced by the app for the period */
  _updateKpi(kpi) {
    for (const { node, num, unit, def } of Object.values(this.r.kpi)) {
      const v = kpi ? kpi[def.key] : null;
      const f = def.kind === 'percent'
        ? { value: isNum(v) ? formatNumber(v, 0) : DASH, unit: '%' }
        : formatEnergy(v);
      setText(num, f.value);
      setText(unit, f.unit);
      setAttr(node, 'hidden', def.optional && !isNum(v));
    }
  }

  _updateSolar(state) {
    const so = this.r.solar;
    setRow(so.rows.power, state.pv.power, 'power');
    setRow(so.rows.today, state.pv.today, 'energy');
    setRow(so.rows.total, state.pv.total, 'energy');
    setAttr(so.rows.total.node, 'hidden', !isNum(state.pv.total));

    const strings = state.pv.strings || [];
    if (strings.length !== so.strings.length) {
      so.strings = [];
      this.r.solarStrings.innerHTML = '';
      for (const st of strings) {
        const value = h('span', { class: 'string-value', text: DASH });
        const meta = h('span', { class: 'string-meta', text: '' });
        const bar = h('span', { class: 'bar-fill' });
        const name = h('span', { class: 'string-name', text: st.key });
        const node = h('div', { class: 'string-row', dataset: { role: `pv${st.key.replace(/\D/g, '')}Power` } },
          h('div', { class: 'string-head' }, name, value),
          h('span', { class: 'bar' }, bar), meta);
        so.strings.push({ node, name, value, meta, bar });
        this._markInteractive(node);
        this.r.solarStrings.appendChild(node);
      }
    }
    const maxP = Math.max(0.1, ...strings.map((x) => (isNum(x.power) ? x.power : 0)));
    strings.forEach((st, i) => {
      const ref = so.strings[i];
      if (!ref) return;
      const f = formatPower(st.power);
      setText(ref.name, st.key);
      setText(ref.value, `${f.value} ${f.unit}`);
      const parts = [];
      if (isNum(st.voltage)) parts.push(`${formatNumber(st.voltage, 0)} ${t('unit.V')}`);
      if (isNum(st.current)) parts.push(`${formatNumber(st.current, 1)} ${t('unit.A')}`);
      setText(ref.meta, parts.join(' · '));
      setStyleVar(ref.bar, '--w', `${isNum(st.power) ? clamp((st.power / maxP) * 100, 0, 100) : 0}%`);
    });
  }

  _updateGrid(state) {
    const g = this.r.grid;
    const st = state.grid;
    const f = formatPower(isNum(st.power) ? Math.abs(st.power) : null);
    setText(g.num, f.value);
    setText(g.unit, f.unit);
    const dir = st.importing ? 'import' : st.exporting ? 'export' : isNum(st.power) ? 'idle' : 'unknown';
    setText(g.badge, dir === 'import' ? t('grid.toHouse') : dir === 'export' ? t('grid.toGrid') : dir === 'idle' ? t('grid.idle') : DASH);
    setAttr(g.badge, 'data-dir', dir);
    setRow(g.rows.import, st.todayImport, 'energy');
    setRow(g.rows.export, st.todayExport, 'energy');
    setRow(g.rows.voltage, st.voltage, 'voltage');
    setRow(g.rows.frequency, st.frequency, 'frequency');
    setAttr(g.rows.voltage.node, 'hidden', !isNum(st.voltage));
  }

  _updatePhases(state) {
    const phases = state.phases;
    const present = ['l1', 'l2', 'l3'].filter((k) => phases[k]);
    const mode = this.opts.showPhases || 'auto';
    setAttr(this.r.phasesCard, 'hidden', mode === 'never' || (present.length === 0 && mode !== 'always'));
    const maxP = Math.max(0.1, ...present.map((k) => Math.abs(phases[k].power || 0)));
    for (const key of ['l1', 'l2', 'l3']) {
      const ref = this.r.phases[key];
      const ph = phases[key];
      setAttr(ref.node, 'hidden', !ph);
      if (!ph) continue;
      const f = formatPower(ph.power);
      setText(ref.value, `${f.value} ${f.unit}`);
      const parts = [];
      if (isNum(ph.voltage)) parts.push(`${formatNumber(ph.voltage, 0)} ${t('unit.V')}`);
      if (isNum(ph.current)) parts.push(`${formatNumber(ph.current, 1)} ${t('unit.A')}`);
      setText(ref.meta, parts.join(' · '));
      setStyleVar(ref.bar, '--w', `${isNum(ph.power) ? clamp((Math.abs(ph.power) / maxP) * 100, 0, 100) : 0}%`);
    }
  }

  _updateInverter(state) {
    const iv = this.r.inverter;
    const st = state.inverter;
    const f = formatPower(st.power);
    setText(iv.num, f.value);
    setText(iv.unit, f.unit);
    setText(iv.badge, invStatusText(st.state));
    setAttr(iv.badge, 'data-state', st.state);
    setRow(iv.rows.temperature, st.temperature, 'temperature');
    setRow(iv.rows.efficiency, st.efficiency, 'percent');
    setRow(iv.rows.frequency, state.grid.frequency, 'frequency');
    setText(iv.rows.rated.value, isNum(st.ratedPowerKw) ? `${formatNumber(st.ratedPowerKw, 0)} ${t('unit.kW')}` : DASH);
    setAttr(iv.rows.rated.node, 'hidden', !isNum(st.ratedPowerKw));
    setText(iv.rows.alarm.value, st.alarm || DASH);
    setAttr(iv.rows.alarm.node, 'hidden', !st.alarm);
    setAttr(iv.rows.efficiency.node, 'hidden', !isNum(st.efficiency));
  }

  _setBig(ref, formatted) {
    setText(ref.num, formatted.value);
    setText(ref.unit, formatted.unit);
  }
}

/* ─────────────────────────── small helpers ─────────────────────────── */

function card(cls, opts = {}, ...children) {
  const head = opts.hideHeader ? null : h('div', { class: 'card-head' },
    h('span', { class: 'card-title' },
      opts.icon ? h('span', { class: 'card-icon', html: icon(opts.icon, { size: 15 }) }) : null,
      opts.titleEl || h('span', { class: 'card-title-text', text: opts.title || '' })),
    opts.extra || null);
  return h('section', { class: `card ${cls}` }, head, ...children);
}

function statRow(labelText, role) {
  const label = h('span', { class: 'stat-label', text: labelText });
  const value = h('span', { class: 'stat-value', text: DASH });
  const node = h('div', { class: 'stat-row', dataset: role ? { role } : {} }, label, value);
  return { node, label, value };
}

function setRow(row, value, kind) {
  if (!row) return;
  if (!isNum(value)) { setText(row.value, DASH); return; }
  let f;
  if (kind === 'power') f = formatPower(value);
  else if (kind === 'energy') f = formatEnergy(value);
  else if (kind === 'percent') f = { value: formatNumber(value, 1), unit: '%' };
  else if (kind === 'voltage') f = { value: formatNumber(value, Math.abs(value) >= 100 ? 0 : 1), unit: t('unit.V') };
  else if (kind === 'current') f = { value: formatNumber(value, 1), unit: t('unit.A') };
  else if (kind === 'temperature') f = { value: formatNumber(value, 1), unit: t('unit.C') };
  else if (kind === 'frequency') f = { value: formatNumber(value, 2), unit: t('unit.Hz') };
  else f = { value: formatNumber(value, 1), unit: '' };
  setText(row.value, `${f.value} ${f.unit}`.trim());
}

function socBand(soc) {
  if (!isNum(soc)) return 'unknown';
  if (soc < 10) return 'critical';
  if (soc < 20) return 'low';
  if (soc < 50) return 'mid';
  if (soc < 80) return 'good';
  return 'full';
}

/** Direction glyph next to a flow label. */
function arrowFor(linkKey, dir, layout) {
  const narrow = layout === 'narrow';
  const vertical = linkKey === 'solar' || linkKey === 'battery' || (narrow && linkKey === 'load');
  if (linkKey === 'solar') return dir === 'toHub' ? '↓' : '↑';
  if (linkKey === 'battery') return narrow ? (dir === 'toHub' ? '↗' : '↙') : (dir === 'toHub' ? '↑' : '↓');
  if (linkKey === 'grid') {
    if (narrow) return dir === 'toHub' ? '↖' : '↘';
    // In the generator layout the grid arrives from the upper left, not the side.
    return layout === 'wideGen' ? (dir === 'toHub' ? '↘' : '↖') : (dir === 'toHub' ? '→' : '←');
  }
  if (linkKey === 'generator') {
    if (narrow) return dir === 'toHub' ? '↙' : '↗';
    return dir === 'toHub' ? '↗' : '↙';
  }
  if (linkKey === 'load') return narrow ? (dir === 'toHub' ? '↑' : '↓') : (dir === 'toHub' ? '←' : '→');
  return vertical ? '↓' : '→';
}

export { socBand };
