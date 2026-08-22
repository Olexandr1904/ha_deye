/**
 * cdp.mjs — a minimal, dependency-free Chrome DevTools Protocol driver.
 * Node 22+ (global WebSocket). Same protocol chrome-devtools-mcp speaks.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class Browser {
  static async launch({ port, headless = true, profile } = {}) {
    // A unique port and profile per run: otherwise an orphaned Chrome from a
    // previous run grabs the port and brings its own localStorage along.
    port = port || 9400 + Math.floor(Math.random() * 400);
    const dir = profile || `/tmp/cdp-profile-${port}-${Date.now()}`;
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-component-update', '--disable-background-networking',
      '--disable-sync', '--metrics-recording-only', '--mute-audio',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      'about:blank',
    ];
    if (headless) args.unshift('--headless=new', '--disable-gpu');
    const proc = spawn(CHROME, args, { stdio: 'ignore', detached: true });
    const b = new Browser(port, proc);
    b.profileDir = dir;
    try {
      await b._waitForPort(dir);
    } catch (e) {
      // Never leave a detached Chrome and its profile behind on a failed launch.
      await b.close();
      throw e;
    }
    // Ctrl-C skips every finally block, so the cleanup has to be registered.
    b._onSignal = () => { b.close().finally(() => process.exit(130)); };
    process.once('SIGINT', b._onSignal);
    process.once('SIGTERM', b._onSignal);
    return b;
  }

  constructor(port, proc) { this.port = port; this.proc = proc; this.pages = []; }

  async _waitForPort(profileDir) {
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) {
          const v = await r.json();
          // The port is random, so it can belong to an orphan from another run.
          // Attaching to a stranger's browser would be worse than failing.
          if (profileDir && v['userDataDir'] && !v['userDataDir'].includes(profileDir)) {
            throw new Error(`port ${this.port} belongs to another Chrome (${v['userDataDir']})`);
          }
          this.version = v;
          return;
        }
      } catch (e) {
        if (/belongs to another Chrome/.test(e.message)) throw e;
      }
      await sleep(100);
    }
    throw new Error('Chrome never opened the debugging port');
  }

  async newPage() {
    const r = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' });
    if (!r.ok) throw new Error(`/json/new → ${r.status}`);
    const target = await r.json();
    const page = new Page(target.webSocketDebuggerUrl, target.id);
    await page._connect();
    this.pages.push(page);
    return page;
  }

  async close() {
    if (this._onSignal) {
      process.off('SIGINT', this._onSignal);
      process.off('SIGTERM', this._onSignal);
      this._onSignal = null;
    }
    for (const p of this.pages) { try { p.ws.close(); } catch {} }
    // Kill the whole process group: --headless=new leaves helper processes
    // behind that keep holding the port and the profile directory.
    for (const sig of ['SIGTERM', 'SIGKILL']) {
      try { process.kill(-this.proc.pid, sig); } catch {}
      try { this.proc.kill(sig); } catch {}
      await sleep(250);
    }
    try { rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

class Page {
  constructor(wsUrl, id) {
    this.wsUrl = wsUrl; this.id = id;
    this._id = 0; this._pending = new Map(); this._listeners = new Map();
    this.console = [];       // every console message
    this.errors = [];        // uncaught exceptions plus console.error
    this.failedRequests = [];
  }

  /** Catch window errors too: ResizeObserver and friends only report that way. */
  async installErrorHook() {
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__winErrors = [];
      addEventListener('error', (e) => window.__winErrors.push(e.message || String(e.error)));
      addEventListener('unhandledrejection', (e) => window.__winErrors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
    ` });
  }

  async windowErrors() {
    try { return await this.eval('return window.__winErrors || [];'); } catch { return []; }
  }

  _connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', async () => {
        this.ws.addEventListener('message', (e) => this._onMessage(JSON.parse(e.data)));
        await this.send('Page.enable');
        await this.send('Runtime.enable');
        await this.send('Network.enable');
        this.on('Runtime.consoleAPICalled', (p) => {
          const text = (p.args || []).map(argText).join(' ');
          this.console.push({ type: p.type, text });
          if (p.type === 'error') this.errors.push(`console.error: ${text}`);
        });
        this.on('Runtime.exceptionThrown', (p) => {
          const d = p.exceptionDetails || {};
          this.errors.push(`exception: ${d.exception?.description || d.text || 'unknown'}`);
        });
        this.on('Network.loadingFailed', (p) => {
          if (!/net::ERR_ABORTED/.test(p.errorText || '')) this.failedRequests.push(p.errorText);
        });
        this.on('Network.responseReceived', (p) => {
          if (p.response && p.response.status >= 400) this.failedRequests.push(`${p.response.status} ${p.response.url}`);
        });
        resolve(this);
      });
      this.ws.addEventListener('error', reject);
      // A crashed tab must fail every pending command at once, not make each of
      // them wait out the full protocol timeout.
      this.ws.addEventListener('close', () => {
        this._closed = true;
        for (const [id, p] of this._pending) { this._pending.delete(id); p.reject(new Error('the page closed the debugging connection')); }
      });
    });
  }

  _onMessage(msg) {
    if (msg.id !== undefined) {
      const p = this._pending.get(msg.id);
      if (!p) return;
      this._pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      return;
    }
    const list = this._listeners.get(msg.method);
    if (list) for (const cb of list) cb(msg.params);
  }

  on(method, cb) {
    if (!this._listeners.has(method)) this._listeners.set(method, []);
    this._listeners.get(method).push(cb);
  }

  off(method, cb) {
    const list = this._listeners.get(method);
    if (!list) return;
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }

  once(method, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // The listener is always removed: a run that waits for eight page loads
      // would otherwise end with eight handlers resolving settled promises.
      const done = (fn) => (p) => { clearTimeout(t); this.off(method, handler); fn(p); };
      const t = setTimeout(() => { this.off(method, handler); reject(new Error(`timed out waiting for ${method}`)); }, timeout);
      const handler = done(resolve);
      this.on(method, handler);
    });
  }

  send(method, params = {}, timeout = 60000) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      // A safety net: a page that stops producing frames could otherwise leave
      // an evaluate() pending forever and stall the whole run.
      const timer = setTimeout(() => {
        if (this._pending.delete(id)) reject(new Error(`${method} did not answer in ${timeout} ms`));
      }, timeout);
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      if (this._closed) { this._pending.delete(id); clearTimeout(timer); reject(new Error('the debugging connection is closed')); return; }
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Device emulation: a real viewport width at any device pixel ratio. */
  async setViewport({ width, height, dpr = 1, mobile = false }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile,
      screenWidth: width, screenHeight: height,
    });
    if (mobile) await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    // Rendering can be suspended after a screenshot, and while it is, neither
    // ResizeObserver nor requestAnimationFrame fire — so the page would keep the
    // layout it had. Bring the target to front and wait for one real frame.
    await this.send('Page.bringToFront').catch(() => {});
    await this.waitForFrame();

    // Confirm the page actually sees the new width before returning: silently
    // measuring the old layout is the kind of failure that costs an hour.
    let seen = null;
    for (let i = 0; i < 40; i++) {
      seen = await this.eval('return innerWidth;').catch(() => null);
      if (seen === width) return;
      await sleep(50);
    }
    throw new Error(`viewport never became ${width}px wide (innerWidth=${seen})`);
  }

  /**
   * Resolves once the page produces an animation frame.
   *
   * A headless page can stop driving its frame loop entirely (after a
   * screenshot, for instance). While that lasts neither requestAnimationFrame
   * nor ResizeObserver fire, so anything the dashboard defers to a frame — which
   * is deliberately most of its work — never happens. Capturing one pixel forces
   * a frame and gets the loop going again.
   */
  async waitForFrame(timeout = 1200) {
    const once = () => this.eval(`return await Promise.race([
      new Promise((r) => requestAnimationFrame(() => r(true))),
      new Promise((r) => setTimeout(() => r(false), ${timeout})),
    ]);`).catch(() => false);

    if (await once()) return true;
    try {
      await this.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 1, clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
      });
    } catch (e) { /* nothing else to try */ }
    return once();
  }

  /** Wipes all data for an origin so tests cannot leak into each other. */
  async clearStorage(origin) {
    try { await this.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }); } catch {}
  }

  async goto(url, { waitLoad = true } = {}) {
    this.console.length = 0; this.errors.length = 0; this.failedRequests.length = 0;
    const load = waitLoad ? this.once('Page.loadEventFired', 20000) : Promise.resolve();
    await this.send('Page.navigate', { url });
    await load;
  }

  /** Evaluates an expression inside the page; await is supported. */
  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  async screenshot(path, { fullPage = false } = {}) {
    const params = { format: 'png' };
    if (fullPage) {
      const m = await this.send('Page.getLayoutMetrics');
      params.captureBeyondViewport = true;
      params.clip = {
        x: 0, y: 0,
        width: Math.ceil(m.cssContentSize.width),
        height: Math.min(20000, Math.ceil(m.cssContentSize.height)),
        scale: 1,
      };
    }
    const { data } = await this.send('Page.captureScreenshot', params);
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  }
}

function argText(a) {
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  if (a.description) return a.description;
  if (a.preview) return a.preview.description || '[object]';
  return String(a.type);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
