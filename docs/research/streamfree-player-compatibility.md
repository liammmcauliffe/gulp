# StreamFree: custom player compatibility

Checked 2026-10-19. Read-only public HTTP requests; no credentials, provider referrer spoofing, generated tokens, or access-control bypass. Application code unchanged.

## Result

**StreamFree documents an iframe integration, and the checked active stream's standalone HLS request returned 403.** This is an access rejection, not a case where working public media merely lacks browser CORS. It is not a verified source for Gulp's owned player.

## Public interface

The [official API page](https://streamfree.top/api) requires no account/API key and publishes `/api/v1/streams`, `/api/v1/streams/{stream_key}`, `/api/v1/sources/{stream_key}`, and categories. Returned `sources` are `/embed/{category}/{variant}` URLs. It documents using an iframe and prohibits sandboxing it. Source availability is temporary; an empty list means the event's feeds are not live yet.

The parent investigation found no current soccer events and a WNBA event with an empty source list. This follow-up used the API's actual active [RedZone source embed](https://strmfree.st/embed/football/redzone1080p) only to assess the same provider's player mechanism; it does not establish NBA/soccer availability.

## Active-source probe

- The RedZone embed returned HTTP 200 as an HTML JW Player page. It builds an HLS source from `/live/{variant}/index.m3u8` with a per-quality signed `_t`, `_e`, `_n` query supplied in the page. The source comments explicitly describe these playlists as auth-protected.
- The page's public [server-selection endpoint](https://strmfree.st/get-stream-key/redzone) returned 200, `Access-Control-Allow-Origin: *`, `is_external: false`, and `server_name: "origin"`.
- An ordinary GET of the exact HLS URL assembled from the page's own values returned **403 Forbidden**, both with `Origin: http://localhost:4173` and with no Origin header. No provider Origin/Referer headers were forged. The body was an nginx 403 page, not an HLS playlist.
- With no readable playlist, no segment URL could be tested. No successful direct playback is claimed, and signed query values were not saved in the repository.

## Integration options

The published API is usable for discovering embed sources and empty/upcoming states. It does not document an owned-player or `postMessage` control contract. The page does not expose a supported replacement-player integration in the checked source. Its [VIP page](https://streamfree.top/vip) advertises IPTV, which could be a separate authorized standalone-feed option, but no VIP account/feed was supplied or tested here. Operator-provided HLS plus explicit third-party playback support would still need playlist/segment/CORS verification.
