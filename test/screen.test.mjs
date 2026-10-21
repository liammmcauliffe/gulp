import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { direction, project } from '../public/pointing.js';
import { activateControl } from '../public/player.js';
import { RESPONSE, lastShelfSnapScrollTop, nearest, projection, scheduleScrollEndPadding, spring } from '../public/snap.js';

test('spring settles exactly on its target and starts at the release velocity', () => {
  assert.equal(spring(0, 400, 0, 0), 0);
  assert.ok(Math.abs(spring(0, 400, 0, 3 * RESPONSE) - 400) < .01);
  assert.ok(Math.abs(spring(0, 400, 2, 1) - 2) < .1, 'First millisecond moves at the hand-off velocity');
  assert.ok(projection(2) > projection(1) && projection(-1) < 0);
  assert.equal(nearest([0, 400, 800], 590), 400);
  assert.equal(lastShelfSnapScrollTop(1080, 280, 5200, 360), 5200 - 280);
  assert.equal(scheduleScrollEndPadding(4920, 4800), 120, 'Padding only bridges the gap to the last snap, not past it');
});

test('local pointer priority preserves phone swipes, scrolling, and player gestures', async () => {
  const elements = new Map(['qr', 'dot', 'error', 'accounts', 'schedule', 'pull', 'settings', 'settings-panel', 'avatar', 'avatar img', 'profile-title'].map(id => [id, { hidden: true, style: {}, listeners: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, classList: { add(name) { this[name] = true; }, remove(name) { this[name] = false; }, contains(name) { return !!this[name]; }, toggle(name, on) { this[name] = on; } }, addEventListener(type, callback) { this.listeners[type] = callback; } }]));
  // A full-view player that a swipe down can drag toward PiP.
  let fullViewOpen = false, refreshes = 0, finishRefresh, reducedMotion = false;
  const stored = { 'gulp:profile': 'Nobody' };
  const profiles = ['Liam', 'Austin', 'Daniel', 'Patrick'].map(name => ({
    dataset: { profile: name }, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector: () => ({ getAttribute: () => `/avatars/${name.toLowerCase()}.png` }),
    addEventListener(type, callback) { this.listeners[type] = callback; },
  }));
  const checked = () => profiles.filter(p => p.attributes['aria-checked'] === 'true').map(p => p.dataset.profile);
  const spinnerClasses = new Set();
  elements.get('pull').classList = { add: name => spinnerClasses.add(name), remove: name => spinnerClasses.delete(name), contains: name => spinnerClasses.has(name) };
  elements.get('pull').style.setProperty = function(name, value) { this[name] = value; };
  const fullView = { style: {}, animate() {} }, dispatched = [];
  const cursorClasses = new Set(), hitTests = [];
  let canonicalTransform = false, transformWrites = 0, cursorTransform;
  Object.defineProperty(elements.get('dot').style, 'transform', {
    get: () => canonicalTransform ? cursorTransform?.replaceAll(',', ', ').replace(', 0)', ', 0px)') : cursorTransform,
    set: value => { transformWrites++; cursorTransform = value; },
  });
  const inputClasses = new Set();
  const body = { classList: { add: name => inputClasses.add(name), remove: name => inputClasses.delete(name) } };
  let overControl = false, overPip = false, overSourcePanel = false, overEmbedControl = false;
  const sourcePanel = { scrollTop: 0 };
  // A 480×270 PiP resting bottom-right of a 1920×1080 screen.
  const pipEl = { style: { setProperty(key, value) { this[key] = value; } }, getBoundingClientRect: () => ({ left: 1408, top: 778, width: 480, height: 270 }) };
  let activations = 0;
  const control = { ownerDocument: { body }, focus() {}, closest: () => overEmbedControl ? control : null, classList: { add() {}, remove() {} }, click: () => { activations++; } };
  elements.get('dot').classList = { toggle: (name, active) => active ? cursorClasses.add(name) : cursorClasses.delete(name), add: name => cursorClasses.add(name), remove: name => cursorClasses.delete(name) };
  const sockets = [], timers = [], frames = new Map(), sent = [], documentListeners = {}, windowListeners = {};
  let reloads = 0, draw, drawRequests = 0, sessionKey = 'demo', frameId = 0, clock = 0;
  // Two shelves resting 400px apart; rows of 400px-spaced cards, 1400px of scroll.
  const shelves = [0, 400].map(offsetTop => ({ offsetTop, offsetHeight: 360 }));
  const page = { scrollTop: 0, scrollHeight: 1800, clientHeight: 1080, style: { removeProperty() {}, setProperty() {} }, addEventListener() {}, querySelectorAll: () => shelves };
  const rows = [100, 500].map(top => ({
    scrollLeft: 0, scrollWidth: 2400, clientWidth: 1000, isConnected: true,
    children: [0, 1, 2, 3, 4].map(i => ({ offsetLeft: 64 + i * 400 })),
    getBoundingClientRect: () => ({ top: top - page.scrollTop, bottom: top + 280 - page.scrollTop }),
  }));
  const runFrames = () => { for (let i = 0; i < 200 && frames.size; i++) { clock += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(f => f(clock)); } };
  const step = () => { const [id, callback] = [...frames].at(-1); frames.delete(id); callback(clock += 16); };
  const source = await readFile(new URL('../public/screen.js', import.meta.url), 'utf8');
  runInNewContext(source.replace(/^import .*;\n/gm, ''), {
    project, activateControl, RESPONSE, lastShelfSnapScrollTop, nearest, projection, scheduleScrollEndPadding, spring,
    setupSports: () => ({ refresh: () => { refreshes++; return new Promise(resolve => { finishRefresh = resolve; }); } }),
    matchMedia: () => ({ matches: reducedMotion }),
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value; } },
    document: {
      body,
      querySelector: selector => selector === '.tv-canvas' ? page : selector.startsWith('#watch:not') ? fullViewOpen && fullView : elements.get(selector.slice(1)),
      querySelectorAll: selector => selector === '.profile' ? profiles : rows, addEventListener: (type, callback) => { documentListeners[type] = callback; },
      dispatchEvent: event => dispatched.push(event.type),
      elementFromPoint: (x, y) => { hitTests.push({ x, y }); return { closest: selector => selector === '.sources-list, .sources-panel' ? overSourcePanel && sourcePanel : selector === '.is-pip' ? overPip && pipEl : overControl ? control : null }; },
    },
    window: { addEventListener: (type, callback) => { windowListeners[type] = callback; } }, innerWidth: 1920, innerHeight: 1080,
    // A laptop window at (100, 50) with 80px of tabs and address bar above the page.
    screenX: 100, screenY: 50, outerWidth: 1920, outerHeight: 1160, performance: { now: () => clock += 100 },
    location: { origin: 'http://localhost:4173', reload: () => { reloads++; } },
    fetch: async () => ({ ok: true, json: async () => ({ ready: true, key: sessionKey, qr: 'demo' }) }),
    WebSocket: class { static OPEN = 1; readyState = 1; constructor() { sockets.push(this); } send(data) { sent.push(JSON.parse(data)); } },
    requestAnimationFrame: callback => { if (callback.name === 'draw') { draw = callback; drawRequests++; return 0; } frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {},
  });
  await new Promise(setImmediate);
  assert.deepEqual(checked(), ['Liam'], 'Liam is the default profile, even if storage holds an unknown name');
  assert.equal(elements.get('avatar img').attributes.src, '/avatars/liam.png');
  assert.deepEqual(profiles.filter(profile => !profile.hidden).map(profile => profile.dataset.profile), ['Austin', 'Daniel', 'Patrick'], 'The current person is the header, not a second row');
  assert.equal(elements.get('profile-title').textContent, 'Liam');
  profiles[2].listeners.click();
  assert.deepEqual(checked(), ['Daniel'], 'Choosing a profile selects only that one');
  assert.equal(stored['gulp:profile'], 'Daniel', 'and remembers it');
  assert.equal(elements.get('avatar img').attributes.src, '/avatars/daniel.png', 'The header picture follows the chosen profile');
  assert.equal(elements.get('avatar').attributes['aria-label'], 'Profile: Daniel');
  assert.equal(elements.get('profile-title').textContent, 'Daniel');
  assert.deepEqual(profiles.filter(profile => !profile.hidden).map(profile => profile.dataset.profile), ['Liam', 'Austin', 'Patrick'], 'The previous person returns to the list');
  const receive = message => sockets[0].onmessage({ data: JSON.stringify(message) });
  receive({ type: 'scroll', dx: .25, dy: .1 });
  receive({ type: 'activate' });
  assert.equal(activations, 0, 'Activation requires calibration');
  assert.equal(page.scrollTop, 0);
  assert.equal(rows[1].scrollLeft, 0);
  assert.equal(elements.get('accounts').hidden, true);
  const settings = elements.get('settings');
  assert.equal(settings.classList['is-waiting'], true, 'Settings initially offers the pairing QR');
  settings.listeners.click();
  assert.equal(settings.classList['is-dismissed'], true, 'The icon force-closes Settings without a phone');
  assert.equal(settings.classList['is-waiting'], false);
  assert.equal(elements.get('settings-panel').inert, true, 'Dismissed controls cannot receive invisible keyboard focus');
  receive({ type: 'disconnected' });
  assert.equal(settings.classList['is-waiting'], false, 'Connection updates respect the manual dismissal');
  settings.listeners.click();
  assert.equal(settings.classList['is-dismissed'], false);
  assert.equal(settings.classList['is-waiting'], true, 'Clicking again reopens the QR');
  assert.equal(elements.get('settings-panel').inert, false);
  settings.listeners.click();
  const localEvent = (x, y) => ({ clientX: x, clientY: y, screenX: x + 100, screenY: y + 130 });
  windowListeners.pointermove(localEvent(300, 200));
  draw();
  assert.equal(elements.get('dot').hidden, false, 'The mouse uses the hand even without a paired phone');
  assert.equal(elements.get('dot').style.transform, 'translate3d(300px,200px,0)', 'Local movement follows the mouse immediately');
  clock += 4000;
  receive({ type: 'calibrate', direction: direction(0, 0) });
  assert.equal(elements.get('accounts').hidden, false, 'The connected account appears in the header');
  assert.equal(elements.get('qr').hidden, false, 'The QR stays available so more phones can join');
  assert.equal(elements.get('settings').classList['is-waiting'], false, 'Settings stops holding itself open once a phone is connected');
  assert.equal(settings.classList['is-dismissed'], false, 'Pairing restores the usual hover and keyboard behavior');
  assert.equal(elements.get('settings-panel').inert, false);
  settings.listeners.click();
  assert.equal(settings.classList['is-dismissed'], false, 'Connected phones keep the existing hover behavior');
  draw();
  assert.deepEqual(hitTests.at(-1), { x: 960, y: 540 }, 'Cursor rendering and hit testing share the centered position');
  assert.equal(elements.get('dot').style.transform, 'translate3d(960px,540px,0)');
  assert.equal(cursorClasses.has('is-hovering'), false);
  for (let i = 0; i < 60; i++) draw();
  const settledRequests = drawRequests;
  for (let i = 0; i < 60; i++) draw();
  assert.equal(drawRequests, settledRequests, 'A settled pointer must stop requesting animation frames');
  canonicalTransform = true;
  const settledWrites = transformWrites;
  for (let i = 0; i < 60; i++) draw();
  assert.equal(transformWrites, settledWrites, 'CSSOM transform serialization must not trigger repeated style writes');
  canonicalTransform = false;
  overControl = true; draw();
  assert.equal(cursorClasses.has('is-hovering'), true, 'The virtual phone pointer detects interactive controls');
  receive({ type: 'activate' });
  assert.equal(activations, 1, 'A phone tap selects the control at the cursor center');
  assert.ok(inputClasses.has('is-pointer'), 'A phone tap leaves keyboard focus presentation');
  documentListeners.keydown({ key: 'Tab' });
  assert.equal(inputClasses.has('is-pointer'), false, 'Tab restores visible keyboard focus');
  documentListeners.pointerdown();
  assert.ok(inputClasses.has('is-pointer'), 'A real mouse or touch press also leaves keyboard focus presentation');
  documentListeners.keydown({ key: 'Tab' });
  assert.equal(inputClasses.has('is-pointer'), false);
  overControl = false; draw();

  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: .1, dy: .04 });
  assert.equal(rows[1].scrollLeft, 192, 'The row under the pointer tracks the finger 1:1');
  assert.equal(page.scrollTop, 0, 'A mostly horizontal swipe never moves the page');
  receive({ type: 'aim', direction: direction(0, 8) });
  const previousPointer = elements.get('dot').style.transform;
  for (let i = 0; i < 60; i++) draw();
  assert.notEqual(elements.get('dot').style.transform, previousPointer, 'Aiming must continue during the swipe');
  receive({ type: 'scroll', dx: .05, dy: 0 });
  assert.equal(rows[0].scrollLeft, 0, 'Moving the pointer must not redirect an ongoing swipe');
  assert.equal(rows[1].scrollLeft, 288);
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  runFrames();
  assert.equal(rows[1].scrollLeft, 400, 'A slow release settles on the nearest card');

  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: .1, dy: 0 });
  assert.equal(rows[0].scrollLeft, 192, 'A new touch selects the row now under the pointer');
  assert.equal(rows[1].scrollLeft, 400, 'Other rows keep their own position');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  runFrames();
  receive({ type: 'aim', direction: direction(0, 0) });
  for (let i = 0; i < 60; i++) draw();

  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: .02, dy: 0 });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: .002, vy: 0 });
  runFrames();
  assert.equal(rows[1].scrollLeft, 1200, 'A flick projects momentum past several cards, then snaps');

  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: .01, dy: .15 });
  assert.equal(page.scrollTop, 162, 'A vertical swipe moves the page');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  runFrames();
  assert.equal(page.scrollTop, 0, 'A short vertical drag falls back to the current shelf');

  const shelvesStyle = elements.get('schedule').style;
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.2 });
  assert.equal(page.scrollTop, 0, 'Pulling down at the top does not scroll');
  assert.match(shelvesStyle.transform, /^translateY\((10\d)(\.\d+)?px\)$/, 'The shelves follow the pull with rubber-band resistance');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  assert.ok(spinnerClasses.has('is-spinning'), 'Rotation starts only when refresh begins');
  runFrames();
  assert.equal(shelvesStyle.transform, 'translateY(64px)', 'The spinner holds its space while the refresh is pending');
  finishRefresh();
  await new Promise(setImmediate);
  runFrames();
  assert.equal(refreshes, 1, 'Letting go past the threshold refreshes the schedule');
  assert.equal(spinnerClasses.has('is-spinning'), false, 'Rotation stops when refresh finishes');
  assert.equal(shelvesStyle.transform, '', 'Then the shelves spring back');
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.05 });
  const pullOffset = () => parseFloat(shelvesStyle.transform.slice(11));
  const releasedOffset = pullOffset();
  assert.ok(elements.get('pull').style['--pull-progress'] > 0 && elements.get('pull').style['--pull-progress'] < 1, 'A short pull reveals a partial arc before the refresh threshold');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: -.002 });
  step(); step();
  assert.ok(pullOffset() > releasedOffset, 'The return spring inherits the downward finger velocity before settling');
  const returningOffset = pullOffset();
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.005 });
  assert.ok(pullOffset() > returningOffset, 'Re-grabbing the return continues from its visible position');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  await new Promise(setImmediate); runFrames();
  assert.equal(refreshes, 1, 'A short pull just springs back');
  reducedMotion = true;
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.05 });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  assert.equal(shelvesStyle.transform, '', 'Reduced motion returns the pull without a moving spring');
  reducedMotion = false;

  documentListeners['gulp:refresh']();
  assert.equal(refreshes, 2, 'Reselecting Sports starts the same refresh as a pull');
  assert.ok(spinnerClasses.has('is-spinning'));
  assert.equal(elements.get('schedule').attributes['aria-busy'], 'true');
  documentListeners['gulp:refresh']();
  assert.equal(refreshes, 2, 'Repeated Sports clicks do not overlap refreshes');
  finishRefresh(); await new Promise(setImmediate); runFrames();
  assert.equal(shelvesStyle.transform, '', 'A Sports refresh also settles the content back');
  assert.equal(spinnerClasses.has('is-spinning'), false);
  assert.equal(elements.get('schedule').attributes['aria-busy'], undefined);

  fullViewOpen = true;
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.05 });
  assert.match(fullView.style.transform, /^translateY\(27px\) scale\(/, 'In full view the video follows a swipe down');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  assert.equal(fullView.style.transform, '', 'A small drag springs back');
  assert.deepEqual(dispatched, []);
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: -.1 });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: -.002 });
  assert.deepEqual(dispatched, ['gulp:pip'], 'A fast swipe down sends the video to picture-in-picture');
  assert.equal(page.scrollTop, 0, 'Swipes in full view never scroll the page underneath');
  fullViewOpen = false;
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: .1 });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: .001 });
  step(); step();
  const midway = page.scrollTop;
  assert.ok(midway > 108 && midway < 400, 'The page is gliding toward the next shelf');
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  assert.equal(frames.size, 0, 'Touching again stops the glide where it is');
  assert.equal(page.scrollTop, midway);
  receive({ type: 'scroll', dx: 0, dy: .2 });
  assert.equal(page.scrollTop, midway + 216, 'Dragging resumes from the on-screen position');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  runFrames();
  assert.equal(page.scrollTop, 400, 'Releasing settles on the next shelf');

  overPip = true;
  const pageBefore = page.scrollTop, rowBefore = rows[1].scrollLeft;
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: -.1, dy: .4 });
  assert.deepEqual([pipEl.style['--pip-x'], pipEl.style['--pip-y']], ['1600px', '346px'], 'The PiP follows the finger right and up');
  assert.deepEqual([page.scrollTop, rows[1].scrollLeft], [pageBefore, rowBefore], 'Dragging the PiP scrolls nothing underneath');
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: 0 });
  runFrames();
  assert.deepEqual([pipEl.style['--pip-x'], pipEl.style['--pip-y']], ['1408px', '160px'], 'Released, it settles in the nearest corner, below the header');
  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: .002, vy: 0 });
  runFrames();
  assert.equal(pipEl.style['--pip-x'], '32px', 'A leftward flick throws it to the far corner');
  overPip = false;

  receive({ type: 'scroll', dx: 0, dy: 0, begin: true });
  receive({ type: 'scroll', dx: 0, dy: .1 });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 0, vy: .002 });
  step();
  assert.ok(frames.size, 'A phone flick is still gliding');
  windowListeners.wheel(localEvent(500, 300));
  assert.equal(frames.size, 0, 'Local trackpad input immediately cancels the phone glide');
  clock += 4000;
  receive({ type: 'calibrate', direction: direction(0, 0) });

  documentListeners['gulp:mouse-mode']({ detail: { on: true } });
  receive({ type: 'aim', direction: direction(0, 0) });
  for (let i = 0; i < 60; i++) draw();
  const move = sent.filter(m => m.action === 'move').at(-1);
  assert.deepEqual([Math.round(move.x), Math.round(move.y)], [1060, 670], 'The OS mouse lands under the drawn pointer, past the window position and browser bars');
  overControl = true; overEmbedControl = true;
  const beforeSourceTap = activations, beforeMouseClicks = sent.filter(m => m.action === 'click').length;
  receive({ type: 'activate' });
  assert.equal(activations, beforeSourceTap + 1, 'Phone taps activate nested source buttons while embed mouse mode is armed');
  assert.equal(sent.filter(m => m.action === 'click').length, beforeMouseClicks, 'A source tap does not also click the provider player');
  overSourcePanel = true; fullViewOpen = true;
  receive({ type: 'scroll', dx: 0, dy: .1, begin: true });
  receive({ type: 'scroll', dx: 0, dy: 0, end: true, vy: 0 });
  assert.equal(sourcePanel.scrollTop, 108, 'Phone swipes scroll the source list instead of dragging playback into PiP');
  assert.deepEqual(dispatched, ['gulp:pip']);
  overControl = false; overEmbedControl = false; overSourcePanel = false; fullViewOpen = false;

  receive({ type: 'aim', direction: direction(6, 0) }); draw();
  const helperMove = sent.filter(message => message.action === 'move').at(-1);
  windowListeners.pointermove(localEvent(helperMove.x - 100, helperMove.y - 130));
  const clicksBeforeHelperEcho = sent.filter(message => message.action === 'click').length;
  receive({ type: 'activate' });
  assert.equal(sent.filter(message => message.action === 'click').length, clicksBeforeHelperEcho + 1, 'The phone OS helper moving the mouse does not claim local priority');
  windowListeners.pointerdown(localEvent(helperMove.x - 100, helperMove.y - 130));
  receive({ type: 'activate' });
  assert.equal(sent.filter(message => message.action === 'click').length, clicksBeforeHelperEcho + 2, 'The helper click is also recognized as phone input');

  windowListeners.pointermove(localEvent(450, 275)); draw();
  assert.equal(elements.get('dot').style.transform, 'translate3d(450px,275px,0)');
  assert.equal(sent.filter(message => message.type === 'mouse-mode').at(-1).on, false, 'Local input disarms the phone OS mouse');
  const clicksBeforeLocal = sent.filter(message => message.action === 'click').length;
  const pageBeforeLocal = page.scrollTop;
  receive({ type: 'aim', direction: direction(-12, 0) });
  receive({ type: 'activate' });
  receive({ type: 'scroll', dx: 0, dy: .2 });
  receive({ type: 'calibrate', direction: direction(0, 0) });
  draw();
  assert.equal(elements.get('dot').style.transform, 'translate3d(450px,275px,0)', 'Phone aim and recentering cannot overwrite an active mouse');
  assert.equal(sent.filter(message => message.action === 'click').length, clicksBeforeLocal, 'Phone taps are ignored while local input has priority');
  assert.equal(page.scrollTop, pageBeforeLocal, 'Phone scrolling cannot fight the trackpad');
  windowListeners.pointerdown(localEvent(600, 350)); draw();
  assert.equal(elements.get('dot').style.transform, 'translate3d(600px,350px,0)', 'A local press takes over even without a preceding move');
  clock += 2500;
  windowListeners.wheel(localEvent(620, 380));
  clock += 1000;
  receive({ type: 'aim', direction: direction(-12, 0) }); draw();
  assert.equal(elements.get('dot').style.transform, 'translate3d(620px,380px,0)', 'Trackpad activity extends local priority');
  clock += 3100;
  receive({ type: 'aim', direction: direction(0, 0) }); draw();
  assert.equal(elements.get('dot').style.transform, 'translate3d(960px,540px,0)', 'The phone can resume after local activity goes idle');
  assert.equal(sent.filter(message => message.type === 'mouse-mode').at(-1).on, true);
  windowListeners.pointermove(localEvent(400, 250)); draw();
  receive({ type: 'disconnected' }); draw();
  assert.equal(elements.get('dot').hidden, false, 'Phone disconnection does not hide the local hand');
  assert.equal(elements.get('dot').style.transform, 'translate3d(400px,250px,0)');

  receive({ type: 'reload' });
  assert.equal(reloads, 1);
  sessionKey = 'restarted-server';
  sockets[0].onclose();
  timers.at(-1)();
  await new Promise(setImmediate);
  assert.equal(reloads, 2, 'A restarted backend refreshes the TV with its new session');
});
