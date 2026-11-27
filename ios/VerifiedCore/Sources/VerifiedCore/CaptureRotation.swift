import Foundation

/// `AVCaptureConnection.videoRotationAngle` for how the phone is physically held, from CoreMotion gravity
/// (device coordinates, in g: upright portrait ≈ (0, -1, 0); flat face up ≈ (0, 0, -1)).
///
/// 90 = portrait (the app's long-standing, known-good value), 0 = top turned left, 180 = top turned right,
/// 270 = upside down. Same values for the back and the front camera (the connection handles mirroring).
///
/// We compute this ourselves instead of `AVCaptureDevice.RotationCoordinator`: on iPhone 17-generation cameras the
/// coordinator's horizon-level capture angle comes back offset by 90° (front camera: 0 in portrait), which saved
/// portrait shots sideways. Web (`web/src/orientation.ts`) and Android (`surfaceRotationFor`) use the same rule.
///
/// Returns `prev` when the reading is ambiguous: the phone lies (nearly) flat, or the tilt sits near a 45° diagonal
/// (hysteresis), so the angle never flickers and a phone laid on a table keeps its last orientation.
public func captureRotationAngle(gravityX gx: Double, y gy: Double, z gz: Double, prev: Double = 90,
                                 hysteresisDeg: Double = 15) -> Double
{
  let planar = (gx * gx + gy * gy).squareRoot()
  if planar < 0.3 || planar < abs(gz) * 0.7 { return prev }
  // Angle of "down" in the screen plane, 0 when the phone is upright, +90 when its top is turned right.
  let down = atan2(gx, -gy) * 180 / .pi
  let angle = norm360(90 + down)
  let q = norm360((angle / 90).rounded() * 90)
  if q == norm360(prev) { return q }
  var off = abs(angle - q)
  if off > 180 { off = 360 - off }
  return off <= 45 - hysteresisDeg ? q : prev
}

private func norm360(_ d: Double) -> Double {
  let r = d.truncatingRemainder(dividingBy: 360)
  let n = r < 0 ? r + 360 : r
  return n == 360 ? 0 : n
}
