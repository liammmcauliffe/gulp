import test from 'node:test';
import assert from 'node:assert/strict';
import { activateControl, setupPlayer, streamUrl } from '../public/player.js';

test('a phone tap clears keyboard focus presentation before focusing and clicking its control', () => {
  const classes = new Set();
  const ownerDocument = { body: { classList: { add: name => classes.add(name) } } };
  let focused = false, clicked = false;
  activateControl({
    ownerDocument,
    focus() { assert.ok(classes.has('is-pointer'), 'Phone input must be identified before programmatic focus'); focused = true; },
    click() { assert.ok(focused, 'Retain real focus for accessibility and keyboard continuation'); clicked = true; },
  }, 0);
  assert.ok(clicked);
});

test('direct stream URLs preserve signed queries, allow local HTTP feeds and reject other schemes or credentials', t => {
  assert.equal(streamUrl(' https://video.example/live.m3u8?token=a%2Fb '), 'https://video.example/live.m3u8?token=a%2Fb');
  assert.equal(streamUrl('http://video.example/live.m3u8'), 'http://video.example/live.m3u8');
  for (const value of ['javascript:alert(1)', 'file:///movie.mp4', 'ftp://video.example/a.mp4', 'https://user:pass@video.example/a.mp4', 'not a URL']) assert.throws(() => streamUrl(value), /HTTPS/);
  const previousLocation = globalThis.location;
  globalThis.location = { protocol: 'https:' };
  t.after(() => { if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; });
  assert.throws(() => streamUrl('http://video.example/live.m3u8'), /local/);
});

test('our HLS and direct-video controls support phone sliders, live seeking, expansion and cleanup', async t => {
  const stalls = new Set();
  t.mock.method(globalThis, 'setTimeout', callback => { stalls.add(callback); return callback; });
  t.mock.method(globalThis, 'clearTimeout', callback => stalls.delete(callback));
  const previous = Object.fromEntries(['document', 'window', 'Hls'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  class Element extends EventTarget {
    hidden = true; disabled = false; attributes = {}; value = ''; isConnected = true;
    children = [];
    classes = new Set();
    classList = { toggle: (key, active) => active ? this.classes.add(key) : this.classes.delete(key), contains: key => this.classes.has(key) };
    setAttribute(key, value) { this.attributes[key] = value; if (key === 'hidden') this.hidden = true; }
    removeAttribute(key) { delete this.attributes[key]; if (key === 'src') this.src = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    contains(target) { return this === target || this.children.some(child => child.contains(target)); }
    focus() { document.activeElement = this; }
    click() { this.dispatchEvent(new Event('click')); }
    scrollIntoView() {}
    getBoundingClientRect() { return { left: 100, width: 200 }; }
    getClientRects() { return this.hidden ? [] : [{}]; }
  }
  const ids = ['watch', 'player', 'watch-title', 'player-status', 'play-pause', 'mute', 'volume', 'seek', 'go-live', 'playback-time', 'player-controls', 'player-empty', 'settings', 'close-player', 'watch-pip-open', 'watch-pip-close', 'embed-shell', 'embed-frame', 'embed-title', 'embed-back', 'embed-pip-open', 'embed-pip-close', ...['watch', 'embed'].flatMap(id => [`${id}-sources`, `${id}-sources-toggle`, `${id}-sources-panel`])];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const background = [new Element(), new Element()];
  globalThis.document = Object.assign(new EventTarget(), { querySelector: selector => elements[selector.slice(1)], querySelectorAll: () => background, createElement: () => new Element() });
  globalThis.window = new EventTarget();
  class Hls {
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    static instances = [];
    static isSupported() { return true; }
    listeners = {};
    constructor() { Hls.instances.push(this); }
    on(name, callback) { this.listeners[name] = callback; }
    loadSource(url) { this.url = url; }
    attachMedia(media) { this.media = media; }
    destroy() { this.destroyed = true; }
  }
  globalThis.Hls = Hls;
  const video = elements.player;
  let pendingPlay, range = [0, 120];
  Object.assign(video, {
    paused: true, currentTime: 0, duration: 120, muted: false, volume: 1,
    seekable: { length: 1, start: () => range[0], end: () => range[1] },
    canPlayType: () => '', load() {},
    play() { this.paused = false; this.dispatchEvent(new Event('play')); return pendingPlay ?? Promise.resolve(); },
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); },
  });
  for (const [id, max, step] of [['volume', '1', '0.01'], ['seek', '1000', '1']]) Object.assign(elements[id], { type: 'range', min: '0', max, step });
  const player = setupPlayer();
  const submit = url => player.load(url);
  player.open('A live game', elements.settings);
  assert.equal(elements['watch-title'].textContent, 'A live game');
  assert.equal(elements.watch.hidden, false);
  assert.equal(elements.player.hidden, true, 'Opening a game without a feed leaves the video hidden');
  submit('javascript:alert(1)');
  assert.match(elements['player-status'].textContent, /HTTPS/, 'Unsafe feed URLs are refused');
  assert.equal(Hls.instances.length, 0);
  submit('https://video.example/live.m3u8?token=one');
  const hls = Hls.instances[0];
  assert.equal(hls.url, 'https://video.example/live.m3u8?token=one');
  assert.equal(hls.media, video);
  hls.listeners.manifest();
  video.dispatchEvent(new Event('playing'));
  assert.equal(stalls.size, 1, 'A parsed manifest and audio-only playback keep the startup timeout armed');
  assert.equal(elements['player-status'].textContent, 'Loading video…');
  video.videoWidth = 1280; video.videoHeight = 720;
  video.dispatchEvent(new Event('canplay'));
  assert.equal(stalls.size, 0, 'Decoded video clears the startup timeout');
  assert.equal(video.paused, false);
  assert.equal(video.muted, false, 'New streams start with sound');
  assert.equal(elements['play-pause'].attributes['aria-label'], 'Pause');
  assert.equal(elements.watch.classList.contains('is-paused'), false, 'The pause icon shows while playing');
  assert.equal(elements['player-status'].textContent, '');
  activateControl(elements.seek, 250);
  assert.equal(video.currentTime, 90, 'A phone tap three quarters across seeks three quarters through the video');
  activateControl(elements.volume, 150);
  assert.equal(video.volume, .25);
  assert.equal(video.muted, false);
  activateControl(elements.volume, -100);
  assert.equal(video.volume, 0, 'Range taps clamp at the edges');
  assert.equal(video.muted, true);
  elements.mute.click();
  assert.equal(video.volume, 1);
  assert.equal(video.muted, false);
  elements['play-pause'].click();
  assert.equal(video.paused, true);
  elements['play-pause'].click();
  assert.equal(video.paused, false);
  range = [60, 180]; video.duration = Infinity; hls.liveSyncPosition = 175;
  video.dispatchEvent(new Event('durationchange'));
  assert.equal(elements['go-live'].hidden, false);
  elements.seek.value = 500; elements.seek.dispatchEvent(new Event('input'));
  assert.equal(video.currentTime, 120, 'DVR seeking uses the moving seekable window');
  elements['go-live'].click();
  assert.equal(video.currentTime, 175);
  assert.equal(elements.watch.classList.contains('is-expanded'), true, 'Watching opens straight into full view');
  assert.equal(elements.watch.attributes['aria-modal'], 'true');
  assert.ok(background.every(element => element.inert));
  elements['close-player'].click();
  assert.equal(elements.watch.classList.contains('is-pip'), true, 'Back shrinks the player into PiP');
  assert.equal(elements.watch.hidden, false);
  assert.equal(video.paused, false, 'PiP keeps playing');
  assert.ok(background.every(element => !element.inert), 'The page is usable around the PiP');
  elements['watch-pip-open'].click();
  assert.equal(elements.watch.classList.contains('is-pip'), false, 'Tapping the PiP returns to full view');
  assert.ok(background.every(element => element.inert));
  elements['close-player'].click();
  let rejectPlay;
  pendingPlay = new Promise((_resolve, reject) => { rejectPlay = reject; });
  submit('https://video.example/movie.mp4');
  assert.equal(hls.destroyed, true, 'Switching sources releases the HLS instance');
  assert.equal(video.src, 'https://video.example/movie.mp4');
  player.close();
  rejectPlay(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await new Promise(setImmediate);
  assert.equal(video.paused, true);
  assert.equal(video.src, '');
  assert.equal(elements.watch.hidden, true);
  assert.ok(background.every(element => !element.inert), 'Closing leaves full view');
  assert.equal(elements['player-status'].textContent, '', 'A delayed play failure cannot revive a closed player');
  assert.equal(document.activeElement, elements.settings);
  pendingPlay = undefined;
  video.videoWidth = 0; video.videoHeight = 0;
  let exhausted = 0;
  player.open('An audio-only feed', elements.settings, 'https://video.example/audio-only.m3u8', {
    onExhausted: () => { exhausted++; return true; },
  });
  Hls.instances.at(-1).listeners.manifest();
  video.dispatchEvent(new Event('playing'));
  [...stalls][0]();
  await new Promise(setImmediate);
  assert.equal(exhausted, 1, 'A feed without decoded video reaches the embed fallback');
  player.close();

  const sources = [
    { label: 'Alpha 1', viewers: 20, embed: true, url: 'https://example.com/alpha' },
    { label: 'Direct stream 1', viewers: null, url: 'https://example.com/direct.mp4' },
    { label: 'Bravo 1', viewers: 1200, embed: true, url: 'https://example.com/bravo' },
    { label: 'Charlie 1', viewers: 0, embed: true, url: 'https://example.com/charlie' },
  ];
  player.openEmbed('A game', sources[0].url, elements.settings, { sources });
  assert.equal(elements['embed-title'].textContent, 'A game');
  assert.equal(elements['embed-frame'].title, 'A game');
  const panel = elements['embed-sources-panel'];
  const listed = (id = 'embed') => elements[`${id}-sources-panel`].children[1].children;
  assert.equal(elements['embed-sources'].hidden, false);
  assert.equal(panel.children[0].className, 'popout-title');
  assert.equal(panel.children[1].className, 'sources-list');
  assert.deepEqual(listed().map(button => button.children[0].children[0].textContent), ['Bravo 1', 'Alpha 1', 'Charlie 1', 'Direct stream 1']);
  assert.equal(listed()[1].attributes['aria-pressed'], 'true', 'The current feed stays selected despite viewer sorting');
  assert.equal(panel.hidden, false);
  listed()[0].click();
  assert.equal(elements['embed-frame'].src, sources[2].url, 'Choosing a source switches the embedded feed');
  assert.equal(listed()[0].attributes['aria-pressed'], 'true');
  listed()[3].click();
  assert.equal(elements.player.src, sources[1].url, 'A direct source opens in the owned player');
  assert.equal(elements.watch.hidden, false);
  assert.equal(elements['embed-shell'].hidden, true);
  assert.equal(elements['watch-title'].textContent, 'A game', 'Switching player types keeps the game title');
  assert.equal(listed('watch')[3].attributes['aria-pressed'], 'true');
  listed('watch')[1].click();
  assert.equal(elements.watch.hidden, true, 'Switching back to an embed releases the owned player');
  assert.equal(elements['embed-frame'].src, sources[0].url);
  elements['embed-back'].click();
  assert.equal(elements['embed-shell'].classList.contains('is-pip'), true);
  assert.equal(elements['embed-title'].textContent, 'A game', 'PiP uses the same title as full view');
  elements['embed-pip-open'].click();
  assert.equal(elements['embed-frame'].src, sources[0].url, 'PiP keeps the selected source');
  player.close();
  player.open('A different game', elements.settings);
  assert.equal(elements['watch-title'].textContent, 'A different game', 'A new game replaces the previous title');
  assert.equal(elements['watch-sources'].hidden, true, 'A new game cannot inherit the previous source list');
  player.close();
});
