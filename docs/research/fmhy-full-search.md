# Full FMHY search: usable sports feeds

Checked 19 October 2026. **Found real direct media URLs and verified NBA TV
and Real Madrid TV playing in Gulp's own player. No Mac helper or provider
iframe is needed for these feeds.**

Follow-up: a direct ESPN US feed has now been verified showing the
Commanders–49ers game at 720p, and is preferred for matched ESPN games on
the local TV page. See [the current playback notes](espn-iptv-linear.md).

## Best integration source

[IPTV-org's documented Streams API](https://github.com/iptv-org/api#streams)
returns direct media URLs, channel IDs, titles, quality labels and optional
request-header metadata. Its actual endpoint is:

```text
https://iptv-org.github.io/api/streams.json
```

The endpoint returned HTTP 200 with CORS `*` and 18,123 entries at check time.
The two NBA TV HTTP URLs below were present with `channel: "NBATV.us"`,
`referrer: null`, and `user_agent: null`. No provider headers or credentials
were required in the successful tests. NBA FAST channels are also listed
under similar IDs; select by the exact tested title/URL rather than treating
every NBA-tagged entry as the same channel.

Discovery chain:
[FMHY IPTV Tools](https://github.com/fmhy/edit/blob/66e7415a2adc8c00a07eb783ea2cae2de4825897/docs/video.md#-iptv-tools)
→ [Awesome IPTV](https://github.com/iptv-org/awesome-iptv)
and FMHY's [IPTV Playlists directory](https://rentry.co/IPTV-Playlists)
→ [IPTV-org](https://github.com/iptv-org/iptv),
[Eja's NBA search](https://eja.tv/?search=NBA).

## Feeds verified in Gulp

| Channel | Entry URL | Delivery check | Browser check |
| --- | --- | --- | --- |
| **NBA TV** | `http://23.237.104.106:8080/USA_NBA/index.m3u8` | Master, media playlist and actual TS prefix HTTP 200/CORS `*`; no encryption tag. | Gulp decoded **1920×1080**, `readyState: 4`. Playback time advanced from 6s to 48s, then 93s after pause/resume. NBA TV branding visible. Our pause/resume and expanded view worked. |
| **Real Madrid TV English** | `https://rmtv.akamaized.net/hls/live/2043154/rmtv-en-web/master.m3u8` | Master, media playlist and TS prefix HTTP 200/CORS `*`; no encryption tag. | Gulp decoded **1280×720**, `readyState: 4`, advancing playback time. Club branding and a football replay were visible. |

These are **linear television channels**, not per-game APIs. NBA TV was
showing basketball programming, and Real Madrid TV was showing a replay.
No claim is made that a specific upcoming NBA or soccer game will air on
either channel. Keep the actual match schedule and Upcoming labels separate.

The former manual Open stream control has since been removed. The matched
ESPN game now opens the verified direct feed automatically. Playback starts
muted, and the phone cursor can operate Gulp's own buttons and sliders.
HTTP streams require the local HTTP TV page; an HTTPS page will reject them
as mixed content.

## Additional media checks

These passed playlist and segment checks but were not visually verified in
Gulp during this pass:

| Channel | Entry URL | Evidence |
| --- | --- | --- |
| NBA TV alternate | `http://rezofoot.tv/NBATV/index.m3u8` | Master/media/TS 200, CORS `*`; ordinary ffprobe identified H.264 720p/~59.94fps and AAC. [Eja source](https://eja.tv/?search=NBA). |
| beIN SPORTS XTRA | `https://d9ssxzmclhfo4.cloudfront.net/bein_sports.m3u8` | Master/media/TS 200/CORS `*`, clear TS. [IPTV-org listing](https://github.com/iptv-org/iptv/blob/179565866a80ba72a4cd6d4722373bd85e17cf8d/streams/us_samsung.m3u). |
| The NBA Channel (FAST) | `https://pb-5pdyic0cu7tri.akamaized.net/NBA.m3u8` | Master/media/TS 200/CORS `*`. This is a separate FAST channel, not established as NBA TV or live-game coverage. [Same listing](https://github.com/iptv-org/iptv/blob/179565866a80ba72a4cd6d4722373bd85e17cf8d/streams/us_samsung.m3u). |
| ESPN Latin America | `https://barinaslive1.boldmss.com/ESPN/ESPN.isml/ESPN.m3u8` | Master/media/m4s 200/CORS `*`; ordinary ffprobe identified H.264/AAC. Spanish default and English alternate audio are advertised. Observed playlist time was behind wall clock. [Eja source](https://eja.tv/?search=ESPN). |
| Futsalmafer / CanalSports.TV | `https://play.agenciastreaming.com:8081/futsalmafertv/index.m3u8` | Master/media/TS 200/CORS `*`. The [broadcaster's own page](https://canalsports.tv/directo-24-horas/) explicitly publishes this HLS URL as its iPhone option. |

FMHY's [Spanish section](https://github.com/fmhy/edit/blob/66e7415a2adc8c00a07eb783ea2cae2de4825897/docs/non-english.md)
links [TDTChannels](https://github.com/LaQuay/TDTChannels/blob/master/TELEVISION.md),
which also supplied Real Madrid TV Spanish, Top Barça, MoreThanSports and
Sportitalia SoloCalcio. Those passed HTTP playlist/segment checks. Sportitalia's
current official player uses a different hostname that returned 403, so its
older working catalog URL remains a lower-priority candidate.

The NBA FAST Tubi entry returned playlists and encrypted segment bytes, but
the key and browser playback were not checked. It is not counted as a verified
playback source.

## Search coverage

The requested `fmhy/FMHY` repository is a two-file index, so the search also
followed its full wiki and the current source repository linked by FMHY's
[official backup page](https://fmhy.net/other/backups).

- Index commit: `8af7be5e4f120b953b92b5766a4ff404b76b2b3e` (2 Markdown files).
- Wiki commit: `adc596c1c0e428f0b77da167c7ab609c19f2a8bd` (19 tracked files).
- Full source commit: `66e7415a2adc8c00a07eb783ea2cae2de4825897` (333 tracked files, 196 Markdown files).
- IPTV-org media catalog commit: `179565866a80ba72a4cd6d4722373bd85e17cf8d`.
- Searched the full text trees for IPTV, M3U/M3U8, HLS, WebRTC, Xtream, streaming
  APIs, live TV, sports and player control APIs. Followed the dedicated IPTV
  Tools, playlist directory, developer API directory, mobile sports apps and
  non-English sports sections. This is a repository-wide search with selected
  destination verification, not a claim to have opened every linked website.

## Other branches checked

- **EasyWebTV:** its [playback code](https://github.com/zhangboheng/Easy-Web-TV-M3u8/blob/main/js/tvplay.js) loads IPTV-org playlists; it adds no separate source supply.
- **NebuloIPTV / OnsideTV and Channels Pro:** playlist clients requiring user-supplied feeds. `veve.pro` currently leads to a domain-sale page.
- **FMHY Streaming APIs directory:** entries are movies, episodic TV and anime. Vyla, Stellar and frameXTV checks did not establish a live sports API.
- **Free-TV:** no actual NBA channel found in its current advertised playlist.
- **Aria NBA TV:** its listed upstream returned 403; excluded.
- **mjh:** current inspected linked indexes offered EPG data; no old media paths were invented.
- **StreamXHD and WITV:** inspected sources use iframe players; no usable direct sports media established.
- **Teledeporte and Esport3:** segment/master requests returned geographic restrictions. A master playlist returning 200 alone was not counted as successful playback.
- Earlier Streamed, Buffstreams, TimStreams, PPV and StreamFree checks remain
  in [the earlier survey](streamed-nba.md). The broader IPTV search above
  changes the overall result: working channels do exist for Gulp's player.

## Minimal app change and validation

Gulp now accepts ordinary HTTP media URLs on the local TV page, alongside
HTTPS. Non-web schemes and credentials in URLs remain rejected, and HTTPS
pages give local-page guidance for HTTP feeds. Its CSP permits the corresponding
media requests. No native helper, proxy, account connector or additional player
dependency was added.

`npm run check` and `npm test` passed, **17 tests**. Browser verification above
was performed after the live-reload test, which deliberately refreshes TV pages.
