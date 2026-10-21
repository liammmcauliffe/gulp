#!/usr/bin/env python3
"""Local GNOME pointer input over stdin, using the same protocol as the Mac helper."""
import math
import sys
from gi.repository import Gio, GLib


def main():
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    remote = 'org.gnome.Mutter.RemoteDesktop'
    cast = 'org.gnome.Mutter.ScreenCast'

    def call(destination, path, interface, method, signature=None, args=()):
        parameters = GLib.Variant(signature, args) if signature else None
        return bus.call_sync(destination, path, interface, method, parameters,
                             None, Gio.DBusCallFlags.NONE, 3000, None).unpack()

    session = call(remote, '/org/gnome/Mutter/RemoteDesktop', remote, 'CreateSession')[0]
    session_id = call(remote, session, 'org.freedesktop.DBus.Properties', 'Get',
                      '(ss)', (remote + '.Session', 'SessionId'))[0]
    # Monitor metadata maps screen coordinates for Mutter's absolute input API.
    # No PipeWire consumer is connected and no video is read or sent anywhere.
    screen = call(cast, '/org/gnome/Mutter/ScreenCast', cast, 'CreateSession',
                  '(a{sv})', ({'remote-desktop-session-id': GLib.Variant('s', session_id)},))[0]
    stream = call(cast, screen, cast + '.Session', 'RecordMonitor',
                  '(sa{sv})', ('', {'cursor-mode': GLib.Variant('u', 0)}))[0]
    metadata = call(cast, stream, 'org.freedesktop.DBus.Properties', 'Get',
                    '(ss)', (cast + '.Stream', 'Parameters'))[0]
    left, top = metadata['position']
    width, height = metadata['size']
    call(remote, session, remote + '.Session', 'Start')

    def notify(method, signature, args):
        # Input is ordered on this connection; don't wait for the compositor between moves.
        message = Gio.DBusMessage.new_method_call(remote, session, remote + '.Session', method)
        message.set_body(GLib.Variant(signature, args))
        message.set_flags(Gio.DBusMessageFlags.NO_REPLY_EXPECTED)
        bus.send_message(message, Gio.DBusSendMessageFlags.NONE)

    try:
        for line in sys.stdin:
            fields = line.split()
            if fields == ['quit']:
                break
            if fields == ['click']:
                notify('NotifyPointerButton', '(ib)', (0x110, True))
                notify('NotifyPointerButton', '(ib)', (0x110, False))
            elif len(fields) == 3 and fields[0] in ('move', 'scroll'):
                try:
                    x, y = map(float, fields[1:])
                except ValueError:
                    continue
                if not (math.isfinite(x) and math.isfinite(y)):
                    continue
                if fields[0] == 'move':
                    notify('NotifyPointerMotionAbsolute', '(sdd)',
                           (stream, max(0., min(width - 1., x - left)),
                            max(0., min(height - 1., y - top))))
                else:
                    notify('NotifyPointerAxis', '(ddu)', (x * 600, y * 600, 0))
                    notify('NotifyPointerAxis', '(ddu)', (0., 0., 1))
    finally:
        call(remote, session, remote + '.Session', 'Stop')


if __name__ == '__main__':
    try:
        main()
    except GLib.Error as error:
        print(f'Gulp GNOME input: {error.message}', file=sys.stderr)
        sys.exit(1)
