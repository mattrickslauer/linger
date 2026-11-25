import AVFoundation
import SwiftUI

enum CameraError: LocalizedError {
  case notRunning, noData, busy
  var errorDescription: String? {
    switch self {
    case .notRunning: "Camera is not ready yet"
    case .noData: "The camera returned no photo"
    case .busy: "Already recording a clip"
    }
  }
}

/// Back (or front) camera with a photo output and a movie output on the same session (like Android's
/// Preview + ImageCapture | VideoCapture). All session work happens on a private serial queue.
/// Video mode adds the microphone (when permitted) and lights the torch when flash is On.
nonisolated final class CameraController: NSObject, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate,
  @unchecked Sendable
{
  let session = AVCaptureSession()
  private let output = AVCapturePhotoOutput()
  private let movie = AVCaptureMovieFileOutput()
  private let queue = DispatchQueue(label: "verified.camera")
  private var configured = false
  private var input: AVCaptureDeviceInput?
  private var audioInput: AVCaptureDeviceInput?
  private var flashMode: AVCaptureDevice.FlashMode = .off
  private var videoMode = false
  private var pending: [Int64: CheckedContinuation<Data, Error>] = [:]
  private var movieDone: (@Sendable (URL, String?) -> Void)?

  /// Clip length cap (AVCaptureMovieFileOutput stops by itself and reports the clip as finished).
  static let maxClipSeconds = 300.0

  static var hasCamera: Bool { AVCaptureDevice.default(for: .video) != nil }

  static func device(_ position: AVCaptureDevice.Position) -> AVCaptureDevice? {
    AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
  }

  /// Both a front and a back camera exist.
  static var canFlip: Bool { device(.back) != nil && device(.front) != nil }

  /// The camera at `position` has a flash (front cameras use the screen and report none here).
  static func hasFlash(_ position: AVCaptureDevice.Position) -> Bool { device(position)?.hasFlash ?? false }

  /// Swaps the session's input to the camera at `position`; keeps the current one if that fails.
  /// Ignored while a clip is recording (the UI disables flip then, like Android).
  func setPosition(_ position: AVCaptureDevice.Position) {
    queue.async {
      guard self.configured, !self.movie.isRecording, self.input?.device.position != position,
            let device = Self.device(position),
            let next = try? AVCaptureDeviceInput(device: device)
      else { return }
      self.session.beginConfiguration()
      if let old = self.input { self.session.removeInput(old) }
      if self.session.canAddInput(next) {
        self.session.addInput(next)
        self.input = next
      } else if let old = self.input {
        self.session.addInput(old)
      }
      self.session.commitConfiguration()
      self.applyTorch()
    }
  }

  /// Photo: the flash mode for the next capture. Video: `.on` lights the torch (Auto acts as Off), as on Android.
  func setFlash(_ mode: AVCaptureDevice.FlashMode) {
    queue.async {
      self.flashMode = mode
      self.applyTorch()
    }
  }

  /// Switches between photo and video mode. Video mode adds the microphone if the user allowed it.
  func setVideoMode(_ on: Bool) {
    queue.async {
      guard self.configured, self.videoMode != on, !self.movie.isRecording else { return }
      self.videoMode = on
      self.session.beginConfiguration()
      if on {
        if self.audioInput == nil, AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
           let mic = AVCaptureDevice.default(for: .audio),
           let a = try? AVCaptureDeviceInput(device: mic), self.session.canAddInput(a)
        {
          self.session.addInput(a)
          self.audioInput = a
        }
      } else if let a = self.audioInput {
        self.session.removeInput(a)
        self.audioInput = nil
      }
      self.session.commitConfiguration()
      self.applyTorch()
    }
  }

  /// Must run on `queue`.
  private func applyTorch() {
    guard let device = input?.device, device.hasTorch else { return }
    let want: AVCaptureDevice.TorchMode = videoMode && flashMode == .on ? .on : .off
    guard device.torchMode != want, device.isTorchModeSupported(want), (try? device.lockForConfiguration()) != nil
    else { return }
    device.torchMode = want
    device.unlockForConfiguration()
  }

  static func requestAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
    default: return false
    }
  }

  /// Microphone for clip sound. Without it clips are recorded video-only.
  static func requestMicAccess() async -> Bool {
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized: return true
    case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
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
    queue.async {
      if self.movie.isRecording { self.movie.stopRecording() }
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  private func configureIfNeeded() {
    guard !configured,
          let device = Self.device(.back) ?? Self.device(.front),
          let input = try? AVCaptureDeviceInput(device: device)
    else { return }
    session.beginConfiguration()
    // .high (not .photo) so the movie output works on the same session; proof photos are downsized to 640 px anyway.
    session.sessionPreset = .high
    if session.canAddInput(input) {
      session.addInput(input)
      self.input = input
    }
    if session.canAddOutput(output) { session.addOutput(output) }
    if session.canAddOutput(movie) { session.addOutput(movie) }
    output.maxPhotoQualityPrioritization = .speed
    movie.maxRecordedDuration = CMTime(seconds: Self.maxClipSeconds, preferredTimescale: 600)
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
        if self.output.supportedFlashModes.contains(self.flashMode) { settings.flashMode = self.flashMode }
        if let conn = self.output.connection(with: .video), conn.isVideoRotationAngleSupported(90) {
          conn.videoRotationAngle = 90
        }
        self.pending[settings.uniqueID] = cont
        self.output.capturePhoto(with: settings, delegate: self)
      }
    }
  }

  /// Starts recording a QuickTime clip (portrait) to `url`. `done` runs (on the camera queue) once the file is
  /// finished: after `stopRecording()`, the length cap, or an interruption; the message is nil if the file is usable.
  func startRecording(to url: URL, done: @escaping @Sendable (URL, String?) -> Void) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      queue.async {
        guard self.configured, self.session.isRunning, self.movie.connection(with: .video) != nil else {
          cont.resume(throwing: CameraError.notRunning)
          return
        }
        guard !self.movie.isRecording else {
          cont.resume(throwing: CameraError.busy)
          return
        }
        if let conn = self.movie.connection(with: .video), conn.isVideoRotationAngleSupported(90) {
          conn.videoRotationAngle = 90
        }
        try? FileManager.default.removeItem(at: url)
        self.movieDone = done
        self.movie.startRecording(to: url, recordingDelegate: self)
        cont.resume()
      }
    }
  }

  func stopRecording() {
    queue.async { if self.movie.isRecording { self.movie.stopRecording() } }
  }

  // MARK: AVCaptureFileOutputRecordingDelegate

  func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL,
                  from connections: [AVCaptureConnection], error: Error?)
  {
    // A cap / disk-full / interruption stop still yields a usable file when this key says so.
    let finished = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool
    let failure: String? = (error == nil || finished == true) ? nil : error?.localizedDescription
    queue.async {
      let done = self.movieDone
      self.movieDone = nil
      done?(outputFileURL, failure)
    }
  }

  // MARK: AVCapturePhotoCaptureDelegate

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let id = photo.resolvedSettings.uniqueID
    let data = photo.fileDataRepresentation()
    let err = error.map { $0.localizedDescription }
    queue.async {
      guard let cont = self.pending.removeValue(forKey: id) else { return }
      if let data {
        cont.resume(returning: data)
      } else {
        let failure: Error = err.map { NSError(domain: "Camera", code: 1, userInfo: [NSLocalizedDescriptionKey: $0]) }
          ?? CameraError.noData
        cont.resume(throwing: failure)
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
