# Gulp: live sports on the TV

A minimal multi-sport schedule and stream player, controlled by an iPhone pointer.

For a standalone Banana Pi TV, follow the [Gulp kiosk setup guide](docs/banana-pi-kiosk.md).

```sh
npm install
npm start
```

Open **http://localhost:4173** on the computer. Gulp never enters full screen
by itself; use the browser's own full screen (F11, or ⌃⌘F on a Mac), which stays
on across page changes. Scan the QR with your iPhone. Motion starts automatically
when permission is already granted. If the browser requires a tap, select
**Allow motion** and allow Motion and Orientation. Your current phone angle becomes the
starting position automatically. The QR disappears and a small rounded square
follows your wrist rotation. Swipe inside the phone’s dotted area to scroll
the TV horizontally or vertically, following the phone screen’s axes.
Phone rotation steers only the pointer; it does not turn the scroll direction
or change the TV’s scroll position. Tap three times quickly inside that area
to reset the pointer to the screen center using your current phone angle.
Tap once to select the control under the pointer. Selection waits 450ms
so triple-tap recentering never opens a game accidentally.
The padding and rounded corners are inactive. You can keep your arm resting
while using it.

## Schedule (Streamed)

Listings come from [Streamed’s public API](https://streamed.pk/docs)
(` /api/matches/live`, `/api/matches/all-today`, `/api/stream/{source}/{id}` ).
Gulp keeps its own UI for titles, team logos, and live/upcoming/final status.
The fetch lives in `public/schedule-source.js` so the provider can be swapped.
**Live now** includes every live game from the visible sports. Each sport shelf
includes its live and upcoming games, so live games appear in both places.
Every shelf sorts by reported Streamed viewer counts (highest first), then start
time (earliest first); games without counts use zero. Listings and viewer counts
refresh every minute. `?sport=` still filters if needed.

## Playback

1. **Linear feed (preferred):** if ESPN’s scoreboard lists the same game on a
   network with a working URL in `public/broadcast-shared.js`, Gulp plays it in
   the built-in hls.js player and tries each listed network/feed in order.
2. **Provider embed:** otherwise Gulp opens the Streamed `embedUrl` in a
   full-window iframe (not element fullscreen), with the Gulp cursor and a
   **Back** control on top. Embeds stay as embeds — Gulp does not scrape
   hidden media URLs or bypass provider protections.
3. **Streaming only:** if ESPN lists only Prime Video / Peacock / Apple TV /
   ESPN+ (etc.) and Streamed has no embed either, the row is marked
   **Streaming only on …**.

Use **Test player** for the Big Buck Bunny HLS sample, or **Open stream** to
paste a direct HLS/MP4/WebM URL. The owned player has play/pause, mute,
volume, seeking, live-edge, and expand. Expand keeps the video and 20px
cursor in the same document.

### Ads in the provider player

Install **uBlock Origin** in the TV browser yourself. Gulp does not install
or configure blockers. That reduces interruptions inside the embed; Gulp’s
own UI has no ads.

## Phone mouse for embeds

The drawn Gulp cursor cannot click inside a cross-origin iframe. While an
embed is open, phone aim/tap/scroll also drive the **OS mouse** (local helper):

| OS | Tool |
| --- | --- |
| macOS | `scripts/gulp-mouse.swift` via `swift` (CoreGraphics) |
| Linux X11 | `xdotool` if installed |
| Linux Wayland | `ydotool` if installed |

Mouse actions run only while an authenticated phone is connected and the
local screen has armed embed mouse mode. No new npm native dependencies.

**macOS:** grant **Accessibility** access to the app that runs Node
(Terminal, iTerm, or your IDE) under System Settings → Privacy & Security →
Accessibility, or clicks will not reach the embed.

**Linux:** install `xdotool` (X11) or `ydotool` (Wayland) on the TV machine.

Note: an earlier mouse helper was removed when the project switched to an
owned-only player (see `docs/research/streamed-nba.md`). Option 2 brings it
back solely for embed control.

## Pointer

Swipe sideways to move the shelf under the pointer, or up and down to move
between shelves. A swipe locks to its dominant axis and tracks your finger 1:1.
On release the phone sends its velocity; the TV projects where the flick would
coast (Apple's deceleration curve) and settles on the nearest card or shelf with
a critically damped spring. Touching again stops a glide where it is.

The TV pointer is a 34px white hand with a soft shadow; its
fingertip is the hotspot. It grows slightly over controls and dips when a tap selects
something. Calibration makes your current
phone angle the neutral position; a 36° horizontal rotation range spans the
screen.

## HTTPS

iPhone Safari requires a secure context and, when access has not already been
granted, a permission tap for motion sensors. `npm start` runs a temporary
Cloudflare HTTPS tunnel so the phone needs no certificate installation. The
computer connects locally; phone orientation passes through Cloudflare.
Internet access is required. The random QR session key limits access;
restarting changes it and the URL.

This checkout includes a local `cloudflared` binary under ignored `.tools/`.
On another Mac, install it with `brew install cloudflared` and use:

```sh
CLOUDFLARED="$(command -v cloudflared)" npm start
```

Alternatively, provide your own trusted HTTPS reverse proxy URL with
`PUBLIC_URL=https://your-host npm run start:local`, forwarding HTTP and
WebSocket requests to `127.0.0.1:4173`. Stop the server with Ctrl+C to stop
the tunnel.

## Develop on the Mac, display on a Linux laptop / TV

Keep the app running on the Mac. The Linux laptop only needs a browser and
SSH; it does not need a copy of this project or Node.js for this setup.

1. On the Mac, enable **System Settings → General → Sharing → Remote Login**
   for your Mac user. Keep both laptops on the same local network.
2. In this project on the Mac, run `npm run dev`. Leave the Mac awake.
3. On the Linux laptop, open a terminal and run this command, replacing
   `YOUR_MAC_IP` with the Mac’s Wi-Fi address:

   ```sh
   ssh -N -o ExitOnForwardFailure=yes -L 4173:127.0.0.1:4173 liammcauliffe@YOUR_MAC_IP
   ```

   Log in with your Mac account. Leave this terminal running. Using port
   4173 on both ends preserves the app’s localhost checks and WebSocket origin.
4. Connect the Linux laptop to the TV over HDMI. Open `http://localhost:4173`
   in its browser and press F11 for full screen. Scan the TV QR with the phone.

The SSH tunnel forwards the Linux browser’s HTTP and WebSocket connections
to the Mac. Development mode refreshes connected TV screens when files in
`public/` change. Backend restarts create a new phone QR, so the phone needs
pairing again.

When the TV browser runs on a different machine than Node, OS mouse control
must run on the machine that shows the embed (install xdotool/ydotool there
and run Gulp locally on that machine for embed mouse, or use the owned
player path only).

```sh
npm run check
npm test
```

Automated checks cover Streamed schedule mapping, ESPN scoreboard mapping,
network→URL candidates, embed URL selection, player controls, phone range
selection, motion permissions, pointer projection, taps, scrolling, live
reload, and a real WebSocket connection. Playback still depends on a working
CORS linear feed or a usable Streamed embed in the TV browser.
