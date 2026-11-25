import SwiftUI
import VerifiedCore

/// The witness's toast on the live screen (v3.4): the ask (also spoken), why it helps, and the ways to answer.
/// `show` arms the shutter (the next proof shot answers it), `tell` takes a spoken or typed answer, `do` is Done.
struct WitnessCard: View {
  @Environment(AppModel.self) private var app
  let request: WitnessAgent.Request
  @State private var typed = ""
  @State private var typing = false
  @FocusState private var focused: Bool

  var body: some View {
    let rec = app.recorder
    let voice = VoiceIO.shared
    let armed = rec.witness.armed == request.wid
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Image(systemName: "eye.fill")
        Text("YOUR WITNESS").font(.caption2.weight(.heavy)).kerning(1.2)
        Text(request.by == "on_device" ? "on-device" : "cloud")
          .font(.caption2.weight(.semibold))
          .padding(.horizontal, 6).padding(.vertical, 2)
          .background(.white.opacity(0.18), in: Capsule())
        Spacer(minLength: 0)
        Button {
          voice.muted.toggle()
        } label: {
          Image(systemName: voice.muted ? "speaker.slash.fill" : "speaker.wave.2.fill").font(.footnote)
        }
        .accessibilityLabel(voice.muted ? "Unmute the witness" : "Mute the witness")
      }
      .foregroundStyle(.white.opacity(0.85))

      Text(request.ask).font(.title3.weight(.bold)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
      if !request.why.isEmpty && !armed {
        Text(request.why).font(.footnote).foregroundStyle(.white.opacity(0.75))
      }

      if armed {
        HStack(spacing: 8) {
          Image(systemName: "camera.viewfinder")
          Text("Frame it and tap the shutter").font(.subheadline.weight(.semibold))
          Spacer(minLength: 0)
          Button("Cancel") { rec.witness.disarm() }.font(.subheadline).foregroundStyle(.white.opacity(0.8))
        }
        .foregroundStyle(.white)
      } else if voice.listening {
        HStack(spacing: 8) {
          Image(systemName: "waveform").symbolEffect(.variableColor.iterative, options: .repeating)
          Text(voice.heard.isEmpty ? "Listening…" : voice.heard).font(.subheadline).lineLimit(2)
          Spacer(minLength: 0)
          Button("Done") { voice.stopListening() }.font(.subheadline.weight(.semibold))
        }
        .foregroundStyle(.white)
      } else if typing {
        HStack(spacing: 8) {
          TextField("Type your answer", text: $typed)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .submitLabel(.send)
            .onSubmit(sendTyped)
          Button(action: sendTyped) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
            .tint(.white)
            .disabled(typed.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      } else {
        actions(rec)
      }
    }
    .padding(14)
    .background(
      LinearGradient(colors: [Color.black.opacity(0.86), Theme.accent.opacity(0.78)],
                     startPoint: .topLeading, endPoint: .bottomTrailing),
      in: RoundedRectangle(cornerRadius: 18))
    .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.25), lineWidth: 1))
    .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
    .transition(.move(edge: .bottom).combined(with: .opacity))
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder private func actions(_ rec: RecorderModel) -> some View {
    HStack(spacing: 8) {
      switch request.kind {
      case .show:
        pill("Show", "camera.fill", primary: true) { rec.witnessShow() }
          .disabled(rec.cameraBusy)
      case .tell:
        pill("Answer", "mic.fill", primary: true) {
          Task {
            if let text = await VoiceIO.shared.listen(maxSeconds: 20) {
              rec.witnessAnswer(via: .voice, text: text)
            } else {
              typing = true
              focused = true
            }
          }
        }
        .disabled(rec.clipStartedAt != nil)  // the clip owns the microphone
        pill("Type", "keyboard", primary: false) { typing = true; focused = true }
      case .do:
        pill("Done", "checkmark", primary: true) { rec.witnessAnswer(via: .done) }
      }
      Spacer(minLength: 0)
      pill("Skip", "forward.fill", primary: false) { rec.witnessSkip() }
    }
  }

  private func pill(_ title: String, _ icon: String, primary: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: icon)
        .font(.subheadline.weight(.semibold))
        .padding(.horizontal, 14).padding(.vertical, 8)
        .foregroundStyle(primary ? Color.black : Color.white)
        .background(primary ? Color.white : Color.white.opacity(0.16), in: Capsule())
    }
    .buttonStyle(.plain)
  }

  private func sendTyped() {
    let t = typed.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !t.isEmpty else { return }
    app.recorder.witnessAnswer(via: .text, text: t)
    typed = ""
    typing = false
  }
}

/// The eye button on the camera: witness on/off, pulsing while it drafts a request.
struct WitnessToggle: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    let w = app.recorder.witness
    Button {
      w.enabled.toggle()
    } label: {
      Image(systemName: w.enabled ? "eye.fill" : "eye.slash.fill")
        .font(.system(size: 17, weight: .semibold))
        .foregroundStyle(w.enabled ? .white : .white.opacity(0.5))
        .symbolEffect(.pulse, options: .repeating, isActive: w.thinking)
        .frame(width: 44, height: 44)
        .background(w.thinking ? Theme.accent.opacity(0.8) : .black.opacity(0.55), in: Circle())
    }
    .accessibilityLabel(w.enabled ? "Witness on" : "Witness off")
    .accessibilityHint("Your witness asks for evidence while you record")
  }
}
