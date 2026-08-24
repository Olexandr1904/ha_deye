/**
 * test-in-ha.mjs — the same dashboard, but inside a running Home Assistant.
 *
 *   DEYE_HA_URL=http://homeassistant.local:8123 \
 *   DEYE_HA_TOKEN=<long-lived access token> \
 *   node tools/test-in-ha.mjs
 *
 * The browser suite proves the panel works against simulated data; this one
 * proves it works as a panel: registered by `panel_custom`, running inside the
 * HA frontend shell, reading the real inverter through the connection HA already
 * has (no WebSocket of its own), and getting history out of Recorder.
 *
 * Nothing here is written to the repository: the URL and the token come from the
 * environment, and the token never leaves the local browser profile.
 */
import { Browser, sleep } from './cdp.mjs';

const URL = process.env.DEYE_HA_URL || 'http://homeassistant.local:8123';
const TOKEN = process.env.DEYE_HA_TOKEN;
const PANEL = process.env.DEYE_PANEL || 'deye-dashboard';
const SHOTS = process.env.DEYE_SHOTS || '/tmp/deye-shots';

if (!TOKEN) {
  console.error('DEYE_HA_TOKEN is required (Profile -> Security -> Long-lived access tokens).');
  process.exit(2);
}

let pass = 0, fail = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name + (detail ? ': ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
};
const group = (t) => console.log(`\n── ${t} ──`);

/** Reaches the panel's own element inside the HA frontend's shadow trees. */
const HELPERS = `
  const deep = (root, sel) => {
    const hit = root.querySelector ? root.querySelector(sel) : null;
    if (hit) return hit;
    const kids = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (const el of kids) if (el.shadowRoot) { const r = deep(el.shadowRoot, sel); if (r) return r; }
    return null;
  };
  const host = deep(document, 'deye-dashboard');
  const sr = host && host.shadowRoot;
  const app = host && host.app;
  const q = (s) => sr && sr.querySelector(s);
  const qa = (s) => sr ? [...sr.querySelectorAll(s)] : [];
  const txt = (s) => { const e = q(s); return e ? e.textContent.trim() : null; };
`;

const browser = await Browser.launch({ headless: true });
const page = await browser.newPage();
console.log(`Home Assistant: ${URL}   panel: /${PANEL}   Chrome ${browser.version['Browser']}`);

try {
  /* The frontend authenticates from localStorage, so the token is planted before
     the first document runs. */
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try {
        localStorage.setItem('hassTokens', JSON.stringify({
          access_token: ${JSON.stringify(TOKEN)},
          token_type: 'Bearer',
          expires_in: 1800,
          hassUrl: ${JSON.stringify(URL)},
          clientId: null,
          expires: Date.now() + 1800000,
          refresh_token: '',
        }));
        localStorage.setItem('selectedTheme', JSON.stringify({ dark: true }));
      } catch (e) {}
    `,
  });
  await page.installErrorHook();
  await page.setViewport({ width: 1600, height: 1000 });

  group('Panel registration');
  await page.goto(`${URL}/${PANEL}`);
  await sleep(6000);

  const reg = await page.eval(`${HELPERS} return {
    element: !!host,
    upgraded: !!(host && host.shadowRoot),
    tag: host ? host.tagName.toLowerCase() : null,
    iframe: !!document.querySelector('iframe'),
    url: location.pathname,
    hass: !!(host && host.hass),
    mode: app && app.client ? app.client.mode : null,
  };`);
  check('the sidebar item loads the custom element', reg.element && reg.upgraded, `<${reg.tag}> at ${reg.url}`);
  check('no iframe anywhere', reg.iframe === false);
  check('Home Assistant handed the panel its hass object', reg.hass === true);
  check('the panel uses the connection HA already has', reg.mode === 'panel', `mode=${reg.mode}`);

  group('Live data from the real inverter');
  const live = await page.eval(`${HELPERS} return {
    pv: txt('.node-solar .node-num'), load: txt('.node-house .node-num'),
    soc: txt('.node-battery .node-num'), grid: txt('.node-grid .node-num'),
    status: txt('.inv-status-text'),
    conn: txt('.conn-text'),
    connPill: !!q('.conn-pill'),
    dashes: qa('.flow-node:not([hidden]) .node-num').filter(e => e.textContent.trim() === '—').length,
    mapped: app ? Object.values(app.config.entities).filter(Boolean).length : 0,
    balance: app && app.state ? app.state.meta.balance : null,
    battSign: app ? app.model.batterySign : null,
    gridSign: app ? app.model.gridSign : null,
    unavailable: app ? Object.entries(app.entityManager.values)
      .filter(([, v]) => v && v.entityId && v.unavailable).map(([k]) => k) : [],
    notices: qa('.notice').map(n => n.textContent.trim().slice(0, 70)),
  };`);
  check('entities are mapped from the panel config', live.mapped >= 30, `${live.mapped} roles`);
  check('the diagram shows real values', live.dashes === 0,
    `PV ${live.pv}, house ${live.load}, SOC ${live.soc}, grid ${live.grid}`);
  check('the inverter reports a state', !!live.status && live.status !== '—', live.status);
  // In panel mode the connection belongs to Home Assistant: the panel shows its
  // own pill only when it opened the socket itself (standalone mode).
  check('the panel does not duplicate HA\'s connection state',
    reg.mode === 'panel' ? !live.connPill || /ONLINE|ОНЛАЙН/i.test(live.conn || '') : /ONLINE/i.test(live.conn || ''),
    `pill=${live.connPill}, text=${live.conn}`);
  check('polarity was resolved for both meters',
    live.battSign !== 'auto' && live.gridSign !== 'auto', `battery ${live.battSign}, grid ${live.gridSign}`);
  check('the power balance closes', live.balance !== null && Math.abs(live.balance) < 1.0,
    live.balance === null ? 'no balance' : `delta=${live.balance.toFixed(3)} kW`);
  check('no mapped entity is unavailable', live.unavailable.length === 0,
    live.unavailable.join(', ') || 'none');
  check('no warning notices', live.notices.length === 0, live.notices.join(' | ') || 'none');

  group('The period selector inside the HA shell');
  for (const [w, h] of [[1600, 1000], [1440, 900], [390, 844]]) {
    await page.setViewport({ width: w, height: h, dpr: 1, mobile: w < 500 });
    await sleep(1200);
    const place = await page.eval(`${HELPERS}
      const chip = q('.topbar .nav-label');
      const sel = q('.topbar .nav-range-select');
      const cr = chip.getBoundingClientRect();
      const sr2 = sel.getBoundingClientRect();
      return { top: Math.round(cr.top), visible: cr.top >= 0 && cr.bottom <= innerHeight && cr.width > 40,
               selVisible: sr2.top >= 0 && sr2.bottom <= innerHeight && sr2.width > 30,
               label: txt('.topbar .nav-label-text'),
               overflow: document.documentElement.scrollWidth - innerWidth };`);
    check(`at ${w}x${h} the date and period are on the first screen`,
      place.visible && place.selVisible && place.overflow <= 1,
      `top ${place.top}px "${place.label}", overflow ${place.overflow}px`);
  }
  await page.setViewport({ width: 1600, height: 1000 });
  await sleep(1200);

  group('History and statistics from Recorder');
  const day = await page.eval(`${HELPERS} return {
    lines: qa('.card-chart path.chart-line').length,
    legend: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()),
    label: txt('.topbar .nav-label-text'),
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    emptyText: txt('.card-chart .chart-empty'),
  };`);
  check('the day chart draws real power lines', day.lines >= 3 && !day.empty,
    `${day.lines} lines, ${day.label}${day.empty ? ` — "${day.emptyText}"` : ''}`);

  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'week'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(4000);
  const week = await page.eval(`${HELPERS} return {
    bars: qa('.card-chart rect.chart-bar').length,
    legend: qa('.card-chart .chart-legend-item').map(e => e.textContent.trim()),
    label: txt('.topbar .nav-label-text'),
    empty: q('.card-chart .chart-empty').classList.contains('is-visible'),
    emptyText: txt('.card-chart .chart-empty'),
  };`);
  check('a week of long-term statistics arrives as bars', week.bars > 0 && !week.empty,
    `${week.bars} bars, ${week.label}${week.empty ? ` — "${week.emptyText}"` : ''}`);
  check('the legend totals the period', week.legend.some((l) => /kWh|МВт|кВт/.test(l)), week.legend.join(' / '));

  group('Historical mode');
  await page.eval(`${HELPERS} const sel = q('.topbar .nav-range-select'); sel.value = 'day'; sel.dispatchEvent(new Event('change', { bubbles: true })); return 1;`);
  await sleep(2500);
  await page.eval(`${HELPERS} qa('.topbar .nav-btn')[0].click(); return 1;`);
  await sleep(4000);
  const past = await page.eval(`${HELPERS} return {
    mode: q('.app').dataset.mode,
    banner: txt('.history-bar'),
    liveCards: qa('.card-flow, .card-battery, .card-grid, .detail-row')
      .filter(e => e.offsetParent !== null).length,
    kpi: qa('.kpi:not([hidden]) .kpi-num').map(e => e.textContent.trim()),
    dashes: qa('.kpi:not([hidden]) .kpi-num').filter(e => e.textContent.trim() === '—').length,
  };`);
  check('yesterday switches the whole dashboard to history', past.mode === 'history' && !!past.banner,
    (past.banner || '').slice(0, 60));
  check('no live card survives in history', past.liveCards === 0, `${past.liveCards} still visible`);
  check('KPI totals for yesterday come from statistics', past.kpi.length >= 4 && past.dashes < past.kpi.length,
    past.kpi.join(' / '));

  await page.eval(`${HELPERS} q('.history-now').click(); return 1;`);
  await sleep(3000);
  const backLive = await page.eval(`${HELPERS} return { mode: q('.app').dataset.mode, flow: q('.card-flow').offsetParent !== null };`);
  check('Now returns to the live view', backLive.mode === 'live' && backLive.flow);

  group('Sensor dialog against a real sensor');
  await page.eval(`${HELPERS} q('.card-battery [data-role]').click(); return 1;`);
  await sleep(4000);
  const dlg = await page.eval(`${HELPERS} return {
    open: !q('.detail-modal').hidden,
    title: txt('.detail-modal .modal-title'),
    entity: txt('.detail-entity'),
    lines: qa('.detail-modal path.chart-line').length,
    bars: qa('.detail-modal rect.chart-bar').length,
    stats: qa('.detail-stat').map(e => e.textContent.trim()),
    empty: !q('.detail-modal .detail-empty').hidden,
    emptyText: txt('.detail-modal .detail-empty'),
    link: q('.detail-link') ? q('.detail-link').getAttribute('href') : null,
  };`);
  check('a real sensor opens with its own history',
    dlg.open && (dlg.lines > 0 || dlg.bars > 0) && !dlg.empty,
    `${dlg.title} / ${dlg.entity}${dlg.empty ? ` — "${dlg.emptyText}"` : `, ${dlg.stats.join(' | ')}`}`);
  check('the dialog links back into Home Assistant',
    /\/history\?entity_id=sensor\./.test(dlg.link || ''), dlg.link);
  await page.eval(`${HELPERS} q('.detail-modal .modal-head .icon-btn').click(); return 1;`);
  await sleep(500);

  group('Inside the Home Assistant shell');
  const shell = await page.eval(`${HELPERS}
    let toggles = 0;
    const onToggle = () => { toggles++; };
    window.addEventListener('hass-toggle-menu', onToggle);
    const menu = q('.menu-btn');
    if (menu) menu.click();
    await new Promise(r => setTimeout(r, 200));
    window.removeEventListener('hass-toggle-menu', onToggle);
    return {
      toggles,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      panelWidth: host.getBoundingClientRect().width,
      innerWidth: window.innerWidth,
      sidebar: !!deep(document, 'ha-sidebar'),
    };`);
  check('the hamburger asks HA to toggle its sidebar', shell.toggles === 1, `${shell.toggles} events`);
  check('the panel fits the shell without horizontal scrolling',
    shell.overflowX <= 1 && shell.panelWidth <= shell.innerWidth + 1,
    `panel ${Math.round(shell.panelWidth)}px of ${shell.innerWidth}px, overflow ${shell.overflowX}px`);
  check('the HA sidebar is still there', shell.sidebar === true);

  const generator = await page.eval(`${HELPERS} return {
    relevant: app.state.generator.relevant,
    node: q('.node-generator') ? getComputedStyle(q('.node-generator')).display !== 'none' : false,
    kpi: q('.kpi[data-key="generator"]') ? !q('.kpi[data-key="generator"]').hidden : false,
    layout: q('.flow-stage').dataset.layout,
    power: app.state.generator.power, today: app.state.generator.today,
  };`);
  check('the generator only appears when it has produced something',
    generator.relevant === (generator.node || generator.kpi),
    `relevant=${generator.relevant}, node=${generator.node}, kpi=${generator.kpi}, layout=${generator.layout}, ${generator.power} kW / ${generator.today} kWh`);

  group('Console');
  const errs = await page.windowErrors();
  const consoleErrors = page.errors.filter((e) => !/favicon|manifest|service.?worker/i.test(e));
  check('no window errors from the panel', errs.length === 0, errs.join(' | ') || 'clean');
  check('no exceptions or console.error', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | ') || 'clean');

  await page.screenshot(`${SHOTS}/in-ha.png`, { fullPage: true });
  console.log(`\nscreenshot: ${SHOTS}/in-ha.png`);
} catch (e) {
  console.error('\nTEST CRASHED:', e.stack);
  fail++;
} finally {
  console.log(`\n${'='.repeat(60)}\nPASSED: ${pass}   FAILED: ${fail}`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log('  - ' + f)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
}
