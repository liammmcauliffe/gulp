/** Swappable schedule + embed source. Today: Streamed.pk public API. */
export const ORIGIN = 'https://streamed.pk';

const hiddenSports = new Set(['fight', 'golf', 'tennis', 'motor-sports']);

export const SPORTS = [
  { id: 'all', label: 'All', category: null },
  { id: 'basketball', label: 'Basketball', category: 'basketball' },
  { id: 'american-football', label: 'Football', category: 'american-football' },
  { id: 'baseball', label: 'Baseball', category: 'baseball' },
  { id: 'hockey', label: 'Hockey', category: 'hockey' },
  { id: 'football', label: 'Soccer', category: 'football' },
  { id: 'fight', label: 'Fight', category: 'fight' },
  { id: 'tennis', label: 'Tennis', category: 'tennis' },
  { id: 'golf', label: 'Golf', category: 'golf' },
  { id: 'motor-sports', label: 'Motors', category: 'motor-sports' },
  { id: 'other', label: 'Other', category: 'other' },
].filter(sport => !hiddenSports.has(sport.category));

const byId = Object.fromEntries(SPORTS.map(s => [s.id, s]));

export const byViewersThenTime = (a, b) => (b.viewers ?? 0) - (a.viewers ?? 0) || a.date - b.date;

export function currentSport(search = '') {
  const sport = new URLSearchParams(search).get('sport');
  return sport && byId[sport] ? sport : 'all';
}

export function badgeUrl(badge) {
  if (!badge) return '';
  if (/^https?:\/\//i.test(badge)) return badge;
  return `${ORIGIN}${badge.startsWith('/') ? badge : `/api/images/badge/${badge}.webp`}`;
}

function normTeam(name) {
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamOverlap(a, b) {
  a = normTeam(a); b = normTeam(b);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const words = s => s.split(' ').filter(w => w.length > 2);
  return words(a).some(w => words(b).includes(w));
}

function teamNamesFromMatch(match) {
  const away = match.teams?.away?.name, home = match.teams?.home?.name;
  if (away && home) return [away, home];
  const parts = match.title?.split(/\s+vs\.?\s+|\s+-\s+/i).map(s => s.trim()).filter(Boolean);
  return parts?.length === 2 ? parts : [];
}

/** Same sport and the same two sides, even when Streamed uses different ids or team spellings. */
export function sameFixture(a, b) {
  if (a.category !== b.category) return false;
  const [aAway, aHome] = teamNamesFromMatch(a);
  const [bAway, bHome] = teamNamesFromMatch(b);
  if (aAway && aHome && bAway && bHome) {
    return (teamOverlap(aAway, bAway) && teamOverlap(aHome, bHome))
      || (teamOverlap(aAway, bHome) && teamOverlap(aHome, bAway));
  }
  return normTeam(a.title) === normTeam(b.title);
}

function mergeTeamSide(a, b) {
  if (!a?.name) return b;
  if (!b?.name) return a;
  return { name: a.name, badge: a.badge || b.badge };
}

function mergeRawMatches(a, b, liveIds) {
  const aLive = liveIds.has(a.id), bLive = liveIds.has(b.id);
  let base, other;
  if (aLive && !bLive) { base = a; other = b; }
  else if (bLive && !aLive) { base = b; other = a; }
  else {
    const score = m => (m.poster ? 4 : 0) + (m.teams?.away?.badge ? 1 : 0) + (m.teams?.home?.badge ? 1 : 0);
    base = score(a) >= score(b) ? a : b;
    other = base === a ? b : a;
  }
  return {
    ...base,
    poster: base.poster || other.poster,
    popular: base.popular || other.popular,
    sources: [...new Map([...(a.sources || []), ...(b.sources || [])].map(s => [`${s.source}/${s.id}`, s])).values()],
    teams: {
      away: mergeTeamSide(base.teams?.away, other.teams?.away),
      home: mergeTeamSide(base.teams?.home, other.teams?.home),
    },
  };
}

function mergeDuplicateFixtures(matches, liveIds) {
  const merged = [];
  for (const match of matches) {
    const i = merged.findIndex(m => sameFixture(m, match));
    if (i === -1) merged.push(match);
    else merged[i] = mergeRawMatches(merged[i], match, liveIds);
  }
  return merged;
}

export function gamesFromMatches(matches, liveIds = new Set()) {
  const now = Date.now();
  return (matches || []).map(match => {
    const live = liveIds.has(match.id);
    const date = Number(match.date) || 0;
    let status = 'upcoming';
    if (live) status = 'live';
    else if (date && date < now - 3 * 60 * 60 * 1000) status = 'final';
    const away = match.teams?.away;
    const home = match.teams?.home;
    return {
      id: match.id,
      title: match.title || 'Game',
      category: match.category || '',
      popular: !!match.popular,
      date,
      status,
      poster: /^\/api\//.test(match.poster) ? `${ORIGIN}${match.poster}` : '',
      sources: match.sources || [],
      networks: [],
      candidates: [],
      mappedNetworks: [],
      teams: [
        { name: away?.name || '', logo: badgeUrl(away?.badge) },
        { name: home?.name || '', logo: badgeUrl(home?.badge) },
      ].filter(t => t.name),
    };
  }).sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || a.date - b.date);
}

export async function fetchSchedule(sport = 'all', fetchImpl = fetch) {
  const { category } = byId[sport] || byId.all;
  const opts = { signal: AbortSignal.timeout(12000) };
  const [liveRes, todayRes] = await Promise.all([
    fetchImpl(`${ORIGIN}/api/matches/live`, opts),
    fetchImpl(`${ORIGIN}/api/matches/all-today`, opts),
  ]);
  if (!liveRes.ok || !todayRes.ok) throw new Error('Schedule is unavailable. Try again shortly.');
  const [live, today] = await Promise.all([liveRes.json(), todayRes.json()]);
  const liveIds = new Set((live || []).map(m => m.id));
  const byMatch = new Map();
  for (const match of [...(live || []), ...(today || [])]) {
    if (hiddenSports.has(match.category) || (category && match.category !== category)) continue;
    byMatch.set(match.id, byMatch.has(match.id) ? mergeRawMatches(byMatch.get(match.id), match, liveIds) : match);
  }
  return gamesFromMatches(mergeDuplicateFixtures([...byMatch.values()], liveIds), liveIds);
}

/** Rank live games by the total viewers reported across their Streamed feeds. */
export async function fetchPopularGames(games, fetchImpl = fetch) {
  const live = games.filter(game => game.status === 'live' && game.sources?.length);
  const ranked = [];
  // Limit to four games at a time so a busy sports day doesn't flood the API.
  for (let start = 0; start < live.length; start += 4) {
    ranked.push(...await Promise.all(live.slice(start, start + 4).map(async game => {
      const sources = new Map(game.sources.filter(s => s.source && s.id).map(s => [`${s.source}/${s.id}`, s]));
      const counts = await Promise.all([...sources.values()].map(async ({ source, id }) => {
        try {
          const response = await fetchImpl(`${ORIGIN}/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) return null;
          const streams = await response.json();
          const viewers = streams.map(s => s.viewers).filter(n => Number.isFinite(n) && n >= 0);
          return viewers.length ? viewers.reduce((sum, n) => sum + n, 0) : null;
        } catch { return null; }
      }));
      const known = counts.filter(n => n !== null);
      return { ...game, viewers: known.length ? known.reduce((sum, n) => sum + n, 0) : null };
    })));
  }
  return ranked.sort(byViewersThenTime);
}

export function compareStreams(a, b) {
  return (b.viewers ?? -1) - (a.viewers ?? -1)
    || Number(!!b.hd) - Number(!!a.hd)
    || Number(/^english/i.test(b.language || '')) - Number(/^english/i.test(a.language || ''));
}

/** One HTTPS feed per provider name — the most-watched stream across all of that provider’s ids. */
export function topStreamPerProvider(streams) {
  const byProvider = new Map();
  for (const stream of streams) {
    const key = stream.source || 'stream';
    const prev = byProvider.get(key);
    if (!prev || compareStreams(stream, prev) < 0) byProvider.set(key, stream);
  }
  return [...byProvider.values()].sort(compareStreams);
}

/** Available feeds: one row per provider (admin, hotel, golf, …), default = highest viewers. */
export async function fetchStreams(sources, fetchImpl = fetch) {
  const groups = new Map((sources || []).filter(s => s.source && s.id).map(s => [`${s.source}/${s.id}`, s]));
  const feeds = await Promise.all([...groups.values()].map(async ({ source, id }) => {
    try {
      const response = await fetchImpl(`${ORIGIN}/api/stream/${encodeURIComponent(source)}/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) return [];
      const streams = await response.json();
      return (streams || []).filter(s => /^https:\/\//i.test(s.embedUrl || '')).map((stream, index) => ({
        ...stream, source, streamNo: stream.streamNo || index + 1,
        viewers: Number.isFinite(stream.viewers) && stream.viewers >= 0 ? stream.viewers : null,
      }));
    } catch { return []; }
  }));
  const unique = [...new Map(feeds.flat().map(stream => [stream.embedUrl, stream])).values()];
  return topStreamPerProvider(unique);
}

/** First working embed URL from Streamed source groups (HD English preferred). */
export async function firstEmbed(sources, fetchImpl = fetch) {
  return (await fetchStreams(sources, fetchImpl))[0]?.embedUrl || '';
}
