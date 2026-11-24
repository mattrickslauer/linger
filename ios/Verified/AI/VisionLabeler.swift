import CoreGraphics
@preconcurrency import Vision

/// Apple Foundation Models is text-only, so the frame is first described with Apple Vision
/// (scene classification, OCR, faces, hands) and the labels are fed to the model as text.
nonisolated enum VisionLabeler {
  struct Labels: Sendable {
    var objects: [String] = []
    var text: [String] = []
    var faces = 0
    var hands = 0

    /// Prompt text for `{{frame}}`.
    var description: String {
      var parts: [String] = []
      parts.append("Detected scene/objects: " + (objects.isEmpty ? "nothing recognizable" : objects.joined(separator: ", ")))
      if !text.isEmpty { parts.append("Text visible in frame: " + text.map { "\"\($0)\"" }.joined(separator: ", ")) }
      parts.append("Faces: \(faces). Hands: \(hands).")
      return parts.joined(separator: "\n")
    }

    /// Short fallback label (2-4 words) when no model is available.
    var shortLabel: String { objects.first.map { $0.components(separatedBy: " (").first ?? $0 } ?? "photo" }
  }

  static func labels(for image: CGImage) -> Labels {
    let classify = VNClassifyImageRequest()
    let ocr = VNRecognizeTextRequest()
    ocr.recognitionLevel = .fast
    let faces = VNDetectFaceRectanglesRequest()
    let hands = VNDetectHumanHandPoseRequest()
    hands.maximumHandCount = 4

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform([classify, ocr, faces, hands])

    var out = Labels()
    out.objects = (classify.results ?? [])
      .filter { $0.confidence >= 0.25 }
      .prefix(8)
      .map { "\($0.identifier.replacingOccurrences(of: "_", with: " ")) (\(Int($0.confidence * 100))%)" }
    out.text = (ocr.results ?? []).compactMap { $0.topCandidates(1).first?.string }.prefix(6).map { String($0.prefix(40)) }
    out.faces = faces.results?.count ?? 0
    out.hands = hands.results?.count ?? 0
    return out
  }
}
