# NBAMonster and StreamCorner player compatibility

Checked 2026-10-19 for Gulp's own HTML5/HLS player. Starting links came from the user's [FMHY live sports directory](https://fmhy.net/video#live-sports), rather than guessed mirror domains.

## Result

No directly playable NBA or soccer HLS feed was verified from these two sites. Neither inspected public page supplied a documented third-party media API. The barriers observed below differ: NBAMonster's actual upstream player refused access; StreamCorner exposes iframe-oriented catalog plumbing whose normal request protocol remains unverified. This does not establish that every source on either site has the same limitation.

## NBAMonster

- The [homepage](https://nbamonster.com/home5) had no scheduled games when checked. Its actual navigation linked [NBA TV](https://nbamonster.com/channels/nba-tv-live-streaming). A separate marketing-text link ending `/channels/nba-tv-live/` was stale and returned a not-found page.
- The working NBA TV page contains four upstream iframes, with channel selectors `ch01` through `ch04`. The first is [piratecat.store's NBA TV player](https://piratecat.store/sports/player.php?hd=nbatv=ch01). The page supplies no transparent `.m3u8` URL.
- A normal unauthenticated GET of that first player returned HTTP **403** and the message “Request forbidden by administrative rules.” Inspection stopped at that access refusal. No playlist or segment was fetched, so playback and media CORS could not be tested. This is an upstream access refusal, rather than evidence of a CORS-only problem.

## StreamCorner

- [StreamCorner's homepage](https://streamcorner.st) returned HTTP 200 HTML containing a React application. Its [main bundle](https://streamcorner.st/assets/BDPerRLx.js) renders selected sources as an **iframe** (`allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`). The ability to choose Bitmovin/Shaka/JWPlayer/etc. refers to the upstream embed, rather than Gulp controlling its own `<video>`.
- The site's [shared bundle](https://streamcorner.st/assets/mnyF_fpF.js) defines provider lists and the public catalog endpoint path `/corner?p=nba`, plus `/corner?p=alpha` for one soccer provider. One actual host in that bundle is [`data.gigav.workers.dev`](https://data.gigav.workers.dev/corner?p=nba). Ordinary GETs of those exact catalog URLs returned HTTP **405**, with `Access-Control-Allow-Methods: POST, OPTIONS` and `Access-Control-Allow-Origin: *`. A 405 is a method mismatch, not proof of authentication or media restrictions.
- The catalog request/response implementation lives in the [obfuscated request bundle](https://streamcorner.st/assets/D6hoLBEF.js). The front end's catalog protocol was not reverse engineered or reproduced, and no media playlist was obtained. No claim is made that these catalog responses themselves are directly usable HLS.
- A normal browser navigation redirected to Google. The homepage explicitly loads `disable-devtool` with Google configured as its redirect URL. No attempt was made to disable that behavior or work around an access challenge.

## Integration decision

There is currently no verified URL here to connect to Gulp. An iframe URL cannot be assigned to HTML `<video>` or converted into HLS by adding an overlay. A new candidate should first return a playlist and at least one segment through normal requests. If those work but only media CORS is absent, a narrowly scoped local relay may solve the browser compatibility issue; that scenario was not reached in these checks. DRM, authentication, or an upstream 403 would be separate barriers.
