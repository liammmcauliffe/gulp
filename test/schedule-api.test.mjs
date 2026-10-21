import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnrichedSchedule, espnUpstreamFetch } from '../schedule-api.mjs';

test('espnUpstreamFetch rewrites /api/espn paths to site.api.espn.com', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ events: [] }) };
  };
  globalThis.fetch = fetchImpl;
  await espnUpstreamFetch('/api/espn/baseball/mlb/scoreboard');
  assert.equal(urls[0], 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard');
});

test('loadEnrichedSchedule fills college logos from ESPN', async () => {
  const team = (homeAway, displayName, logo) => ({ homeAway, team: { displayName, logo, color: '000000' } });
  globalThis.fetch = async url => {
    if (String(url).includes('streamed.pk')) {
      const body = url.endsWith('/live') ? [] : [{
        id: 'cfb-1', title: 'Liberty Flames - Kennesaw State Owls', category: 'american-football', date: Date.now(),
        teams: { away: { name: 'Kennesaw State Owls' }, home: { name: 'Liberty Flames' } },
      }];
      return { ok: true, json: async () => body };
    }
    if (String(url).includes('college-football/scoreboard')) {
      return { ok: true, json: async () => ({ events: [{
        name: 'Liberty Flames at Kennesaw State Owls',
        competitions: [{ competitors: [team('away', 'Kennesaw State Owls', 'https://a.espncdn.com/ksu.png'), team('home', 'Liberty Flames', 'https://a.espncdn.com/lib.png')] }],
      }] }) };
    }
    return { ok: true, json: async () => ({ events: [] }) };
  };
  const games = await loadEnrichedSchedule('american-football');
  assert.equal(games.length, 1);
  assert.ok(games[0].teams.every(t => t.logo.startsWith('https://a.espncdn.com/')));
});
