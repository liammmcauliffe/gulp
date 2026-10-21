import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const swiftFile = fileURLToPath(new URL('./scripts/gulp-mouse.swift', import.meta.url));
let swiftProc;

function which(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0;
}

function ensureSwift() {
  if (swiftProc && !swiftProc.killed) return swiftProc;
  swiftProc = spawn('swift', [swiftFile], { stdio: ['pipe', 'ignore', 'ignore'] });
  swiftProc.on('exit', () => { swiftProc = null; });
  swiftProc.on('error', () => { swiftProc = null; });
  return swiftProc;
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 2000 }).status === 0;
}

/** Move / click / scroll the OS pointer. No-op if the platform tool is missing. */
export function mouseAction(action, { x = 0, y = 0, dx = 0, dy = 0 } = {}) {
  const os = platform();
  if (os === 'darwin') {
    try {
      const proc = ensureSwift();
      if (!proc?.stdin?.writable) return false;
      if (action === 'move') proc.stdin.write(`move ${Math.round(x)} ${Math.round(y)}\n`);
      else if (action === 'click') proc.stdin.write('click\n');
      else if (action === 'scroll') proc.stdin.write(`scroll ${dx} ${dy}\n`);
      else return false;
      return true;
    } catch { return false; }
  }
  if (which('xdotool')) {
    if (action === 'move') return run('xdotool', ['mousemove', '--', String(Math.round(x)), String(Math.round(y))]);
    if (action === 'click') return run('xdotool', ['click', '1']);
    if (action === 'scroll') {
      const steps = Math.max(1, Math.min(20, Math.round(Math.abs(dy) * 8) || Math.round(Math.abs(dx) * 8) || 1));
      const btn = dy > 0 || (!dy && dx < 0) ? '5' : '4';
      return run('xdotool', ['click', '--repeat', String(steps), btn]);
    }
    return false;
  }
  if (which('ydotool')) {
    if (action === 'move') return run('ydotool', ['mousemove', '--absolute', '-x', String(Math.round(x)), '-y', String(Math.round(y))]);
    if (action === 'click') return run('ydotool', ['click', '0xC0']);
    if (action === 'scroll') {
      const amount = Math.round((dy || dx) * 20);
      return run('ydotool', ['mousemove', '-w', '-x', '0', '-y', String(amount || 1)]);
    }
    return false;
  }
  return false;
}

export function stopMouseHelper() {
  if (!swiftProc) return;
  try { swiftProc.stdin?.write('quit\n'); } catch { /* ignore */ }
  swiftProc.kill('SIGTERM');
  swiftProc = null;
}
