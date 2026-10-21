import { fetchSchedule, currentSport } from './public/schedule-source.js';
import { enrichSchedule } from './public/nba.js';

export const ESPN_UPSTREAM = 'https://site.api.espn.com/apis/site/v2/sports';

/** Map browser `/api/espn/...` fetches to ESPN’s public API (no CORS in Node). */
export function espnUpstreamFetch(url) {
  const path = String(url).replace(/^\/api\/espn\//, '');
  return fetch(`${ESPN_UPSTREAM}/${path}`, { signal: AbortSignal.timeout(12000) });
}

export async function loadEnrichedSchedule(sport = 'all') {
  return enrichSchedule(await fetchSchedule(sport), espnUpstreamFetch);
}

export { currentSport };
