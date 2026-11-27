import Foundation

/// `displayRotation` on `feed/{id}` / `moments/{id}`: CLOCKWISE degrees (0, 90, 180 or 270) to turn the Moment's
/// stored media (hero, proof frames, clips) when showing it. The evidence files themselves are hash-chained and never
/// rewritten; this only corrects how they are displayed (some early front-camera captures were stored sideways).
///
/// Missing or invalid (not a finite whole multiple of 90, a string, a bool) is 0. Multiples outside 0..<360 wrap
/// (360 = 0, -90 = 270).
public func normalizeDisplayRotation(_ raw: Any?) -> Int {
  guard let raw, !(raw is Bool), !(raw is String) else { return 0 }
  let value: Double
  switch raw {
  case let v as Int: value = Double(v)
  case let v as Int64: value = Double(v)
  case let v as Double: value = v
  case let v as Float: value = Double(v)
  case let v as NSNumber:
    #if canImport(Darwin)
      if CFGetTypeID(v) == CFBooleanGetTypeID() { return 0 }
    #endif
    value = v.doubleValue
  default: return 0
  }
  guard value.isFinite, value == value.rounded(), abs(value) < 1e9 else { return 0 }
  let n = Int(value)
  guard n % 90 == 0 else { return 0 }
  return ((n % 360) + 360) % 360
}

/// Width/height of media after turning it by `rotation` clockwise degrees: swapped for a quarter turn.
public func displayRotatedSize(width: Double, height: Double, rotation: Int) -> (width: Double, height: Double) {
  normalizeDisplayRotation(rotation) % 180 == 0 ? (width, height) : (height, width)
}
