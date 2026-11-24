import AVFoundation
import SwiftUI

enum CameraError: LocalizedError {
  case notRunning, noData
  var errorDescription: String? {
    switch self {
    case .notRunning: "Camera is not ready yet"
    case .noData: "The camera returned no photo"
    }
  }
}

/// Back camera, photo output only. All session work happens on a private serial queue.
nonisolated final class CameraController: NSObject, @unchecked Sendable {
  let session = AVCaptureSession()
  private let output = AVCapturePhotoOutput()
  private let queue = DispatchQueue(label: "verified.camera")
  private var configured = false
  private var pending: [Int64: CheckedContinuation<Data, Error>] = [:]

  static var hasCamera: Bool { AVCaptureDevice.default(for: .video) != nil }

  static func requestAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
    default: return false
    }
  }

  func start() {
    queue.async {
      self.configureIfNeeded()
      if self.configured, !self.session.isRunning { self.session.startRunning() }
    }
  }

  func stop() {
    queue.async { if self.session.isRunning { self.session.stopRunning() } }
  }

  private func configureIfNeeded() {
    guard !configured,
          let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
          let input = try? AVCaptureDeviceInput(device: device)
    else { return }
    session.beginConfiguration()
    session.sessionPreset = .photo
    if session.canAddInput(input) { session.addInput(input) }
    if session.canAddOutput(output) { session.addOutput(output) }
    output.maxPhotoQualityPrioritization = .speed
    session.commitConfiguration()
    configured = true
  }

  /// Takes one JPEG photo (portrait orientation via EXIF; `ProofFrame` bakes it in).
  func capture() async throws -> Data {
    try await withCheckedThrowingContinuation { cont in
      queue.async {
        guard self.configured, self.session.isRunning else {
          cont.resume(throwing: CameraError.notRunning)
          return
        }
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        settings.photoQualityPrioritization = .speed
        if let conn = self.output.connection(with: .video), conn.isVideoRotationAngleSupported(90) {
          conn.videoRotationAngle = 90
        }
        self.pending[settings.uniqueID] = cont
        self.output.capturePhoto(with: settings, delegate: self)
      }
    }
  }
}

extension CameraController: AVCapturePhotoCaptureDelegate {
  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let id = photo.resolvedSettings.uniqueID
    let data = photo.fileDataRepresentation()
    let err = error.map { $0.localizedDescription }
    queue.async {
      guard let cont = self.pending.removeValue(forKey: id) else { return }
      if let data {
        cont.resume(returning: data)
      } else {
        cont.resume(throwing: err.map { NSError(domain: "Camera", code: 1, userInfo: [NSLocalizedDescriptionKey: $0]) }
          ?? CameraError.noData)
      }
    }
  }
}

/// Live camera preview layer.
struct CameraPreview: UIViewRepresentable {
  let session: AVCaptureSession

  final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  }

  func makeUIView(context: Context) -> PreviewView {
    let v = PreviewView()
    v.previewLayer.session = session
    v.previewLayer.videoGravity = .resizeAspectFill
    v.backgroundColor = .black
    return v
  }

  func updateUIView(_ uiView: PreviewView, context: Context) {}
}
