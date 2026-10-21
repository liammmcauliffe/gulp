import { direction, project } from './pointing.js';

const setup = document.querySelector('#setup'), start = document.querySelector('#start'), status = document.querySelector('#status'), recenter = document.querySelector('#recenter');
const title = document.querySelector('#prompt-title'), spin = document.querySelector('#prompt-spin');
const dots = setupDotGrid(document.querySelector('#touch-dots'));
// iOS ticks only when a real tap hits the switch label. vibrate() covers Android, including events with no tap.
const buzz = pattern => { try { navigator.vibrate?.(pattern); } catch { /* haptic feedback is optional */ } };
for (const host of [start, recenter]) host.querySelector?.('.haptic-switch')?.addEventListener('click', event => event.stopPropagation());
const key = location.hash.slice(1) || sessionStorage.getItem('gulp-key');
if (key) { sessionStorage.setItem('gulp-key', key); history.replaceState(null, '', location.pathname); }
let socket, aim, enabled = false, active = false, requestingMotion = false, lastSent = 0, sensorTimer, retry, wakeLock;
let tapCount = 0, lastTap = 0, tapTimer;
let drag = null, ignoreClick = false;
const send = message => { if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 2048) socket.send(JSON.stringify(message)); };
const showSetup = ({ heading = '', message = '', action = '', waiting = false } = {}) => {
  dots?.reset();
  cancelActivation(); clearTimeout(sensorTimer); active = false; tapCount = 0; drag = null; ignoreClick = false; recenter.hidden = true; setup.hidden = false;
  if (title) { title.textContent = heading; title.hidden = !heading; }
  if (spin) spin.hidden = !waiting;
  status.textContent = message; status.hidden = !message;
  start.hidden = !action; start.disabled = !action; if (action) start.textContent = action;
};

function cancelActivation() {
  clearTimeout(tapTimer);
  tapTimer = null;
}

function scrollBy(dx, dy, begin = false) {
  if (!active) return;
  send({ type: 'scroll', dx: dx / recenter.clientWidth, dy: dy / recenter.clientHeight, ...(begin ? { begin: true } : {}) });
}
// The TV projects momentum and snaps from this release velocity (screen fractions per ms).
function release(vx = 0, vy = 0) {
  if (active) send({ type: 'scroll', dx: 0, dy: 0, end: true, vx: vx / recenter.clientWidth, vy: vy / recenter.clientHeight });
}

function connect() {
  if (!key) { showSetup({ heading: 'Scan the code', message: 'Open this page using the QR code on the computer.' }); return; }
  showSetup({ heading: 'Connecting', waiting: true });
  socket = new WebSocket(`${location.origin.replace('http', 'ws')}/connect?role=phone&key=${encodeURIComponent(key)}`);
  socket.onopen = () => enableMotion();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'replaced') { clearTimeout(retry); socket.onclose = null; socket.close(); buzz([12, 40, 18]); showSetup({ heading: 'Another phone connected', message: 'Scan the QR code to reconnect this phone.' }); }
  };
  socket.onclose = event => {
    buzz([12, 40, 18]);
    showSetup(event.code === 1008 ? { heading: 'Session ended', message: 'Scan the QR code on the computer again.' } : { heading: 'Reconnecting', waiting: true });
    if (event.code !== 1008) retry = setTimeout(connect, 1500);
  };
}
window.addEventListener('deviceorientation', event => {
  if (event.alpha == null || event.beta == null) return;
  aim = direction(event.alpha, event.beta);
  clearTimeout(sensorTimer);
  if (enabled && !active && socket?.readyState === WebSocket.OPEN) calibrate();
  if (active && performance.now() - lastSent > 30) { send({ type: 'aim', direction: aim }); lastSent = performance.now(); }
});
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Screen wake lock is optional. */ }
}
function calibrate() {
  if (!aim || !project(aim, aim)) { showSetup({ heading: 'Tilt your phone', message: 'Tilt your phone slightly.' }); return; }
  if (socket?.readyState !== WebSocket.OPEN) return;
  cancelActivation(); tapCount = 0;
  send({ type: 'calibrate', direction: aim });
  if (!active) buzz(10);
  active = true; setup.hidden = true; recenter.hidden = false; status.hidden = true;
  keepAwake();
}
function waitForMotion() {
  aim = null;
  showSetup({ heading: 'Connecting', waiting: true });
  // Use a fresh reading for the starting angle, including after reconnecting.
  sensorTimer = setTimeout(() => { if (!aim) showSetup({ heading: 'No motion', message: 'No motion data. Check motion access in your browser settings, then reload.' }); }, 5000);
}
async function enableMotion(fromTap = false) {
  if (requestingMotion) return;
  showSetup({ heading: 'Connecting', waiting: true });
  if (!window.isSecureContext) { showSetup({ heading: 'Use Safari', message: 'Motion needs a secure connection. Open the QR link in Safari.' }); return; }
  if (!window.DeviceOrientationEvent) { showSetup({ heading: 'Use your iPhone', message: 'This browser does not provide motion sensors. Open the QR link in Safari on your iPhone.' }); return; }
  if (enabled) { waitForMotion(); return; }
  requestingMotion = true;
  try {
    // Existing permission resolves without a tap. An undecided permission
    // rejects with NotAllowedError until this call runs inside a user tap.
    const permission = typeof DeviceOrientationEvent.requestPermission === 'function' ? await DeviceOrientationEvent.requestPermission() : 'granted';
    if (permission !== 'granted') { showSetup({ heading: 'Motion is off', message: 'Motion access is blocked. Allow motion in your browser settings, then reload.' }); return; }
    enabled = true;
    if (socket?.readyState === WebSocket.OPEN) waitForMotion();
  } catch (err) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (!fromTap && err.name === 'NotAllowedError') showSetup({ heading: 'Motion', message: 'Allow motion and orientation so the pointer can follow your phone.', action: 'Allow motion' });
    else showSetup({ heading: 'Motion did not start', message: 'Motion could not start. Check motion access in your browser settings, then reload.' });
  } finally { requestingMotion = false; }
}
start.addEventListener('click', () => { buzz(10); return enableMotion(true); });
recenter.addEventListener('click', event => {
  if (ignoreClick) { ignoreClick = false; return; }
  if (!active) return;
  if (event?.detail) dots?.tap(event.clientX, event.clientY);
  cancelActivation();
  const now = performance.now();
  tapCount = now - lastTap <= 450 ? tapCount + 1 : 1;
  lastTap = now;
  buzz(tapCount === 3 ? 18 : 8);
  if (tapCount === 3) { tapCount = 0; calibrate(); }
  else tapTimer = setTimeout(() => {
    // Wait for the triple-tap window before selecting anything.
    if (active && tapCount === 1) send({ type: 'activate' });
    tapCount = 0; tapTimer = null;
  }, 450);
});
// Handle the drag directly so Safari never starts a native phone scroll gesture.
// Orientation events keep their own independent send path above.
// Swipe axes always come from the phone display, never from its sensor angles.
recenter.addEventListener('pointerdown', event => {
  if (!active || !event.isPrimary || event.button !== 0) return;
  cancelActivation();
  ignoreClick = false;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, time: performance.now(), vx: 0, vy: 0 };
  scrollBy(0, 0, true);
  recenter.setPointerCapture(event.pointerId);
});
recenter.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = drag.x - event.clientX, dy = drag.y - event.clientY;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  if (!drag.moved) buzz(6);
  drag.moved = true; ignoreClick = true; tapCount = 0;
  const now = performance.now(), elapsed = Math.max(1, now - drag.time);
  dots?.move(event.clientX, event.clientY, -dx, -dy, elapsed);
  scrollBy(dx, dy);
  drag.vx = drag.vx * .25 + dx / elapsed * .75;
  drag.vy = drag.vy * .25 + dy / elapsed * .75;
  drag.x = event.clientX; drag.y = event.clientY; drag.time = now;
});
recenter.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.id) return;
  ignoreClick = drag.moved || !recenter.contains(document.elementFromPoint(event.clientX, event.clientY));
  if (ignoreClick) tapCount = 0;
  const released = drag;
  drag = null;
  dots?.release();
  // Holding still before lifting means no flick.
  if (released.moved && performance.now() - released.time < 80) release(released.vx, released.vy); else release();
});
recenter.addEventListener('pointercancel', () => { cancelActivation(); if (drag) release(); drag = null; tapCount = 0; ignoreClick = true; dots?.release(); });
recenter.addEventListener('touchmove', event => { if (drag?.moved) event.preventDefault(); }, { passive: false });
recenter.addEventListener('wheel', event => {
  cancelActivation();
  event.preventDefault(); tapCount = 0;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? recenter.clientHeight : 1;
  scrollBy(event.deltaX * scale, event.deltaY * scale, true);
}, { passive: false });
recenter.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); tapCount = 0; buzz(18); calibrate(); }
  const delta = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40], PageUp: [0, -recenter.clientHeight], PageDown: [0, recenter.clientHeight] }[event.key];
  if (delta) { event.preventDefault(); cancelActivation(); tapCount = 0; scrollBy(delta[0], delta[1], true); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && socket?.readyState === WebSocket.OPEN) enableMotion();
  if (document.visibilityState === 'hidden') { cancelActivation(); tapCount = 0; wakeLock?.release(); }
});
window.addEventListener('resize', () => { cancelActivation(); drag = null; tapCount = 0; ignoreClick = true; });
window.addEventListener('pagehide', () => { cancelActivation(); clearTimeout(retry); clearTimeout(sensorTimer); socket?.close(); });
connect();

// The original grid, with only its dots moving. Nothing runs once they have settled.
function setupDotGrid(canvas) {
  const context = canvas?.getContext('2d');
  if (!context) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let points = [], ripples = [], touch, bounds, frame, previous;
  const schedule = () => { frame ??= requestAnimationFrame(draw); };
  function reset() {
    cancelAnimationFrame(frame); frame = undefined; previous = undefined;
    touch = null; ripples = [];
    for (const point of points) point.ox = point.oy = point.vx = point.vy = 0;
    draw(performance.now());
  }
  function resize() {
    bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * ratio); canvas.height = Math.round(bounds.height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    points = [];
    // Match the old 18px, center-aligned CSS grid, including its dot color and size.
    for (let y = (bounds.height / 2) % 18; y < bounds.height; y += 18) {
      for (let x = (bounds.width / 2) % 18; x < bounds.width; x += 18) points.push({ x, y, ox: 0, oy: 0, vx: 0, vy: 0 });
    }
    reset();
  }
  function draw(now) {
    frame = undefined;
    const dt = Math.min(32, previous == null ? 16 : now - previous) / 1000;
    previous = now;
    ripples = ripples.filter(ripple => now - ripple.time < 600);
    const strength = touch ? Math.exp(-(now - touch.time) / 110) : 0;
    const decay = Math.exp(-28 * dt);
    let moving = false;
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = '#484848';
    context.beginPath();
    for (const point of points) {
      let tx = 0, ty = 0;
      if (touch && strength > .001) {
        const weight = Math.max(0, 1 - Math.hypot(point.x - touch.x, point.y - touch.y) / 108) ** 2 * strength;
        tx = touch.dx * weight; ty = touch.dy * weight;
      }
      for (const ripple of ripples) {
        const age = (now - ripple.time) / 600, dx = point.x - ripple.x, dy = point.y - ripple.y;
        const distance = Math.hypot(dx, dy);
        const wave = 2.8 * Math.exp(-(((distance - age * 150) / 20) ** 2)) * (1 - age) ** 2;
        tx += dx / Math.max(1, distance) * wave; ty += dy / Math.max(1, distance) * wave;
      }
      const limit = Math.max(1, Math.hypot(tx, ty) / (touch ? 6 : 3.5));
      tx /= limit; ty /= limit;
      // Critically damped, carrying the current velocity when a new gesture arrives.
      const x = point.ox - tx, y = point.oy - ty, vx = point.vx + 28 * x, vy = point.vy + 28 * y;
      point.ox = tx + (x + vx * dt) * decay; point.oy = ty + (y + vy * dt) * decay;
      point.vx = (point.vx - 28 * vx * dt) * decay; point.vy = (point.vy - 28 * vy * dt) * decay;
      if (Math.hypot(point.ox, point.oy, point.vx / 28, point.vy / 28) < .01) point.ox = point.oy = point.vx = point.vy = 0;
      else moving = true;
      context.moveTo(point.x + point.ox + 1, point.y + point.oy);
      context.arc(point.x + point.ox, point.y + point.oy, 1, 0, Math.PI * 2);
    }
    context.fill();
    if (moving || ripples.length || strength > .001) schedule(); else previous = undefined;
  }
  resize();
  canvas.style.backgroundImage = 'none';
  window.addEventListener('resize', resize);
  reduced.addEventListener('change', reset);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') reset(); });
  return {
    move(x, y, dx, dy, elapsed) {
      if (reduced.matches) return;
      touch = { x: x - bounds.left, y: y - bounds.top, dx: 6 * Math.tanh(dx / elapsed), dy: 6 * Math.tanh(dy / elapsed), time: performance.now() };
      schedule();
    },
    tap(x, y) {
      if (reduced.matches) return;
      ripples.push({ x: x - bounds.left, y: y - bounds.top, time: performance.now() });
      if (ripples.length > 3) ripples.shift();
      schedule();
    },
    release() { touch = null; },
    reset,
  };
}
