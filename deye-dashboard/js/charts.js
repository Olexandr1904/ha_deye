/**
 * charts.js — hand-rolled charts in plain SVG.
 *
 * No Chart.js, ECharts or CDN: one dependency less, works offline, weighs about
 * ten kilobytes and draws exactly what the dashboard needs.
 *
 *   TimeSeriesChart — power over a day (lines/areas, negative values supported)
 *   DailyBarChart   — energy per day (grouped bars)
 *
 * Both support a hover crosshair with a tooltip, a legend that toggles series
 * and redraw driven by a ResizeObserver.
 */

import { h, s, niceTicks, monotonePath, clamp, fmtClock, fmtDayShort, formatPower, formatEnergy, prefersReducedMotion } from './utils.js';
import { t } from './i18n.js';

const PAD = { top: 18, right: 14, bottom: 26, left: 46 };

class BaseChart {
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.series = [];
    this.hidden = new Set();
    this.width = 0;
    this.height = opts.height || 260;
    this.host.classList.add('chart');
    this.host.innerHTML = '';
    this.svgWrap = h('div', { class: 'chart-canvas' });
    this.legendEl = h('div', { class: 'chart-legend' });
    this.tooltip = h('div', { class: 'chart-tooltip', role: 'status' });
    this.emptyEl = h('div', { class: 'chart-empty', text: t('chart.noData') });
    this.host.append(this.svgWrap, this.legendEl, this.tooltip, this.emptyEl);
    // Defer the redraw to the next frame: resizing inside an observer callback
    // is not allowed (see renderer.observeFlowResize).
    this._ro = new ResizeObserver(() => {
      if (this._roPending) return;
      this._roPending = true;
      requestAnimationFrame(() => { this._roPending = false; this._onResize(); });
    });
    this._ro.observe(this.svgWrap);
  }

  destroy() { this._ro.disconnect(); this.host.innerHTML = ''; }

  _onResize() {
    const w = this.svgWrap.clientWidth;
    if (!w || Math.abs(w - this.width) < 2) return;
    this.width = w;
    this.render();
  }

  setSeries(series) {
    this.series = series || [];
    this.width = this.svgWrap.clientWidth || this.width;
    this._renderLegend();
    this.render();
  }

  get visibleSeries() { return this.series.filter((x) => !this.hidden.has(x.key) && x.points && x.points.length); }

  _renderLegend() {
    this.legendEl.innerHTML = '';
    for (const sr of this.series) {
      const off = this.hidden.has(sr.key);
      const btn = h('button', {
        class: ['chart-legend-item', off ? 'is-off' : ''],
        type: 'button',
        'aria-pressed': String(!off),
        onclick: () => {
          if (this.hidden.has(sr.key)) this.hidden.delete(sr.key); else this.hidden.add(sr.key);
          this._renderLegend();
          this.render();
        },
      },
        h('span', { class: 'chart-legend-dot', style: { background: sr.color } }),
        h('span', { class: 'chart-legend-label', text: sr.label }),
        h('span', { class: 'chart-legend-value', text: sr.summary || '' }));
      this.legendEl.appendChild(btn);
    }
  }

  _emptyState(isEmpty) {
    this.emptyEl.classList.toggle('is-visible', isEmpty);
    this.svgWrap.classList.toggle('is-empty', isEmpty);
  }

  _hideTooltip() {
    this.tooltip.classList.remove('is-visible');
    // Reset the position: a hidden tooltip keeping its old left stretched the
    // container and caused horizontal scrolling after the window shrank.
    this.tooltip.style.left = '0px';
    this.tooltip.style.top = '0px';
  }

  _showTooltip(x, y, html) {
    this.tooltip.innerHTML = html;
    this.tooltip.classList.add('is-visible');
    const w = this.tooltip.offsetWidth || 150;
    const hostW = this.host.clientWidth;
    this.tooltip.style.left = `${clamp(x - w / 2, 4, Math.max(4, hostW - w - 4))}px`;
    this.tooltip.style.top = `${Math.max(4, y - this.tooltip.offsetHeight - 14)}px`;
  }
}

/* ───────────────────── power chart for one day ───────────────────── */

export class TimeSeriesChart extends BaseChart {
  constructor(host, opts = {}) {
    super(host, opts);
    this.from = opts.from || Date.now() - 86400000;
    this.to = opts.to || Date.now();
  }

  setRange(from, to) { this.from = +from; this.to = +to; }

  render() {
    const W = this.width || this.svgWrap.clientWidth;
    const H = this.height;
    if (!W) return;
    const vis = this.visibleSeries;
    this._emptyState(!vis.length);
    this._hideTooltip();
    this.svgWrap.innerHTML = '';
    if (!vis.length) return;

    let min = 0, max = 0;
    for (const sr of vis) for (const [, v] of sr.points) { if (v < min) min = v; if (v > max) max = v; }
    if (max === min) max = min + 1;
    const yScaleInfo = niceTicks(min, max, 4);
    const y0 = yScaleInfo.min, y1 = yScaleInfo.max;

    const plotW = Math.max(10, W - PAD.left - PAD.right);
    const plotH = Math.max(10, H - PAD.top - PAD.bottom);
    const xOf = (t) => PAD.left + ((t - this.from) / Math.max(1, this.to - this.from)) * plotW;
    const yOf = (v) => PAD.top + plotH - ((v - y0) / (y1 - y0)) * plotH;

    const svg = s('svg', { class: 'chart-svg', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none' });
    const defs = s('defs');
    svg.appendChild(defs);

    // grid lines and Y labels
    const gGrid = s('g', { class: 'chart-grid' });
    for (const t of yScaleInfo.ticks) {
      const y = yOf(t);
      gGrid.appendChild(s('line', { x1: PAD.left, x2: W - PAD.right, y1: y, y2: y, class: t === 0 ? 'grid-zero' : 'grid-line' }));
      gGrid.appendChild(s('text', { x: PAD.left - 8, y: y + 3.5, class: 'axis-label', 'text-anchor': 'end', text: fmtTickValue(t, yScaleInfo.step) }));
    }
    gGrid.appendChild(s('text', { x: 2, y: PAD.top - 7, class: 'axis-label axis-unit', 'text-anchor': 'start', text: this.opts.yUnit || t('unit.kW') }));
    svg.appendChild(gGrid);

    // X labels
    const gX = s('g', { class: 'chart-axis-x' });
    for (const tick of timeTicks(this.from, this.to, Math.max(3, Math.floor(plotW / 90)))) {
      const x = xOf(tick);
      if (x < PAD.left - 1 || x > W - PAD.right + 1) continue;
      gX.appendChild(s('line', { x1: x, x2: x, y1: PAD.top, y2: PAD.top + plotH, class: 'grid-line grid-vertical' }));
      gX.appendChild(s('text', { x, y: H - 8, class: 'axis-label', 'text-anchor': 'middle', text: fmtClock(new Date(tick), false) }));
    }
    svg.appendChild(gX);

    // series
    for (const sr of vis) {
      const pts = sr.points.map(([t, v]) => [xOf(t), yOf(v)]);
      const d = monotonePath(pts);
      if (sr.area) {
        const gradId = `g-${sr.key}-${Math.round(W)}`;
        const grad = s('linearGradient', { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
        grad.appendChild(s('stop', { offset: '0%', 'stop-color': sr.color, 'stop-opacity': 0.34 }));
        grad.appendChild(s('stop', { offset: '100%', 'stop-color': sr.color, 'stop-opacity': 0 }));
        defs.appendChild(grad);
        const zeroY = yOf(Math.max(y0, Math.min(0, y1)));
        const areaD = `${d}L${pts[pts.length - 1][0]},${zeroY}L${pts[0][0]},${zeroY}Z`;
        svg.appendChild(s('path', { d: areaD, fill: `url(#${gradId})`, stroke: 'none' }));
      }
      svg.appendChild(s('path', {
        d, class: 'chart-line', fill: 'none', stroke: sr.color,
        'stroke-width': sr.width || 2, 'stroke-dasharray': sr.dashed ? '4 4' : null,
      }));
    }

    // crosshair and cursor dots
    const gHover = s('g', { class: 'chart-hover', style: 'display:none' });
    const vline = s('line', { y1: PAD.top, y2: PAD.top + plotH, class: 'chart-crosshair' });
    gHover.appendChild(vline);
    const dots = vis.map((sr) => s('circle', { r: 3.6, fill: 'var(--bg-1)', stroke: sr.color, 'stroke-width': 2 }));
    dots.forEach((d) => gHover.appendChild(d));
    svg.appendChild(gHover);

    const overlay = s('rect', { x: PAD.left, y: PAD.top, width: plotW, height: plotH, fill: 'transparent', style: 'cursor:crosshair' });
    svg.appendChild(overlay);

    const onMove = (evt) => {
      const rect = svg.getBoundingClientRect();
      const px = ((evt.clientX - rect.left) / rect.width) * W;
      const t = this.from + ((px - PAD.left) / plotW) * (this.to - this.from);
      gHover.style.display = '';
      vline.setAttribute('x1', px); vline.setAttribute('x2', px);
      const rows = [];
      vis.forEach((sr, i) => {
        const p = nearestPoint(sr.points, t);
        if (!p) { dots[i].style.display = 'none'; return; }
        dots[i].style.display = '';
        dots[i].setAttribute('cx', xOf(p[0]));
        dots[i].setAttribute('cy', yOf(p[1]));
        const f = formatPower(p[1], { signed: sr.signed });
        rows.push(`<div class="tt-row"><span class="tt-dot" style="background:${sr.color}"></span><span class="tt-label">${sr.label}</span><span class="tt-value">${f.value} <i>${f.unit}</i></span></div>`);
      });
      const time = fmtClock(new Date(clamp(t, this.from, this.to)), false);
      this._showTooltip(px * (rect.width / W), PAD.top + 6, `<div class="tt-title">${time}</div>${rows.join('')}`);
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerdown', onMove);
    overlay.addEventListener('pointerleave', () => { gHover.style.display = 'none'; this._hideTooltip(); });

    this.svgWrap.appendChild(svg);
    if (!prefersReducedMotion()) {
      svg.querySelectorAll('.chart-line').forEach((p) => {
        try {
          const len = p.getTotalLength();
          p.style.strokeDasharray = `${len}`;
          p.style.strokeDashoffset = `${len}`;
          p.getBoundingClientRect();
          p.style.transition = 'stroke-dashoffset .9s cubic-bezier(.22,.61,.36,1)';
          p.style.strokeDashoffset = '0';
        } catch (e) { /* getTotalLength is not available in every engine */ }
      });
    }
  }
}

/* ───────────────────── bars per day ───────────────────── */

export class DailyBarChart extends BaseChart {
  render() {
    const W = this.width || this.svgWrap.clientWidth;
    const H = this.height;
    if (!W) return;
    const vis = this.visibleSeries;
    this._emptyState(!vis.length);
    this._hideTooltip();
    this.svgWrap.innerHTML = '';
    if (!vis.length) return;

    // Shared day scale
    const dayKeys = [...new Set(vis.flatMap((sr) => sr.points.map(([t]) => dayKey(t))))].sort();
    let max = 0;
    for (const sr of vis) for (const [, v] of sr.points) if (v > max) max = v;
    const yInfo = niceTicks(0, max || 1, 4);

    const plotW = Math.max(10, W - PAD.left - PAD.right);
    const plotH = Math.max(10, H - PAD.top - PAD.bottom);
    const yOf = (v) => PAD.top + plotH - (v / yInfo.max) * plotH;
    const slot = plotW / Math.max(1, dayKeys.length);
    const barGap = Math.min(3, slot * 0.06);
    const barW = Math.max(1.5, (slot * 0.72 - barGap * (vis.length - 1)) / vis.length);

    const svg = s('svg', { class: 'chart-svg', viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, preserveAspectRatio: 'none' });

    const gGrid = s('g');
    for (const t of yInfo.ticks) {
      const y = yOf(t);
      gGrid.appendChild(s('line', { x1: PAD.left, x2: W - PAD.right, y1: y, y2: y, class: 'grid-line' }));
      gGrid.appendChild(s('text', { x: PAD.left - 8, y: y + 3.5, class: 'axis-label', 'text-anchor': 'end', text: fmtTickValue(t, yInfo.step) }));
    }
    gGrid.appendChild(s('text', { x: 2, y: PAD.top - 7, class: 'axis-label axis-unit', 'text-anchor': 'start', text: this.opts.yUnit || t('unit.kWh') }));
    svg.appendChild(gGrid);

    const labelEvery = Math.ceil(dayKeys.length / Math.max(2, Math.floor(plotW / 56)));
    dayKeys.forEach((key, i) => {
      const cx = PAD.left + slot * (i + 0.5);
      const groupW = barW * vis.length + barGap * (vis.length - 1);
      vis.forEach((sr, si) => {
        const found = sr.points.find(([t]) => dayKey(t) === key);
        const v = found ? found[1] : 0;
        const y = yOf(v);
        const x = cx - groupW / 2 + si * (barW + barGap);
        const bh = Math.max(v > 0 ? 1.5 : 0, PAD.top + plotH - y);
        if (bh > 0) {
          svg.appendChild(s('rect', {
            x, y: PAD.top + plotH - bh, width: barW, height: bh, rx: Math.min(3, barW / 2),
            fill: sr.color, class: 'chart-bar', 'fill-opacity': 0.85,
          }));
        }
      });
      if (i % labelEvery === 0) {
        svg.appendChild(s('text', { x: cx, y: H - 8, class: 'axis-label', 'text-anchor': 'middle', text: fmtDayShort(new Date(+key)) }));
      }
      // hover zone covering the whole column
      const hit = s('rect', { x: PAD.left + slot * i, y: PAD.top, width: slot, height: plotH, fill: 'transparent', style: 'cursor:pointer' });
      hit.addEventListener('pointerenter', (evt) => {
        const rect = svg.getBoundingClientRect();
        const rows = vis.map((sr) => {
          const found = sr.points.find(([t]) => dayKey(t) === key);
          const f = formatEnergy(found ? found[1] : 0);
          return `<div class="tt-row"><span class="tt-dot" style="background:${sr.color}"></span><span class="tt-label">${sr.label}</span><span class="tt-value">${f.value} <i>${f.unit}</i></span></div>`;
        });
        const px = (PAD.left + slot * (i + 0.5)) * (rect.width / W);
        this._showTooltip(px, PAD.top + 6, `<div class="tt-title">${fmtDayShort(new Date(+key))}</div>${rows.join('')}`);
      });
      hit.addEventListener('pointerleave', () => this._hideTooltip());
      svg.appendChild(hit);
    });

    this.svgWrap.appendChild(svg);
  }
}

/* ───────────────────────── helpers ───────────────────────── */

function dayKey(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return String(+d);
}

/** Same number of decimals on every axis label — derived from the grid step. */
function fmtTickValue(v, step) {
  if (v === 0) return '0';
  const s = Math.abs(step || v);
  const digits = s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
  return v.toFixed(digits);
}

function nearestPoint(points, t) {
  if (!points.length) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < t) lo = mid + 1; else hi = mid;
  }
  const a = points[Math.max(0, lo - 1)], b = points[lo];
  return Math.abs(a[0] - t) <= Math.abs(b[0] - t) ? a : b;
}

function timeTicks(from, to, count) {
  const span = to - from;
  // Small steps matter for short ranges (for example right after midnight).
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map((m) => m * 60000);
  const target = span / Math.max(1, count);
  const step = steps.find((x) => x >= target) || steps[steps.length - 1];
  const ticks = [];
  const first = Math.ceil(from / step) * step;
  for (let t = first; t <= to; t += step) ticks.push(t);
  return ticks;
}
