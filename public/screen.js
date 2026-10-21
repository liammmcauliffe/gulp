import { project } from './pointing.js';
import { setupSports } from './nba.js';
import { activateControl } from './player.js';
import { RESPONSE, lastShelfSnapScrollTop, nearest, projection, scheduleScrollEndPadding, spring } from './snap.js';

const qr = document.querySelector('#qr'), dot = document.querySelector('#dot'), error = document.querySelector('#error');
const page = document.querySelector('.tv-canvas'), accounts = document.querySelector('#accounts');
let center, socket, retry, target, position, serverKey, scrollRow, scrollHit, axis, idle, idleTimer, awakeAt, screenOffset, hovered, hoveredZone, mouseDrive = false, lastMousePosition, pageSnapMax = 0;
let localPointer = null, localUntil = 0;
let drawFrame = null, drawnAt = 0, hoverUntil = 0, pointerTransform;
function requestDraw() { drawFrame ??= requestAnimationFrame(draw); }
const helperEvents = [], LOCAL_PRIORITY = 3000;
const glides = new Map();
// Settings offers the QR while waiting for a phone; its icon can dismiss that automatic opening.
const settings = document.querySelector('.settings'), settingsPanel = document.querySelector('#settings-panel');
const paired = on => {
  accounts.hidden = !on;
  if (on) { settings?.classList.remove('is-dismissed'); settingsPanel.inert = false; }
  settings?.classList.toggle('is-waiting', !on && !settings.classList.contains('is-dismissed'));
  requestDraw();
};
document.querySelector('#settings')?.addEventListener('click', () => {
  if (center) return;
  const closed = !settings.classList.contains('is-dismissed');
  settings.classList.toggle('is-dismissed', closed);
  settings.classList.toggle('is-waiting', !closed);
  settingsPanel.inert = closed;
});
// Profiles: Liam by default; remember the selection and show its picture in the header.
const profiles = [...document.querySelectorAll('.profile')];
function chooseProfile(name) {
  if (!profiles.some(profile => profile.dataset.profile === name)) name = 'Liam';
  // Current person lives in the header (picture + name). The list is everyone else, so the picture isn't shown twice.
  for (const profile of profiles) {
    profile.hidden = profile.dataset.profile === name;
    profile.setAttribute('aria-checked', String(profile.hidden));
  }
  document.querySelector('#profile-title').textContent = name;
  document.querySelector('.avatar')?.setAttribute('aria-label', `Profile: ${name}`);
  const picture = profiles.find(profile => profile.dataset.profile === name)?.querySelector?.('img')?.getAttribute('src');
  const avatar = document.querySelector('.avatar img');
  if (avatar) { avatar.hidden = !picture; if (picture) avatar.setAttribute('src', picture); }
}
// A picture that fails to load hides itself so the fallback icon shows; a later successful load brings it back.
document.addEventListener('error', event => { if (event.target.matches?.('.avatar img, .profile-picture')) event.target.hidden = true; }, true);
document.addEventListener('load', event => { if (event.target.matches?.('.avatar img, .profile-picture')) event.target.hidden = false; }, true);
for (const img of document.querySelectorAll('.avatar img, .profile-picture')) if (img.complete && !img.naturalWidth) img.hidden = true;
for (const profile of profiles) profile.addEventListener('click', () => {
  chooseProfile(profile.dataset.profile);
  try { localStorage.setItem('gulp:profile', profile.dataset.profile); } catch { /* this session only */ }
});
try { chooseProfile(localStorage.getItem('gulp:profile')); } catch { chooseProfile('Liam'); }
// Keep real focus for accessibility, but show keyboard focus styling only for keyboard input.
document.addEventListener('pointerdown', () => document.body.classList.add('is-pointer'), true);
document.addEventListener('keydown', event => {
  if (!event.metaKey && !event.altKey && !event.ctrlKey) document.body.classList.remove('is-pointer');
}, true);

// Rows only scroll on x and the page only on y, so one glide per element.
function stopGlide(element) { cancelAnimationFrame(glides.get(element)); glides.delete(element); }
function glide(element, prop, to, velocity) {
  stopGlide(element);
  const from = element[prop];
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { element[prop] = to; return; }
  if (Math.abs(to - from) < .5) { element[prop] = to; return; }
  let start;
  const step = now => {
    start ??= now;
    const t = now - start, done = t >= 3 * RESPONSE;
    element[prop] = done ? to : spring(from, to, velocity, t);
    requestDraw();
    if (done) glides.delete(element); else glides.set(element, requestAnimationFrame(step));
  };
  glides.set(element, requestAnimationFrame(step));
}

function syncScheduleScrollEnd() {
  const shelves = [...page.querySelectorAll('.shelf')];
  if (!shelves.length) {
    pageSnapMax = 0;
    page.style.removeProperty('--schedule-scroll-end');
    return;
  }
  const gutter = parseFloat(getComputedStyle(page).getPropertyValue('--gutter')) || 0;
  const base = shelves[0].offsetTop, last = shelves.at(-1);
  pageSnapMax = lastShelfSnapScrollTop(page.clientHeight, base, last.offsetTop, last.offsetHeight);
  const naturalMax = last.offsetTop + last.offsetHeight + gutter - page.clientHeight;
  page.style.setProperty('--schedule-scroll-end', `${scheduleScrollEndPadding(pageSnapMax, naturalMax)}px`);
  clampPageScroll();
}

function pageScrollCap() {
  const max = page.scrollHeight - page.clientHeight;
  return pageSnapMax > 0 ? Math.min(max, pageSnapMax) : max;
}

function clampPageScroll() {
  const cap = pageScrollCap();
  if (page.scrollTop > cap) page.scrollTop = cap;
}

document.addEventListener('gulp:schedule', syncScheduleScrollEnd);
document.addEventListener('gulp:schedule', requestDraw);
window.addEventListener('resize', syncScheduleScrollEnd);
window.addEventListener('resize', requestDraw);
window.addEventListener('scroll', requestDraw, true);
document.addEventListener('transitionend', requestDraw, true);
page.addEventListener('scroll', clampPageScroll, { passive: true });

// Snap points are where each card or shelf would sit if it were first.
function rowTarget(row, value) {
  const cards = [...row.children], max = row.scrollWidth - row.clientWidth;
  return nearest([max, ...cards.map(card => Math.min(max, card.offsetLeft - cards[0].offsetLeft))], value);
}
function pageTarget(value) {
  const sections = [...page.querySelectorAll('.shelf')], cap = pageScrollCap();
  if (!sections.length) return Math.max(0, Math.min(cap, value));
  const base = sections[0].offsetTop;
  // Sections taller than the screen scroll freely inside, so none of their content is unreachable.
  if (sections.some(s => value > s.offsetTop - base && value < s.offsetTop + s.offsetHeight - page.clientHeight)) return Math.max(0, Math.min(cap, value));
  return nearest([0, cap, ...sections.map(s => Math.min(cap, s.offsetTop - base))], value);
}
// The PiP follows the finger, then flicks to the nearest corner like iPhone picture-in-picture.
const pip = { el: null, x: 0, y: 0, dragging: false };
const placePip = () => { pip.el.style.setProperty('--pip-x', `${pip.x}px`); pip.el.style.setProperty('--pip-y', `${pip.y}px`); };
const pipX = { get v() { return pip.x; }, set v(n) { pip.x = n; placePip(); } };
const pipY = { get v() { return pip.y; }, set v(n) { pip.y = n; placePip(); } };
function grabPip(el) {
  stopGlide(pipX); stopGlide(pipY);
  const rect = el.getBoundingClientRect();
  Object.assign(pip, { el, x: rect.left, y: rect.top, dragging: true });
}
function settlePip(vx = 0, vy = 0) {
  pip.dragging = false;
  const rect = pip.el.getBoundingClientRect(), margin = 32;
  // Top corners stay below the header so the PiP never covers the nav.
  glide(pipX, 'v', nearest([margin, innerWidth - rect.width - margin], pip.x + projection(vx)), vx);
  glide(pipY, 'v', nearest([160, innerHeight - rect.height - margin], pip.y + projection(vy)), vy);
}

// Pull to refresh, iOS-style: the shelves follow with rubber-band resistance and a spinner shows
// above them; let go past the threshold and it holds open until the schedule has reloaded.
const shelves = document.querySelector('.schedule'), spinner = document.querySelector('#pull');
const pull = { active: false, d: 0, shown: 0, refreshing: false }, PULL_TRIGGER = 72, PULL_HOLD = 64;
const rubber = d => d * innerHeight * .55 / (innerHeight + .55 * d);
function showPull(offset) {
  pull.shown = offset;
  if (shelves) shelves.style.transform = offset ? `translateY(${offset}px)` : '';
  if (spinner) {
    spinner.style.opacity = Math.max(0, Math.min(1, offset / PULL_HOLD));
    if (!pull.refreshing && !spinner.classList.contains('is-spinning')) {
      const progress = Math.max(0, Math.min(1, offset / PULL_TRIGGER));
      spinner.style.setProperty('--pull-progress', progress);
    }
    if (!offset && !pull.refreshing) spinner.classList.remove('is-spinning');
  }
}
const pullSpring = { get v() { return pull.shown; }, set v(n) { showPull(n); } };
async function refreshContent(velocity = 0) {
  if (pull.refreshing) return;
  pull.active = false;
  pull.d = 0;
  pull.refreshing = true;
  spinner?.classList.add('is-spinning');
  shelves?.setAttribute('aria-busy', 'true');
  glide(pullSpring, 'v', PULL_HOLD, velocity);
  try { await sports.refresh(); }
  finally {
    pull.refreshing = false;
    shelves?.removeAttribute('aria-busy');
    glide(pullSpring, 'v', 0, 0);
  }
}
function releasePull(velocity = 0) {
  pull.active = false;
  const triggered = rubber(pull.d) >= PULL_TRIGGER && !pull.refreshing;
  // Transfer finger velocity through the same rubber-band curve used during the pull.
  const releaseVelocity = velocity * .55 * (innerHeight / (innerHeight + .55 * pull.d)) ** 2;
  pull.d = 0;
  if (triggered) refreshContent(releaseVelocity);
  else glide(pullSpring, 'v', 0, releaseVelocity);
}
document.addEventListener('gulp:refresh', () => {
  clearTimeout(idle);
  stopGlide(page);
  scrollRow = null; scrollHit = null;
  refreshContent();
});

// In full view a downward swipe drags the video toward the corner; let go far or fast enough and it becomes PiP.
let dismiss = 0;
const fullView = () => document.querySelector('#watch:not([hidden],.is-pip), #embed-shell:not([hidden],.is-pip)');
function dragDismiss(view, message) {
  if (message.begin) dismiss = 0;
  dismiss = Math.max(0, dismiss - message.dy * innerHeight);
  view.style.transformOrigin = '50% 100%';
  view.style.transform = dismiss ? `translateY(${dismiss * .5}px) scale(${1 - Math.min(dismiss, 800) / 3200})` : '';
  clearTimeout(idle);
  if (message.end) releaseDismiss(view, -message.vy * innerHeight);
  else idle = setTimeout(() => releaseDismiss(view, 0), 600);
}
function releaseDismiss(view, velocity) {
  const pulled = dismiss;
  dismiss = 0;
  if (pulled + projection(velocity) > 160) { document.dispatchEvent(new CustomEvent('gulp:pip')); return; }
  const from = view.style.transform;
  view.style.transform = '';
  if (from) view.animate?.([{ transform: from }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' });
}

function settle(vx = 0, vy = 0) {
  clearTimeout(idle);
  scrollHit = null;
  if (pip.dragging) { settlePip(-vx, -vy); return; }
  if (pull.active || pull.d) { releasePull(-vy); return; }
  if (scrollRow?.isConnected) glide(scrollRow, 'scrollLeft', rowTarget(scrollRow, scrollRow.scrollLeft + projection(vx)), vx);
  glide(page, 'scrollTop', pageTarget(page.scrollTop + projection(vy)), vy);
}

function controlAtPointer() {
  const { x, y } = pointerPoint();
  return document.elementFromPoint(x, y)?.closest('a, button, input, textarea, select, summary, [role="button"]');
}

function pointerPoint() {
  const p = position ?? target ?? { x: .5, y: .5 };
  // The fingertip is the hotspot, so it can reach every pixel like a desktop cursor.
  return { x: Math.min(innerWidth - 1, p.x * innerWidth), y: Math.min(innerHeight - 1, p.y * innerHeight) };
}

function rowAtPointer() {
  const { y } = pointerPoint();
  let nearest, distance = Infinity;
  for (const row of document.querySelectorAll('[data-scroll-row]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) continue;
    const gap = Math.max(rect.top - y, y - rect.bottom, 0);
    if (gap < distance) { nearest = row; distance = gap; }
  }
  return nearest;
}

function phoneFollows() {
  return !!(center && !localPointer && (target || position));
}

function sendMouse(message) {
  if (localPointer || socket?.readyState !== WebSocket.OPEN) return;
  if (message.action === 'move') { if (!phoneFollows()) return; }
  else if (!mouseDrive) return;
  const previous = helperEvents.findLast(event => event.action === 'move');
  helperEvents.push({ action: message.action, x: message.x ?? previous?.x, y: message.y ?? previous?.y, at: performance.now() });
  if (helperEvents.length > 40) helperEvents.shift();
  socket.send(JSON.stringify(message));
}

function syncMouseMove() {
  if (!phoneFollows() || !center || !target) return;
  const { x, y } = pointerPoint();
  // The OS mouse uses screen coordinates. A real pointer event gives the exact page → screen offset;
  // until one arrives, estimate it from the window position and the browser bars above the page.
  // ponytail: offset only, assumes 100% browser zoom; zoom would need a second sample to get the scale.
  const offset = screenOffset ?? { x: screenX + (outerWidth - innerWidth) / 2, y: screenY + outerHeight - innerHeight };
  const point = { x: Math.round(x + offset.x), y: Math.round(y + offset.y) };
  if (lastMousePosition?.x === point.x && lastMousePosition?.y === point.y) return;
  lastMousePosition = point;
  sendMouse({ type: 'mouse', action: 'move', ...point });
}

// Any real mouse movement over the page, ours or the helper's, measures the offset; the catch layer
// covers the embed until then, because moves over a cross-origin iframe never reach this page.
const embedCatch = document.querySelector('#embed-catch');
function syncMouseMode() {
  lastMousePosition = null;
  const follow = phoneFollows();
  const embed = mouseDrive && !localPointer;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'mouse-mode', on: follow }));
  if (embedCatch) embedCatch.hidden = !embed;
}

function takeLocal(event, action = 'move') {
  if (event.isTrusted === false) return false;
  const now = performance.now();
  // ponytail: the DOM cannot tag injected OS events; match recent helper coordinates.
  // Exact physical clicks at the same point need native input reporting to distinguish them.
  if (helperEvents.some(sent => sent.action === action && now - sent.at < 1500
    && Math.abs(event.screenX - sent.x) <= 2 && Math.abs(event.screenY - sent.y) <= 2)) return false;
  const first = !localPointer;
  localPointer = { x: event.clientX / innerWidth, y: event.clientY / innerHeight };
  localUntil = now + LOCAL_PRIORITY;
  if (first) {
    clearTimeout(idle);
    for (const element of glides.keys()) if (element !== pullSpring || !pull.refreshing) stopGlide(element);
    scrollRow = null; scrollHit = null; axis = null; pip.dragging = false;
    if (!pull.refreshing && (pull.active || pull.d || pull.shown)) { pull.active = false; pull.d = 0; showPull(0); }
    if (dismiss) { const view = fullView(); if (view) view.style.transform = ''; dismiss = 0; }
    syncMouseMode();
  }
  awake();
  requestDraw();
  return true;
}

window.addEventListener('pointermove', event => {
  screenOffset = { x: event.screenX - event.clientX, y: event.screenY - event.clientY };
  if (embedCatch) embedCatch.hidden = true;
  takeLocal(event);
});
window.addEventListener('pointerdown', event => {
  if (takeLocal(event, 'click')) dot.firstElementChild?.animate?.([{ scale: .85 }, { scale: 1 }], { duration: 200, easing: 'cubic-bezier(.23,1,.32,1)', composite: 'add' });
});
window.addEventListener('wheel', event => { takeLocal(event, 'scroll'); }, { passive: true });

// Players hide their controls and the pointer after a few still seconds, like other video apps.
function awake() {
  if (document.body?.classList.contains('is-idle')) document.body.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body?.classList.add('is-idle'), 2500);
}

async function connect() {
  try {
    const response = await fetch('/api/session');
    const session = await response.json();
    if (!response.ok) throw new Error(session.error);
    if (!session.ready) { retry = setTimeout(connect, 1000); return; }
    if (serverKey && serverKey !== session.key) { location.reload(); return; }
    serverKey = session.key;
    qr.src = session.qr;
    qr.hidden = false;
    if (!center) paired(false);
    error.hidden = true;
    socket = new WebSocket(`${location.origin.replace('http', 'ws')}/connect?role=screen&key=${session.key}`);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      requestDraw();
      if (message.type === 'reload') { location.reload(); return; }
      if (message.type === 'calibrate') {
        center = message.direction; scrollRow = null; scrollHit = null; target = { x: .5, y: .5 };
        if (!localPointer) position = null;
        paired(true);
        syncMouseMode();
      }
      if (localPointer && ['calibrate', 'aim', 'activate', 'scroll'].includes(message.type)) {
        if (performance.now() < localUntil) return;
        localPointer = null; position = null; syncMouseMode();
      }
      if (message.type === 'aim' && center) {
        target = project(message.direction, center, innerWidth / innerHeight);
        // Move is driven from draw() while mouseDrive is on so it tracks the smoothed cursor.
      }
      if (message.type === 'activate' && center && target) {
        if (mouseDrive) {
          const control = controlAtPointer();
          // Back (and any Gulp chrome) still uses the in-page pointer; the embed needs the OS mouse.
          if (control?.closest?.('#embed-shell button')) activateControl(control, pointerPoint().x);
          else sendMouse({ type: 'mouse', action: 'click' });
        } else {
          const control = controlAtPointer();
          control?.animate?.([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
          dot.firstElementChild?.animate?.([{ scale: .85 }, { scale: 1 }], { duration: 200, easing: 'cubic-bezier(.23,1,.32,1)', composite: 'add' });
          activateControl(control, pointerPoint().x);
        }
      }
      if (message.type === 'scroll' && center && Number.isFinite(message.dx) && Number.isFinite(message.dy)) {
        // A swipe stays on its starting surface even while the phone keeps aiming.
        if (message.begin || !scrollHit) { const { x, y } = pointerPoint(); scrollHit = document.elementFromPoint(x, y); }
        const hit = scrollHit, sourcePanel = hit?.closest('.sources-list, .sources-panel');
        if (message.end) scrollHit = null;
        if (sourcePanel) { sourcePanel.scrollTop += message.dy * innerHeight; return; }
        // In a full-view player, the trackpad's swipe down is the gesture into picture-in-picture.
        const view = fullView();
        if (view) { dragDismiss(view, message); return; }
        // Keep the swipe and its settle on the row where the touch began; a touch stops any glide.
        if (message.begin || !scrollRow) {
          const floating = hit?.closest('.is-pip');
          if (floating) grabPip(floating); else pip.dragging = false;
          scrollRow = rowAtPointer(); axis = null;
          if (scrollRow) stopGlide(scrollRow);
          stopGlide(page);
        }
        if (pip.dragging) {
          // Swipes scroll content the other way, so the PiP moves opposite the scroll delta to follow the finger.
          pip.x -= message.dx * innerWidth; pip.y -= message.dy * innerHeight; placePip();
          clearTimeout(idle);
          if (message.end) settle(message.vx * innerWidth, message.vy * innerHeight);
          else idle = setTimeout(settle, 600);
          return;
        }
        // Lock to the dominant axis so a vertical swipe never nudges a row.
        if (!axis && (message.dx || message.dy)) axis = Math.abs(message.dx * innerWidth) >= Math.abs(message.dy * innerHeight) ? 'x' : 'y';
        if (axis === 'x' && scrollRow && message.dx) { stopGlide(scrollRow); scrollRow.scrollLeft += message.dx * innerWidth; }
        if (axis === 'y' && message.dy) {
          stopGlide(page);
          // Pulling down at the very top turns into pull-to-refresh instead of scrolling.
          if (!pull.active && !pull.refreshing && page.scrollTop <= 0 && message.dy < 0) {
            pull.active = true;
            // Re-grab a returning refresh from its visible position, rather than jumping to zero.
            const shown = Math.max(0, Math.min(innerHeight - 1, pull.shown));
            pull.d = shown * innerHeight / (.55 * (innerHeight - shown));
            spinner?.classList.remove('is-spinning');
          }
          if (pull.active) {
            pull.d = Math.max(0, pull.d - message.dy * innerHeight);
            stopGlide(pullSpring); showPull(rubber(pull.d));
            if (!pull.d) pull.active = false;
          } else { page.scrollTop += message.dy * innerHeight; clampPageScroll(); }
        }
        clearTimeout(idle);
        if (message.end) settle(axis === 'x' ? message.vx * innerWidth : 0, axis === 'y' ? message.vy * innerHeight : 0);
        else idle = setTimeout(settle, 600); // Wheel/keys, or a lost release.
      }
      if (message.type === 'disconnected') {
        center = null; target = null; dot.hidden = !localPointer; paired(false); syncMouseMode();
      }
    };
    socket.onclose = () => { dot.hidden = !localPointer; paired(false); center = null; target = null; retry = setTimeout(connect, 1500); };
    syncMouseMode();
  } catch { error.textContent = 'Can’t connect to Gulp. Trying again…'; error.hidden = false; retry = setTimeout(connect, 3000); }
}
function draw() {
  drawFrame = null;
  const now = performance.now(), elapsed = drawnAt ? Math.max(0, now - drawnAt) : 16.67;
  drawnAt = now;
  let moving = false;
  if (localPointer || target && center) {
    if (localPointer) position = { ...localPointer };
    else {
      position ||= { ...target };
      // Keep the same response time when the TV drops frames; settle subpixel noise exactly.
      const blend = 1 - Math.exp(-elapsed / 28);
      position.x += (target.x - position.x) * blend;
      position.y += (target.y - position.y) * blend;
      moving = Math.hypot((target.x - position.x) * innerWidth, (target.y - position.y) * innerHeight) > .1;
      if (!moving) position = { ...target };
    }
    const { x, y } = pointerPoint();
    // Read the hit target once, before any style writes can invalidate browser layout.
    const hit = document.elementFromPoint(x, y);
    const control = hit?.closest('a, button, input, textarea, select, summary, [role="button"]');
    const zone = hit?.closest('[data-hover]');
    const transform = `translate3d(${Math.round(x * 4) / 4}px,${Math.round(y * 4) / 4}px,0)`;
    // CSSOM serializes transforms differently across Chromium versions; compare our own value.
    if (pointerTransform !== transform) {
      pointerTransform = transform;
      dot.style.transform = transform;
      // Gulp already hit-tests the hand. Keep native hover in sync at target
      // boundaries; only a provider iframe needs OS movement on every frame.
      if (mouseDrive || !lastMousePosition || hovered !== control || hoveredZone !== zone) syncMouseMove();
      // A hand-held phone never sits perfectly still; only a real move wakes the player controls.
      if (!awakeAt || Math.hypot(x - awakeAt.x, y - awakeAt.y) > 8) { awakeAt = { x, y }; awake(); }
    }
    if (hovered !== control) {
      hovered?.classList.remove('is-pointed'); control?.classList.add('is-pointed'); hovered = control;
      dot.classList.toggle('is-hovering', !!control);
      hoverUntil = now + 350;
    }
    // [data-hover] areas (Settings) open while the phone pointer is anywhere over them, like a mouse :hover.
    if (hoveredZone !== zone) {
      hoveredZone?.classList.remove('is-hovered'); zone?.classList.add('is-hovered'); hoveredZone = zone;
      hoverUntil = now + 350;
    }
    if (dot.style.opacity !== '1') dot.style.opacity = '1';
    if (dot.hidden) dot.hidden = false;
  } else {
    if (dot.style.opacity !== '0') dot.style.opacity = '0';
    if (!dot.hidden) dot.hidden = true;
    if (hovered) { hovered.classList.remove('is-pointed'); hovered = null; dot.classList.toggle('is-hovering', false); }
    hoveredZone?.classList.remove('is-hovered'); hoveredZone = null;
  }
  if (moving || now < hoverUntil) requestDraw();
}
document.addEventListener('gulp:mouse-mode', event => {
  mouseDrive = !!event.detail?.on;
  syncMouseMode();
  syncMouseMove();
  requestDraw();
});
window.addEventListener('pagehide', () => {
  clearTimeout(retry);
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'mouse-mode', on: false }));
  socket?.close();
});
const sports = setupSports(); connect(); requestDraw(); awake();
