import test from 'node:test';
import assert from 'node:assert/strict';
import { SPORTS, fetchSchedule, gamesFromMatches, firstEmbed, fetchStreams, topStreamPerProvider, currentSport, badgeUrl, fetchPopularGames, sameFixture } from '../public/schedule-source.js';
import { badgeText, teamsMatch, shelvesFrom, startLabel } from '../public/nba.js';

test('start times name the day when a game is not today', () => {
  const now = new Date(2026, 9, 19, 22, 28).getTime();
  const at = (day, hour) => new Date(2026, 9, day, hour).getTime();
  assert.doesNotMatch(startLabel(at(19, 23), now), /Tomorrow|[A-Z][a-z]{2} /);
  assert.match(startLabel(at(20, 20), now), /^Tomorrow /, 'Tomorrow evening is not "8:00 PM" tonight');
  assert.match(startLabel(at(22, 20), now), /^Thu /);
});

test('currentSport defaults to all and accepts Streamed categories', () => {
  assert.equal(currentSport(''), 'all');
  assert.equal(currentSport('?sport=basketball'), 'basketball');
  assert.equal(currentSport('?sport=nba'), 'all');
});

test('hidden sports are excluded from live and upcoming games and sport selection', async () => {
  const hidden = ['fight', 'golf', 'tennis', 'motor-sports'];
  const live = [...hidden, 'hockey'].map(category => ({ id: `live-${category}`, category, date: Date.now() }));
  const today = [...hidden, 'basketball'].map(category => ({ id: `upcoming-${category}`, category, date: Date.now() + 3600000 }));
  const schedule = await fetchSchedule('all', async url => ({ ok: true, json: async () => url.endsWith('/live') ? live : today }));
  assert.deepEqual(schedule.map(game => game.id), ['live-hockey', 'upcoming-basketball']);
  for (const category of hidden) {
    assert.ok(!SPORTS.some(sport => sport.category === category));
    assert.equal(currentSport(`?sport=${category}`), 'all');
  }
});

test('duplicate Streamed fixtures merge all sources and art onto the live row', async () => {
  const live = [{
    id: 'live-sabah',
    title: 'Sabah FK vs Borussia Dortmund',
    category: 'football',
    date: 1,
    teams: { away: { name: 'Sabah FK' }, home: { name: 'Borussia Dortmund' } },
    sources: [{ source: 'hotel', id: 'live' }],
  }];
  const today = [{
    id: 'rich-sabah',
    title: 'Sabah Baku vs Borussia Dortmund',
    category: 'football',
    date: 2,
    poster: '/api/images/proxy/poster.webp',
    teams: { away: { name: 'Sabah Baku', badge: 'away-badge' }, home: { name: 'Borussia Dortmund', badge: 'home-badge' } },
    sources: [{ source: 'admin', id: 'main' }, { source: 'golf', id: 'alternate' }, { source: 'hotel', id: 'live' }],
  }];
  assert.ok(sameFixture(live[0], today[0]));
  const games = await fetchSchedule('all', async url => ({ ok: true, json: async () => url.endsWith('/live') ? live : today }));
  assert.equal(games.length, 1);
  assert.equal(games[0].status, 'live');
  assert.equal(games[0].id, 'live-sabah');
  assert.deepEqual(games[0].sources.map(({ source }) => source), ['hotel', 'admin', 'golf'], 'The merged game retains every provider, including feeds on the richer duplicate');
  assert.match(games[0].poster, /poster\.webp/);
  assert.ok(games[0].teams.every(team => team.logo));
  const [sameId] = await fetchSchedule('all', async url => ({ ok: true, json: async () => url.endsWith('/live') ? live : [{ ...today[0], id: live[0].id }] }));
  assert.deepEqual(sameId.sources, games[0].sources, 'The same providers survive when live and today use the same game id');
});

test('Streamed matches map live/upcoming and badge URLs', () => {
  const liveIds = new Set(['live-1']);
  const games = gamesFromMatches([{
    id: 'live-1',
    title: 'A vs B',
    category: 'basketball',
    popular: true,
    date: Date.now() - 1000,
    sources: [{ source: 'admin', id: 'x' }],
    poster: '/api/images/proxy/poster.webp',
    teams: {
      away: { name: 'Away', badge: 'abc' },
      home: { name: 'Home', badge: '/api/images/proxy/def' },
    },
  }, {
    id: 'soon',
    title: 'C vs D',
    category: 'hockey',
    date: Date.now() + 3600000,
    sources: [],
    teams: {},
  }], liveIds);
  assert.equal(games[0].status, 'live');
  assert.equal(games[0].popular, true);
  assert.equal(games[1].popular, false);
  assert.equal(games[0].teams[0].logo, 'https://streamed.pk/api/images/badge/abc.webp');
  assert.equal(games[0].poster, 'https://streamed.pk/api/images/proxy/poster.webp');
  assert.equal(games[1].poster, '');
  assert.equal(games[1].status, 'upcoming');
  assert.equal(badgeText(games[0]), 'Live · watch');
  assert.equal(badgeText(games[1]), 'Upcoming');
});

test('streaming-only badge when ESPN networks are streaming and no embed sources', () => {
  assert.equal(badgeText({
    status: 'live',
    candidates: [],
    sources: [],
    networks: ['Prime Video'],
  }), 'Streaming only on Prime Video');
});

test('teamsMatch links Streamed rows to ESPN events', () => {
  assert.ok(teamsMatch(
    { teams: [{ name: 'Atlanta Dream' }, { name: 'Golden State Valkyries' }] },
    { title: 'Atlanta Dream at Golden State Valkyries', teams: [{ name: 'Atlanta Dream' }, { name: 'Golden State Valkyries' }] },
  ));
  assert.equal(teamsMatch(
    { teams: [{ name: 'Atlanta Dream' }, { name: 'Golden State Valkyries' }] },
    { title: 'Other Game', teams: [{ name: 'Boston' }, { name: 'Chicago' }] },
  ), false);
});

test('every live game appears in Live now and its sport shelf alongside upcoming games', () => {
  const live = [
    { id: 'basketball', status: 'live', category: 'basketball', viewers: 300, date: 100 },
    { id: 'football', status: 'live', category: 'american-football', viewers: 500, date: 100 },
    { id: 'baseball', status: 'live', category: 'baseball', viewers: 400, date: 100 },
    { id: 'hockey', status: 'live', category: 'hockey', viewers: 200, date: 100 },
  ];
  const upcoming = { id: 'next-baseball', status: 'upcoming', category: 'baseball', date: 200 };
  const shelves = shelvesFrom([...live, upcoming, { id: 'finished', status: 'final', category: 'hockey', date: 0 }]);
  assert.deepEqual(shelves.map(s => s.title), ['Live now', 'Basketball', 'Football', 'Baseball', 'Hockey']);
  assert.deepEqual(shelves[0].games.map(g => g.id), ['football', 'baseball', 'basketball', 'hockey']);
  for (const [i, title] of ['Basketball', 'Football', 'Baseball', 'Hockey'].entries()) {
    assert.ok(shelves.find(s => s.title === title).games.includes(live[i]), `${title} keeps its live game`);
  }
  assert.ok(shelves.find(s => s.title === 'Baseball').games.includes(upcoming));
  assert.ok(!shelves.some(s => s.games.some(g => g.status === 'final')));
});

test('every shelf sorts by viewers descending, then start time, with missing counts treated as zero', () => {
  const games = [
    { id: 'unknown', status: 'live', category: 'baseball', viewers: null, date: 600 },
    { id: 'popular-later', status: 'live', category: 'baseball', viewers: 500, date: 200, popular: true },
    { id: 'upcoming-later', status: 'upcoming', category: 'baseball', date: 500 },
    { id: 'most-watched', status: 'live', category: 'baseball', viewers: 1000, date: 300 },
    { id: 'earlier', status: 'live', category: 'baseball', viewers: 500, date: 100 },
    { id: 'zero', status: 'live', category: 'baseball', viewers: 0, date: 400 },
    { id: 'upcoming-earlier', status: 'upcoming', category: 'baseball', date: 350 },
  ];
  const original = [...games];
  const shelves = shelvesFrom(games);
  assert.deepEqual(shelves[0].games.map(g => g.id), ['most-watched', 'earlier', 'popular-later', 'zero', 'unknown']);
  assert.deepEqual(shelves.find(s => s.title === 'Baseball').games.map(g => g.id), [
    'most-watched', 'earlier', 'popular-later', 'upcoming-earlier', 'zero', 'upcoming-later', 'unknown',
  ]);
  assert.deepEqual(games, original, 'Building shelves leaves the input order intact');
});

test('firstEmbed picks an HTTPS embedUrl from the first working source', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('/bad/')) return { ok: false };
    return {
      ok: true,
      json: async () => [
        { language: 'Spanish', hd: false, embedUrl: 'https://embed.st/embed/a/1' },
        { language: 'English', hd: true, embedUrl: 'https://embed.st/embed/a/2' },
      ],
    };
  };
  const url = await firstEmbed([
    { source: 'bad', id: '1' },
    { source: 'admin', id: 'ppv-test' },
  ], fetchImpl);
  assert.equal(url, 'https://embed.st/embed/a/2');
  assert.equal(calls.length, 2);
});

test('source choices include all unique HTTPS feeds and tolerate failed groups and missing counts', async () => {
  const calls = [];
  const streams = await fetchStreams([
    { source: 'alpha', id: 'one' }, { source: 'alpha', id: 'one' },
    { source: 'broken', id: 'two' }, { source: 'bravo', id: 'three' }, {},
  ], async url => {
    calls.push(url);
    if (url.includes('/broken/')) throw new Error('Offline');
    return { ok: true, json: async () => url.includes('/alpha/') ? [
      { streamNo: 1, language: 'Spanish', viewers: 500, embedUrl: 'https://example.com/alpha/1' },
      { streamNo: 2, language: 'English', hd: true, viewers: 20, embedUrl: 'https://example.com/alpha/2' },
      { embedUrl: 'javascript:alert(1)', viewers: 9999 },
    ] : [{ viewers: -1, embedUrl: 'https://example.com/bravo/1' }] };
  });
  assert.equal(calls.length, 3, 'Duplicate source groups are fetched once');
  assert.deepEqual(streams.map(stream => stream.viewers), [500, null], 'One feed per provider, most viewers');
  assert.deepEqual(streams.map(stream => stream.source), ['alpha', 'bravo']);
});

test('topStreamPerProvider picks the busiest admin across ids and keeps other providers', async () => {
  const streams = await fetchStreams([
    { source: 'admin', id: 'a' },
    { source: 'admin', id: 'b' },
    { source: 'hotel', id: 'c' },
  ], async url => ({
    ok: true,
    json: async () => url.includes('/admin/a') ? [
      { streamNo: 1, viewers: 10, embedUrl: 'https://example.com/admin-low' },
    ] : url.includes('/admin/b') ? [
      { streamNo: 1, viewers: 99, embedUrl: 'https://example.com/admin-top' },
    ] : [{ streamNo: 1, viewers: 50, embedUrl: 'https://example.com/hotel' }],
  }));
  assert.deepEqual(streams.map(s => s.embedUrl), ['https://example.com/admin-top', 'https://example.com/hotel']);
  assert.deepEqual(topStreamPerProvider([
    { source: 'golf', viewers: 1, embedUrl: 'a' },
    { source: 'golf', viewers: 9, embedUrl: 'b' },
  ]).map(s => s.embedUrl), ['b']);
});

test('live games rank by viewers across all feeds and sources', async () => {
  const games = Array.from({ length: 6 }, (_, i) => ({
    id: String(i), status: 'live', date: i, popular: false, sources: [{ source: 'admin', id: String(i) }],
  }));
  // The second game wins only after counting both its source groups. Duplicate source references count once.
  games[1].sources.push({ source: 'golf', id: 'extra' }, { source: 'golf', id: 'extra' });
  games.push({ id: 'upcoming', status: 'upcoming', sources: [{ source: 'admin', id: 'upcoming' }] });
  const calls = [];
  const result = await fetchPopularGames(games, async url => {
    calls.push(url);
    const count = url.endsWith('/extra') ? 100 : Number(url.split('/').at(-1)) * 10;
    return { ok: true, json: async () => [{ viewers: count }, { viewers: 2 }, { viewers: -100 }, {}] };
  });
  assert.deepEqual(result.map(game => game.id), ['1', '5', '4', '3', '2', '0']);
  assert.equal(result[0].viewers, 114);
  assert.equal(calls.filter(url => url.endsWith('/extra')).length, 1);
  assert.ok(!calls.some(url => url.endsWith('/upcoming')));
  assert.equal(games[1].viewers, undefined, 'Ranking does not mutate the schedule');
});

test('viewer ranking tolerates missing counts and failed sources without inventing viewers', async () => {
  const games = [
    { id: 'unknown', status: 'live', date: 1, popular: false, sources: [{ source: 'missing', id: '1' }] },
    { id: 'popular', status: 'live', date: 2, popular: true, sources: [{ source: 'bad', id: '2' }] },
    { id: 'zero', status: 'live', date: 3, sources: [{ source: 'good', id: '3' }] },
  ];
  const result = await fetchPopularGames(games, async url => {
    if (url.includes('/bad/')) throw new Error('Offline');
    return { ok: true, json: async () => url.includes('/good/') ? [{ viewers: 0 }] : [{ hd: true }] };
  });
  assert.deepEqual(result.map(game => game.id), ['unknown', 'popular', 'zero']);
  assert.equal(result[2].viewers, 0);
  assert.equal(result[1].viewers, null);
  assert.deepEqual(await fetchPopularGames([], () => assert.fail('No requests without live games')), []);
});
