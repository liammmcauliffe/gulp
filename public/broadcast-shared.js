/** Network key → ordered playable URLs (best quality first). Unmapped = no linear feed. */
export const NETWORK_STREAMS = {
  usa: [
    'http://138.121.15.230:9002/USA/index.m3u8',
    'https://tvsen3.aynaott.com/dbbcY6NG/index.m3u8',
  ],
  espn: [
    // H.264: verified with decoded 720p video in Gulp. The former HEVC feed played audio only.
    'http://85.237.89.160:9590/usa-s/ESPN-HD/index.m3u8',
  ],
  espn2: [
    'http://85.237.89.160:9590/usa-s/ESPN-2-HD/index.m3u8',
    'https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8',
  ],
  espnu: ['http://85.237.89.160:9590/usa-s/ESPN-U-HD/index.m3u8'],
  espnews: ['http://41.205.93.154/ESPNNEWS/index.m3u8'],
  fs1: ['http://85.237.89.160:9590/usa-s/FOX-SPORTS-1/index.m3u8'],
  nbc: ['http://85.237.89.160:9590/usa-s/NBC-HD/index.m3u8'],
  tnt: ['http://212.5.144.156/tnt/index.m3u8'],
  trutv: ['http://23.237.104.106:8080/USA_TRUTV/index.m3u8'],
  nfln: [
    'http://198.58.104.90:8989/nfl/index.m3u8',
    'https://tvsen6.aynaott.com/nfl/index.m3u8',
  ],
  nbatv: [
    'http://23.237.104.106:8080/USA_NBA/index.m3u8',
    'http://rezofoot.tv/NBATV/index.m3u8',
  ],
  sec: ['http://23.237.104.106:8080/USA_SEC_NETWORK/index.m3u8'],
  acc: ['http://23.239.31.26:8989/accnetwork/index.m3u8'],
  btn: ['http://23.237.104.106:8080/USA_BTN/index.m3u8'],
  e: ['http://23.237.104.106:8080/USA_E/index.m3u8'],
  cnbc: ['https://cnbc-live.akamaized.net/cnbc/master.m3u8'],
  tennis: ['http://23.237.104.106:8080/USA_TENNIS/index.m3u8'],
};

/** ESPN broadcast name aliases → NETWORK_STREAMS key. */
const NETWORK_ALIASES = {
  'usa net': 'usa',
  usa: 'usa',
  'usa network': 'usa',
  'e!': 'e',
  e: 'e',
  cnbc: 'cnbc',
  espn: 'espn',
  espn2: 'espn2',
  espnu: 'espnu',
  espnews: 'espnews',
  'espn news': 'espnews',
  nbc: 'nbc',
  tnt: 'tnt',
  trutv: 'trutv',
  'tru tv': 'trutv',
  'nba tv': 'nbatv',
  nbatv: 'nbatv',
  'nfl net': 'nfln',
  'nfl network': 'nfln',
  nfln: 'nfln',
  'sec network': 'sec',
  secn: 'sec',
  sec: 'sec',
  'acc network': 'acc',
  accn: 'acc',
  acc: 'acc',
  btn: 'btn',
  'big ten network': 'btn',
  fs1: 'fs1',
  'fox sports 1': 'fs1',
  'fox sports one': 'fs1',
  tennis: 'tennis',
  'tennis channel': 'tennis',
};

const STREAMING_ONLY = new Set([
  'prime video', 'amazon prime', 'amazon prime video', 'peacock', 'apple tv',
  'apple tv+', 'espn+', 'espn plus', 'paramount+', 'netflix', 'hulu',
]);

export function normalizeNetwork(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\./g, '');
  return NETWORK_ALIASES[key] || null;
}

export function isStreamingOnly(name) {
  return STREAMING_ONLY.has(String(name || '').trim().toLowerCase());
}

/**
 * Flatten every broadcast network's URLs in ESPN order (deduped).
 * Returns { urls, networks } where networks are display names that contributed URLs.
 */
export function candidatesForNetworks(networks) {
  const seen = new Set();
  const urls = [];
  const used = [];
  for (const network of networks || []) {
    const key = normalizeNetwork(network);
    if (!key) continue;
    const list = NETWORK_STREAMS[key];
    if (!list?.length) continue;
    let added = false;
    for (const url of list) {
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      added = true;
    }
    if (added) used.push(network);
  }
  return { urls, networks: used };
}
