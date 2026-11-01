/**
 * test-client.mjs — unit tests for the standalone connection in ha-client.js.
 *   node tools/test-client.mjs
 *
 * index.html opens its own WebSocket. When Home Assistant was down, or the host
 * was mistyped, the socket closed before authentication and start-up waited for
 * an answer that never came: no token form, no error, and no live data even
 * after Home Assistant came back.
 */
import { HAClient, STATUS } from '../deye-dashboard/js/ha-client.js';

let pass = 0;
const failures = [];
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

/**
 * A WebSocket that plays a scripted Home Assistant: `refuse` closes before
 * anything is said, `accept` authenticates and answers every command.
 */
class FakeSocket {
  static OPEN = 1;
  static behaviour = 'accept';
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    FakeSocket.opened++;
    FakeSocket.last = this;
    setTimeout(() => {
      if (FakeSocket.behaviour === 'refuse') { this.close(); return; }
      this.readyState = FakeSocket.OPEN;
      this._say({ type: 'auth_required' });
    }, 0);
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  _emit(type, ev = {}) { for (const fn of this.listeners[type] || []) fn(ev); }
  _say(msg) { this._emit('message', { data: JSON.stringify(msg) }); }
  send(data) {
    const msg = JSON.parse(data);
    if (msg.type === 'auth') { setTimeout(() => this._say({ type: 'auth_ok', ha_version: 'test' }), 0); return; }
    setTimeout(() => this._say({ type: 'result', id: msg.id, success: true, result: msg.type === 'get_states' ? [] : null }), 0);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._emit('close');
  }
}
FakeSocket.opened = 0;
globalThis.WebSocket = FakeSocket;

const settle = (promise, ms = 200) => Promise.race([
  promise.then(() => 'resolved', () => 'rejected'),
  new Promise((resolve) => setTimeout(() => resolve('pending'), ms)),
]);

/* ── Home Assistant not there at start-up ── */
FakeSocket.behaviour = 'refuse';
let client = new HAClient();
eq('a socket closed before authentication fails the start-up', await settle(client.connectStandalone('http://ha.local:8123', 'token')), 'rejected');
eq('and is reported as disconnected', client.status, STATUS.DISCONNECTED);
eq('without retrying behind the form that asks again', client._reconnectTimer === null, true);
client.destroy();

/* ── a working connection that drops later keeps reconnecting ── */
FakeSocket.behaviour = 'accept';
client = new HAClient();
eq('a connection that authenticates starts up', await settle(client.connectStandalone('http://ha.local:8123', 'token')), 'resolved');
eq('and is connected', client.status, STATUS.CONNECTED);
FakeSocket.last.close();
eq('a drop after that is retried', client._reconnectTimer !== null, true);
eq('while the header says it is reconnecting', client.status, STATUS.CONNECTING);
client.destroy();

if (failures.length) {
  console.log(`ha-client.js: ${failures.length} of ${pass + failures.length} checks FAILED\n`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`ha-client.js: all ${pass} checks passed`);
