// Mac-only harness (no Xcode needed): exercises the app's pure-Swift pieces against the macOS SDK.
// Run via ios/scripts/mac-check.sh. Exits non-zero on the first failed expectation.
import CoreGraphics
import Foundation
import ImageIO
import VerifiedCore

nonisolated(unsafe) var failures = 0
func expect(_ ok: Bool, _ what: String) {
  print(ok ? "  ok   \(what)" : "  FAIL \(what)")
  if !ok { failures += 1 }
}

let framesDir = CommandLine.arguments.dropFirst().first ?? "../../shared/sample-moments/frames"

print("ProofFrame: synthetic (Simulator) frame")
if let img = ProofFrame.syntheticImage(), let f = ProofFrame.make(from: img, t: 1_764_000_000_000) {
  expect(max(f.w, f.h) <= ProofFrame.maxSide, "longest side <= 640 (\(f.w)x\(f.h))")
  expect(f.frameSha == sha256Hex(f.jpegB64), "frameSha = sha256(base64)")
  expect(f.jpegB64.utf8.count < ProofFrame.maxB64Bytes, "base64 < 120 KB (\(f.jpegB64.utf8.count) B)")
  expect(Data(base64Encoded: f.jpegB64) == f.jpeg, "base64 round-trips")
  print("    labels: \(f.labels.description.replacingOccurrences(of: "\n", with: " | "))")
} else {
  expect(false, "synthetic frame")
}

print("ProofFrame: sample JPEGs, upscaled to 4032x3024 first (camera-sized input)")
let files = (try? FileManager.default.contentsOfDirectory(atPath: framesDir).filter { $0.hasSuffix(".jpg") }.sorted()) ?? []
expect(!files.isEmpty, "found sample frames in \(framesDir)")
for name in files {
  let url = URL(fileURLWithPath: framesDir).appendingPathComponent(name)
  guard let data = try? Data(contentsOf: url),
        let src = CGImageSourceCreateWithData(data as CFData, nil),
        let small = CGImageSourceCreateImageAtIndex(src, 0, nil),
        let ctx = CGContext(data: nil, width: 4032, height: 3024, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
  else { expect(false, "decode \(name)"); continue }
  ctx.interpolationQuality = .high
  ctx.draw(small, in: CGRect(x: 0, y: 0, width: 4032, height: 3024))
  guard let big = ctx.makeImage(), let bigJpeg = ProofFrame.encodeJPEG(big, quality: 0.95) else {
    expect(false, "upscale \(name)"); continue
  }
  let start = Date()
  guard let f = ProofFrame.make(from: bigJpeg, t: 1) else { expect(false, "make \(name)"); continue }
  let ms = Int(Date().timeIntervalSince(start) * 1000)
  expect(max(f.w, f.h) == 640 && f.jpegB64.utf8.count < ProofFrame.maxB64Bytes && f.frameSha == sha256Hex(f.jpegB64),
         "\(name): \(f.w)x\(f.h), \(f.jpegB64.utf8.count / 1024) KB b64, \(ms) ms")
  print("    labels: \(f.labels.objects.prefix(4).joined(separator: ", ")) | text: \(f.labels.text.prefix(2)) | short: \(f.labels.shortLabel)")
}

print("Live coach: offline heuristic + lenient JSON parsing")
var screen = VisionLabeler.Labels()
screen.objects = ["computer monitor (80%)"]
expect(LiveCoachHeuristic.heuristic(screen).ok == false, "screen photo -> retake")
expect(LiveCoachHeuristic.heuristic(VisionLabeler.Labels()).ok == false, "nothing recognizable -> retake")
var fish = VisionLabeler.Labels()
fish.objects = ["fish (71%)", "water (60%)"]
let h = LiveCoachHeuristic.heuristic(fish)
expect(h.ok && h.label == "fish" && h.mode == .none, "fish -> keep going, label 'fish', mode none")
let p = LiveJSON.parse("Sure! ```json\n{\"ok\": false, \"reason\": \"Fish not visible, hold it up\", \"label\": \"empty lake\"}\n```")
expect(p?.ok == false && p?.reason == "Fish not visible, hold it up" && p?.label == "empty lake", "parses fenced JSON")
expect(LiveJSON.parse("no json here") == nil, "rejects non-JSON")

print("Recorder chain: chunk payloads with a frame + check reproduce the contract vectors")
let vectorsURL = URL(fileURLWithPath: framesDir).deletingLastPathComponent().deletingLastPathComponent()
  .appendingPathComponent("test-vectors.json")
if let vd = try? Data(contentsOf: vectorsURL),
   let v = try? JSONSerialization.jsonObject(with: vd) as? [String: Any],
   let momentId = v["momentId"] as? String,
   let vc = v["chunks"] as? [[String: Any]] {
  var chain = Chain(momentId: momentId)
  let p0 = Payload(
    gps: [GPSSample(t: 1_764_000_000_000, lat: 33.6189, lng: -117.6681, accuracyM: 5.2, altitudeM: nil, speedMps: 0.4)],
    motion: [MotionSample(t: 1_764_000_000_100, ax: 0.01, ay: 9.81, az: -0.2, gx: 0, gy: 0.001, gz: 0)],
    events: [MomentEvent(t: 1_764_000_000_000, type: .start)])
  let c0 = chain.append(t0: 1_764_000_000_000, t1: 1_764_000_005_000, payload: p0.string)
  let p1 = Payload(
    events: [MomentEvent(t: 1_764_000_006_000, type: .stop)], frameSha: sha256Hex("aGVsbG8="),
    check: FrameCheck(ok: true, reason: "keep going", mode: .onDevice, label: "bass in hand"))
  let c1 = chain.append(t0: 1_764_000_005_000, t1: 1_764_000_006_000, payload: p1.string)
  expect(c0.hash == vc[0]["hash"] as? String && c1.hash == vc[1]["hash"] as? String, "hashes match shared/test-vectors.json")
  expect(chain.lastHash == c1.hash, "headHash = last chunk hash")
} else {
  expect(false, "read shared/test-vectors.json")
}

print(failures == 0 ? "\nALL CHECKS PASSED" : "\n\(failures) CHECK(S) FAILED")
exit(failures == 0 ? 0 : 1)
