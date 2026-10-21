import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { direction, project } from '../public/pointing.js';

const source = (await readFile(new URL('../public/phone.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');
function phone(requestPermission) {
  const elements = Object.fromEntries(['setup', 'start', 'status', 'recenter'].map(id => [id, {
    hidden: id !== 'setup', listeners: {}, classList: {},
    clientWidth: 300, clientHeight: 600, scrollWidth: 900, scrollHeight: 1800,
    addEventListener(type, callback) { this.listeners[type] = callback; },
  }]));
  const events = {}, messages = [], sockets = [], timers = new Map();
  let timerId = 0;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() { sockets.push(this); }
    send(data) { messages.push(JSON.parse(data)); }
  }
  const orientation = requestPermission ? { requestPermission } : {};
  const document = { visibilityState: 'visible', querySelector: selector => elements[selector.slice(1)], addEventListener: (type, callback) => { events[type] = callback; } };
  runInNewContext(source, {
    direction, project, WebSocket: Socket, DeviceOrientationEvent: orientation, document,
    window: { isSecureContext: true, DeviceOrientationEvent: orientation, addEventListener: (type, callback) => { events[type] = callback; } },
    location: { hash: '#test-key', pathname: '/phone', origin: 'https://demo.example' },
    sessionStorage: { getItem() {}, setItem() {} }, history: { replaceState() {} }, navigator: {},
    performance: { now: () => 100 }, requestAnimationFrame() {}, cancelAnimationFrame() {},
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
  });
  return { ...elements, events, messages, sockets, timers, document, sample: () => events.deviceorientation({ alpha: 120, beta: 25 }) };
}

test('remembered motion permission starts without showing a button and resumes after reconnect', async () => {
  let requests = 0;
  const p = phone(async () => { requests++; return 'granted'; });
  p.sample(); // A reading before connection must not become the starting angle.
  const opening = p.sockets[0].onopen();
  assert.equal(p.start.hidden, true, 'No permission-button flash while checking access');
  await opening;
  assert.equal(p.messages.length, 0);
  p.sample();
  assert.equal(p.setup.hidden, true);
  assert.equal(p.recenter.hidden, false);
  assert.equal(p.messages[0].type, 'calibrate');
  p.sockets[0].readyState = 3;
  p.sockets[0].onclose({ code: 1006 });
  [...p.timers.values()][0]();
  await p.sockets[1].onopen();
  assert.equal(requests, 1, 'A connection retry must reuse permission');
  assert.equal(p.start.hidden, true);
  assert.equal(p.messages.filter(message => message.type === 'calibrate').length, 1);
  p.sample();
  assert.equal(p.messages.filter(message => message.type === 'calibrate').length, 2);
});

test('Enable motion appears only when the browser requires a gesture', async () => {
  let requests = 0;
  const p = phone(async () => {
    if (++requests === 1) throw Object.assign(new Error('A tap is required'), { name: 'NotAllowedError' });
    return 'granted';
  });
  await p.sockets[0].onopen();
  assert.equal(p.start.hidden, false);
  assert.equal(p.start.disabled, false);
  assert.equal(p.start.textContent, 'Allow motion');
  assert.match(p.status.textContent, /motion and orientation/);
  p.sample();
  assert.equal(p.messages.length, 0);
  await p.start.listeners.click();
  assert.equal(p.start.hidden, true);
  assert.equal(p.messages.length, 0, 'Wait for a fresh reading after the permission tap');
  p.sample();
  assert.equal(p.setup.hidden, true);
  assert.equal(p.messages[0].type, 'calibrate');
});

test('blocked permission shows settings guidance and retries automatically when returning', async () => {
  let permission = 'denied';
  const p = phone(async () => permission);
  await p.sockets[0].onopen();
  assert.equal(p.start.hidden, true);
  assert.match(p.status.textContent, /browser settings/);
  p.sample();
  assert.equal(p.messages.length, 0);
  permission = 'granted';
  p.events.visibilitychange();
  await new Promise(setImmediate);
  assert.equal(p.start.hidden, true);
  p.sample();
  assert.equal(p.setup.hidden, true);
});

test('browsers without requestPermission start directly and recover from late sensor data', async () => {
  const p = phone();
  await p.sockets[0].onopen();
  assert.equal(p.start.hidden, true);
  [...p.timers.values()][0]();
  assert.equal(p.start.hidden, true, 'Missing sensor readings do not mean a browser tap is required');
  assert.match(p.status.textContent, /No motion data/);
  p.sample();
  assert.equal(p.setup.hidden, true);
});

test('other permission failures show guidance without an unnecessary enable button', async () => {
  const p = phone(async () => { throw Object.assign(new Error('Blocked by policy'), { name: 'SecurityError' }); });
  await p.sockets[0].onopen();
  assert.equal(p.start.hidden, true);
  assert.match(p.status.textContent, /browser settings/);
  p.sample();
  assert.equal(p.messages.length, 0);
});
