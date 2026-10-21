import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { direction, project } from '../public/pointing.js';

test('the dot grid reacts locally, keeps the same dots, settles idle and respects reduced motion', async () => {
  const source = await readFile(new URL('../public/phone.js', import.meta.url), 'utf8');
  const frames = new Map(), events = {};
  let now = 0, nextFrame = 0, drawn = [];
  const context = { setTransform() {}, clearRect() {}, beginPath() { drawn = []; }, moveTo() {}, arc(x, y, radius) { drawn.push({ x, y, radius }); }, fill() {} };
  const bounds = { left: 18, top: 18, width: 324, height: 648 };
  const canvas = { style: {}, getContext: () => context, getBoundingClientRect: () => bounds };
  const reduced = { matches: false, addEventListener: (type, callback) => { events.motion = callback; } };
  const document = { visibilityState: 'visible', addEventListener: (type, callback) => { events[type] = callback; } };
  const dots = runInNewContext(source.slice(source.indexOf('function setupDotGrid(')) + '\nsetupDotGrid(canvas);', {
    canvas, document,
    window: { devicePixelRatio: 3, matchMedia: () => reduced, addEventListener: (type, callback) => { events[type] = callback; } },
    performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  const baseline = drawn.map(point => ({ ...point }));
  const step = () => {
    const pending = [...frames.values()]; frames.clear(); now += 16;
    for (const callback of pending) callback(now);
  };
  const displacement = () => Math.max(...drawn.map((point, index) => Math.hypot(point.x - baseline[index].x, point.y - baseline[index].y)));
  const settle = () => { for (let i = 0; frames.size && i < 200; i++) step(); assert.equal(frames.size, 0, 'No animation loop remains at rest'); };
  assert.equal(frames.size, 0);
  assert.equal(canvas.width, 648, 'Raster resolution is capped at 2×');
  dots.move(180, 300, 40, 0, 16);
  for (let i = 0; i < 5; i++) step();
  assert.ok(displacement() > .3 && displacement() < 6, 'Nearby dots move only a few pixels');
  assert.deepEqual(drawn[0], baseline[0], 'Distant dots stay still');
  assert.equal(drawn.length, baseline.length, 'Feedback does not add shapes');
  dots.release(); settle();
  assert.deepEqual(drawn, baseline, 'The grid returns exactly to its original positions');
  let rippleMovement = 0;
  dots.tap(180, 300);
  for (let i = 0; i < 20; i++) { step(); rippleMovement = Math.max(rippleMovement, displacement()); }
  assert.ok(rippleMovement > .3 && rippleMovement < 3.5, 'A tap makes a restrained travelling ripple');
  assert.equal(drawn.length, baseline.length);
  settle(); assert.deepEqual(drawn, baseline);
  dots.move(180, 300, 40, 0, 16); step();
  document.visibilityState = 'hidden'; events.visibilitychange();
  assert.equal(frames.size, 0, 'Backgrounding stops and resets the effect');
  assert.deepEqual(drawn, baseline);
  reduced.matches = true; events.motion();
  dots.tap(180, 300); dots.move(180, 300, 40, 0, 16);
  assert.equal(frames.size, 0, 'Reduced motion keeps the dots static');
  bounds.width = 648; bounds.height = 324; events.resize();
  assert.equal(canvas.width, 1296); assert.equal(canvas.height, 648);
});

test('motion starts automatically; grid scrolling and triple taps stay separate', async () => {
  const elements = new Map(['setup', 'start', 'status', 'recenter'].map(id => [id, {
    hidden: false, disabled: false, textContent: '', listeners: {},
    clientWidth: 300, clientHeight: 600, scrollWidth: 900, scrollHeight: 1800, scrollLeft: 0, scrollTop: 0,
    setPointerCapture() {},
    contains(element) { return element === this; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
  }]));
  const events = {}, messages = [], sockets = [], buzzes = [];
  const timers = new Map();
  let timerId = 0;
  let now = 100, hitGrid = true;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() { sockets.push(this); }
    send(data) { messages.push(JSON.parse(data)); }
  }
  const orientation = { requestPermission: async () => 'granted' };
  const source = await readFile(new URL('../public/phone.js', import.meta.url), 'utf8');
  runInNewContext(source.replace(/^import .*;\n/, ''), {
    direction, project, WebSocket: Socket, DeviceOrientationEvent: orientation,
    window: { isSecureContext: true, DeviceOrientationEvent: orientation, addEventListener: (type, handler) => { events[type] = handler; } },
    document: { querySelector: selector => elements.get(selector.slice(1)), elementFromPoint: () => hitGrid ? elements.get('recenter') : null, addEventListener() {} },
    location: { hash: '#demo-key', pathname: '/phone', origin: 'https://demo.example' },
    sessionStorage: { getItem() {}, setItem() {} }, history: { replaceState() {} },
    navigator: { vibrate: pattern => buzzes.push(pattern) }, performance: { now: () => now },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  events.deviceorientation({ alpha: 50, beta: 10 }); // Stale, before connecting.
  await sockets[0].onopen();
  assert.equal(elements.get('start').hidden, true);
  assert.equal(elements.get('status').hidden, true);
  assert.equal(messages.length, 0);
  events.deviceorientation({ alpha: 120, beta: 25 });
  assert.deepEqual(messages.find(message => message.type === 'calibrate').direction, direction(120, 25));
  assert.equal(elements.get('setup').hidden, true);
  assert.equal(elements.get('recenter').hidden, false);
  assert.equal(elements.get('status').hidden, true);
  events.deviceorientation({ alpha: 130, beta: 30 });
  const calibrations = () => messages.filter(message => message.type === 'calibrate');
  const tap = delay => { now += delay; elements.get('recenter').listeners.click(); };
  tap(100);
  assert.equal(calibrations().length, 1);
  tap(100);
  assert.equal(calibrations().length, 1);
  tap(100);
  assert.equal(calibrations().length, 2);
  assert.deepEqual(messages.filter(message => message.type === 'calibrate').at(-1).direction, direction(130, 30));
  tap(100); // A fourth tap starts a new gesture.
  assert.equal(calibrations().length, 2);
  tap(500);
  tap(500);
  tap(500); // Widely spaced taps must not recenter.
  assert.equal(calibrations().length, 2);
  const grid = elements.get('recenter');
  const wheel = (dx, dy) => grid.listeners.wheel({ deltaX: dx, deltaY: dy, deltaMode: 0, preventDefault() {} });
  const scrolls = () => messages.filter(message => message.type === 'scroll');
  wheel(75, 300);
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: .25, dy: .5, begin: true });
  tap(100); tap(100);
  wheel(0, 30); // Scrolling interrupts a partially completed triple tap.
  tap(100);
  assert.equal(calibrations().length, 2);
  for (let i = 0; i < 12; i++) wheel(75, 0);
  assert.equal(scrolls().slice(-12).reduce((total, message) => total + message.dx, 0), 3, 'Repeated swipes must not hit a hidden phone scroll boundary');
  tap(100); tap(100);
  grid.listeners.pointercancel();
  tap(100);
  assert.equal(calibrations().length, 2);
  const touch = (clientX, clientY) => ({ pointerId: 1, isPrimary: true, button: 0, clientX, clientY });
  grid.listeners.pointerdown(touch(150, 300));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 0, dy: 0, begin: true });
  now += 50;
  grid.listeners.pointermove(touch(110, 220));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 40 / 300, dy: 80 / 600 });
  const aimCount = messages.filter(message => message.type === 'aim').length;
  events.deviceorientation({ alpha: 140, beta: 35 });
  assert.equal(messages.filter(message => message.type === 'aim').length, aimCount + 1);
  assert.deepEqual(messages.at(-1).direction, direction(140, 35));
  now += 50;
  grid.listeners.pointermove(touch(100, 200));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 10 / 300, dy: 20 / 600 });
  events.deviceorientation({ alpha: 150, beta: 40 });
  assert.equal(messages.filter(message => message.type === 'aim').length, aimCount + 2);
  grid.listeners.pointerup(touch(100, 200));
  const flick = scrolls().at(-1);
  assert.equal(flick.end, true, 'Release sends end so the TV can project momentum');
  assert.ok(flick.vx > 0 && flick.vy > 0, 'A flick includes release velocity');
  assert.equal(flick.begin, undefined, 'Momentum stays in the same row transaction');
  const aimsBeforeEnd = messages.filter(message => message.type === 'aim').length;
  now += 50; events.deviceorientation({ alpha: 160, beta: 45 });
  assert.equal(messages.filter(message => message.type === 'aim').length, aimsBeforeEnd + 1);
  tap(100); tap(100); tap(100);
  assert.equal(calibrations().length, 2, 'The drag-generated click must not count as a tap');
  hitGrid = false;
  grid.listeners.pointerdown(touch(150, 300));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 0, dy: 0, begin: true }, 'A new touch begins a fresh scroll');
  grid.listeners.pointerup(touch(5, 5));
  tap(100);
  assert.equal(calibrations().length, 2, 'Releasing in the padding must not count as a tap');
  hitGrid = true;
  for (let i = 0; i < 3; i++) {
    grid.listeners.pointerdown(touch(150, 300));
    grid.listeners.pointerup(touch(150, 300));
    tap(100);
  }
  assert.equal(calibrations().length, 3);
  grid.listeners.pointerdown(touch(150, 300)); now += 50;
  grid.listeners.pointermove(touch(130, 280));
  grid.listeners.pointerup(touch(130, 280));
  assert.equal(scrolls().at(-1).end, true);
  grid.listeners.pointerdown(touch(150, 300)); now += 50;
  grid.listeners.pointermove(touch(130, 280)); now += 120;
  grid.listeners.pointerup(touch(130, 280));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 }, 'Holding still before release must not start a fling');
  const beforeRotation = scrolls().length;
  for (const [alpha, beta] of [[0, 0], [90, 45], [180, -45], [270, 80]]) {
    now += 50; events.deviceorientation({ alpha, beta });
    assert.equal(scrolls().length, beforeRotation, 'Phone rotation must not scroll the TV');
  }
  grid.clientWidth = 600; grid.clientHeight = 300;
  events.resize();
  assert.equal(scrolls().length, beforeRotation, 'Viewport rotation must not scroll the TV');
  grid.listeners.pointerdown(touch(300, 150)); now += 50;
  grid.listeners.pointermove(touch(300, 120));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: 0, dy: .1 }, 'A vertical swipe stays vertical at any phone heading');
  now += 120; grid.listeners.pointerup(touch(300, 120));
  grid.listeners.pointerdown(touch(300, 150)); now += 50;
  grid.listeners.pointermove(touch(270, 150));
  assert.deepEqual(scrolls().at(-1), { type: 'scroll', dx: .05, dy: 0 }, 'A horizontal swipe stays horizontal at any phone heading');
  now += 120; grid.listeners.pointerup(touch(270, 150));
  const settleTaps = () => {
    now += 451;
    for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
  };
  const activations = () => messages.filter(message => message.type === 'activate');
  tap(500); // Discard the last swipe's synthetic click.
  tap(500);
  assert.equal(activations().length, 0, 'Single tap waits so a triple tap can cancel it');
  settleTaps();
  assert.equal(activations().length, 1, 'A single tap selects after the triple-tap window');
  assert.equal(buzzes.at(-1), 8, 'A tap ticks once');
  const beforeTriple = calibrations().length;
  for (let i = 0; i < 3; i++) {
    grid.listeners.pointerdown(touch(150, 150));
    grid.listeners.pointerup(touch(150, 150));
    tap(100);
  }
  settleTaps();
  assert.equal(calibrations().length, beforeTriple + 1);
  assert.equal(activations().length, 1, 'Triple tap recenters without selecting');
  assert.equal(buzzes.at(-1), 18, 'The third tap ticks a little harder');
  tap(500); tap(100); settleTaps();
  assert.equal(activations().length, 1, 'A partial triple tap must not accidentally select');
  tap(500); wheel(0, 30); settleTaps();
  assert.equal(activations().length, 1, 'Scrolling cancels pending selection');
  tap(500); sockets[0].onclose({ code: 1008 }); settleTaps();
  assert.equal(activations().length, 1, 'Disconnect cancels pending selection');
  assert.deepEqual([...buzzes.at(-1)], [12, 40, 18], 'Losing the connection taps twice');
});
