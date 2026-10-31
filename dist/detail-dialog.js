/**
 * detail-dialog.js — history of a single sensor.
 *
 * Opened by clicking any value backed by an entity. What it draws depends on the
 * quantity, not on the period: energy accumulates, so it gets bars of per-bucket
 * change; everything else (power, voltage, temperature, SOC) gets a mean line
 * with a shaded min-max band, which is the only useful way to look at an
 * instantaneous value over a month.
 */

import { ROLE_BY_KEY } from './config.js?v=1.2.3';
import { h, setText, setAttr, formatByKind, formatEnergy, isNum, DASH } from './utils.js?v=1.2.3';
import { t } from './i18n.js?v=1.2.3';
import { icon } from './icons.js?v=1.2.3';
import { DateNav } from './date-nav.js?v=1.2.3';
import { defaultView, periodBounds, toDateInput } from './ranges.js?v=1.2.3';
import { TimeSeriesChart, DailyBarChart } from './charts.js?v=1.2.3';
import { fetchPowerSeries, fetchEnergyBars, fetchSensorStats, explainEmpty } from './history.js?v=1.2.3';

export class DetailDialog {
  constructor({ client, getConfig }) {
    this.client = client;
    this.getConfig = getConfig;
    this.view = defaultView('day');
    this._gen = 0;             // generation counter: only the newest load may paint
  }

  mount(root) {
    this.el = h('div', { class: 'modal detail-modal', hidden: true, onclick: (e) => { if (e.target === this.el) this.close(); } });
    root.appendChild(this.el);
    return this.el;
  }

  get isOpen() { return this.el && !this.el.hidden; }

  async open(roleKey) {
    const role = ROLE_BY_KEY[roleKey];
    const entityId = this.getConfig().entities[roleKey];
    if (!role || !entityId) return;
    if (role.kind === 'text') return;      // nothing numeric to plot
    if (this.isOpen) this.close();         // never stack a second key listener

    this.role = role;
    this.entityId = entityId;
    this.view = defaultView('day');

    this.el.innerHTML = '';
    this.el.appendChild(this._buildPanel());
    setAttr(this.el, 'hidden', false);
    this._keyHandler = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._keyHandler);
    await this._load();
  }

  close() {
    setAttr(this.el, 'hidden', true);
    if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler);
    if (this.chart) { this.chart.destroy(); this.chart = null; }
  }

  _buildPanel() {
    const label = t(`role.${this.role.key}`, null, this.role.label);
    this.nav = new DateNav({ compact: true, onChange: () => this._load() });
    this.nav.view = this.view;
    this.chartHost = h('div', { class: 'chart-host detail-chart' });
    this.emptyEl = h('div', { class: 'detail-empty', hidden: true });
    this.spinner = h('span', { class: 'spinner', hidden: true });

    this.statsEl = h('div', { class: 'detail-stats' });
    const base = this.client.baseUrl || '';
    this.haLink = h('a', {
      class: 'btn btn-ghost detail-link', target: '_blank', rel: 'noreferrer',
      href: `${base}/history?entity_id=${encodeURIComponent(this.entityId)}`,
      text: t('detail.openInHa'),
    });

    const panel = h('div', { class: 'modal-panel detail-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
      h('div', { class: 'modal-head' },
        h('div', { class: 'detail-title' },
          h('span', { class: 'modal-title', text: label }),
          h('span', { class: 'detail-entity', text: this.entityId })),
        this.spinner,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('ui.close'), html: icon('close', { size: 18 }), onclick: () => this.close() })),
      h('div', { class: 'detail-nav' }, this.nav.element),
      h('div', { class: 'modal-body' }, this.chartHost, this.emptyEl),
      h('div', { class: 'modal-foot' }, this.statsEl, h('span', { class: 'spacer' }), this.haLink));
    this.nav.setView(this.view);
    return panel;
  }

  _setEmpty(html) {
    setAttr(this.emptyEl, 'hidden', !html);
    setAttr(this.chartHost, 'hidden', !!html);
    this.emptyEl.innerHTML = html || '';
  }

  /**
   * Footer numbers. An accumulating counter must never have its samples summed:
   * over a day the reading only ever grows, so the total is the span it covered.
   * @param {object} opts accumulating — samples of a rising counter
   */
  _renderStats(values, { accumulating = false, min: minIn, max: maxIn } = {}) {
    this.statsEl.innerHTML = '';
    if (!values.length) return;
    const kind = this.role.kind;
    const fmt = (v) => (kind === 'energy' ? formatEnergy(v) : formatByKind(kind, v));
    const min = isNum(minIn) ? minIn : Math.min(...values);
    const max = isNum(maxIn) ? maxIn : Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const rows = accumulating
      ? [[t('detail.total'), Math.max(0, max - min)], [t('detail.max'), max]]
      : kind === 'energy'
        ? [[t('detail.total'), values.reduce((a, b) => a + b, 0)], [t('detail.max'), max]]
        : [[t('detail.min'), min], [t('detail.avg'), avg], [t('detail.max'), max]];
    for (const [name, value] of rows) {
      const f = fmt(value);
      this.statsEl.appendChild(h('span', { class: 'detail-stat' },
        h('span', { class: 'detail-stat-label', text: name }),
        h('span', { class: 'detail-stat-value', text: `${f.value} ${f.unit}`.trim() })));
    }
  }

  async _load() {
    this.view = this.nav.view;
    const bounds = periodBounds(this.view);
    const { from, to, step } = bounds;
    // Two quick clicks on the arrows race: whichever request answers last used
    // to win, so the chart could end up showing the previous period's data
    // under the new period's label.
    const gen = ++this._gen;
    const stale = () => gen !== this._gen;
    setAttr(this.spinner, 'hidden', false);
    this._setEmpty('');
    try {
      if (this.chart) { this.chart.destroy(); this.chart = null; }
      const isEnergy = this.role.kind === 'energy';

      if (step === 'power') {
        const data = await fetchPowerSeries(this.client, [this.entityId], from, to, {
          kinds: { [this.entityId]: this.role.kind },
        });
        if (stale()) return undefined;
        const points = data[this.entityId] || [];
        if (!points.length) return this._explainEmpty(step);
        this.chart = new TimeSeriesChart(this.chartHost, { height: 300, yUnit: this._unit(points.map(([, v]) => v)) });
        this.chart.setRange(from, to);
        this.chart.setSeries([{
          key: 'v', label: this._label(), color: this._color(), points,
          area: !isEnergy && this.role.kind === 'power', width: 2.2,
          format: (v) => formatByKind(this.role.kind, v),
        }]);
        this._renderStats(points.map(([, v]) => v), { accumulating: isEnergy });
        return undefined;
      }

      if (isEnergy) {
        const bars = await fetchEnergyBars(this.client, [this.entityId], from, to, step);
        if (stale()) return undefined;
        const rows = bars[this.entityId] || [];
        if (!rows.length) return this._explainEmpty(step);
        this.chart = new DailyBarChart(this.chartHost, { height: 300, bucket: step, yUnit: this._unit(rows.map((r) => r.value)) });
        this.chart.setSeries([{
          key: 'v', label: this._label(), color: this._color(),
          points: rows.map((r) => [+r.start, r.value]),
        }]);
        this._renderStats(rows.map((r) => r.value));
        return undefined;
      }

      const rows = await fetchSensorStats(this.client, this.entityId, from, to, step, this.role.kind);
      if (stale()) return undefined;
      if (!rows.length) return this._explainEmpty(step);
      this.chart = new TimeSeriesChart(this.chartHost, { height: 300, yUnit: this._unit(rows.map((r) => r.max)) });
      this.chart.setRange(from, to);
      this.chart.setSeries([{
        key: 'v', label: this._label(), color: this._color(),
        points: rows.map((r) => [+r.start, r.mean]),
        band: rows.map((r) => [+r.start, r.min, r.max]),
        format: (v) => formatByKind(this.role.kind, v),
      }]);
      // The average is the mean of the bucket means — averaging minima and
      // maxima would report roughly half the peak for a solar day.
      this._renderStats(rows.map((r) => r.mean), {
        min: Math.min(...rows.map((r) => r.min)),
        max: Math.max(...rows.map((r) => r.max)),
      });
      return undefined;
    } catch (e) {
      if (!stale()) this._setEmpty(`<span>${t('detail.noDataPeriod')}</span>`);
      return undefined;
    } finally {
      if (!stale()) setAttr(this.spinner, 'hidden', true);
    }
  }

  /**
   * Distinguishes the three reasons a chart can be empty, because the fix is
   * different in each case.
   */
  async _explainEmpty(step) {
    this.statsEl.innerHTML = '';
    const { text, hint } = await explainEmpty(this.client, [this.entityId], step);
    this._setEmpty(`<span>${text}</span>${hint ? `<small>${hint}</small>` : ''}`);
  }

  _label() { return t(`role.${this.role.key}`, null, this.role.label); }

  /**
   * The axis unit has to be the unit the values will actually be printed in:
   * power and energy auto-scale, so a sub-kilowatt series must say W, not kW.
   */
  _unit(values = []) {
    const ref = values.length ? Math.max(...values.map((v) => Math.abs(v))) : 1;
    return formatByKind(this.role.kind, ref || 1).unit;
  }

  _color() {
    const group = this.role.group;
    const map = {
      solar: 'var(--solar-color)', battery: 'var(--battery-color)', grid: 'var(--grid-color)',
      load: 'var(--load-color)', inverter: 'var(--inverter-color)', phases: 'var(--phase-color)',
      generator: 'var(--generator-color)',
    };
    return map[group] || 'var(--accent-color)';
  }
}
