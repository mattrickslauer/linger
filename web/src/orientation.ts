// Capture auto-rotate. The PWA is portrait-locked (manifest "orientation": "portrait"), so a phone held sideways
// still lays the screen (and the camera frames, which browsers deliver upright relative to the screen) out in portrait.
// Like a native camera app we read gravity from `devicemotion`, work out how the device is physically held, and
// rotate the saved proof frame by the difference so it comes out upright (a landscape JPEG when held landscape).
// Desktop (no motion events) never gets a reading, so its frames are drawn exactly as before.

export type Quarter = 0 | 90 | 180 | 270;

/** Normalise any angle in degrees to [0, 360). */
const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** Snap to the nearest quarter turn. */
export const toQuarter = (deg: number): Quarter => (Math.round(norm(deg) / 90) % 4) * 90 as Quarter;

/**
 * Physical device rotation from gravity, in `screen.orientation.angle` terms: 0 upright portrait, 90 turned
 * counter-clockwise (top to the left), 180 upside down, 270 turned clockwise.
 *
 * `x, y, z` are `accelerationIncludingGravity` in the W3C convention (upright portrait: y ≈ +9.8; flat face-up:
 * z ≈ +9.8). Returns `prev` when the reading is ambiguous: the device lies flat (gravity mostly along z), or the
 * tilt is within the hysteresis band around a 45° diagonal. So it never flickers near 45° and keeps the last
 * orientation when laid on a table.
 */
export function rotationFromGravity(x: number, y: number, z: number, prev: Quarter, hysteresisDeg = 15): Quarter {
  const planar = Math.hypot(x, y);
  // Needs a usable in-plane component and gravity not dominated by z (tilted less than ~55° from flat → hold).
  if (planar < 3 || planar < Math.abs(z) * 0.7) return prev;
  const angle = norm((Math.atan2(x, y) * 180) / Math.PI);
  const q = toQuarter(angle);
  if (q === prev) return prev;
  // Only switch once well inside the new quadrant: within (45° − hysteresis) of its centre.
  let off = Math.abs(angle - q);
  if (off > 180) off = 360 - off;
  return off <= 45 - hysteresisDeg ? q : prev;
}

/**
 * Clockwise rotation (degrees) to apply to a screen-aligned camera frame so it is upright.
 * device: physical rotation (rotationFromGravity); screen: the content's rotation (screen.orientation.angle).
 * A mirrored (front) camera stores its frame un-mirrored, which reverses the turn for the quarter-turn cases.
 */
export function frameRotation(device: Quarter, screen: number, mirrored = false): Quarter {
  // The device is turned this far counter-clockwise relative to the laid-out content. For the rear camera the
  // world's "up" then sits that far clockwise in the frame, so the frame turns back counter-clockwise (360 − ccw
  // clockwise); the un-mirrored front frame is flipped left-right, so its turn goes the other way.
  const ccw = norm(device - toQuarter(screen));
  return toQuarter(mirrored ? ccw : 360 - ccw);
}

// ---------------------------------------------------------------- live tracking (module-level, idempotent)

let device: Quarter | null = null; // null until the first usable reading: desktop stays null forever
let started = false;

/** iOS Safari reports accelerationIncludingGravity with the opposite sign to the W3C convention Chrome follows. */
function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null) return;
  const s = isIOS() ? -1 : 1;
  const next = rotationFromGravity(s * a.x, s * a.y, s * (a.z ?? 0), device ?? 0);
  // A flat (or near-flat) first reading leaves `device` null: no guess until the phone is actually held up.
  if (device === null) {
    const planar = Math.hypot(a.x, a.y);
    if (planar < 3 || planar < Math.abs(a.z ?? 0) * 0.7) return;
  }
  device = next;
}

/** Start following the device's physical orientation (safe to call many times; no-op without devicemotion). */
export function startOrientationTracking() {
  if (started || typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
  started = true;
  window.addEventListener("devicemotion", onMotion);
}

/** The content's current rotation: screen.orientation.angle, else the legacy window.orientation, else 0. */
export function screenAngle(): number {
  if (typeof window === "undefined") return 0;
  const a = window.screen?.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  return norm(Number(a) || 0);
}

/** Clockwise degrees to rotate a captured frame by right now (0 when there's no motion reading, e.g. desktop). */
export function currentFrameRotation(mirrored: boolean): Quarter {
  if (device === null) return 0;
  return frameRotation(device, screenAngle(), mirrored);
}

/** Test hook. */
export function _setDeviceRotation(q: Quarter | null) {
  device = q;
}
