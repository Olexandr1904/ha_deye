/**
 * deye-dashboard.js — entry point of the Home Assistant custom panel.
 *
 * Wiring (configuration.yaml):
 *
 *   panel_custom:
 *     - name: deye-dashboard          # must match the custom element name
 *       sidebar_title: Deye
 *       sidebar_icon: mdi:solar-power-variant
 *       url_path: deye-dashboard
 *       module_url: /local/deye-dashboard/deye-dashboard.js?v=1.0.0
 *       embed_iframe: false           # no iframe — the panel lives inside HA
 *       require_admin: false
 *
 * Home Assistant creates <deye-dashboard> itself and assigns the hass / narrow /
 * panel / route properties. We never open a connection of our own.
 */

import { DeyeDashboard } from './js/app.js';
import { VERSION } from './js/config.js';
import { log } from './js/utils.js';
import { t, setLanguage, resolveLanguage } from './js/i18n.js';

const BASE = new URL('.', import.meta.url);
const CSS_FILES = ['css/dashboard.css', 'css/components.css', 'css/responsive.css'];
const DEMO_KEY = 'deye-dashboard:demo';
const CONN_KEY = 'deye-dashboard:connection';

class DeyeDashboardPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._booted = false;
  }

  /* ── properties assigned by Home Assistant ── */

  set hass(hass) {
    this._hass = hass;
    if (this.app) this.app.setHass(hass);
  }
  get hass() { return this._hass; }

  set panel(panel) { this._panel = panel; }
  get panel() { return this._panel; }

  set narrow(v) { this._narrow = v; this.toggleAttribute('narrow', !!v); }
  get narrow() { return this._narrow; }

  set route(v) { this._route = v; }

  connectedCallback() {
    if (this._booted) return;
    this._booted = true;
    this._boot().catch((e) => this._fatal(e));
  }

  disconnectedCallback() {
    // Home Assistant may detach the panel while navigating — keep the state.
  }

  async _boot() {
    await this._injectStyles();

    setLanguage(resolveLanguage(null, null));   // browser locale for the pre-boot form
    const isStandalone = this.hasAttribute('standalone');
    const params = new URLSearchParams(location.search);
    const wantDemo = params.get('demo') === '1' || localStorage.getItem(DEMO_KEY) === '1';

    this._createApp();

    log(`Deye Dashboard v${VERSION} — mode: ${wantDemo ? 'demo' : isStandalone ? 'standalone' : 'panel'}`);

    if (wantDemo) {
      await this.app.init({ demo: true });
      return;
    }
    if (isStandalone) {
      const conn = readConnection();
      if (!conn) { this._askForToken(); return; }
      try {
        await this.app.init({ standalone: conn });
      } catch (e) {
        this._askForToken(String((e && e.message) || e));
      }
      return;
    }
    await this.app.init({ hass: this._hass || null });
  }

  /**
   * Builds a fresh dashboard instance. init() is not idempotent, so a retry
   * after a failed standalone login must replace the old instance instead of
   * appending a second one and leaking the first client's reconnect timer.
   */
  _createApp() {
    if (this.app) {
      try { this.app.destroy(); } catch (e) { /* already gone */ }
      this.shadowRoot.querySelectorAll('.deye-root, .modal, .onboard').forEach((n) => n.remove());
    }
    this.app = new DeyeDashboard(this.shadowRoot, {
      panelConfig: (this._panel && this._panel.config) || null,
      onToggleMenu: () => this._toggleHaMenu(),
      onDemoToggle: () => this._toggleDemo(),
    });
    return this.app;
  }

  async _injectStyles() {
    const links = CSS_FILES.map((file) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(`${file}?v=${VERSION}`, BASE).href;
      return link;
    });
    this.shadowRoot.append(...links);
    // Wait for the stylesheets so nothing flashes unstyled (but cap it at 1.5 s).
    await Promise.race([
      Promise.all(links.map((l) => new Promise((res) => { l.addEventListener('load', res, { once: true }); l.addEventListener('error', res, { once: true }); }))),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  }

  /** Menu button: on mobile HA hides the sidebar and this is the only way back. */
  _toggleHaMenu() {
    this.dispatchEvent(new CustomEvent('hass-toggle-menu', { bubbles: true, composed: true }));
  }

  _toggleDemo() {
    const on = localStorage.getItem(DEMO_KEY) === '1' || new URLSearchParams(location.search).get('demo') === '1';
    if (on) {
      // Leaving demo mode also has to drop ?demo=1, or the reload lands back in it.
      localStorage.removeItem(DEMO_KEY);
      const url = new URL(location.href);
      url.searchParams.delete('demo');
      location.replace(url.toString());
      return;
    }
    localStorage.setItem(DEMO_KEY, '1');
    location.reload();
  }

  /* ── standalone: connection form (index.html / debugging only) ── */

  _askForToken(errorText) {
    const wrap = document.createElement('div');
    wrap.className = 'onboard';
    wrap.innerHTML = `
      <div class="onboard-panel">
        <h2 class="onboard-title">${t('standalone.title')}</h2>
        <div class="onboard-body">
          <p>${t('standalone.text')}</p>
          ${errorText ? `<p style="color:var(--danger-color)">${errorText}</p>` : ''}
          <div class="field"><label class="field-label">${t('standalone.url')}</label><div class="field-control">
            <input id="d-url" type="url" value="${location.origin}" spellcheck="false"></div></div>
          <div class="field"><label class="field-label">${t('standalone.token')}</label><div class="field-control">
            <input id="d-token" type="password" placeholder="eyJhbGciOi..." spellcheck="false"></div></div>
          <div class="onboard-actions">
            <button class="btn btn-primary" id="d-connect" type="button">${t('standalone.connect')}</button>
            <button class="btn btn-ghost" id="d-demo" type="button">${t('standalone.demo')}</button>
          </div>
        </div>
      </div>`;
    this.shadowRoot.appendChild(wrap);
    const $ = (id) => wrap.querySelector(id);
    $('#d-connect').addEventListener('click', async () => {
      const url = $('#d-url').value.trim();
      const token = $('#d-token').value.trim();
      if (!url || !token) return;
      saveConnection({ url, token });
      wrap.remove();
      try {
        await this._createApp().init({ standalone: { url, token } });
      } catch (e) {
        clearConnection();
        this._askForToken(String((e && e.message) || e));
      }
    });
    $('#d-demo').addEventListener('click', () => { localStorage.setItem(DEMO_KEY, '1'); location.reload(); });
  }

  _fatal(err) {
    console.error('[DEYE] fatal start-up error:', err);
    const box = document.createElement('div');
    box.style.cssText = 'padding:24px;font:14px/1.5 system-ui;color:#ffb4b4';
    box.textContent = t('fatal', { msg: err && err.message ? err.message : err });
    this.shadowRoot.appendChild(box);
  }
}

function readConnection() {
  try {
    const raw = localStorage.getItem(CONN_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.url && v.token ? v : null;
  } catch (e) { return null; }
}
function saveConnection(v) { try { localStorage.setItem(CONN_KEY, JSON.stringify(v)); } catch (e) {} }
function clearConnection() { try { localStorage.removeItem(CONN_KEY); } catch (e) {} }

if (!customElements.get('deye-dashboard')) {
  customElements.define('deye-dashboard', DeyeDashboardPanel);
}

export { DeyeDashboardPanel };
