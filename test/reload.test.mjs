import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { createDemo } from '../server.mjs';

test('development edits notify the connected TV to refresh', { timeout: 5000 }, async () => {
  const server = createDemo({ publicUrl: 'https://pointer.example', liveReload: true });
  const temporary = new URL(`../public/.reload-test-${randomBytes(6).toString('hex')}`, import.meta.url);
  let screen;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://localhost:${server.address().port}`;
    const { key } = await (await fetch(`${origin}/api/session`)).json();
    screen = new WebSocket(`${origin.replace('http', 'ws')}/connect?role=screen&key=${key}`, { origin });
    await once(screen, 'open');
    const changed = once(screen, 'message');
    await writeFile(temporary, 'development reload test');
    assert.deepEqual(JSON.parse((await changed)[0]), { type: 'reload' });
  } finally { screen?.terminate(); await server.shutdown(); await unlink(temporary).catch(() => {}); }
});
