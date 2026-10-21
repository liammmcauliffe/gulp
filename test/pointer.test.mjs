import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import WebSocket from 'ws';
import { createDemo } from '../server.mjs';
import { direction, project } from '../public/pointing.js';

test('calibrated aiming: center, right, left, up, wrap, and pointing away', () => {
  const center = direction(0, 0);
  assert.deepEqual(project(center, center), { x: .5, y: .5 });
  assert.ok(project(direction(350, 0), center).x > .5);
  assert.ok(project(direction(10, 0), center).x < .5);
  assert.ok(project(direction(0, 10), center).y < .5);
  assert.ok(project(direction(0, -10), center).y > .5);
  assert.ok(Math.abs(project(direction(0, 0), direction(359, 0)).x - .5) < .03);
  assert.equal(project(direction(180, 0), center), null);
  assert.equal(project(direction(0, 90), direction(0, 90)), null);
  assert.equal(project(direction(330, 0), center).x, 1);
  assert.deepEqual(project(direction(137, 23), direction(137, 23)), { x: .5, y: .5 });
});

test('sports screen uses our video player and serves its local HLS library', async () => {
  const server = createDemo();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  try {
    const response = await fetch(origin);
    const html = await response.text();
    assert.match(html, /aria-label="Sports games"/);
    assert.match(html, /id="games"/);
    assert.match(html, /id="accounts"/);
    assert.match(html, /<video[^>]+playsinline/);
    assert.match(html, /id="embed-frame"/);
    assert.match(html, /id="embed-back"/);
    assert.doesNotMatch(html, /stop-mouse|photo-row|\/images\//);
    assert.match(response.headers.get('content-security-policy'), /media-src 'self' blob: http: https:;/);
    assert.match(response.headers.get('content-security-policy'), /worker-src 'self' blob:;/);
    assert.match(response.headers.get('content-security-policy'), /frame-src https:\/\/embed\.st https:\/\/rockyembed\.st;/);
    assert.equal((await fetch(`${origin}/player.js`)).status, 200);
    const hls = await fetch(`${origin}/hls.js`);
    assert.equal(hls.status, 200);
    assert.match(await hls.text(), /Hls/);
    assert.equal((await fetch(`${origin}/nba.js`)).status, 200);
    assert.equal((await fetch(`${origin}/schedule-source.js`)).status, 200);
    assert.equal((await fetch(`${origin}/images/10.jpg`)).status, 404);
    assert.equal((await fetch(`${origin}/images/private.jpg`)).status, 404);
    const { images } = await (await fetch(`${origin}/avatars/manifest.json`)).json();
    assert.equal(images.length, 19);
    for (const image of images) {
      const picture = await fetch(`${origin}/avatars/${image.file}`);
      assert.equal(picture.status, 200, `${image.name} is available locally`);
      assert.match(picture.headers.get('content-type'), /^image\/png/);
      assert.equal(Buffer.from(await picture.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    }
    assert.equal((await fetch(`${origin}/avatars/neytiri.png`)).status, 404);
  } finally { await server.shutdown(); }
});

test('QR authenticates and relays aim and validated two-axis scrolling; disconnect restores QR', { timeout: 5000 }, async () => {
  const server = createDemo({ publicUrl: 'https://pointer.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${server.address().port}`;
  const connect = role => new WebSocket(`${origin.replace('http', 'ws')}/connect?role=${role}&key=${session.key}`, { origin });
  let screen, phone;
  try {
    const response = await fetch(`${origin}/api/session`);
    var session = await response.json();
    assert.equal(response.status, 200);
    assert.match(session.qr, /^data:image\/png;base64,/);
    const forbidden = await new Promise((resolve, reject) => { http.get(`${origin}/api/session`, { headers: { Host: 'pointer.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
    assert.equal(forbidden, 403);
    const bad = new WebSocket(`${origin.replace('http', 'ws')}/connect?role=phone&key=wrong`, { origin });
    const rejected = await once(bad, 'error');
    assert.match(rejected[0].message, /403/);
    screen = connect('screen'); await once(screen, 'open');
    phone = connect('phone');
    const connected = once(screen, 'message');
    await once(phone, 'open'); await connected;
    let next = once(screen, 'message');
    phone.send(JSON.stringify({ type: 'scroll', dx: .5, dy: .5 })); // Ignored before calibration.
    phone.send(JSON.stringify({ type: 'activate' }));
    phone.send(JSON.stringify({ type: 'calibrate', direction: direction(0, 0) }));
    assert.equal(JSON.parse((await next)[0]).type, 'calibrate');
    next = once(screen, 'message');
    phone.send(JSON.stringify({ type: 'aim', direction: direction(350, 5) }));
    // Aim messages are rate limited. Send after the calibration frame.
    await new Promise(resolve => setTimeout(resolve, 20));
    phone.send(JSON.stringify({ type: 'aim', direction: direction(350, 5) }));
    const aim = JSON.parse((await next)[0]);
    assert.equal(aim.type, 'aim');
    assert.ok(project(aim.direction, direction(0, 0)).x > .5);
    next = once(screen, 'message');
    for (const invalid of [null, { type: 'scroll', dx: -5, dy: .5 }, { type: 'scroll', dx: .5, dy: 5 }, { type: 'scroll', dx: '0.5', dy: .5 }, { type: 'scroll', dx: .5, dy: null }]) phone.send(JSON.stringify(invalid));
    phone.send(JSON.stringify({ type: 'scroll', dx: -.25, dy: .75, begin: true, ignored: true }));
    assert.deepEqual(JSON.parse((await next)[0]), { type: 'scroll', dx: -.25, dy: .75, begin: true });
    next = once(screen, 'message');
    phone.send(JSON.stringify({ type: 'scroll', dx: 0, dy: 0, end: true, vx: 9, vy: 0 })); // Velocity out of range: end dropped.
    assert.deepEqual(JSON.parse((await next)[0]), { type: 'scroll', dx: 0, dy: 0 });
    next = once(screen, 'message');
    phone.send(JSON.stringify({ type: 'scroll', dx: 0, dy: 0, end: true, vx: .003, vy: -.001 }));
    assert.deepEqual(JSON.parse((await next)[0]), { type: 'scroll', dx: 0, dy: 0, end: true, vx: .003, vy: -.001 });
    next = once(screen, 'message');
    phone.send(JSON.stringify({ type: 'activate', ignored: true }));
    assert.deepEqual(JSON.parse((await next)[0]), { type: 'activate' });
    next = once(screen, 'message'); phone.close();
    assert.equal(JSON.parse((await next)[0]).type, 'disconnected');
  } finally { phone?.terminate(); screen?.terminate(); await server.shutdown(); }
});
