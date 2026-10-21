import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { gamesFromScoreboard, badgeText, enrichFromEspn, enrichSchedule, espnScoreboardDate, needsEspnArt, openGame, studioNetworkFromTitle } from '../public/nba.js';
import { candidatesForNetworks, isStreamingOnly, NETWORK_STREAMS, normalizeNetwork } from '../public/broadcast-shared.js';
import { byViewersThenTime, firstEmbed, fetchStreams } from '../public/schedule-source.js';

test('ESPN fills college logos Streamed lacks, fetching each scoreboard once per refresh', async () => {
  const urls = [];
  const team = (homeAway, displayName, logo) => ({ homeAway, team: { displayName, logo, color: homeAway === 'home' ? 'f47321' : 'red;}' } });
  const fetchImpl = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ events: url.includes('college-football') ? [{
      id: '9', name: 'New Mexico State Aggies at Sam Houston Bearkats', status: { type: { state: 'pre' } },
      competitions: [{ competitors: [team('away', 'New Mexico State Aggies', 'https://a.espncdn.com/nmsu.png'), team('home', 'Sam Houston Bearkats', 'https://a.espncdn.com/shsu.png')] }],
    }] : [] }) };
  };
  const cache = new Map();
  const game = { category: 'american-football', teams: [{ name: 'Sam Houston Bearkats', logo: '' }, { name: 'New Mexico State Aggies', logo: 'https://streamed.pk/kept.webp' }] };
  const extra = await enrichFromEspn(game, fetchImpl, cache);
  assert.deepEqual(extra.teams.map(t => t.logo), ['https://a.espncdn.com/shsu.png', 'https://streamed.pk/kept.webp']);
  assert.deepEqual(extra.teams.map(t => t.color), ['#f47321', ''], 'Team colors come through; anything but a hex color is dropped');
  assert.ok(urls.some(url => url.endsWith('college-football/scoreboard?groups=80')), 'All FBS games, not only featured ones');
  await enrichFromEspn({ ...game, teams: [{ name: 'Delaware', logo: '' }] }, fetchImpl, cache);
  assert.equal(urls.length, 3, 'Second game reuses scoreboards and the shared college team directory');
});

test('dated ESPN scoreboards fill logos when today\'s boards miss the game', async () => {
  const urls = [];
  const row = (homeAway, displayName, logo) => ({ homeAway, team: { displayName, logo } });
  const fetchImpl = async url => {
    urls.push(url);
    const events = url.includes('uefa.champions/scoreboard?dates=20261021') ? [{
      name: 'Shakhtar Donetsk at Internazionale',
      competitions: [{ competitors: [row('away', 'Shakhtar Donetsk', 'https://a.espncdn.com/sha.png'), row('home', 'Internazionale', 'https://a.espncdn.com/int.png')] }],
    }] : [];
    return { ok: true, json: async () => ({ events }) };
  };
  const game = { category: 'football', date: Date.parse('2026-10-21T19:00:00.000Z'), teams: [{ name: 'Internazionale', logo: '' }, { name: 'Shakhtar Donetsk', logo: '' }] };
  const extra = await enrichFromEspn(game, fetchImpl, new Map());
  assert.deepEqual(extra.teams.map(t => t.logo), ['https://a.espncdn.com/int.png', 'https://a.espncdn.com/sha.png']);
  assert.equal(espnScoreboardDate(game.date), '20261021');
  assert.ok(urls.every(url => !url.includes('dates=') || urls.indexOf(url) >= 3), 'Try each league for today before dated scoreboards');
  assert.ok(urls.includes('/api/espn/soccer/uefa.champions/scoreboard?dates=20261021'));
});

test('MLB team directory fills logos when scoreboards have no row', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    if (url.includes('/baseball/mlb/teams')) {
      return { ok: true, json: async () => ({
        sports: [{ leagues: [{ teams: [
          { team: { displayName: 'Tampa Bay Rays', color: '092c5c', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/mlb/500/tb.png' }] } },
          { team: { displayName: 'Cleveland Guardians', color: '002b5c', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/mlb/500/cle.png' }] } },
        ] }] }],
      }) };
    }
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const game = { category: 'baseball', date: Date.parse('2026-10-21T00:00:00.000Z'), teams: [{ name: 'Tampa Bay Rays', logo: '' }, { name: 'Cleveland Guardians', logo: '' }] };
  const extra = await enrichFromEspn(game, fetchImpl, new Map());
  assert.ok(extra.teams.every(team => team.logo.includes('teamlogos/mlb')));
  assert.ok(urls.some(url => url.includes('/baseball/mlb/teams')));
});

test('needsEspnArt skips rows that already have both crests', () => {
  assert.equal(needsEspnArt({ teams: [{ name: 'A', logo: 'x' }, { name: 'B', logo: 'y' }], status: 'upcoming' }), false);
  assert.equal(needsEspnArt({ teams: [{ name: 'A', logo: '' }, { name: 'B', logo: 'y' }], status: 'upcoming' }), true);
});

test('enrichSchedule only fetches ESPN for games still missing logos', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ events: [] }) }; };
  const schedule = [
    { category: 'baseball', teams: [{ name: 'A', logo: 'https://a.png' }, { name: 'B', logo: 'https://b.png' }] },
    { category: 'baseball', teams: [{ name: 'C', logo: '' }, { name: 'D', logo: '' }] },
  ];
  await enrichSchedule(schedule, fetchImpl);
  assert.ok(calls > 0, 'Missing logos should trigger ESPN');
  assert.ok(calls < 6, 'Full schedule should not re-enrich every row');
});

test('studio cards use a network mark when Streamed sends no teams', () => {
  assert.equal(studioNetworkFromTitle('Goals Show Xtra (TNT)'), 'tnt');
  assert.equal(studioNetworkFromTitle('Some Cup Final'), '');
});
import { fetchSchedule } from '../public/schedule-source.js';

test('every game defaults to its embed; direct playback requires opting in and retains embed fallback', async t => {
  const embed = 'https://embed.st/embed/admin/game/1', control = {}, calls = [];
  let available = true;
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /\/api\/stream\//, 'Embedded playback needs no extra network lookup');
    return { ok: true, json: async () => available ? [{ embedUrl: embed }] : [] };
  });
  const player = { openEmbed: (...args) => calls.push(['embed', ...args]), open: (...args) => calls.push(['direct', ...args]) };
  const espn = { title: 'An ESPN game', sources: [{ source: 'admin', id: 'espn-game' }], candidates: NETWORK_STREAMS.espn };
  const leaguePass = { title: 'A League Pass game', sources: [{ source: 'admin', id: 'league-pass-game' }] };
  for (const game of [espn, leaguePass]) {
    assert.equal(await openGame(game, control, player), '');
    assert.deepEqual(calls.at(-1).slice(0, 4), ['embed', game.title, embed, control]);
    assert.equal(calls.at(-1)[4].sources[0].url, embed);
  }
  const previous = globalThis.location;
  globalThis.location = { protocol: 'http:' };
  t.after(() => { if (previous === undefined) delete globalThis.location; else globalThis.location = previous; });
  await openGame(espn, control, player, true);
  assert.deepEqual(calls.at(-1).slice(0, 4), ['direct', espn.title, control, NETWORK_STREAMS.espn]);
  assert.equal(calls.at(-1)[4].onExhausted(), true);
  assert.deepEqual(calls.at(-1).slice(0, 4), ['embed', espn.title, embed, control]);
  available = false;
  const before = calls.length;
  assert.match(await openGame(espn, control, player), /No stream is available/);
  assert.equal(calls.length, before, 'Embedded mode never silently switches to a direct feed');
});

test('ESPN fixture maps statuses and USA→E! candidate URLs', () => {
  const games = gamesFromScoreboard({
    events: [{
      id: '1',
      name: 'Atlanta Dream at Golden State Valkyries',
      date: '2026-10-20T00:00Z',
      status: { type: { state: 'in' } },
      competitions: [{
        broadcasts: [{ names: ['USA Net', 'CNBC', 'Peacock', 'E!'] }],
        competitors: [
          { homeAway: 'home', team: { displayName: 'Golden State Valkyries', logo: 'https://a.espncdn.com/home.png' } },
          { homeAway: 'away', team: { displayName: 'Atlanta Dream', logo: 'https://a.espncdn.com/away.png' } },
        ],
      }],
    }, {
      id: '2',
      name: 'Future',
      date: '2026-10-21T00:00Z',
      status: { type: { state: 'pre' } },
      competitions: [{ broadcasts: [{ names: ['NBC'] }], competitors: [] }],
    }, {
      id: '3',
      name: 'Prime only',
      date: '2026-10-20T01:00Z',
      status: { type: { state: 'in' } },
      competitions: [{ broadcasts: [{ names: ['Prime Video'] }], competitors: [] }],
    }],
  });
  assert.equal(games[0].status, 'live');
  assert.deepEqual(games[0].networks, ['USA Net', 'CNBC', 'Peacock', 'E!']);
  assert.equal(games[0].candidates[0], NETWORK_STREAMS.usa[0]);
  assert.ok(games[0].candidates.includes(NETWORK_STREAMS.e[0]));
  assert.ok(games[0].candidates.indexOf(NETWORK_STREAMS.usa[0]) < games[0].candidates.indexOf(NETWORK_STREAMS.e[0]));
  assert.equal(badgeText(games[0]), 'Live · watch · USA Net');
  assert.equal(games[0].teams[0].name, 'Atlanta Dream');
  assert.equal(games.find(g => g.id === '2').status, 'upcoming');
  assert.equal(badgeText(games.find(g => g.id === '2')), 'Upcoming');
  assert.equal(badgeText(games.find(g => g.id === '3')), 'Streaming only on Prime Video');
});

test('schedule errors are reported rather than presented as an empty list', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(fetchSchedule('all'), /Schedule is unavailable/);
});

test('Sports returns to the top with shared refresh feedback and waits for an existing load', async () => {
  let navClick, rejectLoad, resolveLoad, fetches = 0, closes = 0;
  const events = [], scrolls = [], attributes = {};
  const toggle = { setAttribute: (key, value) => { attributes[key] = value; }, getAttribute: key => attributes[key], addEventListener() {} };
  const elements = {
    '#games': { childElementCount: 0, children: [], setAttribute() {}, querySelectorAll() { return this.children; }, replaceChildren(...children) { this.children = children; this.childElementCount = children.length; } },
    '#games-status': { dataset: {} }, '#games-message': {}, '#games-hint': {}, '#prefer-direct': toggle,
    '#sport-title': {}, '#watch': { hidden: false },
    '.tv-canvas': { setAttribute() {}, scrollTo: options => scrolls.push(options) },
    '.tabs': { addEventListener: (_type, callback) => { navClick = callback; } },
  };
  const context = {
    SPORTS: [{ id: 'all', label: 'All' }], currentSport: () => 'all',
    setupPlayer: () => ({ close: () => { closes++; }, embedOpen: () => false }),
    fetchSchedule: () => { fetches++; return new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject; }); },
    fetchPopularGames: async () => [],
    candidatesForNetworks, isStreamingOnly, NETWORK_STREAMS, normalizeNetwork, byViewersThenTime, firstEmbed, fetchStreams,
    document: {
      querySelector: selector => elements[selector],
      addEventListener() {},
      dispatchEvent: event => events.push(event.type),
      createElement: tag => ({ className: '', classList: { add() {}, remove() {} }, style: { setProperty() {} }, dataset: {}, children: [], scrollLeft: 0, get lastElementChild() { return this.children.at(-1); }, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {} }),
    },
    fetch: async url => {
      if (String(url).includes('/api/schedule')) return { ok: false };
      return { ok: true, json: async () => ({ events: [], sports: [{ leagues: [{ teams: [] }] }] }) };
    },
    window: { addEventListener() {} }, location: { search: '' }, matchMedia: () => ({ matches: true }),
    CustomEvent: class { constructor(type) { this.type = type; } }, setInterval: () => 1, clearInterval() {},
  };
  const source = (await readFile(new URL('../public/nba.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '').replace(/^export \{.*\};\n/gm, '').replace(/\bexport /g, '');
  runInNewContext(source, context);
  const sports = context.setupSports();
  assert.equal(elements['#games-message'].textContent, 'Loading games');
  assert.equal(elements['#games-status'].dataset.loading, 'true');
  assert.equal(elements['#games-hint'].hidden, true);
  const waiting = sports.refresh();
  assert.equal(sports.refresh(), waiting, 'A manual refresh shares the automatic request');
  assert.equal(fetches, 1);
  navClick({ target: { closest: () => null } });
  assert.equal(events.length, 0, 'Inactive tabs do not refresh');
  navClick({ target: { closest: () => ({}) }, preventDefault() {} });
  assert.equal(closes, 1);
  assert.equal(scrolls[0].top, 0);
  assert.equal(scrolls[0].behavior, 'instant');
  assert.deepEqual(events, ['gulp:refresh']);
  rejectLoad(new Error('Offline')); await waiting;
  assert.equal(elements['#games-message'].textContent, 'Games unavailable');
  assert.equal(elements['#games-hint'].textContent, 'Select Sports to try again.');
  assert.equal(elements['#games-status'].dataset.loading, 'false');
  elements['#games'].childElementCount = 1;
  const next = sports.refresh();
  assert.equal(elements['#games-status'].hidden, true, 'Refreshing an existing schedule uses the shared pull spinner');
  assert.equal(fetches, 2, 'A completed or failed load permits another refresh');
  rejectLoad(new Error('Still offline')); await next;
  assert.equal(elements['#games-message'].textContent, 'Couldn’t update games');
  assert.match(elements['#games-hint'].textContent, /Showing the last schedule/);
  assert.equal(elements['#games'].childElementCount, 1, 'A failed refresh keeps the existing games');
  const empty = sports.refresh(); resolveLoad([]); await empty;
  assert.equal(elements['#games-message'].textContent, 'No games scheduled');
  assert.equal(elements['#games-hint'].textContent, 'Select Sports to check again.');
  assert.equal(elements['#games-status'].dataset.loading, 'false');
  const game = { id: 'game', title: 'A live game', status: 'live', date: Date.now(), teams: [], networks: [] };
  const first = sports.refresh(); resolveLoad([game]); await first;
  const originalShelf = elements['#games'].children[0];
  originalShelf.lastElementChild.scrollLeft = 120;
  const unchanged = sports.refresh(); resolveLoad([{ ...game }]); await unchanged;
  assert.equal(elements['#games'].children[0], originalShelf, 'Minute refreshes keep unchanged cards and their decoded images');
  assert.equal(originalShelf.lastElementChild.scrollLeft, 120, 'Retained shelves keep their horizontal scroll');
  const changed = sports.refresh(); resolveLoad([{ ...game, title: 'Updated game title' }]); await changed;
  assert.notEqual(elements['#games'].children[0], originalShelf, 'Changed game information still refreshes');
  assert.equal(elements['#games'].children[0].lastElementChild.scrollLeft, 120, 'Changed shelves also retain their scroll');
});
