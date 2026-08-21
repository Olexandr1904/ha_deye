/**
 * test-dashboard.mjs — interactive tests for Deye Dashboard over CDP.
 * A real browser: device emulation, clicks, shadow DOM reads, console capture.
 */
import { Browser, sleep } from './cdp.mjs';
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
  return page.eval(`${HELPERS}
    const t0 = Date.now();
    while (Date.now() - t0 < ${ms}) {
      try { if (${expr}) return true; } catch (e) {}
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
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
  check('application booted', booted.app && booted.cards >= 6 && booted.nodes === 5 && booted.links === 4, JSON.stringify(booted));

  const values = await page.eval(`${HELPERS} return {
    solar: txt('.node-solar .node-num'), house: txt('.node-house .node-num'),
    battery: txt('.node-battery .node-num'), grid: txt('.node-grid .node-num'),
    inv: txt('.inv-power-num'), status: txt('.inv-status-text'),
    battCard: txt('.card-battery .big-num'), mode: txt('.batt-mode'),
    kpi: qa('.kpi:not([hidden]) .kpi-num').map(e=>e.textContent.trim()),
  };`);
  check('values rendered', values.solar !== '—' && values.status === 'ONLINE', JSON.stringify(values).slice(0, 190));
  check('SOC matches in the node and the card', values.battery === values.battCard, `${values.battery} / ${values.battCard}`);

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
  check('a flow out of the inverter runs in reverse', anim.battery.dir !== 'toHub' ? anim.battery.rev === 'reverse' : true, `battery dir=${anim.battery.dir} ${anim.battery.rev}`);
  check('intensity drives the speed', parseFloat(anim.solar.dur) < parseFloat(anim.load.dur) || anim.load.dir === 'idle',
    `solar ${anim.solar.dur} (7.8 kW) vs load ${anim.load.dur}`);

  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(300);
  const reduced = await page.eval(`${HELPERS} return getComputedStyle(q('.link-solar .link-beads')).animationDuration;`);
  check('prefers-reduced-motion disables the animation', parseFloat(reduced) < 0.01, `duration ${reduced}`);
  await page.send('Emulation.setEmulatedMedia', { features: [] });

  /* ─────────────── 4. chart range switching ─────────────── */
  group('Charts: Today / 7 Days / 30 Days');
  const chartStats = async () => page.eval(`${HELPERS} return {
    title: txt('.card-chart .card-title-text'),
    lines: qa('.card-chart path.chart-line').length,
    bars: qa('.card-chart rect.chart-bar').length,
    legend: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()),
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    yUnit: txt('.card-chart .axis-unit'),
  };`);
  let cs = await chartStats();
  check('Today: lines drawn', cs.lines >= 3 && !cs.empty, `lines ${cs.lines}, unit ${cs.yUnit}, legend ${cs.legend.length}`);

  await page.eval(`${HELPERS} qa('.range-btn').find(b => b.textContent.includes('7 Days')).click();`);
  await sleep(900);
  cs = await chartStats();
  check('7 Days: bars drawn', cs.bars >= 14 && !cs.empty, `bars ${cs.bars}, "${cs.title}", unit ${cs.yUnit}`);

  await page.eval(`${HELPERS} qa('.range-btn').find(b => b.textContent.includes('30 Days')).click();`);
  await sleep(1100);
  cs = await chartStats();
  check('30 Days: bars drawn', cs.bars >= 60, `bars ${cs.bars}, "${cs.title}"`);
  check('legend shows period totals', cs.legend.some((l) => /kWh|MWh/.test(l)), cs.legend.join(' · ').slice(0, 120));

  await page.eval(`${HELPERS} qa('.range-btn').find(b => b.textContent.includes('Today')).click();`);
  await sleep(900);
  cs = await chartStats();
  check('switching back to Today works', cs.lines >= 3, `lines ${cs.lines}`);

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

  /* ─────────────── 6. settings ─────────────── */
  group('Settings dialog');
  const settings = await page.eval(`${HELPERS}
    q('.topbar .icon-btn:last-of-type').click();
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
  check('no balance warning', noBalanceNotice.length <= 2, `notices ${noBalanceNotice.length}`);

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
    q('.topbar .icon-btn:last-of-type').click();
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

  /* ─────────────── 13. accessibility ─────────────── */
  group('Accessibility');
  const a11y = await page.eval(`${HELPERS} return {
    iconBtns: qa('.icon-btn').length,
    labeled: qa('.icon-btn[aria-label]').length,
    tabs: qa('.range-btn[role="tab"][aria-selected]').length,
    svgHidden: qa('svg[aria-hidden="true"]').length,
    contrastVars: getComputedStyle(host).getPropertyValue('--text-0').trim(),
    focusVisible: (() => { const b = q('.range-btn'); b.focus(); return sr.activeElement === b; })(),
  };`);
  check('icon buttons carry an aria-label', a11y.labeled === a11y.iconBtns, `${a11y.labeled}/${a11y.iconBtns}`);
  check('range switch exposes tabs with aria-selected', a11y.tabs === 3, `${a11y.tabs}`);
  check('decorative SVG hidden from screen readers', a11y.svgHidden >= 5, `${a11y.svgHidden}`);
  check('buttons are focusable', a11y.focusVisible === true);

  /* ─────────────── summary ─────────────── */
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${BASE}?demo=1&hour=13.5`);
  await sleep(1500);
  await page.screenshot(`${SHOT}-final.png`, { fullPage: true });

  const finalWin = await page.windowErrors();
  check('final: page has no window errors', finalWin.length === 0, finalWin.join(' | ') || 'clean');
  console.log(`\n${'='.repeat(60)}\nPASSED: ${pass}   FAILED: ${fail}`);
  if (fail) { console.log('\nFailures:'); failures.forEach((f) => console.log('  - ' + f)); }
} catch (e) {
  console.error('\nTEST CRASHED:', e.stack);
  fail++;
} finally {
  await browser.close();
  try { (await import('node:child_process')).execSync(`pkill -f "cdp-profile-${browser.port}" || true`); } catch {}
  process.exit(fail ? 1 : 0);
}
