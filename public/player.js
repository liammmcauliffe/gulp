const clock = seconds => {
  const n = Math.max(0, Math.floor(seconds || 0));
  return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

export function streamUrl(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete HTTP or HTTPS stream URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS stream URL without a username or password.');
  if (url.protocol === 'http:' && globalThis.location?.protocol === 'https:') throw new Error('Open Gulp at http://localhost:4173 to play an HTTP stream.');
  return url.href;
}

// Synthetic clicks do not position native range inputs. Phone taps use the
// same cursor center as hit testing to set our seek and volume sliders.
export function activateControl(control, x) {
  if (!control || control.disabled) return;
  // Remote taps are pointer input even though their clicks and focus are programmatic.
  control.ownerDocument?.body?.classList.add('is-pointer');
  if (control.type === 'range') {
    const rect = control.getBoundingClientRect(), min = Number(control.min || 0), max = Number(control.max || 100);
    if (rect.width <= 0) return;
    const step = control.step === 'any' ? 0 : Number(control.step || 1);
    let value = min + Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * (max - min);
    if (step) value = min + Math.round((value - min) / step) * step;
    control.value = Math.max(min, Math.min(max, value));
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  } else { control.focus({ preventScroll: true }); control.click(); }
}

export function setupPlayer() {
  const $ = id => document.querySelector(`#${id}`);
  const watch = $('watch'), video = $('player'), title = $('watch-title'), status = $('player-status');
  const play = $('play-pause'), mute = $('mute'), volume = $('volume'), seek = $('seek');
  const goLive = $('go-live');
  const embed = $('embed-shell'), frame = $('embed-frame'), embedBack = $('embed-back');
  const background = [...document.querySelectorAll('.screen-header, .schedule')];
  const sourceMenus = ['watch', 'embed'].map(id => ({
    root: $(`${id}-sources`), toggle: $(`${id}-sources-toggle`), panel: $(`${id}-sources-panel`),
  })).filter(menu => menu.root);
  let choices = [], sourceButtons = [], activeUrl = '', playbackName = '';
  let hls, generation = 0, source = '', trigger, queue = [], queueIndex = 0, stallTimer, onExhausted = null;
  const mouseMode = on => {
    document.body.classList.toggle('is-watching', !!on);
    try { document.dispatchEvent?.(new CustomEvent('gulp:mouse-mode', { detail: { on: !!on } })); } catch { /* test DOM stub */ }
  };

  function markSource(url) {
    activeUrl = url;
    for (const { button, choice } of sourceButtons) button.setAttribute('aria-pressed', String(choice.url === url));
  }
  function setSources(available = [], selected = '') {
    choices = [...available].sort((a, b) => (b.viewers ?? -1) - (a.viewers ?? -1));
    sourceButtons = [];
    for (const { root, toggle, panel } of sourceMenus) {
      root.hidden = !choices.length;
      panel.hidden = false;
      const heading = document.createElement('h2'), list = document.createElement('div');
      heading.className = 'popout-title'; list.className = 'sources-list';
      heading.textContent = 'Sources';
      panel.replaceChildren(heading, list);
      for (const choice of choices) {
        const button = document.createElement('button'), copy = document.createElement('span');
        const label = document.createElement('span');
        button.type = 'button'; button.className = 'source-option';
        copy.className = 'source-copy';
        label.textContent = choice.label;
        copy.append(label);
        const check = document.createElement('span');
        check.className = 'source-check';
        check.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="m5 12 4 4L19 6"/></svg>';
        button.append(copy, check);
        list.append(button);
        sourceButtons.push({ button, choice });
        button.addEventListener('click', () => {
          if (choice.url === activeUrl) { toggle.focus({ preventScroll: true }); return; }
          const options = { sources: choices };
          if (choice.embed) openEmbed(playbackName, choice.url, trigger, options);
          else open(playbackName, trigger, choice.url, { ...options, onExhausted: () => {
            const fallback = choices.find(item => item.embed);
            if (!fallback) return false;
            openEmbed(playbackName, fallback.url, trigger, options);
            return true;
          } });
        });
      }
    }
    markSource(selected);
  }
  function seekWindow() {
    if (video.seekable.length) return [video.seekable.start(0), video.seekable.end(video.seekable.length - 1)];
    return [0, Number.isFinite(video.duration) ? video.duration : 0];
  }
  function update() {
    // Icons swap by class; the labels carry the words.
    watch.classList.toggle('is-paused', video.paused);
    watch.classList.toggle('is-muted', video.muted || video.volume === 0);
    play.setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
    play.disabled = !source;
    mute.setAttribute('aria-label', video.muted || video.volume === 0 ? 'Unmute' : 'Mute');
    volume.value = video.muted ? 0 : video.volume;
    const [start, end] = seekWindow(), live = !!hls?.liveSyncPosition || video.duration === Infinity;
    seek.disabled = !source || end <= start;
    seek.value = end > start ? 1000 * (video.currentTime - start) / (end - start) : 0;
    seek.setAttribute('aria-valuetext', live ? `${clock(end - video.currentTime)} behind live` : `${clock(video.currentTime)} of ${clock(end)}`);
    $('playback-time').textContent = live ? end - video.currentTime < 10 ? 'Live' : `−${clock(end - video.currentTime)}` : `${clock(video.currentTime)} / ${clock(end)}`;
    goLive.hidden = !live;
  }
  function expanded(active) {
    document.body.classList.toggle('is-watching', active);
    watch.classList.toggle('is-expanded', active);
    for (const element of background) element.inert = active;
    if (active) { watch.setAttribute('role', 'dialog'); watch.setAttribute('aria-modal', 'true'); }
    else { watch.removeAttribute('role'); watch.removeAttribute('aria-modal'); }
  }
  function clearStall() { clearTimeout(stallTimer); stallTimer = null; }
  function unload() {
    generation++;
    clearStall();
    source = '';
    video.pause();
    hls?.destroy(); hls = null;
    video.removeAttribute('src'); video.load();
    video.hidden = true;
    $('player-controls').hidden = true;
    $('player-empty').hidden = false;
    status.textContent = '';
    update();
  }
  async function resume() {
    const current = generation;
    try { await video.play(); }
    catch (error) {
      if (current !== generation || error.name === 'AbortError') return;
      status.textContent = error.name === 'NotAllowedError' ? 'Press Play to start.' : 'This stream isn’t playing right now. Try again in a moment.';
    }
  }
  function failed() {
    if (onExhausted) {
      const fallback = onExhausted;
      onExhausted = null;
      Promise.resolve(fallback()).then(opened => {
        if (!opened) status.textContent = 'This stream isn’t playing right now. Try again in a moment.';
      });
      return;
    }
    status.textContent = 'This stream isn’t playing right now. Try again in a moment.';
  }
  function tryNext() {
    if (queueIndex + 1 < queue.length) {
      queueIndex++;
      markSource(queue[queueIndex]);
      status.textContent = 'Loading video…';
      load(queue[queueIndex], true);
      return true;
    }
    return false;
  }
  function closeEmbed() {
    if (frame) frame.src = 'about:blank';
    embed?.setAttribute('hidden', '');
    mouseMode(false);
  }
  function openEmbed(name, url, from, options = {}) {
    clearPip();
    unload();
    expanded(false);
    watch.hidden = true;
    onExhausted = null;
    trigger = from;
    playbackName = name;
    setSources(options.sources, url);
    if (!embed || !frame) return;
    document.title = `Gulp — ${name}`;
    $('embed-title').textContent = name;
    frame.title = name;
    frame.src = url;
    embed.hidden = false;
    mouseMode(true);
    embedBack?.focus({ preventScroll: true });
  }
  function armStall(current) {
    clearStall();
    stallTimer = setTimeout(() => {
      if (current !== generation || !source) return;
      if (!tryNext()) failed();
    }, 25000);
  }
  function load(value, fromQueue = false) {
    let url;
    try { url = streamUrl(value); }
    catch (error) {
      if (fromQueue && tryNext()) return;
      status.textContent = error.message; return;
    }
    if (!fromQueue) { queue = [url]; queueIndex = 0; unload(); }
    else {
      clearStall();
      source = '';
      video.pause();
      hls?.destroy(); hls = null;
      video.removeAttribute('src'); video.load();
      generation++;
    }
    const current = generation;
    source = url;
    video.muted = false;
    video.hidden = false;
    $('player-controls').hidden = false;
    $('player-empty').hidden = true;
    status.textContent = 'Loading video…';
    const Hls = globalThis.Hls;
    const onReady = () => { if (current === generation) resume(); };
    const onFatal = () => {
      if (current !== generation) return;
      hls?.destroy(); hls = null;
      if (!tryNext()) failed();
    };
    armStall(current);
    if (/\.m3u8$/i.test(new URL(url).pathname) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (!Hls?.isSupported()) { onFatal(); return; }
      hls = new Hls();
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (current !== generation || !data.fatal) return;
        onFatal();
      });
      hls.loadSource(url); hls.attachMedia(video);
    } else { video.src = url; resume(); }
    update();
  }
  function open(name, from, autoLoad = '', options = {}) {
    clearPip();
    closeEmbed();
    // Watching always opens in full view: the player fills all the space the page is given.
    unload(); expanded(true);
    trigger = from;
    playbackName = name;
    onExhausted = typeof options.onExhausted === 'function' ? options.onExhausted : null;
    watch.hidden = false;
    title.textContent = name;
    video.setAttribute('aria-label', name);
    const urls = Array.isArray(autoLoad) ? autoLoad.filter(Boolean) : autoLoad ? [autoLoad] : [];
    setSources(options.sources, urls[0]);
    if (urls.length) {
      queue = urls;
      queueIndex = 0;
      load(urls[0], true);
      play.focus({ preventScroll: true });
    } else $('close-player').focus({ preventScroll: true });
  }
  function close() {
    clearPip();
    closeEmbed();
    unload(); expanded(false); watch.hidden = true; onExhausted = null;
    (trigger?.isConnected ? trigger : $('settings')).focus({ preventScroll: true });
  }
  // Back shrinks the stream into an in-page picture-in-picture that keeps playing; × or a new stream ends it.
  function pip(on) {
    const view = embed && !embed.hidden ? embed : watch;
    if (view.hidden || view.classList.contains('is-pip') === on) return;
    const first = view.getBoundingClientRect();
    // A swipe-down may have left the view mid-drag; the FLIP below starts from exactly there.
    if (view.style) view.style.transform = '';
    view.classList.toggle('is-pip', on);
    const last = view.getBoundingClientRect();
    // Browsing works again in PiP; the embed only gets the OS mouse in full view.
    if (view === watch) expanded(!on); else mouseMode(!on);
    if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && last.width) {
      // Grow or shrink from where it was on screen, so it reads as the same video moving.
      view.animate?.([
        { transformOrigin: '0 0', transform: `translate(${first.left - last.left}px,${first.top - last.top}px) scale(${first.width / last.width},${first.height / last.height})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: 340, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
    (on ? trigger : view === watch ? play : embedBack)?.focus({ preventScroll: true });
  }
  function clearPip() { watch.classList.toggle('is-pip', false); embed?.classList.toggle('is-pip', false); }
  play.addEventListener('click', () => { if (video.paused) resume(); else video.pause(); });
  mute.addEventListener('click', () => { if (!video.volume) video.volume = 1; video.muted = !video.muted; });
  volume.addEventListener('input', () => { video.volume = Number(volume.value); video.muted = video.volume === 0; });
  seek.addEventListener('input', () => { const [start, end] = seekWindow(); if (end > start) video.currentTime = start + Number(seek.value) / 1000 * (end - start); });
  goLive.addEventListener('click', () => { const [, end] = seekWindow(); if (end > 0) { video.currentTime = hls?.liveSyncPosition ?? Math.max(0, end - 2); resume(); } });
  $('close-player').addEventListener('click', () => pip(true));
  embedBack?.addEventListener('click', () => pip(true));
  document.addEventListener?.('gulp:pip', () => pip(true));
  for (const id of ['watch', 'embed']) {
    $(`${id}-pip-open`)?.addEventListener('click', () => pip(false));
    $(`${id}-pip-close`)?.addEventListener('click', close);
  }
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && embed && !embed.hidden) pip(true);
  });
  for (const name of ['play', 'pause', 'ended', 'volumechange', 'timeupdate', 'durationchange', 'progress', 'loadedmetadata']) video.addEventListener(name, update);
  // A parsed playlist or playing audio alone doesn't prove a usable video feed.
  for (const name of ['playing', 'canplay']) video.addEventListener(name, () => {
    if (source && video.videoWidth && video.videoHeight) { clearStall(); status.textContent = ''; }
  });
  video.addEventListener('waiting', () => { if (source) status.textContent = 'Buffering…'; });
  video.addEventListener('error', () => { if (source && !tryNext()) failed(); });
  watch.addEventListener('keydown', event => {
    if (event.key === 'Escape') pip(true);
    if (event.key !== 'Tab' || !watch.classList.contains('is-expanded')) return;
    const controls = [...watch.querySelectorAll('button, input')].filter(control => !control.disabled && control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('pagehide', () => { closeEmbed(); unload(); });
  update();
  return { open, close, load, openEmbed, embedOpen: () => !!(embed && !embed.hidden) };
}
