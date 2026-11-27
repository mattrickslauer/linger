import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import VerifiedCore

/// A proof frame ready for the chain: JPEG (longest side 640 px, quality 0.6), its base64 string,
/// `frameSha` = sha256 of that base64 string (contract), and Apple Vision labels for the on-device coach.
nonisolated struct ProofFrame: Sendable {
  let jpeg: Data
  let jpegB64: String
  let frameSha: String
  let w: Int
  let h: Int
  let t: Int64
  let labels: VisionLabeler.Labels

  static let maxSide = 640
  static let quality = 0.6
  /// Contract target: base64 < 120 KB so a chunk stays far below Firestore's 1 MB doc limit.
  static let maxB64Bytes = 120_000

  /// Decodes camera output (JPEG/HEIC, any size, EXIF orientation), downsizes with orientation applied,
  /// re-encodes, hashes and labels it. Runs off the main actor.
  static func make(from data: Data, t: Int64) -> ProofFrame? {
    guard let image = downscale(data, maxSide: maxSide) else { return nil }
    return make(from: image, t: t)
  }

  static func make(from image: CGImage, t: Int64) -> ProofFrame? {
    var q = quality
    var jpeg = encodeJPEG(image, quality: q)
    // Keep under the size target: step quality down if a very detailed frame is too big.
    while let j = jpeg, j.base64EncodedString().utf8.count > maxB64Bytes, q > 0.25 {
      q -= 0.15
      jpeg = encodeJPEG(image, quality: q)
    }
    guard let jpeg else { return nil }
    let b64 = jpeg.base64EncodedString()
    return ProofFrame(
      jpeg: jpeg, jpegB64: b64, frameSha: sha256Hex(b64), w: image.width, h: image.height, t: t,
      labels: VisionLabeler.labels(for: image))
  }

  /// ImageIO thumbnail: longest side <= maxSide, EXIF orientation baked in.
  static func downscale(_ data: Data, maxSide: Int) -> CGImage? {
    guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let opts: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxSide,
    ]
    return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
  }

  static func encodeJPEG(_ image: CGImage, quality: Double) -> Data? {
    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return out as Data
  }

  /// Decodes a stored base64 JPEG (feed hero / chunk frame) for display.
  static func cgImage(fromBase64 b64: String) -> CGImage? {
    guard let data = Data(base64Encoded: b64),
          let src = CGImageSourceCreateWithData(data as CFData, nil)
    else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
  }

  /// Decodes a stored base64 JPEG and turns it by the Moment's `displayRotation` (clockwise degrees). 0 is exactly
  /// `cgImage(fromBase64:)`.
  static func cgImage(fromBase64 b64: String, rotation: Int) -> CGImage? {
    guard let image = cgImage(fromBase64: b64) else { return nil }
    return rotated(image, clockwise: rotation)
  }

  /// The image itself turned `degrees` clockwise (as seen on screen) in quarter turns, so whatever shows it (fit,
  /// blurred fill) sees the true rotated aspect. 0 or an invalid angle returns `image` unchanged; a failed redraw
  /// falls back to the unrotated image.
  static func rotated(_ image: CGImage, clockwise degrees: Int) -> CGImage {
    let r = normalizeDisplayRotation(degrees)
    guard r != 0 else { return image }
    let w = image.width, h = image.height
    let quarter = r % 180 != 0
    let outW = quarter ? h : w, outH = quarter ? w : h
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let ctx = CGContext(data: nil, width: outW, height: outH, bitsPerComponent: 8, bytesPerRow: 0,
                              space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return image }
    ctx.interpolationQuality = .none  // whole-pixel quarter turns: no resampling
    // CoreGraphics is y-up, so a clockwise turn on screen is a negative angle.
    switch r {
    case 90: ctx.translateBy(x: 0, y: CGFloat(outH)); ctx.rotate(by: -.pi / 2)
    case 180: ctx.translateBy(x: CGFloat(outW), y: CGFloat(outH)); ctx.rotate(by: .pi)
    default: ctx.translateBy(x: CGFloat(outW), y: 0); ctx.rotate(by: .pi / 2)  // 270
    }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? image
  }

  /// Simulator only (no camera): a synthetic test frame so the whole flow can be exercised.
  static func syntheticImage() -> CGImage? {
    let w = 640, h = 480
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    let colors = [CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1), CGColor(red: 0.1, green: 0.6, blue: 0.4, alpha: 1)]
    if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1]) {
      ctx.drawLinearGradient(g, start: .zero, end: CGPoint(x: w, y: h), options: [])
    }
    // A sun and a dark bank: enough for Vision to return a few scene labels.
    ctx.setFillColor(CGColor(red: 0.95, green: 0.9, blue: 0.6, alpha: 1))
    ctx.fillEllipse(in: CGRect(x: 420, y: 300, width: 120, height: 120))
    ctx.setFillColor(CGColor(red: 0.3, green: 0.25, blue: 0.2, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: 90))
    return ctx.makeImage()
  }
}
