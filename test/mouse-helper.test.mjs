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
