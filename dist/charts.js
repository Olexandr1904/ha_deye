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

import { h, s, niceTicks, monotonePath, clamp, fmtClock, fmtDayShort, fmtMonthShort, formatPower, formatEnergy, prefersReducedMotion } from './utils.js?v=1.2.0';
import { t } from './i18n.js?v=1.2.0';

const PAD = { top: 18, right: 14, bottom: 26, left: 46 };

class BaseChart {
  /** The period being shown. Both chart types lay their x axis out from it. */
  setRange(from, to) { this.from = +from; this.to = +to; }

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
    this.emptyEl = h('div', { class: 'chart-empty' },
      h('span', { class: 'chart-empty-text', text: t('chart.noData') }),
      h('small', { class: 'chart-empty-hint', hidden: true }));
    this.host.append(this.svgWrap, this.legendEl, this.tooltip, this.emptyEl);
    // Defer the redraw to the next frame: resizing inside an observer callback
    // is not allowed (see renderer.observeFlowResize).
    this._ro = new ResizeObserver(() => {
      if (this._roPending) return;
      this._roPending = true;
      const run = () => {
        if (!this._roPending) return;
        this._roPending = false;
        this._onResize();
      };
      requestAnimationFrame(run);
      setTimeout(run, 120);
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

  /**
   * The three reasons a period can be empty need three different remedies, so
   * the caller names the reason instead of the chart guessing.
   */
  setEmptyText(text, hint = '') {
    const textEl = this.emptyEl.querySelector('.chart-empty-text');
    const hintEl = this.emptyEl.querySelector('.chart-empty-hint');
    if (textEl) textEl.textContent = text || t('chart.noData');
    if (hintEl) { hintEl.textContent = hint || ''; hintEl.hidden = !hint; }
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
    for (const sr of vis) {
      for (const [, v] of sr.points) { if (v < min) min = v; if (v > max) max = v; }
      for (const [, lo, hi] of sr.band || []) { if (lo < min) min = lo; if (hi > max) max = hi; }
    }
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
      gX.appendChild(s('text', { x, y: H - 8, class: 'axis-label', 'text-anchor': 'middle', text: axisTimeLabel(new Date(tick), this.to - this.from) }));
    }
    svg.appendChild(gX);

    // series
    for (const sr of vis) {
      const pts = sr.points.map(([t, v]) => [xOf(t), yOf(v)]);
      const d = monotonePath(pts);

      // A min-max band: the same smoothing along the top edge, then back along
      // the bottom one. Drawn first so the mean line stays readable on top.
      if (sr.band && sr.band.length > 1) {
        const top = sr.band.map(([t, , hi]) => [xOf(t), yOf(hi)]);
        const bottom = sr.band.map(([t, lo]) => [xOf(t), yOf(lo)]).reverse();
        const bandPath = `${monotonePath(top)}L${monotonePath(bottom).slice(1)}Z`;
        svg.appendChild(s('path', { d: bandPath, class: 'chart-band', fill: sr.color, 'fill-opacity': 0.16, stroke: 'none' }));
      }
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
        const f = sr.format ? sr.format(p[1]) : formatPower(p[1], { signed: sr.signed });
        let extra = '';
        if (sr.band) {
          const b = sr.band[sr.points.indexOf(p)];
          if (b) {
            const lo = sr.format ? sr.format(b[1]) : formatPower(b[1]);
            const hi = sr.format ? sr.format(b[2]) : formatPower(b[2]);
            extra = ` <i>(${lo.value}–${hi.value})</i>`;
          }
        }
        rows.push(`<div class="tt-row"><span class="tt-dot" style="background:${sr.color}"></span><span class="tt-label">${sr.label}</span><span class="tt-value">${f.value} <i>${f.unit}</i>${extra}</span></div>`);
      });
      const time = tooltipTimeLabel(new Date(clamp(t, this.from, this.to)), this.to - this.from);
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

    // Shared bucket scale. It comes from the selected period when there is one,
    // so a month with data in two of its twelve slots shows two bars where those
    // months are — building the axis out of the buckets that happen to hold data
    // would spread them across the whole width and read as a full year.
    const bucket = this.opts.bucket || 'day';
    const dayKeys = bucketsOfPeriod(this.from, this.to, bucket)
      || [...new Set(vis.flatMap((sr) => sr.points.map(([t]) => dayKey(t, bucket))))].sort((a, b) => a - b);
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
        const found = sr.points.find(([t]) => dayKey(t, bucket) === key);
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
        const d = new Date(+key);
        const text = this.opts.bucket === 'month' ? fmtMonthShort(d) : fmtDayShort(d);
        svg.appendChild(s('text', { x: cx, y: H - 8, class: 'axis-label', 'text-anchor': 'middle', text }));
      }
      // hover zone covering the whole column
      const hit = s('rect', { x: PAD.left + slot * i, y: PAD.top, width: slot, height: plotH, fill: 'transparent', style: 'cursor:pointer' });
      hit.addEventListener('pointerenter', (evt) => {
        const rect = svg.getBoundingClientRect();
        const rows = vis.map((sr) => {
          const found = sr.points.find(([t]) => dayKey(t, bucket) === key);
          const f = formatEnergy(found ? found[1] : 0);
          return `<div class="tt-row"><span class="tt-dot" style="background:${sr.color}"></span><span class="tt-label">${sr.label}</span><span class="tt-value">${f.value} <i>${f.unit}</i></span></div>`;
        });
        const px = (PAD.left + slot * (i + 0.5)) * (rect.width / W);
        const d = new Date(+key);
        const title = this.opts.bucket === 'month' ? fmtMonthShort(d) : fmtDayShort(d);
        this._showTooltip(px, PAD.top + 6, `<div class="tt-title">${title}</div>${rows.join('')}`);
      });
      hit.addEventListener('pointerleave', () => this._hideTooltip());
      svg.appendChild(hit);
    });

    this.svgWrap.appendChild(svg);
  }
}

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Every bucket of a period, in calendar order, or null when no period is known.
 * Stepping with setDate/setMonth keeps it right across DST and month lengths.
 */
function bucketsOfPeriod(from, to, bucket) {
  if (!from || !to || to <= from) return null;
  const keys = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (bucket === 'month') cursor.setDate(1);
  const limit = bucket === 'month' ? 400 : 500;                 // a sane guard, never reached in practice
  while (+cursor < +to && keys.length < limit) {
    keys.push(String(+cursor));
    if (bucket === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }
  return keys.length ? keys : null;
}

function dayKey(t, bucket) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (bucket === 'month') d.setDate(1);
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

const DAY_MS = 86400000;

function timeTicks(from, to, count) {
  const span = to - from;
  // Small steps matter for short ranges (for example right after midnight).
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map((m) => m * 60000);
  const target = span / Math.max(1, count);
  const step = steps.find((x) => x >= target) || steps[steps.length - 1];
  const ticks = [];
  if (step >= DAY_MS) {
    // Beyond a day, step in local calendar days: a fixed millisecond grid lands
    // on UTC midnight and would label every tick with the timezone offset.
    const days = Math.max(1, Math.round(step / DAY_MS));
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    if (+d < from) d.setDate(d.getDate() + days);
    for (; +d <= to; d.setDate(d.getDate() + days)) ticks.push(+d);
    return ticks;
  }
  const first = Math.ceil(from / step) * step;
  for (let t = first; t <= to; t += step) ticks.push(t);
  return ticks;
}

/** A clock reads well inside a day and is useless across a month. */
function axisTimeLabel(date, span) {
  if (span > 60 * DAY_MS) return fmtMonthShort(date);
  if (span > 2 * DAY_MS) return fmtDayShort(date);
  return fmtClock(date, false);
}

function tooltipTimeLabel(date, span) {
  if (span > 2 * DAY_MS) return `${fmtDayShort(date)}, ${fmtClock(date, false)}`;
  return fmtClock(date, false);
}

// Exported for the unit tests: the axis is the part most easily got wrong.
export { bucketsOfPeriod, timeTicks, axisTimeLabel };
