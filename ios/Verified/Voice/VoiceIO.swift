import AVFoundation
import Foundation
import Observation
import Speech

/// Platform voice (docs/ARCHITECTURE.md v3.2): speech-to-text with `SFSpeechRecognizer` (on-device recognition when
/// the device supports it, so it works with no signal) and text-to-speech with `AVSpeechSynthesizer`, one sentence at
/// a time. Every screen that listens also shows a text field: voice is never required.
@Observable
final class VoiceIO: NSObject, AVSpeechSynthesizerDelegate {
  static let shared = VoiceIO()

  private(set) var listening = false
  private(set) var speaking = false
  /// Live (partial) transcript while listening.
  private(set) var heard = ""
  var error: String?
  /// Spoken replies on/off (the person can mute the witness and interviewer).
  var muted = UserDefaults.standard.bool(forKey: "voiceMuted") {
    didSet {
      UserDefaults.standard.set(muted, forKey: "voiceMuted")
      if muted { stopSpeaking() }
    }
  }

  @ObservationIgnored private let synth = AVSpeechSynthesizer()
  @ObservationIgnored private var engine: AVAudioEngine?
  @ObservationIgnored private var task: SFSpeechRecognitionTask?
  @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
  @ObservationIgnored private var listenDone: CheckedContinuation<String?, Never>?
  @ObservationIgnored private var silenceTimer: Task<Void, Never>?
  @ObservationIgnored private var maxTimer: Task<Void, Never>?
  @ObservationIgnored private var speakDone: CheckedContinuation<Void, Never>?
  /// The utterance `speakDone` waits for: a late didFinish/didCancel of an interrupted one must not end the next.
  @ObservationIgnored private var current: AVSpeechUtterance?

  override private init() {
    super.init()
    synth.delegate = self
  }

  var onDeviceRecognition: Bool { Self.recognizer()?.supportsOnDeviceRecognition ?? false }

  // MARK: - Permissions

  /// Speech recognition + microphone. False: the caller shows the text field only.
  static func requestPermissions() async -> Bool {
    let speech: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { c in
      SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
    }
    guard speech == .authorized else { return false }
    return await AVAudioApplication.requestRecordPermission()
  }

  private static func recognizer() -> SFSpeechRecognizer? {
    SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
  }

  // MARK: - Speak

  /// Speaks one sentence and returns when it has been said (or right away when muted).
  func speak(_ text: String) async {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty, !muted else { return }
    stopSpeaking()
    prepareSession()
    let u = AVSpeechUtterance(string: t)
    u.voice = AVSpeechSynthesisVoice(language: Locale.current.identifier.replacingOccurrences(of: "_", with: "-"))
      ?? AVSpeechSynthesisVoice(language: "en-US")
    u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
    speaking = true
    current = u
    await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
      speakDone = c
      synth.speak(u)
    }
  }

  func stopSpeaking() {
    if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
    finishSpeaking()
  }

  private func finishSpeaking() {
    current = nil
    speaking = false
    let c = speakDone
    speakDone = nil
    c?.resume()
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let u = utterance  // only compared by identity on the main actor
    Task { @MainActor in self.finished(u) }
  }

  nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    nonisolated(unsafe) let u = utterance  // only compared by identity on the main actor
    Task { @MainActor in self.finished(u) }
  }

  /// Only the utterance being waited for ends the wait (`stopSpeaking` already ended an interrupted one).
  private func finished(_ u: AVSpeechUtterance) {
    guard let current, current === u else { return }
    finishSpeaking()
  }

  // MARK: - Listen

  /// Listens until the person pauses (`silence` s after the last word), `maxSeconds`, or `stopListening()`.
  /// Returns the transcript, or nil when nothing was heard or speech is unavailable (show the text field).
  func listen(maxSeconds: Double = 15, silence: Double = 1.6) async -> String? {
    guard !listening else { return nil }
    stopSpeaking()
    error = nil
    heard = ""
    guard await Self.requestPermissions() else {
      error = "Microphone or speech recognition not allowed: type instead."
      return nil
    }
    guard let recognizer = Self.recognizer(), recognizer.isAvailable else {
      error = "Speech recognition is not available right now: type instead."
      return nil
    }
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    req.addsPunctuation = true
    if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }  // works offline

    prepareSession()
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      error = "The microphone is busy: type instead."
      return nil
    }
    Self.installTap(on: input, format: format, request: req)
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      self.error = "Could not start the microphone: type instead."
      return nil
    }
    self.engine = engine
    self.request = req
    listening = true
    task = Self.recognize(recognizer, req) { [weak self] text, isFinal, failed in
      Task { @MainActor in self?.onResult(text, isFinal: isFinal, failed: failed, silence: silence) }
    }
    maxTimer = Task { [weak self] in
      try? await Task.sleep(for: .seconds(maxSeconds))
      guard !Task.isCancelled else { return }
      self?.stopListening()
    }
    // Nobody speaks at all: give up after a while.
    restartSilence(after: max(silence, 6))
    return await withCheckedContinuation { c in listenDone = c }
  }

  /// Ends listening now and returns what was heard so far.
  func stopListening() {
    guard listening else { return }
    listening = false
    silenceTimer?.cancel()
    maxTimer?.cancel()
    engine?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.finish()
    engine = nil
    request = nil
    task = nil
    let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
    let c = listenDone
    listenDone = nil
    c?.resume(returning: text.isEmpty ? nil : text)
  }

  private func onResult(_ text: String?, isFinal: Bool, failed: Bool, silence: Double) {
    guard listening else { return }
    if let text, !text.isEmpty {
      heard = text
      restartSilence(after: silence)
    }
    if isFinal || failed { stopListening() }
  }

  private func restartSilence(after seconds: Double) {
    silenceTimer?.cancel()
    silenceTimer = Task { [weak self] in
      try? await Task.sleep(for: .seconds(seconds))
      guard !Task.isCancelled else { return }
      self?.stopListening()
    }
  }

  /// While the camera runs it owns the audio session (play-and-record); otherwise set one up for voice.
  private func prepareSession() {
    let s = AVAudioSession.sharedInstance()
    guard s.category != .playAndRecord else { return }
    do {
      try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .duckOthers])
      try s.setActive(true)
    } catch {
      print("[Verified] audio session:", error.localizedDescription)
    }
  }

  // Built outside the main actor: the tap and the recognition handler run on audio / speech queues.
  private nonisolated static func installTap(on node: AVAudioInputNode, format: AVAudioFormat,
                                             request: SFSpeechAudioBufferRecognitionRequest) {
    nonisolated(unsafe) let req = request
    node.installTap(onBus: 0, bufferSize: 1024, format: format) { @Sendable buffer, _ in req.append(buffer) }
  }

  private nonisolated static func recognize(
    _ recognizer: SFSpeechRecognizer, _ request: SFSpeechAudioBufferRecognitionRequest,
    _ handler: @escaping @Sendable (String?, Bool, Bool) -> Void
  ) -> SFSpeechRecognitionTask {
    recognizer.recognitionTask(with: request) { @Sendable result, error in
      handler(result?.bestTranscription.formattedString, result?.isFinal ?? false, error != nil)
    }
  }
}
