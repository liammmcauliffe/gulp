# FMHY discovery → ESPN direct playback

Checked 19 October 2026. **A direct ESPN US HLS feed played the
Commanders–49ers game in Gulp's own player at 1280×720.** The scoreboard
was visible at Washington 17, San Francisco 23, fourth quarter, 1:48.
Playback time advanced beyond three minutes; this was decoded video,
not just a successful playlist request.

## Source and verification

[FMHY IPTV Tools](https://fmhy.net/video#iptv-tools) links
[Awesome IPTV](https://github.com/iptv-org/awesome-iptv). IPTV-org's
[documented Streams API](https://github.com/iptv-org/api#streams) supplies
its current catalog at `https://iptv-org.github.io/api/streams.json`.
The working ESPN US entry is:

```text
http://85.237.89.160:9590/usa-s/ESPN-HD/index.m3u8
```

Its manifest advertises H.264/AAC; ordinary playlist and video-segment
requests permit browser access. Gulp's actual `setupPlayer()` decoded
1280×720 and showed the requested matchup. This feed uses HTTP, so the
TV must open on the local HTTP page rather than an HTTPS deployment.

## App behavior

- Streamed supplies the schedule and per-game embed sources.
- ESPN scoreboards match both teams and add broadcast-network names.
- `public/broadcast-shared.js` maps those names to static candidate URLs.
  The app does not fetch the entire IPTV catalog at runtime.
- Updated 20 October 2026: every game defaults to its Streamed embed.
  Settings replaces Test player with a saved **Use direct streams** switch,
  off by default. Only when enabled does a matched ESPN game try the
  verified US feed first, with its embed as a startup fallback.
- A parsed manifest or playing audio alone no longer clears the
  startup timeout: decoded video dimensions are required. The feed sometimes
  needs more than ten seconds to start, so the timeout allows 25 seconds.

This is a linear ESPN channel, so its programming can change. It is not
an event-specific feed API or a guarantee of availability for every event.

## Other candidates checked

| Candidate | Result |
| --- | --- |
| ESPN `http://212.5.144.156:8080/espn/index.m3u8` | Playlists and segments passed, but HEVC produced advancing audio with zero video dimensions in this browser. Removed from ESPN candidates. |
| ESPN Latin America `https://barinaslive1.boldmss.com/ESPN/ESPN.isml/ESPN.m3u8` | Decoded 1920×1080, showing F90 Colombia studio programming. Spanish default; English alternate audio advertised. Not the requested game. |
| ESPN2 Latin America `https://barinaslive1.boldmss.com/ESPN_2/ESPN_2.isml/ESPN_2.m3u8` | Decoded 1920×1080, with 49ers sideline footage observed. Only Spanish audio advertised. Latest segment time was approximately ten minutes behind wall clock; exact matchup not established. |
| truTV `http://23.237.104.106:8080/USA_TRUTV/index.m3u8` | Decoded 1280×720 with TNT Sports programming visible. Not verified carrying the baseball game, so not promoted ahead of its embed. |
| NFL Network `http://198.58.104.90:8989/nfl/index.m3u8` | Manifest lacks CORS; not usable directly in this browser. |
| NFL Network `https://tvsen6.aynaott.com/nfl/index.m3u8` | Playlist and segment checks passed with CORS, but actual browser video was not verified in this pass. |

The broader channel search remains in [fmhy-full-search.md](fmhy-full-search.md).
The protected Streamed URL investigation is in
[streamed-player-compatibility.md](streamed-player-compatibility.md).

## Validation

`npm run check` and all 30 tests passed. After integration, opening the
Commanders–49ers card at `http://localhost:4173/` showed Gulp's own player
with the provider embed hidden, 1280×720 video, and advancing playback.
The first attempt hit the former ten-second startup limit; a separate
manifest request took 21 seconds. The verified attempt used the corrected
25-second limit. Player regression checks cover audio-only startup reaching
the fallback rather than being counted as video playback.

After the Settings change, syntax checks and all 31 tests passed. Browser
checks confirmed that the switch persists in both states across reloads,
and that the ESPN game uses its embed with the switch off.
