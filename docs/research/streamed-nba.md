# Streamed NBA source notes

**Update:** the subsequent [full FMHY repository search](fmhy-full-search.md)
found direct NBA TV and Real Madrid TV feeds and verified both playing in
Gulp. The Streamed-specific restrictions below still apply; they do not
describe those separate IPTV channel sources.

Checked 19 October 2026 against the site's own documentation and live responses.

- [Streamed docs](https://streamed.st/docs) identify `https://streamed.pk` as the API origin. No API key is required; responses permit cross-origin reads.
- [Matches docs](https://streamed.st/docs/matches): `GET /api/matches/basketball` supplies basketball events, their scheduled timestamps, teams, and source IDs. `GET /api/matches/live` supplies the live selection. Gulp matches NBA teams, excluding WNBA and other basketball leagues.
- [Streams docs](https://streamed.st/docs/streams): `GET /api/stream/{source}/{id}` resolves source groups to player URLs. Use the source-specific ID, not the catalog match ID.
- The current NBA listings advertise `admin`, `golf`, and `hotel` source groups. All five resolved choices for Detroit–Boston use `https://embed.st/embed/{source}/{id}/{streamNo}`. The admin choices advertise “English - NBC”; source names are provider aliases, not proof of the original video origin.
- The embed's public HTML references `strmd.b-cdn.net` player scripts and a SwarmCloud HLS engine. The API returns the hosted player, not a direct NBA video feed. These were used by the earlier iframe prototype; the current player uses direct media URLs supplied separately.
- At verification, the catalog listed Detroit–Boston, New York–Philadelphia, and Oklahoma City–San Antonio as future events, with no NBA match in the live feed. The interface therefore showed **Upcoming** for all three. This is an observation of Streamed's catalog, not independent NBA schedule verification.

Gulp fetches the schedule API directly and refreshes every 60 seconds. Feed
failures show an error rather than claiming there are no games. Soccer is at
`/?sport=soccer`, using `/api/matches/football` with the same live-status lookup.
NBA stays at `/`. Sport navigation keeps the existing relay session.

## Switch to our own player

The user rejected the native mouse helper and provider player. Both have
been removed. Cross-origin iframe controls cannot be activated by a page's
synthetic phone pointer. Gulp now owns the video element and its controls,
including the volume and seek sliders. Expanded playback stays in the same
document so the Berd cursor remains visible.

Streamed's documented API returns `embedUrl`, not a standalone media URL.
During soccer testing, the embedded player loaded a signed HLS playlist on
`lb24.strmd.st`. A request to that observed URL outside the embedded player
with the localhost Origin returned HTTP 403 without CORS permission. That
URL was ephemeral and is not stored in the project. There is no working
Streamed-to-Gulp direct feed integration, and Gulp does not proxy or rewrite
provider restrictions.

**Live · add stream** opens an empty player for the selected match. The user
is looking for a compatible direct source. Meanwhile, **Test player** opens
an explicitly labeled Big Buck Bunny sample used by the
[official hls.js demo](https://hlsjs.video-dev.org/demo/):
`https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`.
The sample was verified playing with decoded frames in the app browser.

Our player accepts HTTPS HLS, MP4, and WebM, subject to browser codec support
and source CORS. It uses native HLS where supported, otherwise locally served
[hls.js](https://github.com/video-dev/hls.js). A host such as
[Mux](https://www.mux.com/docs/guides/start-live-streaming) can ingest a supplied
live feed and provide HLS playback, but a hosting service does not provide
the sporting event itself. No DRM license integration is configured.

## FMHY source survey

The user supplied [FMHY's live sports directory](https://fmhy.net/video#live-sports)
to resolve current site links. Checked 19 October 2026. No standalone NBA or
soccer feed was verified from this checked subset; this is not an exhaustive
claim about every source in that directory.

| Source / current link | Observed result for our player |
| --- | --- |
| [Streamed](https://streamed.pk/docs/streams) | Public API returns `embedUrl`. No documented direct-media or iframe-command API found. [Detailed check](streamed-player-compatibility.md). |
| [Buffstreams](https://mybuffstreams.plus/home7) | Soccer catalog had no event links at check time. Its NBA category listed a WNBA event, not an NBA game. That basketball page loaded an external `gooz.aapmains.net` iframe with no selected stream ID; no video URL was exposed. |
| [TimStreams](https://timst.top/) | Public event/channel APIs return iframe sources. The listed NBA TV upstream returned 403. Its official client includes an authenticated VIP playlist feature; account playback was not tested. [Detailed check](tim-ppv-player-compatibility.md). |
| [PPV.ST](https://ppv.st/api) | Checked NBA/soccer details and an always-live NFL Network detail had empty `m3u8` fields and iframe sources. The always-live upstream also failed normal TLS certificate verification. Its client advertises VIP standalone links; none were supplied or tested. [Detailed check](tim-ppv-player-compatibility.md). |
| [StreamFree](https://streamfree.top/api) | API sources are embed URLs. An active channel's exact signed HLS URL returned 403 both with localhost Origin and with no Origin. No readable playlist or segment was verified. [Detailed check](streamfree-player-compatibility.md). |
| [NBAMonster](https://nbamonster.com/home5) | No NBA games listed; NBA TV's first upstream player returned 403. [Detailed check](nba-streamcorner-player-compatibility.md). |
| [StreamCorner](https://streamcorner.st/) | Front end renders iframe sources. Its catalog request protocol remains unverified; a GET returned 405 because the endpoint expects POST. This is not proof of a media-access refusal. [Detailed check](nba-streamcorner-player-compatibility.md). |
| [Matchora](https://matchora.to/developers) | Its developer documentation explicitly excludes direct stream URLs from the public API and supplies embeds. |

Additional directory probes: zlive returned HTTP 451 to the web reader;
FawaNews could not be read through the web reader, and an ordinary request
failed hostname certificate verification. Neither was treated as a usable
source. No certificate or access checks were bypassed.

Source details for the Buffstreams observation:
[NBA category](https://mybuffstreams.plus/nbastreams2),
[soccer category](https://mybuffstreams.plus/soccer-live-streams),
[the listed basketball event](https://mybuffstreams.plus/wnba-playoffs/golden-state-valkyries-atlanta-dream/1576879).
The additional PPV always-live check used its actual catalog entry:
[NFL Network API response](https://api.ppv.st/api/streams/nfl-network).
This checks the provider mechanism; it does not establish NBA/soccer availability.

The concrete leads are an operator-provided direct integration or the
standalone playlist features some providers offer to accounts. Those remain
untested. An IPTV channel catalog may also need channel selection before its
individual media URL can be loaded into our current player.

Before connecting a source, verify an actual HLS playlist and media segment,
then decoded playback in Gulp. An HTML page returning 200 is insufficient.
If ordinary media requests work and only browser CORS is absent, a narrowly
scoped local relay could solve that compatibility problem. A 403 or missing
media source is a separate issue. No new source was enabled in Gulp from this
survey.
