import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('Wayland uses ydotool even when the X11 tool is installed', async () => {
  const source = (await readFile(new URL('../mouse-helper.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', 'importMeta.url');
  for (const env of [{ XDG_SESSION_TYPE: 'wayland' }, { WAYLAND_DISPLAY: 'wayland-0' }, { XDG_SESSION_TYPE: 'x11' }]) {
    const commands = [];
    runInNewContext(`${source}\nmouseAction('move', { x: 100, y: 200 });`, {
      platform: () => 'linux', process: { env }, URL,
      fileURLToPath: () => '/unused-macos-helper',
      spawnSync: (command, args) => { if (command !== 'sh') commands.push(command); return { status: 0 }; },
      importMeta: { url: 'file:///mouse-helper.mjs' },
    });
    assert.deepEqual(commands, [env.XDG_SESSION_TYPE === 'x11' ? 'xdotool' : 'ydotool']);
  }
});

test('GNOME sends pointer input through one persistent helper without blocking each movement', async () => {
  const source = (await readFile(new URL('../mouse-helper.mjs', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '').replaceAll('import.meta.url', 'importMeta.url');
  const launches = [], writes = [], lookups = [];
  runInNewContext(`${source}\nfor (let i = 0; i < 60; i++) mouseAction('move', { x: 960 + i, y: 540 });\nmouseAction('click');\nstopMouseHelper();`, {
    platform: () => 'linux', process: { env: { XDG_SESSION_TYPE: 'wayland', XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' } }, URL,
    fileURLToPath: url => String(url),
    spawnSync: (command, args) => { lookups.push([command, ...args]); return { status: 0 }; },
    spawn: (command, args) => {
      launches.push([command, ...args]);
      return { stdin: { writable: true, write: line => writes.push(line), on() {} }, on() {}, kill() {} };
    },
    importMeta: { url: 'file:///mouse-helper.mjs' },
  });
  assert.equal(launches.length, 1, 'A movement must not start a process each frame');
  assert.match(launches[0].at(-1), /gulp-mouse-gnome\.py$/);
  assert.ok(lookups.length <= 1, 'Tool discovery must not block the input loop');
  assert.equal(writes[0], 'move 960 540\n');
  assert.equal(writes[59], 'move 1019 540\n');
  assert.equal(writes[60], 'click\n');
  assert.equal(writes.at(-1), 'quit\n');
});
