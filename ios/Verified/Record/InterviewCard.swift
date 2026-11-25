import SwiftUI
import VerifiedCore

/// The voice interview on the Record tab (v3.2): talk → bubbles → structured intention card with the bar preview.
/// A text field is always there; "Skip — just type it" focuses the plain form below.
struct InterviewCard: View {
  @Environment(AppModel.self) private var app
  let typeInstead: () -> Void
  @FocusState private var answerFocused: Bool

  var body: some View {
    let iv = app.interview
    VStack(alignment: .leading, spacing: 14) {
      switch iv.phase {
      case .idle: intro
      case .done:
        if let r = iv.result { IntentionSummary(result: r) } else { intro }
      default: conversation(iv)
      }
    }
    .padding(16)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 20))
    .overlay(RoundedRectangle(cornerRadius: 20).stroke(Theme.accent.opacity(iv.active ? 0.5 : 0), lineWidth: 1.5))
    .animation(.snappy, value: iv.phase)
    .animation(.snappy, value: iv.lines)
  }

  // MARK: - Intro

  private var intro: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 14) {
        Button { app.interview.begin() } label: {
          Image(systemName: "mic.fill")
            .font(.system(size: 26, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 64, height: 64)
            .background(LinearGradient(colors: [Theme.accent, Theme.accent.opacity(0.75)],
                                       startPoint: .top, endPoint: .bottom), in: Circle())
            .shadow(color: Theme.accent.opacity(0.35), radius: 10, y: 4)
        }
        .accessibilityLabel("Talk it through")
        VStack(alignment: .leading, spacing: 4) {
          Text("Talk it through").font(.title3.bold())
          Text("Say what you're about to do. Your witness asks up to 3 quick questions, splits it into claims and tells you the minimum evidence to get it verified.")
            .font(.subheadline).foregroundStyle(.secondary)
        }
      }
      HStack(spacing: 8) {
        Chip(text: HybridAI.onDeviceAvailable ? "questions on-device" : "questions in the cloud",
             systemImage: HybridAI.onDeviceAvailable ? "cpu" : "cloud", color: HybridAI.onDeviceAvailable ? Theme.accent : .blue)
        Chip(text: "structured in the cloud", systemImage: "cloud", color: .blue)
        Spacer(minLength: 0)
      }
      Button("Skip — just type it", action: typeInstead).font(.subheadline.weight(.semibold))
    }
  }

  // MARK: - Conversation

  private func conversation(_ iv: InterviewModel) -> some View {
    @Bindable var iv = iv
    let voice = VoiceIO.shared
    return VStack(alignment: .leading, spacing: 10) {
      HStack {
        Label("Witness interview", systemImage: "waveform").font(.headline)
        Spacer()
        Button { voice.muted.toggle() } label: {
          Image(systemName: voice.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
        }
        .accessibilityLabel(voice.muted ? "Unmute voice" : "Mute voice")
        Button("Cancel") { iv.cancel() }.font(.subheadline)
      }
      if let place = iv.placeLabel {
        Label(place, systemImage: "location.fill").font(.caption).foregroundStyle(.secondary)
      }
      ForEach(iv.lines) { line in Bubble(line: line) }
      if voice.listening {
        Bubble(line: .init(role: .me, text: voice.heard.isEmpty ? "Listening…" : voice.heard), live: true)
      }
      status(iv)
      if let err = voice.error, iv.phase == .waiting {
        Text(err).font(.caption).foregroundStyle(Theme.warn)
      }
      if [.listening, .waiting, .speaking].contains(iv.phase) {
        HStack(spacing: 10) {
          Button { if voice.listening { voice.stopListening() } else { iv.listen() } } label: {
            Image(systemName: voice.listening ? "stop.fill" : "mic.fill")
              .font(.title3.weight(.semibold))
              .foregroundStyle(.white)
              .frame(width: 46, height: 46)
              .background(voice.listening ? Theme.bad : Theme.accent, in: Circle())
              .symbolEffect(.pulse, options: .repeating, isActive: voice.listening)
          }
          .accessibilityLabel(voice.listening ? "Stop listening" : "Speak")
          TextField("Or type your answer", text: $iv.typed)
            .textFieldStyle(.plain)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .background(Color(.tertiarySystemGroupedBackground), in: Capsule())
            .focused($answerFocused)
            .submitLabel(.send)
            .onSubmit { iv.submitTyped() }
          if !iv.typed.isEmpty {
            Button { iv.submitTyped() } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
          }
        }
        Button { iv.finishNow() } label: {
          Label("That's it", systemImage: "checkmark").font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.bordered)
        .disabled(iv.lines.filter { $0.role == .me }.isEmpty)
      }
    }
  }

  @ViewBuilder private func status(_ iv: InterviewModel) -> some View {
    let text: String? = switch iv.phase {
    case .locating: "Finding where you are…"
    case .thinking: HybridAI.onDeviceAvailable ? "Thinking on-device…" : "Thinking…"
    case .structuring: app.network.isOnline ? "Structuring your intention in the cloud…" : "Offline: using the on-device draft…"
    case .previewing: "Previewing the bar…"
    default: nil
    }
    if let text {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(text).font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}

private struct Bubble: View {
  let line: InterviewModel.Line
  var live = false

  var body: some View {
    HStack {
      if line.role == .me { Spacer(minLength: 40) }
      VStack(alignment: line.role == .me ? .trailing : .leading, spacing: 4) {
        Text(line.text)
          .font(.subheadline)
          .foregroundStyle(line.role == .me ? .white : .primary)
          .padding(.horizontal, 12).padding(.vertical, 8)
          .background(line.role == .me ? AnyShapeStyle(Theme.accent.opacity(live ? 0.6 : 1)) : AnyShapeStyle(Color(.tertiarySystemGroupedBackground)),
                      in: RoundedRectangle(cornerRadius: 16))
        if let mode = line.mode {
          Label(mode == "on_device" ? "on-device" : "cloud", systemImage: mode == "on_device" ? "cpu" : "cloud")
            .font(.caption2).foregroundStyle(.secondary)
        }
      }
      if line.role == .ai { Spacer(minLength: 40) }
    }
    .transition(.opacity.combined(with: .move(edge: .bottom)))
  }
}

/// The structured intention the interview produced, editable (remove what the AI assumed), with the bar preview.
struct IntentionSummary: View {
  @Environment(AppModel.self) private var app
  let result: StructuredIntention

  var body: some View {
    let iv = app.interview
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 4) {
          Text(result.activity.isEmpty ? result.category.label.uppercased() : result.activity.uppercased())
            .font(.caption.weight(.bold)).kerning(1).foregroundStyle(Theme.accent)
          Text(result.goal.isEmpty ? result.text : result.goal).font(.title3.bold())
        }
        Spacer()
        Menu {
          Button("Redo interview", systemImage: "mic") {
            app.recorder.structured = nil
            iv.begin()
          }
          Button("Clear", systemImage: "xmark", role: .destructive) {
            app.recorder.structured = nil
            iv.cancel()
          }
        } label: {
          Image(systemName: "ellipsis.circle").font(.title3)
        }
      }
      if let place = result.place?.label {
        Label(place, systemImage: "mappin.and.ellipse").font(.subheadline).foregroundStyle(.secondary)
      }
      if !result.claims.isEmpty {
        // v4: claims + "To get this verified" (the evidence plan) replace the quantity chips.
        PlanSummary(claims: result.claims, plan: result.plan, removeClaim: { iv.removeClaim($0) })
        if let m = result.expectedMinutes { Chip(text: "~\(Int(m)) min", systemImage: "clock") }
      } else if !result.quantities.isEmpty || result.expectedMinutes != nil {
        FlowChips {
          ForEach(result.quantities) { q in
            Button { iv.removeQuantity(q) } label: {
              Chip(text: "\(q.label) · \(q.measuredBy)", systemImage: "ruler", color: Theme.accent)
            }
            .buttonStyle(.plain)
          }
          if let m = result.expectedMinutes { Chip(text: "~\(Int(m)) min", systemImage: "clock") }
        }
      }
      if !result.conditions.isEmpty {
        FlowChips {
          ForEach(result.conditions, id: \.self) { c in
            Button { iv.removeCondition(c) } label: { Chip(text: c, systemImage: "cloud.sun") }.buttonStyle(.plain)
          }
        }
      }
      if !result.assumptions.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("The AI assumed (tap × if wrong)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          ForEach(result.assumptions, id: \.self) { a in
            HStack(alignment: .firstTextBaseline, spacing: 8) {
              Text(a).font(.footnote)
              Spacer()
              Button { iv.removeAssumption(a) } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                .accessibilityLabel("Remove assumption")
            }
          }
        }
      }
      BarPreviewRow(preview: result.preview, recheck: { Task { await iv.previewBar() } })
      HStack(spacing: 6) {
        Chip(text: "\(result.turns) \(result.turns == 1 ? "answer" : "answers")", systemImage: "waveform")
        Chip(text: modeLabel(result.mode), systemImage: result.mode == "on_device" ? "cpu" : "cloud",
             color: result.mode == "on_device" ? Theme.accent : .blue)
      }
    }
  }

  private func modeLabel(_ m: String) -> String {
    switch m {
    case "on_device": "on-device interview"
    case "cloud": "cloud interview"
    case "mixed": "on-device + cloud"
    default: "typed"
    }
  }
}

/// "Bar ≈ 0.73 (preview)": the score this Moment will likely have to reach. Binding bar: set server-side at submit.
struct BarPreviewRow: View {
  let preview: StructuredIntention.Preview?
  let recheck: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        Image(systemName: "flag.checkered").foregroundStyle(Theme.warn)
        if let p = preview {
          Text("Bar ≈ \(String(format: "%.2f", p.bar))").font(.headline.monospacedDigit())
          Text("(preview)").font(.caption).foregroundStyle(.secondary)
          Spacer()
          Chip(text: p.mode == "on_device" ? "on-device" : "cloud", systemImage: p.mode == "on_device" ? "cpu" : "cloud",
               color: p.mode == "on_device" ? Theme.accent : .blue)
        } else {
          Text("Bar preview unavailable").font(.subheadline).foregroundStyle(.secondary)
          Spacer()
          Button("Retry", action: recheck).font(.caption)
        }
      }
      if let p = preview {
        BarGauge(score: nil, bar: p.bar).frame(height: 10)
        if !p.rationale.isEmpty { Text(p.rationale).font(.caption).foregroundStyle(.secondary) }
      }
      Text("The binding bar is set in the cloud when you submit. Harder or more tempting claims need more evidence.")
        .font(.caption2).foregroundStyle(.tertiary)
    }
    .padding(12)
    .background(Theme.warn.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
  }
}

/// A horizontal 0…1 track with the bar as a flag and, when known, the score as a filled bar.
struct BarGauge: View {
  let score: Double?
  let bar: Double

  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(Color(.tertiarySystemFill))
        if let score {
          Capsule().fill(score >= bar ? Theme.accent : Theme.bad)
            .frame(width: max(6, g.size.width * min(1, max(0, score))))
        }
        Rectangle().fill(Theme.warn).frame(width: 3, height: g.size.height + 8)
          .offset(x: g.size.width * min(1, max(0, bar)) - 1.5)
      }
    }
    .accessibilityElement()
    .accessibilityLabel(score.map { String(format: "Score %.2f, bar %.2f", $0, bar) } ?? String(format: "Bar %.2f", bar))
  }
}

/// Wraps chips onto several lines.
struct FlowChips<Content: View>: View {
  @ViewBuilder let content: Content
  var body: some View {
    FlowLayout(spacing: 6) { content }
  }
}

struct FlowLayout: Layout {
  var spacing: CGFloat = 6

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxX: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width { x = 0; y += rowH + spacing; rowH = 0 }
      x += size.width + spacing
      maxX = max(maxX, x - spacing)
      rowH = max(rowH, size.height)
    }
    return CGSize(width: min(maxX, width), height: y + rowH)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
    for s in subviews {
      let size = s.sizeThatFits(.unspecified)
      if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
      s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
      x += size.width + spacing
      rowH = max(rowH, size.height)
    }
  }
}
