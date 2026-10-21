import { setupPlayer } from './player.js';
import { candidatesForNetworks, isStreamingOnly, NETWORK_STREAMS, normalizeNetwork } from './broadcast-shared.js';
import {
  SPORTS,
  byViewersThenTime,
  currentSport,
  fetchSchedule,
  fetchPopularGames,
  fetchStreams,
  firstEmbed,
  gamesFromMatches,
} from './schedule-source.js';

const ESPN = '/api/espn';

/** Streamed category → ESPN scoreboards to try for linear-network feeds and team logos. */
const ESPN_PATHS = {
  // College scoreboards list only featured games unless the division group is set (80 = FBS, 50 = D-I).
  basketball: [
    'basketball/nba/scoreboard',
    'basketball/wnba/scoreboard',
    'basketball/mens-college-basketball/scoreboard?groups=50',
    'basketball/womens-college-basketball/scoreboard?groups=50',
  ],
  'american-football': ['football/nfl/scoreboard', 'football/college-football/scoreboard?groups=80'],
  baseball: ['baseball/mlb/scoreboard'],
  hockey: ['hockey/nhl/scoreboard'],
  football: ['soccer/eng.1/scoreboard', 'soccer/usa.1/scoreboard', 'soccer/uefa.champions/scoreboard'],
};

/** Pro-league team lists when scoreboards have no row for the game. */
const ESPN_TEAM_DIRS = {
  baseball: 'baseball/mlb/teams',
  basketball: 'basketball/nba/teams',
  'american-football': 'football/college-football/teams',
};

export { SPORTS, currentSport, gamesFromMatches, fetchSchedule as fetchGames, firstEmbed };

function statusFromEspn(state) {
  if (state === 'in') return 'live';
  if (state === 'pre') return 'upcoming';
  if (state === 'post') return 'final';
  return 'unavailable';
}

const hex = value => /^[0-9a-f]{6}$/i.test(value || '') ? `#${value}` : '';

export function gamesFromScoreboard(data) {
  return (data?.events || []).map(event => {
    const competition = event.competitions?.[0] || {};
    const competitors = [...(competition.competitors || [])].sort((a, b) =>
      (a.homeAway === 'home') - (b.homeAway === 'home'));
    const away = competitors.find(c => c.homeAway === 'away') || competitors[0];
    const home = competitors.find(c => c.homeAway === 'home') || competitors[1];
    const networks = (competition.broadcasts || []).flatMap(b => b.names || []);
    const { urls, networks: mapped } = candidatesForNetworks(networks);
    return {
      id: event.id,
      title: event.name || event.shortName || 'Game',
      date: Date.parse(event.date),
      status: statusFromEspn(event.status?.type?.state),
      networks,
      candidates: urls,
      mappedNetworks: mapped,
      teams: [
        { name: away?.team?.displayName || away?.team?.shortDisplayName || '', logo: away?.team?.logo || '', color: hex(away?.team?.color) },
        { name: home?.team?.displayName || home?.team?.shortDisplayName || '', logo: home?.team?.logo || '', color: hex(home?.team?.color) },
      ].filter(t => t.name),
    };
  }).sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || a.date - b.date);
}

function norm(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamOverlap(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const words = s => s.split(' ').filter(w => w.length > 2);
  return words(a).some(w => words(b).includes(w));
}

/** True when Streamed teams appear in the ESPN event title/teams. */
export function teamsMatch(streamed, espn) {
  const want = (streamed.teams || []).map(t => t.name).filter(Boolean);
  const have = (espn.teams || []).map(t => t.name).filter(Boolean);
  if (want.length >= 2 && have.length >= 2) {
    return (teamOverlap(want[0], have[0]) && teamOverlap(want[1], have[1]))
      || (teamOverlap(want[0], have[1]) && teamOverlap(want[1], have[0]));
  }
  const hay = norm([espn.title, ...have].join(' '));
  if (want.length >= 2) return want.every(name => hay.includes(norm(name)));
  return want.length === 1 && hay.includes(norm(want[0]));
}

// Pass one `cache` per refresh so each scoreboard is fetched once, however many games need it.
function scoreboard(path, cache, fetchImpl) {
  if (!cache.has(path)) {
    cache.set(path, fetchImpl(`${ESPN}/${path}`, { signal: AbortSignal.timeout(12000) })
      .then(response => response.ok ? response.json() : null).then(gamesFromScoreboard).catch(() => []));
  }
  return cache.get(path);
}

/** ESPN `dates=` query (YYYYMMDD) for the game’s UTC calendar day. */
export function espnScoreboardDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function withEspnDate(path, ymd) {
  return path.includes('?') ? `${path}&dates=${ymd}` : `${path}?dates=${ymd}`;
}

const sameTeam = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.includes(b) || b.includes(a)); };

function mergeEspnHit(game, hit) {
  return {
    networks: hit.networks,
    candidates: hit.candidates,
    mappedNetworks: hit.mappedNetworks,
    // Streamed often has no badge for college teams; ESPN has a logo and colors for every school.
    teams: (game.teams || []).map(team => {
      const espn = hit.teams.find(t => sameTeam(t.name, team.name));
      return { ...team, logo: team.logo || espn?.logo || '', color: team.color || espn?.color || '' };
    }),
  };
}

export function teamsFromEspnDirectory(data) {
  const list = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return list.map(({ team }) => {
    const logos = team.logos || [];
    const logo = logos.find(entry => entry.rel?.includes('full') && entry.href)?.href || logos[0]?.href || '';
    return { name: team.displayName || team.shortDisplayName || team.name || '', logo, color: hex(team.color) };
  }).filter(team => team.name);
}

function espnTeamDirectory(path, cache, fetchImpl) {
  if (!cache.has(path)) {
    cache.set(path, fetchImpl(`${ESPN}/${path}?limit=500`, { signal: AbortSignal.timeout(12000) })
      .then(response => response.ok ? response.json() : null).then(teamsFromEspnDirectory).catch(() => []));
  }
  return cache.get(path);
}

async function fillTeamsFromDirectory(game, teams, fetchImpl, cache) {
  const path = ESPN_TEAM_DIRS[game.category];
  if (!path || !teams.some(team => team.name && !team.logo)) return teams;
  const directory = await espnTeamDirectory(path, cache, fetchImpl);
  return teams.map(team => {
    if (!team.name || team.logo) return team;
    const hit = directory.find(entry => sameTeam(entry.name, team.name));
    return { ...team, logo: hit?.logo || '', color: team.color || hit?.color || '' };
  });
}

/** Studio rows with a trailing “(TNT)” etc. — network key from broadcast-shared, if we know it. */
export function studioNetworkFromTitle(title) {
  const match = String(title || '').match(/\(([^)]+)\)\s*$/);
  return match ? normalizeNetwork(match[1]) || '' : '';
}

export function needsEspnArt(game) {
  const teams = (game.teams ?? []).filter(t => t.name);
  return teams.some(t => !t.logo) || (game.status === 'live' && teams.length >= 2);
}

export async function enrichSchedule(schedule, fetchImpl = fetch) {
  const cache = new Map();
  const games = schedule.filter(needsEspnArt);
  await Promise.all(games.map(async game => {
    try {
      Object.assign(game, await enrichFromEspn(game, fetchImpl, cache));
    } catch { /* keep Streamed-only row */ }
  }));
  return schedule;
}

export async function enrichFromEspn(game, fetchImpl = fetch, cache = new Map()) {
  const paths = ESPN_PATHS[game.category] || [];
  let hit = null;
  for (const path of paths) {
    hit = (await scoreboard(path, cache, fetchImpl)).find(g => teamsMatch(game, g));
    if (hit) break;
  }
  if (!hit) {
    const ymd = espnScoreboardDate(game.date);
    if (ymd) {
      for (const path of paths) {
        hit = (await scoreboard(withEspnDate(path, ymd), cache, fetchImpl)).find(g => teamsMatch(game, g));
        if (hit) break;
      }
    }
  }
  const merged = hit ? mergeEspnHit(game, hit) : { networks: [], candidates: [], mappedNetworks: [] };
  const teams = await fillTeamsFromDirectory(game, merged.teams || game.teams || [], fetchImpl, cache);
  return { ...merged, teams };
}

export function badgeText(game) {
  if (game.status === 'upcoming') return 'Upcoming';
  if (game.status === 'final') return 'Final';
  if (game.status !== 'live') return 'Stream unavailable';
  if (game.candidates?.length) {
    const net = game.mappedNetworks?.[0] || game.networks?.[0] || 'watch';
    return `Live · watch · ${net}`;
  }
  if (game.sources?.length) return 'Live · watch';
  const streaming = (game.networks || []).filter(isStreamingOnly);
  if (streaming.length && !(game.networks || []).some(n => !isStreamingOnly(n))) {
    return `Streaming only on ${streaming[0]}`;
  }
  if (streaming.length && !game.sources?.length) return `Streaming only on ${streaming[0]}`;
  return 'Live · add stream';
}

function networkLine(game) {
  return (game.networks || []).filter(Boolean).join(' · ');
}

/** "8:00 PM" today, "Tomorrow 8:00 PM", then "Wed 8:00 PM" — "today" listings include tomorrow's games. */
export function startLabel(date, now = Date.now()) {
  const time = new Date(date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const day = start => new Date(start).setHours(0, 0, 0, 0);
  const days = Math.round((day(date) - day(now)) / 864e5);
  if (days === 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  return `${new Date(date).toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** All live games, then live and upcoming games in each sport; every shelf uses viewer/time order. */
export function shelvesFrom(games) {
  const sportOf = game => SPORTS.find(s => s.category && s.category === game.category)?.id || 'other';
  const visible = games.filter(g => g.status === 'live' || g.status === 'upcoming').sort(byViewersThenTime);
  return [
    { title: 'Live now', games: visible.filter(g => g.status === 'live') },
    ...SPORTS.slice(1).map(({ id, label }) => ({ title: label, games: visible.filter(g => sportOf(g) === id) })),
  ].filter(shelf => shelf.games.length);
}

const el = (tag, className = '') => Object.assign(document.createElement(tag), { className });
const shownPosters = new Set();
const image = src => Object.assign(document.createElement('img'), { src, alt: '', loading: 'lazy', decoding: 'async' });

function card(game, play) {
  const live = game.status === 'live';
  const control = el(live ? 'button' : 'div', 'card');
  const thumb = el('span', 'thumb'), fallback = el('span', 'thumb-fallback');
  const teams = game.teams ?? [];
  const crests = teams.filter(team => team.logo);
  const studioNet = !teams.length && studioNetworkFromTitle(game.title);
  // Crests on a split of the two team colors, while the poster loads or when it has none.
  if (crests.length) fallback.append(...crests.map(team => image(team.logo)));
  else if (studioNet) {
    fallback.classList.add('is-studio');
    const mark = el('span', 'studio-mark');
    mark.textContent = studioNet;
    mark.dataset.network = studioNet;
    fallback.append(mark);
  } else fallback.append(Object.assign(el('span', 'thumb-label'), { textContent: game.title }));
  teams.forEach((team, i) => { if (team.color) fallback.style.setProperty(i ? '--home' : '--away', team.color); });
  if (crests.length >= 2 && !teams.some(team => team.color)) {
    fallback.style.setProperty('--away', '#252525');
    fallback.style.setProperty('--home', '#121212');
  }
  thumb.append(fallback);
  if (game.poster) {
    const poster = image(game.poster);
    // Posters seen before skip the fade so the minute refresh doesn't flash every card.
    if (shownPosters.has(game.poster)) poster.classList.add('is-loaded');
    else poster.addEventListener('load', () => { shownPosters.add(game.poster); poster.classList.add('is-loaded'); });
    poster.addEventListener('error', () => poster.remove());
    thumb.append(poster);
  }
  const pill = el(live ? 'span' : 'time', live ? 'pill live' : 'pill');
  if (live) pill.textContent = 'Live';
  else {
    pill.dateTime = new Date(game.date).toISOString();
    pill.textContent = startLabel(game.date);
  }
  thumb.append(pill);
  const meta = el('span', 'card-meta'), text = el('span', 'card-text'), title = el('span', 'card-title');
  title.textContent = game.title;
  text.append(title);
  const badge = badgeText(game), sub = badge.startsWith('Streaming only') ? badge : networkLine(game);
  if (sub) text.append(Object.assign(el('span', 'card-sub'), { textContent: sub }));
  if (crests.length) {
    const row = el('span', 'crests');
    row.append(...crests.map(team => image(team.logo)));
    meta.append(row);
  }
  meta.append(text);
  control.append(thumb, meta);
  if (live) {
    control.type = 'button';
    control.addEventListener('click', () => play(game, control));
  }
  return control;
}

export async function openGame(game, control, player, preferDirect = false) {
  const streams = await fetchStreams(game.sources);
  const url = streams[0]?.embedUrl || '';
  const sources = streams.map(stream => ({
    label: `${stream.source.charAt(0).toUpperCase()}${stream.source.slice(1)}`,
    viewers: stream.viewers, url: stream.embedUrl, embed: true,
  }));
  const options = { sources };
  if (!preferDirect) {
    if (url) player.openEmbed(game.title, url, control, options);
    return url ? '' : 'No stream is available for this game right now.';
  }
  let enriched = game;
  if (!game.candidates?.length) {
    try {
      const extra = await enrichFromEspn(game);
      enriched = { ...game, ...extra, networks: extra.networks.length ? extra.networks : game.networks };
    } catch { /* keep Streamed-only */ }
  }
  // Prefer only the verified ESPN US feed; HTTPS screens keep the embed.
  const direct = location.protocol === 'http:'
    ? (enriched.candidates || []).filter(candidate => NETWORK_STREAMS.espn.includes(candidate)) : [];
  const directUrls = direct.length ? direct : !url ? enriched.candidates || [] : [];
  sources.push(...[...new Set(directUrls)].map((candidate, index) => ({ label: `Direct stream ${index + 1}`, url: candidate, viewers: null })));
  if (direct.length) {
    player.open(enriched.title, control, direct, { ...options, onExhausted: () => {
      if (!url) return false;
      player.openEmbed(enriched.title, url, control, options);
      return true;
    } });
    return '';
  }
  if (url) { player.openEmbed(game.title, url, control, options); return ''; }
  if (enriched.candidates?.length) { player.open(enriched.title, control, enriched.candidates, options); return ''; }
  const streaming = (enriched.networks || []).filter(isStreamingOnly);
  if (streaming.length && !(enriched.networks || []).some(n => !isStreamingOnly(n))) {
    return `Streaming only on ${streaming[0]} — no embed available.`;
  }
  return 'No stream is available for this game right now.';
}

export function setupSports() {
  const sport = currentSport(location.search);
  const { label } = SPORTS.find(s => s.id === sport) || SPORTS[0];
  const games = document.querySelector('#games'), status = document.querySelector('#games-status');
  const statusMessage = document.querySelector('#games-message'), statusHint = document.querySelector('#games-hint');
  function showStatus(message = '', hint = '', busy = false) {
    status.hidden = !message;
    status.dataset.loading = String(busy);
    statusMessage.textContent = message;
    statusHint.textContent = hint;
    statusHint.hidden = !hint;
  }
  const player = setupPlayer();
  const directToggle = document.querySelector('#prefer-direct');
  try { directToggle.setAttribute('aria-checked', String(localStorage.getItem('gulp:prefer-direct') === 'true')); } catch { /* embedded default when storage is unavailable */ }
  directToggle.addEventListener('click', () => {
    const on = directToggle.getAttribute('aria-checked') !== 'true';
    directToggle.setAttribute('aria-checked', String(on));
    try { localStorage.setItem('gulp:prefer-direct', String(on)); } catch { /* keep this session's choice */ }
  });
  let loading = null, timer;
  document.title = `Gulp — ${label}`;
  document.querySelector('#sport-title').textContent = label;
  document.querySelector('.tv-canvas').setAttribute('aria-label', 'Sports games');
  games.setAttribute('aria-label', `${label} schedule`);
  // Reselecting Sports returns to the top and shares pull-to-refresh's loading feedback.
  document.querySelector('.tabs').addEventListener('click', event => {
    if (!event.target.closest('a[href]')) return;
    event.preventDefault();
    if (!document.querySelector('#watch').hidden || player.embedOpen()) player.close();
    document.querySelector('.tv-canvas').scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    document.dispatchEvent(new CustomEvent('gulp:refresh'));
  });

  async function play(game, control) {
    showStatus('Opening stream', '', true);
    try {
      const message = await openGame(game, control, player, directToggle.getAttribute('aria-checked') === 'true');
      if (message) showStatus('Stream unavailable', message);
    }
    catch { showStatus('Stream unavailable', 'Select the game to try again.'); }
    finally { if (statusMessage.textContent === 'Opening stream') showStatus(); }
  }

  function update() {
    // Manual refresh waits for an existing automatic refresh instead of dismissing its spinner early.
    return loading ||= loadSchedule().finally(() => { loading = null; });
  }

  async function loadSchedule() {
    if (!games.childElementCount) showStatus('Loading games', '', true);
    else showStatus();
    try {
      let schedule;
      try {
        const res = await fetch(`/api/schedule?sport=${encodeURIComponent(sport)}`, { signal: AbortSignal.timeout(45000) });
        if (res.ok) schedule = await res.json();
      } catch { /* fall back to Streamed */ }
      if (!Array.isArray(schedule) || !schedule.length) schedule = await fetchSchedule(sport);
      // Server schedule can be stale; fill any row still missing crests or live metadata.
      await enrichSchedule(schedule, fetch);
      const popular = fetchPopularGames(schedule).catch(() => []);
      const viewers = new Map((await popular).map(game => [game.id, game.viewers]));
      for (const game of schedule) game.viewers = viewers.get(game.id) ?? null;
      const shelves = shelvesFrom(schedule);
      showStatus(shelves.length ? '' : 'No games scheduled', shelves.length ? '' : 'Select Sports to check again.');
      // Refreshing must not throw each shelf back to its first card.
      const kept = new Map([...games.querySelectorAll('.shelf')].map(shelf => [shelf.dataset.title, shelf.lastElementChild?.scrollLeft || 0]));
      games.replaceChildren(...shelves.map(({ title, games: list }) => {
        const shelf = el('section', 'shelf'), heading = el('h2'), row = el('ul', 'shelf-row');
        shelf.dataset.title = title;
        shelf.setAttribute('aria-label', title);
        heading.textContent = title;
        row.dataset.scrollRow = '';
        row.append(...list.map(game => { const item = el('li'); item.append(card(game, play)); return item; }));
        shelf.append(heading, row);
        return shelf;
      }));
      for (const shelf of games.children) {
        const row = shelf.lastElementChild;
        if (row) row.scrollLeft = kept.get(shelf.dataset.title) || 0;
      }
      document.dispatchEvent(new CustomEvent('gulp:schedule'));
    } catch {
      showStatus(games.childElementCount ? 'Couldn’t update games' : 'Games unavailable', games.childElementCount ? 'Showing the last schedule. Select Sports to try again.' : 'Select Sports to try again.');
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') update(); });
  timer = setInterval(() => { if (document.visibilityState !== 'hidden') update(); }, 60000);
  window.addEventListener('pagehide', () => { clearInterval(timer); });
  update();
  return { refresh: update };
}
