/**
 * test-dashboard.mjs — interactive tests for Deye Dashboard over CDP.
 * A real browser: device emulation, clicks, shadow DOM reads, console capture.
 */
import { Browser, sleep } from './cdp.mjs';
import { toDateInput } from '../deye-dashboard/js/ranges.js';
import { mkdirSync } from 'node:fs';

const ORIGIN = process.env.DEYE_ORIGIN || 'http://127.0.0.1:8899';
const BASE = `${ORIGIN}/index.html`;
const SHOT = (process.env.DEYE_SHOTS || '/tmp/deye-shots') + '/t';

try { mkdirSync(process.env.DEYE_SHOTS || '/tmp/deye-shots', { recursive: true }); } catch {}

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const group = (t) => console.log(`\n── ${t} ──`);

/* Helpers that live inside the page. */
const HELPERS = `
  const host = document.querySelector('deye-dashboard');
  const sr = host.shadowRoot;
  const app = host.app;
  const q = (s) => sr.querySelector(s);
  const qa = (s) => [...sr.querySelectorAll(s)];
  const txt = (s) => { const e = q(s); return e ? e.textContent.trim() : null; };
  const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,cx:r.x+r.width/2,cy:r.y+r.height/2}; };
  const distToRect = (p, r) => Math.hypot(Math.max(r.left-p.x,0,p.x-r.right), Math.max(r.top-p.y,0,p.y-r.bottom));
  const endpoints = (el) => {
    const total = el.getTotalLength(); const m = el.getScreenCTM();
    const t = (p) => ({ x: p.x*m.a + p.y*m.c + m.e, y: p.x*m.b + p.y*m.d + m.f });
    return [t(el.getPointAtLength(0)), t(el.getPointAtLength(total))];
  };
`;

/** Waits for a condition inside the page (DOM updates land in an animation frame). */
async function poll(page, expr, ms = 4000) {
  // Deliberately setTimeout and not requestAnimationFrame: after a device-metrics
  // change the page can stop producing frames, and an rAF-based wait would then
  // never resolve, hanging the whole run.
  return page.eval(`${HELPERS}
    const t0 = Date.now();
    while (Date.now() - t0 < ${ms}) {
      try { if (${expr}) return true; } catch (e) {}
      await new Promise(r => setTimeout(r, 50));
    }
    return false;`);
}

const browser = await Browser.launch({ headless: true });
console.log(`Chrome: ${browser.version['Browser']}, protocol ${browser.version['Protocol-Version']}`);
const page = await browser.newPage();
// Trace localStorage writes so it is visible who saves the config and when.
await page.clearStorage(ORIGIN);
await page.installErrorHook();
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__saves = [];
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    window.__saves.push({ key: k, t: Date.now(), stack: new Error().stack.split('\\n').slice(1,5).join(' <= ') });
    return orig.call(this, k, v);
  };
`});

try {
  /* ─────────────── 1. boot without errors ─────────────── */
  group('Boot (demo mode, 13:30)');
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${BASE}?demo=1&hour=13.5`);
  await sleep(1600);

  check('no exceptions and no console.error', page.errors.length === 0, page.errors.join(' | ') || 'clean');
  check('no failed requests', page.failedRequests.length === 0, page.failedRequests.join(' | ') || 'clean');
  const booted = await page.eval(`${HELPERS} return { app: !!app, cards: qa('.card').length, nodes: qa('.flow-node').length, links: qa('.flow-link').length };`);
  check('application booted', booted.app && booted.cards === 8 && booted.nodes === 6 && booted.links === 5, JSON.stringify(booted));

  const values = await page.eval(`${HELPERS} return {
    solar: txt('.node-solar .node-num'), house: txt('.node-house .node-num'),
    battery: txt('.node-battery .node-num'), grid: txt('.node-grid .node-num'),
    inv: txt('.inv-power-num'), status: txt('.inv-status-text'),
    battCard: txt('.card-battery .big-num'), mode: txt('.batt-mode'),
    kpi: qa('.kpi:not([hidden]) .kpi-num').map(e=>e.textContent.trim()),
    socEntity: (() => {
      const st = app.client.getState(app.config.entities.batterySoc);
      return st ? String(Math.round(parseFloat(st.state) * 10) / 10) : null;
    })(),
  };`);
  check('values rendered', values.solar !== '—' && values.status === 'ONLINE', JSON.stringify(values).slice(0, 190));
  check('SOC matches in the node and the card', values.battery === values.battCard, `${values.battery} / ${values.battCard}`);
  // Compared as numbers: "100.0" and "100" are the same reading formatted
  // differently, and the point of the check is the value, not the rounding.
  check('the first paint already agrees with the entity state',
    Math.abs(parseFloat(values.battery) - parseFloat(values.socEntity)) < 0.06,
    `node ${values.battery} vs entity ${values.socEntity}`);

  // The generator produced nothing by 13:30, so nothing about it may be on screen.
  const genOff = await page.eval(`${HELPERS} return {
    relevant: app.state.generator.relevant,
    node: !!q('.node-generator') && !q('.node-generator').hidden,
    link: getComputedStyle(q('.link-generator')).display !== 'none',
    card: !!q('.card-generator') && q('.card-generator').offsetParent !== null,
    kpi: !q('.kpi[data-key="generator"]').hidden,
    layout: q('.flow-stage').dataset.layout,
    chart: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()).some(x => /Generator/.test(x)),
  };`);
  check('an idle generator is nowhere to be seen',
    genOff.relevant === false && !genOff.node && !genOff.link && !genOff.card && !genOff.kpi
      && genOff.layout === 'wide' && !genOff.chart,
    JSON.stringify(genOff));

  /* ─────────────── 2. link geometry ─────────────── */
  group('Diagram geometry: links meet the nodes');
  const geo = await page.eval(`${HELPERS}
    const map = { solar: '.node-solar', battery: '.node-battery', grid: '.node-grid', load: '.node-house' };
    const hub = rect('.node-inverter .inv-body');
    const out = {};
    for (const [key, sel] of Object.entries(map)) {
      const beads = q('.link-' + key + ' .link-beads');
      const [a, b] = endpoints(beads);
      const nr = rect(sel + ' .node-body');
      const r = Math.min(nr.w, nr.h) / 2;
      const distNode = Math.abs(Math.hypot(a.x - nr.cx, a.y - nr.cy) - r);
      const distHub = distToRect(b, hub);
      out[key] = { node: +distNode.toFixed(1), hub: +distHub.toFixed(1) };
    }
    out.layout = q('.flow-stage').dataset.layout;
    return out;`);
  for (const key of ['solar', 'battery', 'grid', 'load']) {
    const g = geo[key];
    check(`link ${key}: endpoints sit at the node edges`, g.node < 14 && g.hub < 14, `node ${g.node}px, inverter ${g.hub}px`);
  }

  /* ─────────────── 3. flow animation ─────────────── */
  group('Animation');
  const anim = await page.eval(`${HELPERS}
    const info = (key) => { const g = q('.link-'+key); const b = q('.link-'+key+' .link-beads'); const cs = getComputedStyle(b);
      return { dir: g.dataset.dir, name: cs.animationName, dur: cs.animationDuration, rev: cs.animationDirection, op: +parseFloat(cs.opacity).toFixed(2) }; };
    return { solar: info('solar'), battery: info('battery'), grid: info('grid'), load: info('load') };`);
  check('an active flow animates', anim.solar.name === 'bead-run' && parseFloat(anim.solar.dur) > 0.4, `solar ${anim.solar.dir} ${anim.solar.dur}`);
  check('a flow out of the inverter runs in reverse',
    anim.battery.dir === 'fromHub' && anim.battery.rev === 'reverse', `battery dir=${anim.battery.dir} ${anim.battery.rev}`);
  check('intensity drives the speed', parseFloat(anim.solar.dur) < parseFloat(anim.load.dur),
    `solar ${anim.solar.dur} (7.8 kW) vs load ${anim.load.dur}`);

  // Running is not moving. The keyframe took a unitless period, which Chrome
  // would not interpolate from 0px: the offset jumped by exactly one pattern
  // period every half cycle, so the beads stood still while every check above
  // passed. Seek the animation and read the offset itself. Each path runs from
  // its node to the inverter, so a falling offset carries the beads inwards.
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(300);
  const travel = await page.eval(`${HELPERS}
    const along = (key, nodeSel) => {
      const path = q('.link-' + key + ' .link-beads');
      const a = path.getAnimations()[0];
      if (!a) return { offsets: [], startAtNode: null };
      a.pause();
      const dur = a.effect.getComputedTiming().duration;
      const offsets = [0.25, 0.5, 0.75].map((f) => {
        a.currentTime = f * dur;
        return +parseFloat(getComputedStyle(path).strokeDashoffset.replace(/[^-0-9.]/g, '')).toFixed(2);
      });
      a.play();
      const [start] = endpoints(path);
      const node = rect(nodeSel), hub = rect('.node-inverter');
      return { offsets, startAtNode: Math.hypot(start.x - node.cx, start.y - node.cy) < Math.hypot(start.x - hub.cx, start.y - hub.cy) };
    };
    return { solar: along('solar', '.node-solar'), load: along('load', '.node-house') };`);
  const falls = (v) => v.length === 3 && v[0] > v[1] && v[1] > v[2];
  const rises = (v) => v.length === 3 && v[0] < v[1] && v[1] < v[2];
  check('solar beads travel toward the inverter', travel.solar.startAtNode && falls(travel.solar.offsets),
    `path starts at the node: ${travel.solar.startAtNode}, offset at 25/50/75 %: ${travel.solar.offsets.join(' / ')}`);
  check('house beads travel from the inverter to the house', travel.load.startAtNode && rises(travel.load.offsets),
    `path starts at the node: ${travel.load.startAtNode}, offset at 25/50/75 %: ${travel.load.offsets.join(' / ')}`);

  // A bead is a zero-length dash with round caps — a circle as wide as the
  // stroke. A dash 1.3 long under a 4.6 stroke drew a capsule, an oval.
  const beads = await page.eval(`${HELPERS}
    const shape = () => { const cs = getComputedStyle(q('.link-solar .link-beads'));
      return { dash: parseFloat(cs.strokeDasharray), width: parseFloat(cs.strokeWidth), cap: cs.strokeLinecap }; };
    const stage = q('.flow-stage'); const was = stage.dataset.layout;
    const wide = shape(); stage.dataset.layout = 'narrow'; const narrow = shape(); stage.dataset.layout = was;
    return { wide, narrow };`);
  for (const [layout, b] of Object.entries(beads)) {
    check(`${layout} layout: the beads are circles`, b.cap === 'round' && b.dash <= 0.05 * b.width,
      `dash ${b.dash} under a ${b.width} stroke, ${b.cap} caps`);
  }

  // On by default: the diagram's flow is its point, so the system's
  // reduce-motion setting stops it only when animation is set to auto.
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(300);
  const reduced = await page.eval(`${HELPERS} return { setting: app.config.animations, dur: getComputedStyle(q('.link-solar .link-beads')).animationDuration };`);
  check('by default the beads run even under reduce-motion', reduced.setting === 'on' && parseFloat(reduced.dur) > 0.4,
    `animations=${reduced.setting}, duration ${reduced.dur}`);
  await page.send('Emulation.setEmulatedMedia', { features: [] });

  /* ─────────────── 4. chart periods ─────────────── */
  group('Chart periods: Day / Week / Month / Year');
  const chartStats = async () => page.eval(`${HELPERS} return {
    title: txt('.card-chart .card-title-text'),
    lines: qa('.card-chart path.chart-line').length,
    bars: qa('.card-chart rect.chart-bar').length,
    legend: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()),
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    yUnit: txt('.card-chart .axis-unit'),
    label: txt('.topbar .nav-label-text'),
    active: q('.topbar .nav-range-select').value,
    forwardBlocked: q('.topbar .nav-btn[disabled]') !== null,
  };`);
  const pickRange = async (key, wait = 900) => {
    await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = '${key}'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    await sleep(wait);
  };

  let cs = await chartStats();
  check('Day: lines drawn', cs.lines >= 3 && !cs.empty && cs.active === 'day',
    `lines ${cs.lines}, unit ${cs.yUnit}, "${cs.title}", ${cs.label}`);
  check('forward navigation blocked on today', cs.forwardBlocked === true);

  await pickRange('week');
  cs = await chartStats();
  check('Week: daily bars', cs.bars > 0 && !cs.empty && cs.active === 'week',
    `bars ${cs.bars}, "${cs.title}", ${cs.label}`);

  await pickRange('month', 1100);
  cs = await chartStats();
  check('Month: daily bars', cs.bars > 0 && cs.active === 'month', `bars ${cs.bars}, ${cs.label}`);

  await pickRange('year', 1400);
  cs = await chartStats();
  check('Year: monthly bars', cs.bars > 0 && cs.active === 'year', `bars ${cs.bars}, ${cs.label}`);
  check('legend shows period totals', cs.legend.some((l) => /kWh|MWh/.test(l)), cs.legend.join(' / ').slice(0, 120));

  await pickRange('day');
  cs = await chartStats();
  check('switching back to Day works', cs.lines >= 3, `lines ${cs.lines}`);

  /* ─────────────── 5. chart tooltip ─────────────── */
  group('Chart interaction');
  const tip = await page.eval(`${HELPERS}
    const svg = q('.card-chart .chart-svg');
    const r = svg.getBoundingClientRect();
    const ev = (type, x, y) => svg.querySelector('rect[style*="crosshair"]').dispatchEvent(new PointerEvent(type, {clientX:x, clientY:y, bubbles:true}));
    ev('pointermove', r.x + r.width*0.55, r.y + r.height*0.5);
    await new Promise(r2 => setTimeout(r2, 120));
    const tt = q('.card-chart .chart-tooltip');
    const visible = tt.classList.contains('is-visible');
    const rows = tt.querySelectorAll('.tt-row').length;
    const title = tt.querySelector('.tt-title')?.textContent;
    const cross = q('.card-chart .chart-hover').style.display !== 'none';
    return { visible, rows, title, cross };`);
  check('hover tooltip', tip.visible && tip.rows >= 3, `rows ${tip.rows}, time ${tip.title}, crosshair ${tip.cross}`);

  const legendToggle = await page.eval(`${HELPERS}
    const before = qa('.card-chart path.chart-line').length;
    qa('.card-chart .chart-legend-item')[0].click();
    await new Promise(r => setTimeout(r, 250));
    const after = qa('.card-chart path.chart-line').length;
    qa('.card-chart .chart-legend-item')[0].click();
    await new Promise(r => setTimeout(r, 250));
    return { before, after, restored: qa('.card-chart path.chart-line').length };`);
  check('legend toggles a series off and on', legendToggle.after === legendToggle.before - 1 && legendToggle.restored === legendToggle.before,
    `${legendToggle.before} → ${legendToggle.after} → ${legendToggle.restored}`);

  group('The period selector is on the page, not buried in it');
  for (const [w, h] of [[1600, 1000], [1440, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h, dpr: 1, mobile: w < 500 });
    await poll(page, `!!q('.topbar .nav-label')`, 4000);
    const place = await page.eval(`${HELPERS}
      const chip = q('.topbar .nav-label');
      const sel = q('.topbar .nav-range-select');
      const cr = chip.getBoundingClientRect();
      const sr2 = sel.getBoundingClientRect();
      return {
        chipTop: Math.round(cr.top), chipVisible: cr.top >= 0 && cr.bottom <= innerHeight && cr.width > 40,
        selVisible: sr2.top >= 0 && sr2.bottom <= innerHeight && sr2.width > 30,
        label: txt('.topbar .nav-label-text'),
        overflow: document.documentElement.scrollWidth - innerWidth,
        headerH: Math.round(q('.topbar').getBoundingClientRect().height),
      };`);
    check(`at ${w}x${h} the date and period sit in the first screen`,
      place.chipVisible && place.selVisible && place.overflow <= 1,
      `chip top ${place.chipTop}px "${place.label}", header ${place.headerH}px, overflow ${place.overflow}px`);
  }
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(600);

  const localDate = (expr) => `(() => { const d = ${expr}; return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })()`;
  const setRange = async (key) => {
    await page.eval(`${HELPERS}
      const sel = q('.topbar .nav-range-select'); sel.value = '${key}';
      sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
    await poll(page, `q('.topbar .nav-range-select').value === '${key}'`, 4000);
    await sleep(500);
  };
  group('Period consistency: the tiles, the legend and the buckets agree');
  // The defect that reached the owner: a period total that quietly included the
  // next period, so a day reported roughly twice its export. Everything here
  // compares numbers against each other rather than counting shapes.
  const readPeriod = () => page.eval(`${HELPERS}
    const toKwh = (text) => {
      // Doubled escapes: this source is inside a template literal, where \d
      // would reach the page as a plain 'd'.
      const m = String(text).match(/(-?[\\d.,]+)\\s*(MWh|kWh|Wh)/i);
      if (!m) return null;
      const v = parseFloat(m[1].replace(',', '.'));
      const u = m[2].toLowerCase();
      return u === 'mwh' ? v * 1000 : u === 'wh' ? v / 1000 : v;
    };
    const tiles = {};
    for (const el of qa('.kpi:not([hidden])')) {
      const num = el.querySelector('.kpi-num').textContent.trim();
      const unit = el.querySelector('.kpi-unit') ? el.querySelector('.kpi-unit').textContent.trim() : '';
      // Self-sufficiency is a percentage, everything else is energy.
      tiles[el.dataset.key] = /%/.test(unit) ? parseFloat(num.replace(',', '.')) : toKwh(num + ' ' + unit);
    }
    const legend = {};
    for (const el of qa('.card-chart .chart-legend-item')) {
      const label = el.querySelector('.chart-legend-label').textContent.trim();
      legend[label] = toKwh(el.querySelector('.chart-legend-value').textContent.trim());
    }
    const bounds = app.chart ? { from: app.chart.from, to: app.chart.to } : null;
    const series = app.chart && app.chart.series ? app.chart.series.map((sr) => ({
      key: sr.key, points: sr.points.length,
      // A bucket with nothing in it draws no bar (a generator idle most days).
      filled: sr.points.filter((p) => p[1] > 0).length,
      first: sr.points.length ? sr.points[0][0] : null,
      last: sr.points.length ? sr.points[sr.points.length - 1][0] : null,
      total: sr.points.reduce((a2, p) => a2 + p[1], 0),
    })) : [];
    return {
      label: txt('.topbar .nav-label-text'), range: q('.topbar .nav-range-select').value,
      mode: q('.app').dataset.mode,
      bannerVisible: !q('.history-bar').hidden,
      bannerState: q('.history-bar').dataset.state,
      bannerText: txt('.history-bar'),
      tiles, legend, series, bounds,
      axisLabels: qa('.card-chart .chart-axis-x text').length || qa('.card-chart text.axis-label').length,
      bars: qa('.card-chart rect.chart-bar').length,
      energy: Object.fromEntries(Object.entries(app.energy || {}).map(([k, v]) => [k, { id: v.id, total: v.total, rows: v.rows.length }])),
    };`);

  const closeEnough = (a2, b2) => a2 !== null && b2 !== null && Math.abs(a2 - b2) <= Math.max(0.6, Math.abs(a2) * 0.02);

  for (const key of ['week', 'month', 'year']) {
    await setRange(key);
    await poll(page, `qa('.card-chart rect.chart-bar').length > 0`, 9000);
    const p = await readPeriod();

    // 1. the tile and the legend are two renderings of one number
    const pairs = [['solar', 'Solar'], ['consumption', 'House'], ['gridImport', 'Import'], ['gridExport', 'Export']];
    const mismatched = pairs.filter(([tile, lab]) => !closeEnough(p.tiles[tile], p.legend[lab]));
    check(`${key}: every KPI tile matches the chart legend`, mismatched.length === 0,
      mismatched.length
        ? mismatched.map(([t2, l]) => `${t2} ${p.tiles[t2]} vs ${l} ${p.legend[l]}`).join('; ')
        : pairs.map(([t2, l]) => `${l} ${Math.round(p.legend[l])}`).join(' '));
    // The generator's tile and its series follow the same period total, so they
    // come and go together (the chart once followed the live state instead).
    const genTile = p.tiles.generator ?? null, genLegend = p.legend.Generator ?? null;
    check(`${key}: the generator tile and the chart agree`,
      genTile === null ? genLegend === null : closeEnough(genTile, genLegend),
      `tile ${genTile}, legend ${genLegend}`);

    // 2. the legend total is the sum of the bars it drew
    const drift = p.series.filter((sr) => Math.abs(sr.total - (p.legend[{ pv: 'Solar', load: 'House', import: 'Import', export: 'Export', generator: 'Generator' }[sr.key]] ?? sr.total)) > Math.max(0.6, sr.total * 0.02));
    check(`${key}: the legend totals the bars it drew`, drift.length === 0,
      drift.map((sr) => `${sr.key} ${sr.total.toFixed(1)}`).join(' ') || `${p.series.length} series`);

    // 3. every bucket falls inside the period
    const outside = p.series.filter((sr) => sr.first !== null && (sr.first < p.bounds.from || sr.last >= p.bounds.to));
    check(`${key}: no bucket lies outside the period`, outside.length === 0,
      outside.length ? outside.map((sr) => `${sr.key} ${new Date(sr.first).toISOString().slice(0, 10)}..${new Date(sr.last).toISOString().slice(0, 10)}`).join(' ')
        : `${new Date(p.bounds.from).toISOString().slice(0, 10)} → ${new Date(p.bounds.to).toISOString().slice(0, 10)}`);

    // 4. bars are one per series per bucket that has data
    const expectedBars = p.series.reduce((a2, sr) => a2 + sr.filled, 0);
    check(`${key}: one bar per bucket per series`, p.bars === expectedBars, `${p.bars} bars, expected ${expectedBars}`);

    // 5. self-sufficiency follows from the two tiles it is derived from
    const ss = p.tiles.selfSufficiency;
    const derived = p.tiles.consumption > 0 ? ((p.tiles.consumption - p.tiles.gridImport) / p.tiles.consumption) * 100 : null;
    check(`${key}: self-sufficiency follows from consumption and import`,
      derived === null || Math.abs(ss - derived) <= 1.5, `shown ${ss}, derived ${derived === null ? '—' : derived.toFixed(1)}`);

    // 6. the bar naming the period is present, and says which kind of period it is
    check(`${key}: the period is named above the tiles`,
      p.bannerVisible && new RegExp(p.label.split(' ')[p.label.split(' ').length - 1]).test(p.bannerText || ''),
      `${p.bannerState}: ${(p.bannerText || '').slice(0, 52)}`);
  }

  // A year keeps twelve slots even though the demo's data starts in January and
  // stops today: the axis is a calendar, not a list of what happens to exist.
  await setRange('year');
  await poll(page, `qa('.card-chart rect.chart-bar').length > 0`, 9000);
  const yearNow = await readPeriod();
  check('a partial year still lays out every month',
    yearNow.axisLabels >= 12, `${yearNow.axisLabels} axis labels for ${yearNow.series[0] ? yearNow.series[0].points : 0} months of data`);
  check('and only the months with data get bars',
    yearNow.series.every((sr) => sr.points <= 12) && yearNow.series[0].points < 12,
    yearNow.series.map((sr) => `${sr.key}:${sr.points}`).join(' '));

  // The same period, reached twice, gives the same numbers.
  const before = await readPeriod();
  await setRange('week');
  await poll(page, `qa('.card-chart rect.chart-bar').length > 0`, 9000);
  await setRange('year');
  await poll(page, `qa('.card-chart rect.chart-bar').length > 0`, 9000);
  const again = await readPeriod();
  check('leaving a period and coming back gives the same totals',
    closeEnough(before.tiles.solar, again.tiles.solar) && closeEnough(before.tiles.gridExport, again.tiles.gridExport),
    `solar ${before.tiles.solar} → ${again.tiles.solar}, export ${before.tiles.gridExport} → ${again.tiles.gridExport}`);

  // A past period and the current one must both say what the tiles add up to.
  await setRange('month');
  await poll(page, `q('.history-bar').dataset.state === 'partial'`, 9000);
  const runningMonth = await readPeriod();
  check('the current month is marked as a running total',
    runningMonth.mode === 'live' && runningMonth.bannerState === 'partial' && /totals for/i.test(runningMonth.bannerText || ''),
    `${runningMonth.bannerState}: ${(runningMonth.bannerText || '').slice(0, 60)}`);
  await page.eval(`${HELPERS} qa('.topbar .nav-btn')[0].click(); return 1;`);
  await poll(page, `q('.app').dataset.mode === 'history'`, 9000);
  const closedMonth = await readPeriod();
  check('and a past month as a closed one',
    closedMonth.mode === 'history' && closedMonth.bannerState === 'past' && /viewing/i.test(closedMonth.bannerText || ''),
    `${closedMonth.bannerState}: ${(closedMonth.bannerText || '').slice(0, 60)}`);
  const pastMismatch = [['solar', 'Solar'], ['consumption', 'House'], ['gridExport', 'Export']]
    .filter(([tile, lab]) => !closeEnough(closedMonth.tiles[tile], closedMonth.legend[lab]));
  check('a past month agrees between tiles and legend too', pastMismatch.length === 0,
    pastMismatch.map(([t2, l]) => `${t2} ${closedMonth.tiles[t2]} vs ${l} ${closedMonth.legend[l]}`).join('; ') || 'all match');

  await setRange('day');
  await poll(page, `q('.app').dataset.mode === 'live'`, 9000);

  group('The picker matches the period');
  // Picking a day out of a calendar is useless when the period is a year, and
  // that is what the platform input can offer, so months and years get a grid.
  const openChip = async () => {
    await page.eval(`${HELPERS} q('.topbar .nav-label').click(); return 1;`);
    await sleep(300);
    return page.eval(`${HELPERS}
      const pop = q('.topbar .nav-pop');
      return {
        open: !pop.hidden,
        kind: pop.querySelector('.pop-months') ? 'months' : pop.querySelector('.pop-years') ? 'years' : 'none',
        cells: qa('.topbar .pop-cell').map(b => b.textContent.trim()),
        disabled: qa('.topbar .pop-cell[disabled]').length,
        active: (q('.topbar .pop-cell.is-active') || {}).textContent,
        head: (q('.topbar .pop-title') || {}).textContent,
        expanded: q('.topbar .nav-label').getAttribute('aria-expanded'),
        inputType: q('.topbar .nav-date-input').type,
      };`);
  };

  await setRange('month');
  const monthPick = await openChip();
  check('a month period offers twelve months, not a calendar of days',
    monthPick.open && monthPick.kind === 'months' && monthPick.cells.length === 12 && monthPick.head === String(new Date().getFullYear()),
    `${monthPick.kind}, ${monthPick.cells.length} cells, head ${monthPick.head}`);
  check('months in the future are not offered', monthPick.disabled === 11 - new Date().getMonth(),
    `${monthPick.disabled} disabled, current month index ${new Date().getMonth()}`);
  check('the selected month is marked', !!monthPick.active, `${monthPick.active}`);

  await page.eval(`${HELPERS}
    const cells = qa('.topbar .pop-cell').filter(b => !b.disabled);
    cells[0].click(); return 1;`);
  await poll(page, `q('.topbar .nav-pop').hidden && qa('.card-chart rect.chart-bar').length > 0`, 8000);
  const monthApplied = await page.eval(`${HELPERS} return {
    label: txt('.topbar .nav-label-text'), closed: q('.topbar .nav-pop').hidden,
    bars: qa('.card-chart rect.chart-bar').length, mode: q('.app').dataset.mode };`);
  check('picking a month applies it and closes the grid',
    monthApplied.closed && /jan|січ/i.test(monthApplied.label) && monthApplied.bars > 0,
    `${monthApplied.label}, ${monthApplied.bars} bars, ${monthApplied.mode}`);

  await setRange('year');
  const yearPick = await openChip();
  check('a year period offers years', yearPick.open && yearPick.kind === 'years' && yearPick.cells.length === 10,
    `${yearPick.kind}, ${yearPick.cells.join(' ')}`);
  check('the newest year comes first and none are in the future',
    yearPick.cells[0] === String(new Date().getFullYear()), yearPick.cells[0]);
  const escaped2 = await page.eval(`${HELPERS}
    q('.topbar .nav-pop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return { hidden: q('.topbar .nav-pop').hidden, expanded: q('.topbar .nav-label').getAttribute('aria-expanded') };`);
  check('Escape closes the grid', escaped2.hidden === true && escaped2.expanded === 'false');

  await setRange('day');
  const dayPick = await openChip();
  check('a day period keeps the platform calendar',
    dayPick.open === false && dayPick.inputType === 'date', `pop open=${dayPick.open}, input=${dayPick.inputType}`);
  await sleep(400);

  group('Midnight rollover');
  // The view anchor is a date, so at 00:00 "today" silently becomes yesterday.
  // Rewinding the anchor by a day is the same situation and must self-heal —
  // without waiting for a frame, because a background tab is given none.
  // Start from where a user who has not navigated would be.
  await page.eval(`${HELPERS} app.setView({ ...app.view, range: 'day', anchor: new Date() }); return 1;`);
  await poll(page, `q('.app').dataset.mode === 'live'`, 8000);

  // Exactly what midnight does: the anchor now names a day in the past, and
  // nothing else changes. No private call and no frame — the healing has to
  // come from the ordinary update path.
  await page.eval(`${HELPERS}
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0, 0, 0, 0);
    app.view = { ...app.view, anchor: y };
    app._followNow = true;
    return 1;`);
  const todayIso = toDateInput(new Date());
  // Poll on the anchor itself: the DOM still shows the live view from before the
  // mutation, so waiting on the mode would pass without anything having healed.
  await poll(page, `${localDate('app.view.anchor')} === '${todayIso}'`, 12000);
  const afterRoll = await page.eval(`${HELPERS} return {
    mode: q('.app').dataset.mode, label: txt('.topbar .nav-label-text'),
    anchor: ${localDate('app.view.anchor')}, banner: !q('.history-bar').hidden };`);
  check('a stale anchor is re-anchored to the current period',
    afterRoll.anchor === todayIso, `${afterRoll.anchor} (wanted ${todayIso})`);
  check('and the page stays live rather than sliding into history',
    afterRoll.mode === 'live' && !afterRoll.banner, `${afterRoll.mode}, ${afterRoll.label}`);
  // A period the user chose deliberately must not be dragged forward.
  const pinned = await page.eval(`${HELPERS}
    app.view = { ...app.view, anchor: new Date(2026, 1, 10) };
    app._followNow = false;
    return { healed: app._followCurrentPeriod(), anchor: ${localDate('app.view.anchor')} };`);
  check('a period the user picked is left alone', pinned.healed === false && pinned.anchor === '2026-02-10',
    `${pinned.anchor}`);
  await page.eval(`${HELPERS} app.setView({ ...app.view, anchor: new Date(), range: 'day' }); return 1;`);
  await poll(page, `q('.app').dataset.mode === 'live'`, 6000);

  /* ─────────────── 5b. date navigation and history mode ─────────────── */
  group('Date navigation and historical mode');
  const navState = async () => page.eval(`${HELPERS} return {
    label: txt('.topbar .nav-label-text'),
    mode: q('.app').dataset.mode,
    banner: !q('.history-bar').hidden,
    bannerText: txt('.history-label'),
    flowVisible: getComputedStyle(q('.card-flow')).display !== 'none',
    detailsVisible: getComputedStyle(q('.detail-row')).display !== 'none',
    liveCards: qa('.card-flow, .card-battery, .card-grid, .card-solar, .card-generator, .card-phases, .card-inverter')
      .filter(e => e.offsetParent !== null).map(e => e.className.replace(/card |tone-\S+/g, '').trim()),
    emptyText: txt('.card-chart .chart-empty'),
    kpi: qa('.kpi:not([hidden]) .kpi-num').map(e => e.textContent.trim()),
    nowVisible: q('.history-now').offsetParent !== null,
    forwardBlocked: q('.topbar .nav-btn[disabled]') !== null,
  };`);
  const live = await navState();
  check('today is live: diagram and cards visible', live.mode === 'live' && live.flowVisible && live.detailsVisible && !live.banner,
    `mode=${live.mode}, ${live.label}`);

  await page.eval(`${HELPERS} qa('.topbar .nav-btn')[0].click(); return 1;`);
  await poll(page, `q('.app').dataset.mode === 'history'`, 8000);
  const past = await navState();
  check('one day back enters historical mode', past.mode === 'history' && past.banner,
    `mode=${past.mode}, banner "${past.bannerText}"`);
  check('every live card is hidden in history', !past.flowVisible && !past.detailsVisible && past.liveCards.length === 0,
    past.liveCards.length ? `still visible: ${past.liveCards.join(', ')}` : 'none visible');
  check('KPI recomputed for the past day',
    past.kpi.length >= 4 && past.label !== live.label
      && JSON.stringify(past.kpi) !== JSON.stringify(live.kpi) && !past.kpi.includes('—'),
    `${past.label}: ${past.kpi.join(' / ')}`);
  check('forward navigation unblocked in the past', past.forwardBlocked === false);
  check('Now appears in the history banner', past.nowVisible === true);
  check('the top bar does not offer a second Now', await page.eval(`${HELPERS} return !q('.topbar .nav-now');`) === true);
  // The demo generator ran 19:00-21:00 yesterday and is idle at 13:30 today:
  // the chart follows the day on screen, not what the generator does now.
  await poll(page, `!app._periodBusy`, 8000);
  const pastSeries = await page.eval(`${HELPERS} return qa('.card-chart .chart-legend-item').map(e => e.textContent.trim());`);
  check("yesterday's generator run is on yesterday's chart", pastSeries.some((l) => /Generator/.test(l)), pastSeries.join(' / '));
  await page.screenshot(`${SHOT}-history.png`);

  await page.eval(`${HELPERS} q('.history-now').click(); return 1;`);
  await poll(page, `q('.app').dataset.mode === 'live'`, 8000);
  const back = await navState();
  check('Now returns to live', back.mode === 'live' && !back.banner && back.flowVisible, back.label);

  // Statistics loaded for another period never pass for today's. Until today's
  // arrive — or for good, if that load fails — the last period's are still in
  // place: here, a day on which the generator ran and the house used 999 kWh.
  await poll(page, `!app._periodBusy && !app._periodQueued`, 8000);
  const stale = await page.eval(`${HELPERS}
    app.periodKpi = { ...app.periodKpi, generator: 9, consumption: 999 };
    app._periodKpiFrom -= 86400000;
    app._lastChartFetch = Date.now();          // no reload may tidy it up meanwhile
    app._applyUpdate();
    await new Promise((r) => setTimeout(r, 300));
    const out = { tile: !q('.kpi[data-key="generator"]').hidden, house: txt('.kpi[data-key="consumption"] .kpi-num') };
    await app._loadPeriod(true);
    return out;`);
  check("another period's statistics never pass for today's", !stale.tile && parseFloat(stale.house) < 999,
    `generator tile ${stale.tile}, house ${stale.house}`);

  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'custom'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(900);
  await page.eval(`${HELPERS}
    const input = qa('.topbar .nav-range-input')[0];
    input.value = '2026-08-01';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;`);
  await poll(page, `qa('.topbar .nav-range-input')[0].value === '2026-08-01' && qa('.card-chart rect.chart-bar').length > 0`, 8000);
  const custom = await page.eval(`${HELPERS}
    const inputs = qa('.topbar .nav-range-input');
    return {
      count: inputs.length, from: inputs[0].value, to: inputs[1].value,
      bars: qa('.card-chart rect.chart-bar').length,
      lines: qa('.card-chart path.chart-line').length,
      mode: q('.app').dataset.mode,
      max: q('.topbar .nav-range-input').getAttribute('max'),
    };`);
  check('custom interval loads', custom.count === 2 && custom.from === '2026-08-01' && custom.bars > 0,
    `${custom.from} – ${custom.to}: ${custom.bars} bars, ${custom.lines} lines`);
  check('the pickers refuse the future', custom.max === toDateInput(new Date()), `max=${custom.max}`);

  await page.eval(`${HELPERS}
    const inputs = qa('.topbar .nav-range-input');
    inputs[0].value = '2019-01-01';
    inputs[1].value = '2019-01-05';
    inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
    return 1;`);
  await poll(page, `q('.card-chart .chart-empty').classList.contains('is-visible')`, 8000);
  const emptyPeriod = await page.eval(`${HELPERS} return {
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    text: txt('.card-chart .chart-empty'), bars: qa('.card-chart rect.chart-bar').length };`);
  check('a period before the data existed says so',
    emptyPeriod.empty && emptyPeriod.bars === 0 && /no data for this period/i.test(emptyPeriod.text),
    `"${emptyPeriod.text}", bars ${emptyPeriod.bars}`);

  // Detailed states are purged long before statistics are, so a day far in the
  // past has an empty power chart while its month still has bars.
  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'day'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(600);
  await page.eval(`${HELPERS}
    const input = q('.topbar .nav-date-input');
    input.value = '2026-02-10';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 1;`);
  await poll(page, `txt('.topbar .nav-label-text') !== null && q('.card-chart .chart-empty').classList.contains('is-visible')`, 8000);
  const dayEmptyOld = await page.eval(`${HELPERS} return {
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    hint: txt('.card-chart .chart-empty-hint') };`);
  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'month'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await poll(page, `qa('.card-chart rect.chart-bar').length > 0`, 8000);
  const oldMonth = await page.eval(`${HELPERS} return {
    monthBars: qa('.card-chart rect.chart-bar').length, label: txt('.topbar .nav-label-text') };`);
  check('an old day is empty while its month still has data', dayEmptyOld.empty && oldMonth.monthBars > 0,
    `${oldMonth.label}: day empty=${dayEmptyOld.empty}, month bars=${oldMonth.monthBars}`);
  check('the purged day names the remedy', /week|month/i.test(dayEmptyOld.hint || ''),
    `hint "${dayEmptyOld.hint}"`);

  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'day'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(400);
  await page.eval(`${HELPERS} q('.history-now') && !q('.history-now').closest('[hidden]') ? q('.history-now').click() : null; return 1;`);
  await sleep(1100);
  // Every group below measures the live diagram, so a failed reset here would
  // surface as seven confusing geometry failures instead of one clear one.
  const backLive = await navState();
  check('the view is back to live for the groups that follow', backLive.mode === 'live' && backLive.flowVisible,
    `mode=${backLive.mode}, ${backLive.label}`);

  /* ─────────────── 6. settings ─────────────── */
  group('Settings dialog');
  const settings = await page.eval(`${HELPERS}
    q('.topbar .settings-btn').click();
    await new Promise(r => setTimeout(r, 400));
    const modal = q('.modal');
    const inputs = qa('.modal .field input[type="text"]');
    const filled = inputs.filter(i => i.value).length;
    const datalist = q('#deye-entity-list');
    const dots = qa('.modal .conf-dot[data-c]').map(d => d.dataset.c);
    return {
      open: modal && !modal.hidden,
      tabs: qa('.modal .tab-btn').map(b => b.textContent.trim()),
      inputs: inputs.length, filled,
      datalistOptions: datalist ? datalist.children.length : 0,
      confHigh: dots.filter(d => d === 'high').length,
      confMismatch: dots.filter(d => d === 'mismatch').length,
    };`);
  check('settings open from the gear button', settings.open, `tabs: ${settings.tabs.join(', ')}`);
  check('entity fields filled by auto-detection', settings.filled >= 20, `${settings.filled} of ${settings.inputs}`);
  check('entity autocomplete populated', settings.datalistOptions >= 20, `${settings.datalistOptions} options`);
  check('role-match validation is green', settings.confHigh >= 15 && settings.confMismatch === 0, `high=${settings.confHigh}, mismatch=${settings.confMismatch}`);

  // The battery cut-off is a setpoint (number.*), the one role allowed to read
  // one: its autocomplete has to offer it, and a measurement role's must not.
  const lists = await page.eval(`${HELPERS}
    const opts = (key) => { const input = app.settings.fields[key].input; const dl = sr.getElementById(input.getAttribute('list'));
      return dl ? [...dl.options].map((o) => o.value) : []; };
    return { cutoff: opts('batteryShutdownSoc'), soc: opts('batterySoc') };`);
  check('the cut-off field suggests the shutdown SOC setpoint', lists.cutoff.includes('number.deye_battery_shutdown_soc'),
    `${lists.cutoff.filter((x) => x.startsWith('number.')).join(', ') || 'no number.* entity'}`);
  check('a measurement field suggests no setpoints', lists.soc.length > 0 && !lists.soc.some((x) => x.startsWith('number.')),
    `${lists.soc.length} options, number.*: ${lists.soc.filter((x) => x.startsWith('number.')).length}`);

  const tabs = await page.eval(`${HELPERS}
    const out = {};
    for (const b of qa('.modal .tab-btn')) {
      b.click();
      await new Promise(r => setTimeout(r, 250));
      const visible = qa('.modal .tab-panel').findIndex(p => !p.hidden);
      out[b.dataset.tab] = { panel: visible, rows: qa('.modal .diag-table tbody tr').length, areas: qa('.modal textarea').length };
    }
    return out;`);
  check('diagnostics tab is populated', (tabs.diag?.rows || 0) >= 20, `table rows ${tabs.diag?.rows}`);
  check('export tab offers YAML and JSON', (tabs.export?.areas || 0) === 2, `textareas ${tabs.export?.areas}`);

  const yaml = await page.eval(`${HELPERS} return qa('.modal textarea')[0].value;`);
  check('YAML contains panel_custom and entities', /panel_custom/.test(yaml) && /entities:/.test(yaml) && /module_url/.test(yaml), yaml.split('\n').length + ' lines');

  await page.screenshot(`${SHOT}-settings.png`);
  const closed = await page.eval(`${HELPERS}
    q('.modal .modal-head .icon-btn').click();
    await new Promise(r => setTimeout(r, 300));
    return q('.modal').hidden;`);
  check('settings close', closed === true);

  /* ─────────────── 7. responsive layout and overflow ─────────────── */
  group('Responsive layout (real device emulation)');
  for (const [w, h, dpr, mobile, label] of [
    [390, 844, 3, true, 'iPhone 14'],
    [430, 932, 3, true, 'iPhone 15 Pro Max'],
    [768, 1024, 2, true, 'iPad'],
    [1024, 768, 1, false, 'laptop 1024'],
    [1440, 900, 2, false, 'MacBook 1440'],
    [1920, 1080, 1, false, 'FHD'],
    [2560, 1440, 1, false, 'QHD'],
  ]) {
    await page.setViewport({ width: w, height: h, dpr, mobile });
    await sleep(700);
    const r = await page.eval(`${HELPERS} return {
      docScroll: document.documentElement.scrollWidth, inner: innerWidth,
      hostScroll: host.scrollWidth, hostClient: host.clientWidth,
      layout: q('.flow-stage').dataset.layout,
      stage: Math.round(rect('.flow-stage').w),
      node: Math.round(rect('.node-solar').w),
      labelsOverlap: (() => {
        const ls = qa('.flow-label').map(e => e.getBoundingClientRect());
        for (let i=0;i<ls.length;i++) for (let j=i+1;j<ls.length;j++) {
          const a=ls[i], b=ls[j];
          if (a.right > b.left+1 && b.right > a.left+1 && a.bottom > b.top+1 && b.bottom > a.top+1) return true;
        }
        return false;
      })(),
      kpiCols: getComputedStyle(q('.kpi-row')).gridTemplateColumns.split(' ').length,
      textClipped: qa('.node-num, .kpi-num, .big-num').some(e => e.scrollWidth > e.clientWidth + 1),
    };`);
    const noOverflow = r.docScroll <= r.inner + 1 && r.hostScroll <= r.hostClient + 1;
    check(`${label} (${w}x${h}@${dpr}x): no horizontal scrolling`, noOverflow, `doc ${r.docScroll}/${r.inner}, host ${r.hostScroll}/${r.hostClient}`);
    check(`${label}: ${r.layout} diagram, ${r.node}px node, labels do not overlap`, !r.labelsOverlap && r.node > 40, `stage ${r.stage}px, KPI columns ${r.kpiCols}`);
    check(`${label}: numbers are not clipped`, !r.textClipped);
    if ([390, 768, 1920].includes(w)) await page.screenshot(`${SHOT}-w${w}.png`, { fullPage: w === 390 });
  }

  const winErrs = await page.windowErrors();
  check('no window errors after all the resizes', winErrs.length === 0, winErrs.join(' | ') || 'clean');

  /* ─────────────── 7a. scrolling: one finger, and the top bar stays ─────────────── */
  group('Scrolling (one finger) and the sticky top bar');
  await page.setViewport({ width: 390, height: 844, dpr: 3, mobile: true });
  await sleep(700);
  // Raw touch events rather than Input.synthesizeScrollGesture: the synthesized
  // gesture moved nothing at all in headless Chrome on Linux, while a touch
  // stream goes through the same gesture detection a real finger does.
  // Whichever element scrolls, the page has moved by the sum of the two.
  const swipe = async () => {
    await page.eval(`${HELPERS} host.scrollTop = 0; document.scrollingElement.scrollTop = 0; return 1;`);
    const finger = (y) => [{ x: 195, y, id: 1 }];
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: finger(600) });
    for (let y = 585; y >= 300; y -= 15) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: finger(y) });
      await sleep(16);
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(500);
    return page.eval(`${HELPERS} return {
      scrolled: Math.round(host.scrollTop + document.scrollingElement.scrollTop),
      bar: Math.round(rect('.topbar').top),
    };`);
  };
  const scrollChecks = (where, r) => {
    check(`${where}: a one-finger swipe scrolls the page`, r.scrolled > 100, `${r.scrolled}px`);
    check(`${where}: the top bar stays on screen`, r.bar >= -1 && r.bar <= 16, `top bar at ${r.bar}px after ${r.scrolled}px`);
  };
  scrollChecks('standalone', await swipe());

  // Home Assistant does not size a custom panel: its parent, <ha-panel-custom>,
  // is a block with height: auto, so the panel grows to its content and the
  // document is what scrolls. Reproduce that container here. A panel that is a
  // scroll container there has nothing to scroll: it swallowed a one-finger
  // swipe while it refused to chain the scroll (1.2.0), and it is the box the
  // sticky top bar sticks within, so the bar scrolled away with the page.
  await page.eval(`${HELPERS}
    const wrap = document.createElement('div');
    wrap.id = 'ha-like-parent';
    host.before(wrap); wrap.append(host);
    document.body.style.overflow = 'visible';
    return 1;`);
  await sleep(500);
  scrollChecks('inside Home Assistant', await swipe());
  await page.eval(`${HELPERS}
    const wrap = document.getElementById('ha-like-parent');
    wrap.before(host); wrap.remove();
    document.body.style.overflow = '';
    document.scrollingElement.scrollTop = 0;
    return 1;`);

  /* ─────────────── 7b. the settings dialog on a phone ─────────────── */
  group('Settings dialog on a phone (390 px)');
  // The dialog clips whatever does not fit (overflow: hidden), so a control
  // past its edge is not scrolled to — it is simply gone. Ukrainian labels are
  // the longer ones, and the status line after Auto-detect shares the footer.
  const dialogFits = async (label) => {
    const r = await page.eval(`${HELPERS}
      const panel = q('.modal-panel').getBoundingClientRect();
      const out = qa('.modal-head .tab-btn, .modal-head .icon-btn, .modal-foot .btn, .modal-foot .modal-status')
        .filter((e) => e.getBoundingClientRect().width > 0)
        .filter((e) => { const b = e.getBoundingClientRect(); return b.left < panel.left - 1 || b.right > panel.right + 1; })
        .map((e) => { const b = e.getBoundingClientRect(); return (e.textContent.trim() || e.getAttribute('aria-label')) + ' ' + Math.round(b.left) + '→' + Math.round(b.right); });
      return { out, panel: Math.round(panel.left) + '→' + Math.round(panel.right) };`);
    check(`${label}: every tab and button is inside the dialog`, r.out.length === 0, r.out.join(', ') || `dialog ${r.panel}`);
  };
  // The language button saves the whole configuration, entities included; the
  // onboarding group further down needs storage as it was, so it is put back.
  const storedConfig = await page.eval(`return localStorage.getItem('deye-dashboard:user-config:v1');`);
  for (const lang of ['EN', 'UA']) {
    if (lang === 'UA') {
      await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
      await poll(page, `q('.lang-btn').textContent.trim() === 'UA'`, 5000);
    }
    await page.eval(`${HELPERS} q('.topbar .settings-btn').click(); return 1;`);
    await poll(page, `!q('.modal').hidden`, 3000);
    await dialogFits(`${lang}, as opened`);
    await page.eval(`${HELPERS} qa('.modal-foot .btn')[0].click(); return 1;`);   // Auto-detect writes the status line
    await poll(page, `q('.modal-foot .modal-status').textContent.trim() !== ''`, 3000);
    await dialogFits(`${lang}, after Auto-detect`);
    await page.eval(`${HELPERS} q('.modal').querySelector('.modal-foot .btn:not(.btn-ghost):not(.btn-primary)').click(); return 1;`);   // Cancel
    await poll(page, `q('.modal').hidden`, 3000);
  }
  await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
  await poll(page, `q('.lang-btn').textContent.trim() === 'EN'`, 5000);
  await page.eval(`const before = ${JSON.stringify(storedConfig)};
    if (before === null) localStorage.removeItem('deye-dashboard:user-config:v1');
    else localStorage.setItem('deye-dashboard:user-config:v1', before);
    return 1;`);

  /* ─────────────── 8. extreme values ─────────────── */
  group('Extreme values and broken data');
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(400);
  await page.eval(`${HELPERS}
    clearInterval(app.client._timer);       // stop the simulation
    app.client._tick = () => {};
    app.client._set('sensor.deye_pv_power', 199999, 'W', 'power');
    app.client._set('sensor.deye_total_load_power', 123456, 'W', 'power');
    app.client._set('sensor.deye_battery_soc', 7, '%', 'battery');
    return 1;`);
  const rendered = await poll(page, `q('.node-solar .node-num').textContent.trim() === '200'`);
  check('injected values reached the DOM', rendered === true);
  const extreme = await page.eval(`${HELPERS}
    return {
      solar: txt('.node-solar .node-num') + ' ' + txt('.node-solar .node-unit'),
      house: txt('.node-house .node-num') + ' ' + txt('.node-house .node-unit'),
      band: q('.card-battery').dataset.band,
      clipped: qa('.node-num, .big-num, .kpi-num').some(e => e.scrollWidth > e.clientWidth + 1),
      battColor: getComputedStyle(q('.batt-fill')).fill,
    };`);
  check('huge values do not break the layout', !extreme.clipped, `PV ${extreme.solar}, house ${extreme.house}`);
  check('low SOC turns the battery critical', extreme.band === 'critical', `band=${extreme.band}, fill=${extreme.battColor}`);

  const partial = await page.eval(`${HELPERS}
    app.client._set('sensor.deye_pv_power', 'unavailable', '', '');
    await new Promise(r => setTimeout(r, 400));
    return { solar: txt('.node-solar .node-num'), strings: app.state.pv.strings.length };`);
  check('PV falls back to the string sum when the total sensor drops', partial.solar !== '—', `PV ${partial.solar} from ${partial.strings} strings`);

  await page.eval(`${HELPERS}
    for (const id of Object.keys(app.client.getStates())) app.client._set(id, 'unavailable', '', '');
    return 1;`);
  const wentDark = await poll(page, `q('.node-solar .node-num').textContent.trim() === '—' && q('.inv-status-text').textContent.trim() === 'OFFLINE'`);
  check('the no-data state is rendered', wentDark === true);
  const broken = await page.eval(`${HELPERS}
    return {
      solar: txt('.node-solar .node-num'), soc: txt('.node-battery .node-num'),
      status: txt('.inv-status-text'), invState: q('.node-inverter').dataset.state,
      dirs: qa('.flow-link').map(l => l.dataset.dir),
      notices: qa('.notice').length,
      cards: qa('.card').length,
    };`);
  check('unavailable becomes dashes without crashing', broken.solar === '—' && broken.soc === '—' && broken.cards >= 6, `PV=${broken.solar}, SOC=${broken.soc}`);
  check('inverter marked OFFLINE', broken.status === 'OFFLINE' && broken.invState === 'offline', `${broken.status}/${broken.invState}`);
  check('every flow goes idle', broken.dirs.every((d) => d === 'idle'), broken.dirs.join(','));
  await sleep(800);   // wait out the .5s fade-out transition
  const idleAnim = await page.eval(`${HELPERS}
    const cs = getComputedStyle(q('.link-grid .link-beads'));
    return { name: cs.animationName, op: +parseFloat(cs.opacity).toFixed(2), label: txt('.fl-grid .fl-value'),
             glow: +parseFloat(getComputedStyle(q('.link-grid .link-glow')).opacity).toFixed(2) };`);
  check('an idle flow neither animates nor shows', idleAnim.name === 'none' && idleAnim.op === 0,
    `anim=${idleAnim.name} opacity=${idleAnim.op} glow=${idleAnim.glow} label "${idleAnim.label}"`);
  check('console is still clean', page.errors.length === 0, page.errors.join(' | ') || 'clean');

  /* ─────────────── 9. connection state ─────────────── */
  group('Connection loss');
  const conn = await page.eval(`${HELPERS}
    app.renderer.setConnection('connecting');
    await new Promise(r => setTimeout(r, 200));
    const a = { text: txt('.status-text'), state: q('.status-chip').dataset.state };
    app.renderer.setConnection('disconnected');
    await new Promise(r => setTimeout(r, 200));
    const b = { text: txt('.status-text'), state: q('.status-chip').dataset.state };
    app.renderer.setConnection('connected');
    await new Promise(r => setTimeout(r, 200));
    const c = { text: txt('.status-text'), state: q('.status-chip').dataset.state };
    return { a, b, c };`);
  check('RECONNECTING on a drop', /RECONNECT/.test(conn.a.text) && conn.a.state === 'warn', JSON.stringify(conn.a));
  check('DISCONNECTED when the socket dies', conn.b.text === 'DISCONNECTED' && conn.b.state === 'bad', JSON.stringify(conn.b));
  check('ONLINE after recovery', conn.c.text === 'ONLINE' && conn.c.state === 'ok', JSON.stringify(conn.c));

  /* ─────────────── 10. onboarding ─────────────── */
  group('Onboarding with no entities mapped');
  const savesBefore = await page.eval(`return (window.__saves || []).map(s => s.key);`);
  if (process.env.DEYE_VERBOSE) console.log('    localStorage writes:', savesBefore.join(', ') || 'none');
  await page.goto(`${BASE}?demo=1&hour=13.5&deye_noauto=1`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  const onb = await page.eval(`${HELPERS} return {
    visible: !q('.onboard').hidden,
    buttons: qa('.onboard-actions .btn').map(b => b.textContent.trim()),
    dashes: qa('.node-num').filter(e => e.textContent.trim() === '—').length,
    diag: { search: location.search, noauto: app.flags.noauto, mapped: Object.values(app.config.entities).filter(Boolean).length,
            ls: Object.keys(localStorage), nodes: qa('.node-num').map(e => e.textContent.trim()) },
  };`);
  if (!onb.visible) {
    console.log('    diagnostics:', JSON.stringify(onb.diag));
    const saves = await page.eval(`return (window.__saves||[]).filter(s => s.key.includes('user-config'));`);
    for (const sv of saves) console.log('    CONFIG WRITE:', sv.stack);
  }
  check('onboarding shown', onb.visible && onb.buttons.length === 3, onb.buttons.join(' / '));
  check('the dashboard behind it renders dashes', onb.dashes >= 3, `dashes ${onb.dashes}`);

  const autodetect = await page.eval(`${HELPERS}
    qa('.onboard-actions .btn')[0].click();
    await new Promise(r => setTimeout(r, 900));
    return {
      hidden: q('.onboard').hidden,
      solar: txt('.node-solar .node-num'),
      mapped: Object.values(app.config.entities).filter(Boolean).length,
      pv: app.config.entities.pvPower, soc: app.config.entities.batterySoc,
      grid: app.config.entities.gridPower, load: app.config.entities.loadPower,
    };`);
  check('"Detect automatically" finds the entities', autodetect.hidden && autodetect.mapped >= 20, `mapped ${autodetect.mapped}`);
  check('key roles resolved correctly', autodetect.pv === 'sensor.deye_pv_power' && autodetect.soc === 'sensor.deye_battery_soc'
    && autodetect.grid === 'sensor.deye_total_grid_power' && autodetect.load === 'sensor.deye_total_load_power',
    `${autodetect.pv}, ${autodetect.soc}, ${autodetect.grid}, ${autodetect.load}`);
  check('values appeared', autodetect.solar !== '—', `PV ${autodetect.solar}`);

  /* ─────────────── 11. polarity detection ─────────────── */
  group('Polarity auto-detection (demo reports "+ = discharge")');
  await page.goto(`${BASE}?demo=1&hour=13.5`);
  await sleep(2600);
  const signs = await page.eval(`${HELPERS} return {
    battery: app.model.batterySign, source: app.model.batteryLearner.source,
    conf: Math.round(app.model.batteryLearner.confidence * 100),
    grid: app.model.gridSign,
    raw: app.entityManager.values.batteryPower.rawState,
    model: app.state.battery.power, charging: app.state.battery.charging,
    balance: app.state.meta.balance,
    uiPower: txt('.batt-power-num'), uiMode: txt('.batt-mode'),
  };`);
  check('battery polarity resolved to discharge_positive', signs.battery === 'discharge_positive', `${signs.battery} (${signs.source}, ${signs.conf}%)`);
  const consistent = (Number(signs.raw) < 0) === signs.charging;
  check('model sign agrees with the raw value', consistent, `raw=${signs.raw} -> model ${signs.model?.toFixed?.(2)} kW, charging=${signs.charging}`);
  check('UI shows the correct mode', /CHARG|DISCHARG|IDLE|ЗАРЯД|РОЗРЯД|СПОКІЙ/.test(signs.uiMode || ''), `${signs.uiPower} / ${signs.uiMode}`);
  check('power balance adds up', Math.abs(signs.balance || 0) < 0.05, `delta=${(signs.balance ?? NaN).toFixed?.(3)} kW`);

  const noBalanceNotice = await page.eval(`${HELPERS} return qa('.notice').map(n => n.className);`);
  check('no balance warning', !noBalanceNotice.some((c) => /balance/.test(c)), `notices ${noBalanceNotice.join(' ')}`);

  /* ─────────────── 12. language switching ─────────────── */
  group('Language switching (English / Ukrainian)');
  const langBefore = await page.eval(`${HELPERS} return {
    code: q('.lang-btn').textContent.trim(),
    coverage: txt('.flow-footer .section-label'),
    battery: txt('.card-battery .card-title-text'),
    kpi: txt('.kpi .kpi-label'),
    range: qa('.range-btn').map(b => b.textContent.trim()),
    lang: app.config.language,
  };`);
  check('starts in English', langBefore.code === 'EN' && langBefore.coverage === 'Load coverage',
    `${langBefore.battery} / ${langBefore.kpi} / ${langBefore.range.join(' ')}`);

  await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
  await poll(page, `q('.lang-btn').textContent.trim() === 'UA'`, 5000);
  const langUk = await page.eval(`${HELPERS} return {
    code: q('.lang-btn').textContent.trim(),
    coverage: txt('.flow-footer .section-label'),
    battery: txt('.card-battery .card-title-text'),
    kpi: txt('.kpi .kpi-label'),
    node: txt('.node-solar .node-label'),
    mode: txt('.batt-mode'),
    lang: app.config.language,
    stored: JSON.parse(localStorage.getItem('deye-dashboard:user-config:v1') || '{}').language,
    cards: qa('.card').length,
    lines: qa('.card-chart path.chart-line').length,
    latin: /[A-Za-z]/.test(txt('.flow-footer .section-label')),
  };`);
  check('switches to Ukrainian', langUk.code === 'UA' && !langUk.latin,
    `${langUk.coverage} / ${langUk.battery} / ${langUk.kpi} / ${langUk.node}`);
  check('choice is persisted', langUk.lang === 'uk' && langUk.stored === 'uk', `config=${langUk.lang}, localStorage=${langUk.stored}`);
  check('remount keeps the dashboard intact', langUk.cards >= 6 && langUk.lines >= 3,
    `cards ${langUk.cards}, chart lines ${langUk.lines}`);
  const ukExtra = await page.eval(`${HELPERS} return {
    status: q('.status-chip').dataset.state, statusText: txt('.status-text'),
    kpiUnit: txt('.kpi .kpi-unit'), chartUnit: txt('.card-chart .axis-unit'),
    nodeUnit: txt('.node-solar .node-unit'), voltage: txt('.card-battery .stat-value'),
  };`);
  check('connection state survives the remount', ukExtra.status === 'ok', `${ukExtra.statusText} (${ukExtra.status})`);
  check('units are localised too', /кВт|Вт/.test(ukExtra.kpiUnit + ukExtra.chartUnit + ukExtra.nodeUnit),
    `KPI ${ukExtra.kpiUnit}, axis ${ukExtra.chartUnit}, node ${ukExtra.nodeUnit}, battery ${ukExtra.voltage}`);

  const ukSettings = await page.eval(`${HELPERS}
    q('.topbar .settings-btn').click();
    await new Promise(r => setTimeout(r, 500));
    const tabs = qa('.modal .tab-btn').map(b => b.textContent.trim());
    q('.modal .tab-btn[data-tab="options"]').click();
    await new Promise(r => setTimeout(r, 300));
    const labels = qa('.modal .field-label').map(l => l.textContent.trim()).filter(Boolean);
    const langSelect = qa('.modal select').map(sl => [...sl.options].map(o => o.textContent.trim()));
    q('.modal .modal-head .icon-btn').click();
    return { tabs, labels: labels.slice(0, 6), hasLanguageOption: langSelect.some(o => o.includes('Українська')) };`);
  check('settings dialog is translated', ukSettings.tabs.every((x) => !/^[A-Za-z ]+$/.test(x) || x === 'Entity'),
    ukSettings.tabs.join(' / '));
  check('language selector lists both languages', ukSettings.hasLanguageOption, ukSettings.labels.join(' | ').slice(0, 110));

  await page.screenshot(`${SHOT}-uk.png`);
  await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
  await poll(page, `q('.lang-btn').textContent.trim() === 'EN'`, 5000);
  const backEn = await page.eval(`${HELPERS} return { code: q('.lang-btn').textContent.trim(), coverage: txt('.flow-footer .section-label'), errors: (window.__winErrors||[]).length };`);
  check('switches back to English', backEn.code === 'EN' && backEn.coverage === 'Load coverage', backEn.coverage);
  check('switching produced no window errors', backEn.errors === 0, `errors ${backEn.errors}`);

  /* ─────────────── 13. generator ─────────────── */
  group('Generator (demo runs it 19:00-21:00)');
  await page.goto(`${BASE}?demo=1&hour=20`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);
  const gen = await page.eval(`${HELPERS} return {
    layout: q('.flow-stage').dataset.layout,
    nodeVisible: !q('.node-generator').hidden,
    nodeValue: txt('.node-generator .node-num') + ' ' + txt('.node-generator .node-unit'),
    linkDir: q('.link-generator').dataset.dir,
    linkAnim: getComputedStyle(q('.link-generator .link-beads')).animationName,
    cardVisible: !q('.card-generator').hidden,
    cardPower: txt('.card-generator .big-num'),
    cardBadge: txt('.card-generator .dir-badge'),
    kpiVisible: !q('.kpi[data-key="generator"]').hidden,
    kpiValue: txt('.kpi[data-key="generator"] .kpi-num'),
    mixSegments: qa('.mix-seg:not(.is-zero)').length,
    mixLegend: qa('.mix-item').map(e => e.textContent.trim()),
    alloc: qa('.alloc-chip').map(e => e.textContent.trim()),
    balance: app.state.meta.balance,
    relevant: app.state.generator.relevant,
    links: qa('.flow-link:not([hidden])').length,
  };`);
  check('five-spoke layout with the generator',
    gen.layout === 'wideGen' && gen.nodeVisible && gen.relevant === true && gen.links === 5,
    `layout=${gen.layout}, node ${gen.nodeValue}, links ${gen.links}`);
  check('generator link animates towards the inverter', gen.linkDir === 'toHub' && gen.linkAnim === 'bead-run',
    `${gen.linkDir}, ${gen.linkAnim}`);
  check('generator card and KPI appear', gen.cardVisible && gen.kpiVisible,
    `card ${gen.cardPower} (${gen.cardBadge}), KPI ${gen.kpiValue}`);
  check('generator is a source in the coverage mix', gen.mixLegend.some((l) => /Generator/.test(l)),
    gen.mixLegend.join(' / '));
  check('distribution names the generator', gen.alloc.some((a) => /Generator/.test(a)), gen.alloc.join(' | '));
  // Exporting while the generator runs and the battery charges: the export has
  // to be attributed to the generator, never to the battery it is filling.
  const genAlloc = await page.eval(`${HELPERS} return {
    alloc: app.flow.alloc, charging: app.state.battery.charging,
    exportKw: app.state.grid.power < 0 ? -app.state.grid.power : 0 };`);
  const attributed = (genAlloc.alloc.generatorToGrid || 0) + (genAlloc.alloc.pvToGrid || 0) + (genAlloc.alloc.batteryToGrid || 0);
  check('the export is attributed to the generator, not to a charging battery',
    genAlloc.exportKw > 0.1 && Math.abs(attributed - genAlloc.exportKw) < 0.05
      && (!genAlloc.charging || !genAlloc.alloc.batteryToGrid),
    `export ${genAlloc.exportKw.toFixed(2)} kW = gen ${(genAlloc.alloc.generatorToGrid || 0).toFixed(2)} + pv ${(genAlloc.alloc.pvToGrid || 0).toFixed(2)} + batt ${(genAlloc.alloc.batteryToGrid || 0).toFixed(2)}`);
  check('balance still closes with the generator running', Math.abs(gen.balance) < 0.05,
    `delta=${gen.balance.toFixed(4)} kW`);
  // Whether the chart draws it is decided by the period's own history, not by
  // the live state: see "yesterday's generator run" and "the inverter's early
  // reset" below. The demo's history ends at the real clock, not at ?hour=.

  const genGeo = await page.eval(`${HELPERS}
    const hub = rect('.node-inverter .inv-body');
    const out = {};
    for (const key of ['solar', 'generator', 'grid', 'battery', 'load']) {
      const sel = { solar: '.node-solar', generator: '.node-generator', grid: '.node-grid', battery: '.node-battery', load: '.node-house' }[key];
      const beads = q('.link-' + key + ' .link-beads');
      const [a, b] = endpoints(beads);
      const nr = rect(sel + ' .node-body');
      const r = Math.min(nr.w, nr.h) / 2;
      out[key] = { node: +Math.abs(Math.hypot(a.x - nr.cx, a.y - nr.cy) - r).toFixed(1), hub: +distToRect(b, hub).toFixed(1) };
    }
    return out;`);
  for (const key of ['solar', 'generator', 'grid', 'battery', 'load']) {
    const g = genGeo[key];
    check(`wideGen link ${key}: endpoints at the node edges`, g.node < 14 && g.hub < 14, `node ${g.node}px, inverter ${g.hub}px`);
  }
  await page.screenshot(`${SHOT}-generator.png`);

  await page.setViewport({ width: 390, height: 844, dpr: 3, mobile: true });
  // The layout switch happens in an animation frame, which a preceding
  // screenshot can delay — wait for the result instead of guessing a delay.
  await poll(page, `q('.flow-stage').dataset.layout === 'narrowGen'`, 6000);
  const genNarrow = await page.eval(`${HELPERS} return {
    diag: { inner: innerWidth, stageW: q('.flow-stage').clientWidth, hasGen: app.renderer._hasGenerator },
    layout: q('.flow-stage').dataset.layout,
    overflow: document.documentElement.scrollWidth <= innerWidth + 1 && host.scrollWidth <= host.clientWidth + 1,
    labelsOverlap: (() => {
      const ls = qa('.flow-label:not([hidden])').map(e => e.getBoundingClientRect());
      for (let i=0;i<ls.length;i++) for (let j=i+1;j<ls.length;j++) {
        const a=ls[i], b=ls[j];
        if (a.right > b.left+1 && b.right > a.left+1 && a.bottom > b.top+1 && b.bottom > a.top+1) return true;
      }
      return false;
    })(),
  };`);
  check('narrow layout with the generator fits', genNarrow.layout === 'narrowGen' && genNarrow.overflow && !genNarrow.labelsOverlap,
    `layout=${genNarrow.layout}, no overflow=${genNarrow.overflow}, labels ok=${!genNarrow.labelsOverlap}, diag=${JSON.stringify(genNarrow.diag)}`);

  // The narrow paths have their own coordinates, so they need their own
  // measurement: a wide-layout pass proves nothing about them.
  const narrowGeo = await page.eval(`${HELPERS}
    const hub = rect('.node-inverter .inv-body');
    const out = {};
    for (const key of ['solar', 'generator', 'grid', 'battery', 'load']) {
      const sel = { solar: '.node-solar', generator: '.node-generator', grid: '.node-grid', battery: '.node-battery', load: '.node-house' }[key];
      const beads = q('.link-' + key + ' .link-beads');
      const [a, b] = endpoints(beads);
      const nr = rect(sel + ' .node-body');
      const r = Math.min(nr.w, nr.h) / 2;
      out[key] = { node: +Math.abs(Math.hypot(a.x - nr.cx, a.y - nr.cy) - r).toFixed(1), hub: +distToRect(b, hub).toFixed(1) };
    }
    return out;`);
  for (const key of ['solar', 'generator', 'grid', 'battery', 'load']) {
    const g = narrowGeo[key];
    check(`narrowGen link ${key}: endpoints at the node edges`, g.node < 14 && g.hub < 14, `node ${g.node}px, inverter ${g.hub}px`);
  }
  await page.screenshot(`${SHOT}-generator-narrow.png`);
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(900);

  /* ─────────────── 13a. a mapping saved before a role existed ─────────────── */
  group('A mapping saved before the generator roles existed');
  // Roles added by a later version are absent from a mapping an older one
  // saved. Start-up detection used to run only when nothing at all was mapped,
  // so such a browser never got the generator: its kilowatts were missing from
  // the diagram and a power-balance warning appeared instead.
  const storedBeforeLegacy = await page.eval(`return localStorage.getItem('deye-dashboard:user-config:v1');`);
  const reloadWith = async (shapeEntities) => {
    await page.eval(`${HELPERS}
      const entities = { ...app.config.entities };
      (${shapeEntities})(entities);
      localStorage.setItem('deye-dashboard:user-config:v1', JSON.stringify({ entities }));
      return 1;`);
    await page.goto(`${BASE}?demo=1&hour=20`);
    await poll(page, `!!host.app && host.app._readyDone`, 8000);
    await sleep(1500);
    return page.eval(`${HELPERS} return {
      power: app.config.entities.generatorPower,
      nodeVisible: !q('.node-generator').hidden,
      balance: app.state.meta.balance,
    };`);
  };
  const legacy = await reloadWith(`(e) => { for (const k of Object.keys(e)) if (k.startsWith('generator')) delete e[k]; }`);
  check('a role the saved mapping never had is detected at start-up', !!legacy.power && legacy.nodeVisible,
    `generatorPower=${legacy.power}, node visible=${legacy.nodeVisible}`);
  check('with it the power balance closes', legacy.balance !== null && Math.abs(legacy.balance) < 0.5,
    `balance ${legacy.balance === null ? 'none' : legacy.balance.toFixed(2) + ' kW'}`);
  const cleared = await reloadWith(`(e) => { e.generatorPower = null; }`);
  check('a role the user cleared stays cleared', cleared.power === null, `generatorPower=${cleared.power}`);
  await page.eval(`const before = ${JSON.stringify(storedBeforeLegacy)};
    if (before === null) localStorage.removeItem('deye-dashboard:user-config:v1');
    else localStorage.setItem('deye-dashboard:user-config:v1', before);
    return 1;`);
  await page.goto(`${BASE}?demo=1&hour=20`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);

  /* ─────────────── 13b. time on battery, and a generator that stopped ─────────────── */
  group('Time on battery and the solar forecast; the generator after it stopped');
  // 22:00: the demo generator ran 19:00-21:00 and is off, the sun is down, the
  // battery carries the house. The demo inverter cuts the battery off at 10 %.
  await page.goto(`${BASE}?demo=1&hour=22`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);
  const night = await page.eval(`${HELPERS}
    const b = app.state.battery;
    const row = (k) => { const r = app.renderer.r.battery.rows[k]; return r ? { shown: !r.node.hidden, text: r.value.textContent.trim() } : null; };
    return {
      soc: b.soc, capacity: b.capacity, runtime: b.runtime, forecast: b.forecast, load: app.state.load.power,
      onBattery: row('runtime'), withForecast: row('forecast'), eta: row('eta'),
      genNode: !q('.node-generator').hidden, genCard: !q('.card-generator').hidden, layout: q('.flow-stage').dataset.layout,
      genKpi: !q('.kpi[data-key="generator"]').hidden, genKpiValue: txt('.kpi[data-key="generator"] .kpi-num'),
    };`);
  const expectHours = night.runtime ? (night.capacity * (night.soc - 10) / 100) / night.runtime.loadKw : null;
  check("time on battery is counted to the 10 % cut-off at the house's consumption",
    !!night.runtime && night.runtime.reservePct === 10 && Math.abs(night.runtime.hours - expectHours) < 0.01,
    night.runtime ? `${night.runtime.hours.toFixed(2)} h = ${night.capacity} kWh × (${night.soc.toFixed(1)} − 10) % / ${night.runtime.loadKw.toFixed(2)} kW` : 'no runtime');
  check('and the battery card says so', night.onBattery && night.onBattery.shown && /^≈ .+\(to 10 %\)$/.test(night.onBattery.text),
    night.onBattery ? night.onBattery.text : 'no row');
  check('the solar forecast gives a cut-off time or a lowest point',
    !!night.forecast && night.withForecast && night.withForecast.shown && /^(down to 10 %|lasts — lowest ≈ \d+ %) .*\d\d:\d\d$/.test(night.withForecast.text),
    night.withForecast ? night.withForecast.text : 'no row');
  check('time to full is not shown while discharging', night.eta && !night.eta.shown, night.eta ? night.eta.text : 'no row');
  // The demo pins its clock with ?hour=; the forecast has to run on that clock,
  // not on the machine's — else 22:00's battery is driven through the real
  // afternoon's sun.
  const clock = await page.eval(`${HELPERS}
    let mod;
    try { mod = await import(new URL('js/battery-runtime.js', location.href)); }
    catch (e) { mod = await import(new URL('battery-runtime.js', location.href)); }
    const b = app.state.battery, v = app.entityManager.values;
    const expected = mod.forecastRuntime({ now: app.client.now(), socPct: b.soc, capacityKwh: b.capacity,
      reservePct: b.runtime.reservePct, loadKw: b.runtime.loadKw, slots: mod.mergeSlots(v.pvForecastToday.forecast, v.pvForecastTomorrow.forecast) });
    return { got: JSON.stringify(b.forecast), expected: JSON.stringify(expected), pinned: new Date(app.client.now()).toTimeString().slice(0, 5) };`);
  check("the forecast runs on the demo's clock", clock.got === clock.expected, `pinned ${clock.pinned}: ${clock.got}`);
  check('a generator that stopped leaves the diagram and its card', !night.genNode && !night.genCard && !/Gen$/.test(night.layout),
    `node ${night.genNode}, card ${night.genCard}, layout ${night.layout}`);
  check("but its tile keeps the day's energy", night.genKpi && parseFloat(night.genKpiValue) > 0, `tile ${night.genKpi}, ${night.genKpiValue}`);

  // The forecast line is a sentence, and the Ukrainian one is long: on a phone
  // it has to wrap inside the card, not widen the page.
  const storedBeforeLang = await page.eval(`return localStorage.getItem('deye-dashboard:user-config:v1');`);
  await page.setViewport({ width: 390, height: 844, dpr: 3, mobile: true });
  await sleep(700);
  await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
  await poll(page, `q('.lang-btn').textContent.trim() === 'UA'`, 5000);
  await sleep(500);
  const phoneUk = await page.eval(`${HELPERS}
    const v = app.renderer.r.battery.rows.forecast.value.getBoundingClientRect();
    const c = q('.card-battery').getBoundingClientRect();
    return { doc: document.documentElement.scrollWidth, inner: innerWidth, value: Math.round(v.right), card: Math.round(c.right),
      text: app.renderer.r.battery.rows.forecast.value.textContent.trim() };`);
  check('on a phone the Ukrainian forecast line wraps inside the card',
    phoneUk.doc <= phoneUk.inner + 1 && phoneUk.value <= phoneUk.card,
    `page ${phoneUk.doc}/${phoneUk.inner} px, line ends at ${phoneUk.value} of ${phoneUk.card}: ${phoneUk.text}`);
  await page.eval(`${HELPERS} q('.lang-btn').click(); return 1;`);
  await poll(page, `q('.lang-btn').textContent.trim() === 'EN'`, 5000);
  await page.eval(`const before = ${JSON.stringify(storedBeforeLang)};
    if (before === null) localStorage.removeItem('deye-dashboard:user-config:v1');
    else localStorage.setItem('deye-dashboard:user-config:v1', before);
    return 1;`);
  await page.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(500);

  // At the cut-off there is nothing left to count down.
  await page.goto(`${BASE}?demo=1&hour=22`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);
  const cutoff = await page.eval(`${HELPERS}
    clearInterval(app.client._timer); app.client._tick = () => {};
    app.client._set('sensor.deye_battery_soc', 8, '%', 'battery', 'Deye battery SOC', 'measurement');
    await new Promise((r) => setTimeout(r, 500));
    const rows = app.renderer.r.battery.rows;
    return { runtime: rows.runtime.value.textContent.trim(), forecastShown: !rows.forecast.node.hidden };`);
  check('at the cut-off the card says so and drops the forecast', /^at the cut-off \(10 %\)$/.test(cutoff.runtime) && !cutoff.forecastShown,
    `${cutoff.runtime}, forecast shown: ${cutoff.forecastShown}`);

  // An inverter whose clock runs an hour ahead zeroes its daily counters at
  // 23:00. The generator that ran earlier today must stay on today's chart and
  // tile: the period's history and statistics still hold it. The demo serves
  // today's history up to the real clock, whatever ?hour= says, so the run is
  // placed in the first minute of the day, where every clock has it.
  const reset = await page.eval(`${HELPERS}
    // The demo's tick would write its own counter back over the reset.
    clearInterval(app.client._timer); app.client._tick = () => {};
    const t0 = new Date().setHours(0, 0, 0, 0);
    const callWS = app.client.callWS.bind(app.client);
    app.client.callWS = async (msg) => {
      const r = await callWS(msg);
      const power = 'sensor.deye_generator_power', today = 'sensor.deye_generator_energy_today';
      if (msg.type === 'history/history_during_period' && r[power]) {
        r[power] = [{ s: '6000', lu: t0 / 1000 }, { s: '0', lu: t0 / 1000 + 20 }];
      }
      if (msg.type === 'recorder/statistics_during_period' && r[today]) {
        r[today] = [{ start: t0, end: t0 + 3600000, change: 10.1 }];
      }
      return r;
    };
    app.client._set('sensor.deye_generator_energy_today', 0, 'kWh', 'energy', 'Deye generator energy today', 'total_increasing');
    // A reload within the same minute would be answered from the history cache;
    // applying the configuration clears it, as saving the settings does.
    app.applyConfig(app.config);
    const t1 = Date.now();
    while ((app._periodBusy || app._periodQueued) && Date.now() - t1 < 8000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 300));
    return {
      today: app.state.generator.today,
      chart: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()),
      tile: !q('.kpi[data-key="generator"]').hidden, tileValue: txt('.kpi[data-key="generator"] .kpi-num'),
    };`);
  check("after the inverter's early reset the generator is still on today's chart",
    reset.today === 0 && reset.chart.some((l) => /Generator/.test(l)), `counter ${reset.today}; ${reset.chart.join(' / ')}`);
  check("and its tile keeps the day's energy from the statistics", reset.tile && parseFloat(reset.tileValue) > 0,
    `tile ${reset.tile}, ${reset.tileValue}`);

  // 10:00: the demo battery is half full and charging at about 6 kW (by 13:30
  // it is full and the charge has tapered to nothing).
  await page.goto(`${BASE}?demo=1&hour=10`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);
  const noon = await page.eval(`${HELPERS}
    const r = app.renderer.r.battery.rows.eta;
    return { charging: app.state.battery.charging, shown: !r.node.hidden, label: r.label.textContent.trim(), text: r.value.textContent.trim() };`);
  check('while charging, time to full is shown', noon.charging && noon.shown && /full/i.test(noon.label), `${noon.label}: ${noon.text}`);
  await page.goto(`${BASE}?demo=1&hour=20`);
  await poll(page, `!!host.app && host.app._readyDone`, 8000);
  await sleep(1500);

  /* ─────────────── 14. sensor dialog ─────────────── */
  group('Sensor dialog');
  // Click and read are separate protocol calls, and the waiting between them
  // happens here rather than inside a single long evaluation: a page that stalls
  // mid-evaluation takes the whole run down with it, whereas poll() re-enters the
  // page in short bounded steps.
  const readDialog = () => page.eval(`${HELPERS} return {
      open: !q('.detail-modal').hidden,
      title: txt('.detail-modal .modal-title'),
      entity: txt('.detail-entity'),
      lines: qa('.detail-modal path.chart-line').length,
      bars: qa('.detail-modal rect.chart-bar').length,
      bands: qa('.detail-modal path[fill-opacity="0.16"]').length,
      stats: qa('.detail-stat').map(e => e.textContent.trim()),
      link: q('.detail-link') ? q('.detail-link').getAttribute('href') : null,
      empty: !q('.detail-empty').hidden,
      ranges: qa('.detail-modal .range-btn').length,
      empty: !q('.detail-modal .detail-empty').hidden,
      emptyText: txt('.detail-modal .detail-empty'),
    };`);
  const dialogSettled = `!q('.detail-modal').hidden && q('.detail-modal .spinner').hidden`;
  const openDialog = async (selector) => {
    await page.eval(`${HELPERS} q('${selector}').click(); return 1;`);
    await poll(page, dialogSettled, 9000);
    return readDialog();
  };
  const dialogRange = async (key) => {
    await page.eval(`${HELPERS} q('.detail-modal [data-range="${key}"]').click(); return 1;`);
    await sleep(150);                       // let the click start the request
    await poll(page, dialogSettled, 9000);
    return readDialog();
  };
  const closeDialog = () => page.eval(`${HELPERS} q('.detail-modal .modal-head .icon-btn').click(); return 1;`);

  const rowDlg = await openDialog('.card-inverter .stat-row[data-role="inverterTemperature"]');
  check('a stat row opens its sensor', rowDlg.open && rowDlg.lines >= 1,
    `${rowDlg.title} / ${rowDlg.entity}, lines ${rowDlg.lines}`);
  check('dialog shows min/avg/max and a link to Home Assistant',
    rowDlg.stats.length === 3 && /history\?entity_id=/.test(rowDlg.link || ''), rowDlg.stats.join(' | '));

  const band = await dialogRange('month');
  check('over a month an instantaneous sensor gets a mean line with a min-max band',
    band.bands === 1 && band.lines === 1, `bands ${band.bands}, lines ${band.lines}, ${band.stats.join(' | ')}`);
  await page.screenshot(`${SHOT}-dialog.png`);
  await closeDialog();
  await sleep(400);

  const kpiDlg = await openDialog('.kpi[data-key="solar"]');
  // Over a day an accumulating counter is a rising line; bars appear for longer
  // periods. The footer must show the span the counter covered, never the sum of
  // its samples — for a rising counter that means total equals max, and summing
  // instead would produce a number hundreds of times larger.
  const kpiNums = kpiDlg.stats.map((x) => parseFloat(x.replace(/[^\d.]+/g, '')));
  check('a KPI tile opens the energy sensor',
    kpiDlg.open && kpiDlg.lines === 1 && kpiDlg.stats.length === 2
      && Number.isFinite(kpiNums[0]) && Math.abs(kpiNums[0] - kpiNums[1]) < 0.02,
    `${kpiDlg.title}, lines ${kpiDlg.lines}, ${kpiDlg.stats.join(' | ')}`);
  const kpiMonth = await dialogRange('month');
  check('over a month the energy sensor becomes bars', kpiMonth.bars > 0, `bars ${kpiMonth.bars}, ${kpiMonth.stats.join(' | ')}`);
  await closeDialog();
  await sleep(300);

  const nodeDlg = await openDialog('.node-battery');
  check('a diagram node opens its sensor', nodeDlg.open && (nodeDlg.lines > 0 || nodeDlg.bars > 0),
    `${nodeDlg.title} / ${nodeDlg.entity}`);
  const escaped = await page.eval(`${HELPERS}
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await new Promise(r => setTimeout(r, 300));
    return q('.detail-modal').hidden;`);
  check('Escape closes the dialog', escaped === true);

  const notClickable = await page.eval(`${HELPERS}
    const rows = qa('.stat-row[data-role]');
    const off = rows.filter(r => r.getAttribute('aria-disabled') === 'true');
    const on = rows.filter(r => r.classList.contains('is-clickable'));
    const first = on[0];
    return { total: rows.length, off: off.length, on: on.length,
             offRole: off.length ? off[0].dataset.role : null,
             role: first ? first.getAttribute('role') : null,
             tabindex: first ? first.getAttribute('tabindex') : null,
             cursor: first ? getComputedStyle(first).cursor : null };`);
  check('rows without a mapped entity are not interactive',
    notClickable.on > 0 && notClickable.off > 0 && notClickable.offRole !== null
      && notClickable.on + notClickable.off === notClickable.total,
    `${notClickable.on} of ${notClickable.total} clickable, ${notClickable.off} disabled${notClickable.offRole ? ` (e.g. ${notClickable.offRole})` : ''}`);
  check('a clickable row is reachable and labelled for a screen reader',
    notClickable.role === 'button' && notClickable.tabindex === '0' && notClickable.cursor === 'pointer',
    `role=${notClickable.role}, tabindex=${notClickable.tabindex}, cursor=${notClickable.cursor}`);

  // Enter and Space must open the dialog: the rows advertise role="button".
  await page.eval(`${HELPERS}
    const row = qa('.stat-row[data-role].is-clickable')[0];
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 1;`);
  await poll(page, dialogSettled, 9000);
  const keyDlg = await readDialog();
  check('Enter opens the dialog from a focused row', keyDlg.open && !!keyDlg.entity, `${keyDlg.title} / ${keyDlg.entity}`);
  await closeDialog();
  await sleep(250);
  await page.eval(`${HELPERS}
    const row = qa('.stat-row[data-role].is-clickable')[0];
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    return 1;`);
  await poll(page, dialogSettled, 9000);
  const spaceDlg = await readDialog();
  check('Space opens it too', spaceDlg.open === true);
  await closeDialog();
  await sleep(250);

  // Rows built during an update, not at mount: they used to miss the treatment.
  const stringDlg = await openDialog('.string-row[data-role]');
  check('a PV string row opens its own sensor', stringDlg.open && /pv/i.test(stringDlg.entity || ''),
    `${stringDlg.title} / ${stringDlg.entity}`);
  await closeDialog();
  await sleep(250);
  const phaseDlg = await openDialog('.phase-row[data-role]');
  check('a phase row opens its own sensor', phaseDlg.open && !!phaseDlg.entity,
    `${phaseDlg.title} / ${phaseDlg.entity}`);
  await closeDialog();
  await sleep(250);

  // sensor.deye_battery_soh declares no state_class, so Recorder keeps no
  // statistics for it — the dialog must say that rather than draw nothing.
  await openDialog('.card-battery [data-role="batterySoh"]');
  const noStats = await dialogRange('month');
  check('a sensor without statistics explains itself',
    noStats.empty && /no recorded history/i.test(noStats.emptyText || '')
      && /state_class/i.test(noStats.emptyText || '') && noStats.lines === 0,
    `empty=${noStats.empty}, "${(noStats.emptyText || '').slice(0, 90)}"`);
  await closeDialog();
  await sleep(250);

  /* ─────────────── 15. animation setting ─────────────── */
  group('Flow animation setting');
  const animState = () => page.eval(`${HELPERS}
    const cs = getComputedStyle(q('.link-solar .link-beads'));
    return { attr: q('.app').dataset.anim, name: cs.animationName, dur: cs.animationDuration };`);
  const setAnim = async (mode) => {
    await page.eval(`${HELPERS} app.applyConfig({ ...app.config, animations: '${mode}' }, false); return 1;`);
    await sleep(700);
  };
  await setAnim('off');
  let a = await animState();
  check('off disables the animation', a.attr === 'off' && parseFloat(a.dur) < 0.01, `${a.attr}, ${a.dur}`);
  await setAnim('auto');
  a = await animState();
  check('auto animates when the system does not object', a.attr === 'auto' && parseFloat(a.dur) > 0.4, `${a.attr}, ${a.dur}`);

  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(400);
  a = await animState();
  check('auto respects the system reduce-motion setting', parseFloat(a.dur) < 0.01, `${a.attr}, ${a.dur}`);
  await setAnim('on');
  a = await animState();
  check('on animates even under reduce-motion', a.attr === 'on' && parseFloat(a.dur) > 0.4, `${a.attr}, ${a.dur}`);
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  await setAnim('auto');

  /* ─────────────── 16. accessibility ─────────────── */
  group('Accessibility');
  const a11y = await page.eval(`${HELPERS} return {
    iconBtns: qa('.icon-btn').length,
    labeled: qa('.icon-btn[aria-label]').length,
    periodOptions: q('.topbar .nav-range-select').options.length,
    periodLabelled: !!q('.topbar .nav-range-select').getAttribute('aria-label'),
    svgHidden: qa('svg[aria-hidden="true"]').length,
    contrastVars: getComputedStyle(host).getPropertyValue('--text-0').trim(),
    focusVisible: (() => { const b = q('.topbar .nav-label'); b.focus(); return sr.activeElement === b; })(),
  };`);
  check('icon buttons carry an aria-label', a11y.labeled === a11y.iconBtns, `${a11y.labeled}/${a11y.iconBtns}`);
  check('the period selector offers every period and is labelled',
    a11y.periodOptions === 5 && a11y.periodLabelled, `${a11y.periodOptions} options`);
  check('decorative SVG hidden from screen readers', a11y.svgHidden >= 5, `${a11y.svgHidden}`);
  check('buttons are focusable', a11y.focusVisible === true);

  /* ─────────────── summary ─────────────── */
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${BASE}?demo=1&hour=13.5`);
  await sleep(1500);
  await page.screenshot(`${SHOT}-final.png`, { fullPage: true });

  const finalWin = await page.windowErrors();
  check('final: page has no window errors', finalWin.length === 0, finalWin.join(' | ') || 'clean');
} catch (e) {
  console.error('\nTEST CRASHED:', e.stack);
  fail++;
} finally {
  // The summary belongs in `finally`: a crash halfway through still leaves a
  // list of what had already failed, which is the useful part.
  console.log(`\n${'='.repeat(60)}\nPASSED: ${pass}   FAILED: ${fail}`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log('  - ' + f)); }
  await browser.close();
  try { (await import('node:child_process')).execSync(`pkill -f "cdp-profile-${browser.port}" || true`); } catch {}
  process.exit(fail ? 1 : 0);
}
