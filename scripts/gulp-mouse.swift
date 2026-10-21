import CoreGraphics
import Foundation

// ponytail: long-lived CGEvent helper. Needs Accessibility for the parent (Node/Terminal).
// Lines on stdin: "move X Y" | "click" | "scroll DX DY" | "quit"

func post(_ event: CGEvent?) {
  event?.post(tap: .cghidEventTap)
}

func handle(_ line: String) -> Bool {
  let parts = line.split(separator: " ").map(String.init)
  guard let cmd = parts.first else { return true }
  switch cmd {
  case "quit":
    return false
  case "move":
    guard parts.count >= 3, let x = Double(parts[1]), let y = Double(parts[2]) else { return true }
    let point = CGPoint(x: x, y: y)
    post(CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left))
  case "click":
    var location = CGEvent(source: nil)?.location ?? .zero
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: location, mouseButton: .left))
    location = CGEvent(source: nil)?.location ?? location
    post(CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: location, mouseButton: .left))
  case "scroll":
    let dx = Int32(Double(parts.count > 1 ? parts[1] : "0") ?? 0)
    let dy = Int32(Double(parts.count > 2 ? parts[2] : "0") ?? 0)
    if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32((-dy) * 4), wheel2: Int32((-dx) * 4), wheel3: 0) {
      event.post(tap: .cghidEventTap)
    }
  default:
    break
  }
  return true
}

while let line = readLine() {
  if !handle(line) { break }
}
