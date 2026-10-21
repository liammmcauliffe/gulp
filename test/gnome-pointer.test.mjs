import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('GNOME maps logical pointer coordinates into the selected monitor pixel scale', t => {
  const result = spawnSync('python3', ['-', fileURLToPath(new URL('../scripts/gulp-mouse-gnome.py', import.meta.url))], {
    encoding: 'utf8',
    input: String.raw`
import importlib.util, io, sys, types
sys.dont_write_bytecode = True
class Value:
    def __init__(self, signature, value): self.value = value
    def unpack(self): return self.value
class Message:
    def __init__(self, destination, path, interface, method): self.method = method
    def set_body(self, value): self.body = value.value
    def set_flags(self, flags): pass
class Bus:
    def __init__(self, scale): self.scale, self.messages = scale, []
    def call_sync(self, destination, path, interface, method, args, *rest):
        if method in ('CreateSession', 'RecordMonitor'): value = ('/session',)
        elif method == 'Get' and args.value[1] == 'SessionId': value = ('session',)
        elif method == 'Get': value = ({'position': (-1920, 0), 'size': (1920, 1080), 'output-name': 'HDMI-1'},)
        elif method == 'GetCurrentState': value = (1, [], [(0, 0, 1.0, 0, False, [('eDP-1', '', '', '')], {}), (-1920, 0, self.scale, 0, True, [('HDMI-1', '', '', '')], {})], {})
        else: value = ()
        return Value('', value)
    def send_message(self, message, flags): self.messages.append((message.method, message.body))
    def signal_subscribe(self, *args): return 1
    def signal_unsubscribe(self, *args): pass
context = types.SimpleNamespace(pending=lambda: False)
Gio = types.SimpleNamespace(BusType=types.SimpleNamespace(SESSION=0), DBusCallFlags=types.SimpleNamespace(NONE=0), DBusSignalFlags=types.SimpleNamespace(NONE=0), DBusMessageFlags=types.SimpleNamespace(NO_REPLY_EXPECTED=0), DBusSendMessageFlags=types.SimpleNamespace(NONE=0), DBusMessage=types.SimpleNamespace(new_method_call=Message))
GLib = types.SimpleNamespace(Variant=Value, MainContext=types.SimpleNamespace(default=lambda: context), Error=Exception)
sys.modules['gi'] = types.ModuleType('gi')
sys.modules['gi.repository'] = types.SimpleNamespace(Gio=Gio, GLib=GLib)
spec = importlib.util.spec_from_file_location('gulp_gnome', sys.argv[1])
helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
for scale in (1.0, 1.25, 2.0):
    bus = Bus(scale); Gio.bus_get_sync = lambda *args: bus
    sys.stdin = io.StringIO('move -1200 540\nmove 9999 -20\nclick\nquit\n')
    helper.main()
    moves = [body[1:] for method, body in bus.messages if method == 'NotifyPointerMotionAbsolute']
    assert moves == [(720 * scale, 540 * scale), (1919 * scale, 0.0)], (scale, moves)
    buttons = [body for method, body in bus.messages if method == 'NotifyPointerButton']
    assert buttons == [(0x110, True), (0x110, False)], buttons
print('1x, fractional, 2x, monitor origin, edge clamping, and clicks passed')
`,
  });
  if (result.error?.code === 'ENOENT') return t.skip('Python 3 is needed by the GNOME helper');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
