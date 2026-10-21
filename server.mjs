import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { WebSocketServer, WebSocket } from 'ws';
import { mouseAction, stopMouseHelper } from './mouse-helper.mjs';
import avatars from './public/avatars/manifest.json' with { type: 'json' };
import { currentSport, loadEnrichedSchedule } from './schedule-api.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const files = {
  '/': ['index.html', 'text/html'],
  '/phone': ['phone.html', 'text/html'],
  '/style.css': ['style.css', 'text/css'],
  '/screen.js': ['screen.js', 'text/javascript'],
  '/phone.js': ['phone.js', 'text/javascript'],
  '/pointing.js': ['pointing.js', 'text/javascript'],
  '/snap.js': ['snap.js', 'text/javascript'],
  '/nba.js': ['nba.js', 'text/javascript'],
  '/player.js': ['player.js', 'text/javascript'],
  '/broadcast-shared.js': ['broadcast-shared.js', 'text/javascript'],
  '/schedule-source.js': ['schedule-source.js', 'text/javascript'],
  '/hls.js': ['../node_modules/hls.js/dist/hls.min.js', 'text/javascript'],
  '/avatars/manifest.json': ['avatars/manifest.json', 'application/json'],
};
for (const avatar of avatars.images) files[`/avatars/${avatar.file}`] = [`avatars/${avatar.file}`, 'image/png'];
const localRequest = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname);
const validDirection = value => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1) && Math.abs(Math.hypot(...value) - 1) < .01;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://a.espncdn.com https://streamed.pk; connect-src 'self' ws: wss: http: https:; media-src 'self' blob: http: https:; worker-src 'self' blob:; frame-src https://embed.st https://rockyembed.st; frame-ancestors 'none'; base-uri 'none'";

export function createDemo({ publicUrl = process.env.PUBLIC_URL, liveReload = false } = {}) {
  const key = randomBytes(24).toString('hex');
  let phone, calibration, mouseEnabled = false;
  const screens = new Set();
  const broadcast = message => { const data = JSON.stringify(message); for (const screen of screens) if (screen.readyState === WebSocket.OPEN) screen.send(data); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      if (path === '/api/session') {
        if (!localRequest(req)) return json(403, { error: 'Open the computer screen at localhost.' });
        if (!publicUrl) return json(200, { ready: false });
        const qr = await QRCode.toDataURL(`${publicUrl}/phone#${key}`, { margin: 3, width: 300, color: { dark: '#000000', light: '#ffffff' } });
        return json(200, { ready: true, key, qr });
      }
      if (path === '/api/schedule') {
        const sport = currentSport(new URL(req.url, `http://${req.headers.host}`).search);
        return json(200, await loadEnrichedSchedule(sport));
      }
      if (path.startsWith('/api/espn/')) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const espnPath = url.pathname.slice('/api/espn/'.length);
        if (!espnPath || !/^[a-z0-9][a-z0-9./_-]*$/i.test(espnPath)) return json(400, { error: 'Bad ESPN path.' });
        const upstream = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}${url.search}`;
        const response = await fetch(upstream, { signal: AbortSignal.timeout(12000) });
        const body = await response.text();
        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(body);
        return;
      }
      if (!files[path]) return json(404, { error: 'Not found.' });
      const [file, type] = files[path];
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(await readFile(resolve(publicDir, file)));
    } catch { if (!res.headersSent) json(500, { error: 'Could not load the demo.' }); else res.end(); }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const supplied = url.searchParams.get('key') || '';
    const role = url.searchParams.get('role');
    const allowedOrigins = [`http://localhost:${server.address().port}`, `http://127.0.0.1:${server.address().port}`, publicUrl];
    if (url.pathname !== '/connect' || !/^[a-f\d]{48}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(key)) || !['screen', 'phone'].includes(role) || (role === 'screen' && !localRequest(req)) || !allowedOrigins.includes(req.headers.origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    sockets.handleUpgrade(req, socket, head, ws => {
      ws.alive = true;
      ws.on('error', () => {});
      ws.on('pong', () => { ws.alive = true; });
      if (role === 'screen') {
        screens.add(ws);
        if (calibration) ws.send(JSON.stringify(calibration));
        ws.on('message', raw => {
          let message;
          try { message = JSON.parse(raw); } catch { return; }
          if (!message || typeof message !== 'object') return;
          // Phone aim moves the OS cursor whenever it has control; embed mode adds clicks into the iframe.
          if (message.type === 'mouse-mode') {
            mouseEnabled = message.on === true;
            return;
          }
          // Armed by local screen; applied only while an authenticated phone is connected.
          if (!mouseEnabled || !phone || message.type !== 'mouse') return;
          if (message.action === 'move' && [message.x, message.y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 20000)) {
            mouseAction('move', { x: message.x, y: message.y });
            return;
          }
          if (message.action === 'click') { mouseAction('click'); return; }
          if (message.action === 'scroll' && [message.dx, message.dy].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 4)) {
            mouseAction('scroll', { dx: message.dx, dy: message.dy });
          }
        });
        ws.on('close', () => { screens.delete(ws); if (![...screens].length) mouseEnabled = false; });
        return;
      }
      if (phone) { phone.send(JSON.stringify({ type: 'replaced' })); phone.close(1000); }
      phone = ws; calibration = null; mouseEnabled = false;
      broadcast({ type: 'disconnected' });
      let lastMessage = 0;
      ws.on('message', raw => {
        if (phone !== ws) return;
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'activate') {
          if (calibration) broadcast({ type: 'activate' });
          return;
        }
        if (message.type === 'scroll') {
          const within = limit => n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
          if (calibration && [message.dx, message.dy].every(within(4))) broadcast({
            type: 'scroll', dx: message.dx, dy: message.dy,
            ...(message.begin === true ? { begin: true } : {}),
            ...(message.end === true && [message.vx, message.vy].every(within(1)) ? { end: true, vx: message.vx, vy: message.vy } : {}),
          });
          return;
        }
        if (!['aim', 'calibrate'].includes(message.type) || !validDirection(message.direction)) return;
        const now = Date.now();
        if (message.type === 'aim' && now - lastMessage < 15) return;
        lastMessage = now;
        const clean = { type: message.type, direction: message.direction };
        if (message.type === 'calibrate') calibration = clean;
        if (calibration) broadcast(clean);
      });
      ws.on('close', () => { if (phone === ws) { phone = null; calibration = null; mouseEnabled = false; broadcast({ type: 'disconnected' }); } });
    });
  });
  const heartbeat = setInterval(() => { for (const ws of sockets.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } } }, 15000);
  heartbeat.unref();
  let reloadTimer;
  const watcher = liveReload ? watch(publicDir, { recursive: true }, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcast({ type: 'reload' }), 150);
  }) : null;
  watcher?.on('error', error => console.error(`Auto-refresh stopped: ${error.message}`));
  server.on('close', () => { clearInterval(heartbeat); clearTimeout(reloadTimer); watcher?.close(); });
  server.setPublicUrl = value => { publicUrl = new URL(value).origin; };
  server.shutdown = async () => { stopMouseHelper(); clearInterval(heartbeat); for (const ws of sockets.clients) ws.terminate(); sockets.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const server = createDemo({ liveReload: process.argv.includes('--live-reload') });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`Computer screen: http://localhost:${port}`);
  let tunnel;
  if (process.argv.includes('--tunnel') && !process.env.PUBLIC_URL) {
    const binary = process.env.CLOUDFLARED || fileURLToPath(new URL('./.tools/cloudflared', import.meta.url));
    console.log('Starting a temporary HTTPS link for iPhone motion access…');
    tunnel = spawn(binary, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let found = false;
    tunnel.stderr.on('data', chunk => {
      const url = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (url && !found) {
        found = true;
        server.setPublicUrl(url[0]);
        console.log(`Phone link: ${url[0]}/phone`);
        console.log('QR code ready. Scan it with your iPhone.');
      }
    });
    tunnel.on('error', err => { console.error(`HTTPS link could not start: ${err.message}. See README.md.`); });
    tunnel.on('exit', code => { if (code) console.error('HTTPS link stopped. Restart npm start.'); });
  } else if (!process.env.PUBLIC_URL) console.log('Set PUBLIC_URL to a trusted HTTPS address to enable the QR code.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { tunnel?.kill(); await server.shutdown(); process.exit(); });
}
