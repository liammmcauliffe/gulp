# TimStreams and PPV.ST: custom player compatibility

Checked 2026-10-19 using the current links in [FMHY's live sports directory](https://fmhy.net/video#live-sports). Read-only requests, no login, no modified provider referrer, no access-control bypass. Application code unchanged.

## Result

**Neither site's checked public interface provided a usable standalone NBA/soccer HLS source.** Both public integrations presently return iframe players. A watch page or API returning 200 is not playback verification. No media playlist was available through the checked public interfaces, so no playlist/segment playback test could be performed.

## TimStreams

- [Home](https://timst.top/) loads a React client. Its [current public client bundle](https://timst.top/assets/index-DZ5a-Ay1.js) fetches `/api/live-upcoming`, `/api/channels`, and `/api/watch/{event}`; the watch view renders the selected source as an iframe.
- [Public live/upcoming endpoint](https://timst.top/api/live-upcoming) returned HTTP 200 and `Access-Control-Allow-Origin: http://localhost:4173` for a request from that origin. The current events contained iframe/watch URLs on `ehgembxe.cfd`; no NBA/soccer event was present in that response at check time.
- [Public channels endpoint](https://timst.top/api/channels) returned 217 channels, with iframe/watch URLs rather than M3U8 media URLs.
- The channel list's NBA TV source linked to `https://ehgembxe.cfd/8tl2ksef-2775`. An ordinary unauthenticated GET returned **403 Forbidden**, so investigation stopped there; this is an embed-access rejection, not merely missing CORS on public media.
- The official client has a **VIP** dashboard calling `/api/vip/playlist-url` with a bearer token from the signed-in account. Its state calls the result `m3u8_url`. This is evidence of a potential supported standalone-playlist option for an authorized account, **not** a tested public/free HLS feed. No authenticated route was probed or credential requested.

## PPV.ST

- [Official API documentation](https://ppv.st/api) describes [the public stream list](https://api.ppv.st/api/streams). Its current [documentation component](https://ppv.st/_app-1/D_xsbKaD.js) explicitly allows other-site/API use and sensible cached backend use, but prohibits modifying embed behavior or bypassing ad/integration rules. Its API response asks users interested in integration to contact the operator.
- The public list returned HTTP 200 and `Access-Control-Allow-Origin: *`. Checked current NBA [Celtics–Pistons detail](https://api.ppv.st/api/streams/nba/2026-10-20/bos-det) and soccer [Fenerbahce–Slavia Prague detail](https://api.ppv.st/api/streams/ucl/2026-10-20/fen-slp) endpoints also returned 200/CORS `*`.
- In both checked details, `m3u8` was an empty string and `sources` contained only `type: "iframe"`, named **External Player Frame**, on `taifood-blog.asia`. `source_type: "playlist"` alone therefore does **not** establish a playable playlist.
- The [official application bundle](https://ppv.st/_app-1/C0ZN2SDT.js) includes a **Short link** action for sources marked VIP, with copy explaining that the generated link can be opened in a media player. This might be a supported authorized-account route, but it was not available in the checked public event responses and was not tested.

## Recommendation

Keep Gulp's owned player awaiting a direct media URL. These two public APIs can supply schedule metadata and vendor embed URLs, but their checked responses do not solve custom-player playback. An operator-approved direct integration or an account's officially provided standalone playlist would need separate CORS and playlist/segment verification before implementation. Do not hardcode their iframe URLs as HLS or label these sources as verified playback.
