# Gulp on the Banana Pi BPI-F3

The Banana Pi runs Gulp’s server, Chromium, and the local mouse helper. The TV opens `http://localhost:4173`; the iPhone connects through the QR code that Gulp displays.

The intended startup sequence is: boot → GNOME automatic login → Gulp server → Chromium kiosk → scan the QR with your phone.

Run the commands below **on the Banana Pi as `chillhouse`**, not on the development Mac. These commands use `/home/chillhouse/gulp` as the checkout location.

**1. Get Gulp working on the Pi before enabling startup.**

You need Git, Chromium, curl, npm, Node.js 22 or newer, and a working `cloudflared` executable. The BPI-F3 is **RISC-V64**, so use software built for that architecture. [BPI-F3 specifications](https://docs.banana-pi.org/en/BPI-F3/BananaPi_BPI-F3), [Node platform support](https://github.com/nodejs/node/blob/main/BUILDING.md).

The Mac’s bundled `.tools/cloudflared` cannot be reused. Cloudflare’s published Linux download table currently lists x86 and ARM builds rather than RISC-V; a compatible RISC-V build or source build is needed. [Cloudflare downloads](https://developers.cloudflare.com/tunnel/downloads/).

Check the installed tools:

```bash
uname -m
node --version
npm --version
cloudflared --version
command -v chromium-browser || command -v chromium
```

Clone the public repository and install its dependencies on the Pi:

```bash
git clone https://github.com/liammmcauliffe/gulp.git ~/gulp
cd ~/gulp
npm ci
CLOUDFLARED="$(command -v cloudflared)" npm start
```

Open `http://localhost:4173` in Chromium. Wait for the QR code, scan it, and test the existing phone pointer, scrolling, and game selection.

The phone remote is already implemented. On GNOME Wayland, Gulp uses a persistent Python helper with GNOME’s local input API. It requires Python 3 and its GObject bindings, both present on this Pi. This avoids `ydotool`’s intermediate jump to the top-left corner and starting a new process on every pointer move. The helper maps the primary TV monitor and does not read or transmit video. [Mutter remote desktop API](https://gitlab.gnome.org/GNOME/mutter/-/blob/main/src/org.gnome.Mutter.RemoteDesktop.xml).

Check `python3 -c 'from gi.repository import Gio, GLib'` and `echo "$XDG_CURRENT_DESKTOP"`. The service below records the GNOME desktop environment explicitly. Other Wayland desktops fall back to `ydotool`, which requires a running `ydotoold` daemon and access to its socket; X11 uses `xdotool` when available. Validate phone control inside an actual embedded player before relying on phone-only operation.

On this BPI-F3, Node **22.23.3** passes the application tests without runtime flags. The tested Node 24.22.0 RISC-V build crashes or misparses HTTP on this hardware; use the working Node 22 build here. The native tools are installed in `~/.local/bin`, with the Node distribution in `~/.local/opt`.

Continue once Gulp, the QR, and the required phone controls work. Stop this manually started Pi server with **Ctrl+C** before starting the service in the next step.

**2. Start Gulp automatically when you log in.**

Create a [systemd user service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html). These commands record the working Node, PATH, and Cloudflare executable locations from your current terminal, so startup does not depend on an interactive shell loading them.

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/gulp.service <<EOF
[Unit]
Description=Gulp TV server

[Service]
WorkingDirectory=$HOME/gulp
Environment="PATH=$PATH"
Environment="CLOUDFLARED=$(command -v cloudflared)"
Environment="YDOTOOL_SOCKET=${YDOTOOL_SOCKET:-/tmp/.ydotool_socket}"
Environment="XDG_SESSION_TYPE=wayland"
Environment="XDG_CURRENT_DESKTOP=ubuntu:GNOME"
ExecStartPre=/bin/sh -c 'until /usr/bin/curl -sS --connect-timeout 5 --max-time 10 -o /dev/null https://api.trycloudflare.com; do sleep 3; done'
ExecStart=$(command -v node) $HOME/gulp/server.mjs --tunnel
Restart=on-failure
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now gulp.service
```

The socket setting is only used by the non-GNOME `ydotool` fallback. If you need that fallback, set `YDOTOOL_SOCKET` to the socket used by your working daemon and configure the daemon to start at boot. GNOME’s native helper needs neither that daemon nor root access.

Check the server:

```bash
systemctl --user status gulp.service
sudo journalctl _SYSTEMD_USER_UNIT=gulp.service -n 40 --no-pager
```

Wait for “QR code ready” before testing phone pairing. Internet access is required for the temporary HTTPS tunnel. The current app logs a tunnel failure without necessarily exiting the Node process, so a running service alone does not prove that phone pairing is ready.

**3. Create the Chromium kiosk launcher.**

This waits for Gulp to respond rather than relying on a five-second delay. Chromium uses its [Wayland backend](https://github.com/chromium/chromium/blob/main/docs/ozone_overview.md) and a separate Gulp profile, retaining its own browser settings between boots.

```bash
mkdir -p ~/.local/bin

cat > ~/.local/bin/tv-kiosk.sh <<'EOF'
#!/bin/bash
set -e

until curl -fsS --max-time 2 http://localhost:4173/api/session >/dev/null 2>&1; do
  sleep 1
done

gulp_browser="$(command -v chromium-browser || command -v chromium)"

exec "$gulp_browser" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --ozone-platform=wayland \
  --user-data-dir="$HOME/.config/gulp-chromium" \
  "http://localhost:4173"
EOF

chmod +x ~/.local/bin/tv-kiosk.sh
```

The TV URL stays local. Gulp generates the phone’s HTTPS URL and QR; you do not paste a temporary Cloudflare address into the kiosk script.

The Pi's dedicated Gulp browser also loads [uBlock Origin 1.75.0](https://github.com/gorhill/uBlock/releases/tag/1.75.0). Its official Chromium ZIP is extracted under `~/.local/opt/ublock-origin-1.75.0/`. When recreating the launcher, retain this argument before the TV URL:

```bash
  --load-extension="$HOME/.local/opt/ublock-origin-1.75.0/uBlock0.chromium" \
```

The extension's **My rules** pane has these permanent [no-popups rules](https://github.com/gorhill/uBlock/wiki/Per-site-switches#no-popups), so pressing Play cannot leave an advertising window in front of Gulp:

```text
no-popups: localhost true
no-popups: embed.st true
no-popups: rockyembed.st true
```

Keep popup blocking in the browser: the provider's live player rejects sandboxed iframes. Restarting only `gulp-kiosk.service` applies browser changes without changing phone pairing.

**4. Launch the kiosk when GNOME starts.**

GNOME reads login startup entries from `~/.config/autostart/`. [Desktop autostart specification](https://specifications.freedesktop.org/autostart/latest/).

```bash
mkdir -p ~/.config/autostart

cat > ~/.config/autostart/tv-kiosk.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Gulp TV
Comment=Open Gulp on the TV
Exec=$HOME/.local/bin/tv-kiosk.sh
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
```

**5. Keep the TV awake, then test.**

Disable automatic suspension and blanking for this dedicated TV session:

```bash
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-timeout 0
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-type nothing
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-battery-timeout 0
gsettings set org.gnome.desktop.session idle-delay 0
```

Launch the kiosk:

```bash
~/.local/bin/tv-kiosk.sh
```

Chromium should open Gulp fullscreen. Scan the QR, open a game, test the player controls, return to browsing, and test PiP. Check sound and video on the actual TV; this guide does not establish hardware video acceleration or codec support on the Pi.

After that works, save any open work and reboot:

```bash
sudo reboot
```

Automatic GNOME login should now start Gulp and the kiosk without a keyboard. Scan the newly displayed QR after rebooting: Gulp’s temporary tunnel address and pairing session change when its server restarts.

To leave the kiosk, press **Alt+F4**. To disable automatic browser startup:

```bash
mv ~/.config/autostart/tv-kiosk.desktop ~/.config/autostart/tv-kiosk.desktop.disabled
```

To disable the Pi’s Gulp server startup too:

```bash
systemctl --user disable --now gulp.service
```

This setup is independent of the development Mac. The Mac’s currently running Gulp server and phone pairing do not need to be restarted.

For later updates, run `git pull --ff-only` from `~/gulp`, then `npm ci` if dependencies changed. Apply server changes with `systemctl --user restart gulp.service` and scan the new QR. Refresh Chromium to load frontend changes.
