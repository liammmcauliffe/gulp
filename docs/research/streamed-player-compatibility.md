# Streamed and Gulp's own player

Checked 19 October 2026 with the official documentation and ordinary, unauthenticated GET requests. This is a compatibility finding, not a claim that an internal media URL could never be obtained.

## Finding

**Streamed does not currently document a standalone HLS feed or a cooperative iframe control API.** Its supported integration is a hosted player iframe. The documented stream object has `id`, `streamNo`, `language`, `hd`, `embedUrl`, and `source`; the embedding example assigns `embedUrl` to an iframe. There is no documented `.m3u8`, DASH, MP4, token-refresh, or player-command endpoint. [Streamed Streams API](https://streamed.pk/docs/streams)

The API itself is public and does not require authentication. That applies to the catalog/API; it does not establish that the separate video delivery system accepts requests from Gulp. [Streamed API overview](https://streamed.pk/docs)

## Current first-party responses

- `GET /api/matches/live` returned HTTP 200 and `Access-Control-Allow-Origin: *`. A live soccer entry, Tottenham Hotspur–Coventry City, offered `golf` and `hotel` source groups. [Live matches response](https://streamed.pk/api/matches/live)
- The golf resolver returned two English stream objects, each with an `https://embed.st/embed/golf/2373/...` URL. The response added a viewer count but no direct media URL. [Golf stream response](https://streamed.pk/api/stream/golf/2373)
- The golf iframe page wrapped a second iframe on `rockyembed.st`. That page in turn created an `embed.st/embed/ingest/...` iframe. Neither inspected wrapper exposed a direct media URL or visible parent-player message handler. This is an observation of those wrappers, not proof about every script in every provider. [Golf embed](https://embed.st/embed/golf/2373/1), [nested provider page](https://rockyembed.st/source/streamed1.php?hd=27&id=2373&no=1)
- The hotel resolver likewise returned only hosted player URLs. Its embed loaded a player bundle from `strmd.b-cdn.net` and third-party player libraries; its initial HTML contained no plain `.m3u8` URL or visible parent-player message handler. [Hotel stream response](https://streamed.pk/api/stream/hotel/tottenham-hotspur-vs-coventry-city-premier-league-1792431000), [hotel embed](https://embed.st/embed/hotel/tottenham-hotspur-vs-coventry-city-premier-league-1792431000/1)

These responses are ephemeral observations; event IDs and available providers may change. No signed media URLs are saved here.

## Specific admin embed: Commanders–49ers

Checked 19 October 2026 against the user-supplied [admin embed](https://embed.st/embed/admin/ppv-washington-commanders-at-san-francisco-49-ers/1).

- The [source API](https://streamed.pk/api/stream/admin/ppv-washington-commanders-at-san-francisco-49-ers) returned HD and SD embed URLs, viewer counts, and an English/ESPN label, with no direct media field.
- The embed itself loaded a player, without another video iframe. Its observed resources included a tokenized HLS master playlist and a high-quality variant on `lb11.strmd.st`.
- The original embed successfully decoded 1920 × 1080 video and advanced playback time.
- Ordinary requests to the observed master and variant both returned **403 Forbidden**, without an `Access-Control-Allow-Origin` header.
- A separate browser page using Gulp's installed hls.js library and the same master URL failed with `manifestLoadError` (browser HTTP status 0), `readyState: 0`, and no decoded video dimensions.

The playlist address can be observed, but copying it into an independent player did not establish working playback. The tests do not establish the exact server-side authorization or token-lifetime rules. No transient playlist URLs were committed and no application playback behavior was changed.

## Implication for Gulp

Drawing Gulp controls above an iframe does not give those controls access to the embedded player. Cross-origin messaging requires the receiving page to implement the agreed message handler. No such Streamed command contract was found in its public docs. [MDN: `postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)

The previous browser investigation observed HLS inside Streamed's player, but the copied playlist returned HTTP 403 outside it. That failed test is recorded in [the existing source notes](streamed-nba.md). This pass did not retry by changing Origin/Referer, proxy the protected feed, or attempt to defeat its access checks.

For Gulp's existing video element, the actionable requirement remains a provider-supported direct media URL that allows the app's requests. Hls.js requires CORS permission on HLS resources. A media URL observed inside an iframe is not sufficient evidence that all playlists, segments, and keys will work independently. [Hls.js CORS requirements](https://github.com/video-dev/hls.js#cors)

**Result:** keep Streamed for match metadata; no working, supported Streamed-to-Gulp custom-player integration has been established. A documented direct-feed agreement or a documented cooperative player API would change that result.
