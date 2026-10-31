/**
 * ha-client.js — the single gateway to Home Assistant.
 *
 * Two modes behind one interface:
 *   panel      — running inside Home Assistant (panel_custom, embed_iframe: false).
 *                Uses the hass object and its existing WebSocket connection.
 *                Never opens its own socket and never polls.
 *   standalone — index.html opened directly. Own WebSocket to /api/websocket
 *                with a long-lived access token (development and debugging).
 *
 * No external APIs. Local Home Assistant only.
 */

import { log, warn, error } from './utils.js?v=1.2.3';

export const STATUS = { CONNECTED: 'connected', CONNECTING: 'connecting', DISCONNECTED: 'disconnected' };

export class HAClient {
  constructor() {
    this.mode = null;
    this._status = STATUS.CONNECTING;
    this._hass = null;
    this._states = {};            // standalone: our own copy of the states
    this._statusCbs = new Set();
    this._stateCbs = new Set();
    this._readyCbs = new Set();
    this._ready = false;
    this._unsubEvents = null;
    this._lastSeen = new Map();   // entity_id -> last_updated (de-duplication)
    // standalone
    this._ws = null;
    this._msgId = 1;
    this._pending = new Map();
    this._retry = 0;
    this._closing = false;
    this._reconnectTimer = null;
  }

  /* ─────────────────────────── shared API ─────────────────────────── */

  get status() { return this._status; }
  get connected() { return this._status === STATUS.CONNECTED; }
  get isReady() { return this._ready; }

  onStatus(cb) { this._statusCbs.add(cb); cb(this._status); return () => this._statusCbs.delete(cb); }
  onStateChanged(cb) { this._stateCbs.add(cb); return () => this._stateCbs.delete(cb); }
  onReady(cb) { if (this._ready) cb(); else this._readyCbs.add(cb); return () => this._readyCbs.delete(cb); }

  getStates() { return this.mode === 'panel' ? (this._hass ? this._hass.states : {}) : this._states; }
  getState(entityId) { return this.getStates()[entityId] || null; }
  listEntityIds() { return Object.keys(this.getStates()); }

  /** Base URL of the Home Assistant instance, for links out of the panel. */
  get baseUrl() {
    if (this.mode === 'standalone') return this._baseUrl || '';
    return '';   // panel mode is same-origin, so relative links work
  }

  get locale() {
    return (this._hass && this._hass.locale && this._hass.locale.language) || undefined;
  }

  _setStatus(next) {
    if (this._status === next) return;
    this._status = next;
    log('status →', next);
    this._statusCbs.forEach((cb) => { try { cb(next); } catch (e) { error(e); } });
  }

  _markReady() {
    if (this._ready) return;
    this._ready = true;
    log('initial states ready:', Object.keys(this.getStates()).length, 'entities');
    this._readyCbs.forEach((cb) => { try { cb(); } catch (e) { error(e); } });
    this._readyCbs.clear();
  }

  _emitChange(entityId, stateObj) {
    // De-duplication: never dispatch the same last_updated twice.
    const stamp = stateObj ? `${stateObj.state}@${stateObj.last_updated}` : 'gone';
    if (this._lastSeen.get(entityId) === stamp) return;
    this._lastSeen.set(entityId, stamp);
    this._stateCbs.forEach((cb) => { try { cb(entityId, stateObj); } catch (e) { error(e); } });
  }

  /* ───────────────────────── mode: panel ───────────────────────── */

  /**
   * Called from the custom panel hass setter on every Home Assistant update.
   * Nothing heavy happens here: connection check plus a one-time subscription.
   */
  setHass(hass) {
    if (!hass) return;
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this.mode = 'panel';
      log('mode = panel, HA version', hass.config && hass.config.version);
    }
    const conn = hass.connection;
    this._setStatus(conn && conn.connected !== false && hass.connected !== false ? STATUS.CONNECTED : STATUS.CONNECTING);

    if (first) {
      this._markReady();
      this._subscribePanel(conn);
      // The initial fan-out over known entities is done by the model via getStates().
    } else if (this._trackChanges) {
      // Fallback path: if events do not arrive for some reason, compare the
      // object identity of the tracked state objects.
      this._diffTracked();
    }
  }

  /** Entities to watch with the fallback diff. */
  setTrackedEntities(ids) {
    this._trackChanges = ids && ids.length ? new Set(ids) : null;
    this._trackedRefs = new Map();
  }

  _diffTracked() {
    if (!this._trackChanges || !this._hass) return;
    const states = this._hass.states;
    for (const id of this._trackChanges) {
      const st = states[id];
      if (this._trackedRefs.get(id) !== st) {
        this._trackedRefs.set(id, st);
        this._emitChange(id, st || null);
      }
    }
  }

  async _subscribePanel(conn) {
    if (!conn || typeof conn.subscribeEvents !== 'function') {
      warn('hass.connection.subscribeEvents is unavailable — falling back to hass updates');
      return;
    }
    try {
      this._unsubEvents = await conn.subscribeEvents((ev) => {
        const d = ev && ev.data;
        if (!d || !d.entity_id) return;
        this._emitChange(d.entity_id, d.new_state || null);
      }, 'state_changed');
      log('subscribed to state_changed');
    } catch (e) {
      warn('could not subscribe to state_changed:', e);
    }
    if (typeof conn.addEventListener === 'function') {
      conn.addEventListener('ready', () => { this._setStatus(STATUS.CONNECTED); });
      conn.addEventListener('disconnected', () => { this._setStatus(STATUS.CONNECTING); });
      conn.addEventListener('reconnect-error', () => { this._setStatus(STATUS.DISCONNECTED); });
    }
  }

  /* ─────────────────────── mode: standalone ─────────────────────── */

  async connectStandalone(baseUrl, token) {
    this.mode = 'standalone';
    this._baseUrl = (baseUrl || location.origin).replace(/\/+$/, '');
    this._token = token;
    this._closing = false;
    return this._openSocket();
  }

  _wsUrl() {
    const u = new URL(this._baseUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = (u.pathname.replace(/\/+$/, '')) + '/api/websocket';
    u.search = '';
    return u.toString();
  }

  _openSocket() {
    return new Promise((resolve, reject) => {
      this._setStatus(STATUS.CONNECTING);
      let ws;
      try {
        ws = new WebSocket(this._wsUrl());
      } catch (e) {
        this._scheduleReconnect();
        reject(e);
        return;
      }
      this._ws = ws;
      let authed = false;

      ws.addEventListener('message', async (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch (e) { return; }

        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: this._token }));
          return;
        }
        if (msg.type === 'auth_invalid') {
          error('auth_invalid:', msg.message);
          this._closing = true;
          ws.close();
          reject(new Error(msg.message || 'auth invalid'));
          return;
        }
        if (msg.type === 'auth_ok') {
          authed = true;
          this._retry = 0;
          log('standalone WebSocket connected, HA', msg.ha_version);
          try {
            // Load states BEFORE announcing CONNECTED: the status callback
            // triggers a refresh, and on a reconnect it would otherwise read
            // the stale pre-outage snapshot and never be corrected.
            await this._loadStatesStandalone();
            await this._subscribeStandalone();
            this._setStatus(STATUS.CONNECTED);
            resolve(this);
          } catch (e) { reject(e); }
          return;
        }
        if (msg.type === 'result') {
          const p = this._pending.get(msg.id);
          if (p) {
            this._pending.delete(msg.id);
            msg.success ? p.resolve(msg.result) : p.reject(new Error((msg.error && msg.error.message) || 'WS error'));
          }
          return;
        }
        if (msg.type === 'event') {
          const p = this._pending.get(msg.id);
          if (p && p.onEvent) p.onEvent(msg.event);
          return;
        }
        if (msg.type === 'pong') {
          const p = this._pending.get(msg.id);
          if (p) { this._pending.delete(msg.id); p.resolve(true); }
        }
      });

      ws.addEventListener('close', () => {
        this._ws = null;
        for (const [, p] of this._pending) p.reject && p.reject(new Error('socket closed'));
        this._pending.clear();
        if (!this._closing) {
          this._setStatus(authed ? STATUS.CONNECTING : STATUS.DISCONNECTED);
          this._scheduleReconnect();
        } else {
          this._setStatus(STATUS.DISCONNECTED);
        }
      });

      ws.addEventListener('error', () => { /* a close event follows */ });
    });
  }

  _scheduleReconnect() {
    if (this._closing || this._reconnectTimer) return;
    const delay = Math.min(30000, 1000 * 2 ** this._retry++);
    log('reconnecting in', delay, 'ms');
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._openSocket().catch(() => {});
    }, delay);
  }

  async _loadStatesStandalone() {
    const list = await this.callWS({ type: 'get_states' });
    const map = {};
    for (const st of list) map[st.entity_id] = st;
    const reload = this._ready;
    this._states = map;
    this._markReady();
    // On a reload after reconnect nobody is listening for _markReady any more,
    // so push the fresh values out explicitly.
    if (reload) for (const id of Object.keys(map)) this._emitChange(id, map[id]);
  }

  async _subscribeStandalone() {
    await this._sendSubscription({ type: 'subscribe_events', event_type: 'state_changed' }, (event) => {
      const d = event && event.data;
      if (!d || !d.entity_id) return;
      if (d.new_state) this._states[d.entity_id] = d.new_state;
      else delete this._states[d.entity_id];
      this._emitChange(d.entity_id, d.new_state || null);
    });
    log('subscribed to state_changed (standalone)');
  }

  _sendSubscription(msg, onEvent) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return reject(new Error('socket not open'));
      const id = this._msgId++;
      this._pending.set(id, { resolve: () => resolve(id), reject, onEvent });
      this._ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  /* ──────────────────────────── callWS ──────────────────────────── */

  /** Generic WebSocket command call (history, statistics, ...). */
  callWS(msg) {
    if (this.mode === 'panel') {
      if (!this._hass) return Promise.reject(new Error('hass is not ready yet'));
      if (typeof this._hass.callWS === 'function') return this._hass.callWS(msg);
      if (this._hass.connection) return this._hass.connection.sendMessagePromise(msg);
      return Promise.reject(new Error('no WebSocket access'));
    }
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('socket not open'));
    return new Promise((resolve, reject) => {
      const id = this._msgId++;
      this._pending.set(id, { resolve, reject });
      this._ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  destroy() {
    this._closing = true;
    if (this._unsubEvents) { try { this._unsubEvents(); } catch (e) {} this._unsubEvents = null; }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { try { this._ws.close(); } catch (e) {} this._ws = null; }
    this._statusCbs.clear();
    this._stateCbs.clear();
  }
}
