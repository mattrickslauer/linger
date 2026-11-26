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
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
      .stroke(Theme.lake.opacity(iv.active ? 0.6 : 0), lineWidth: 1.5))
    .animation(.snappy, value: iv.phase)
    .animation(.snappy, value: iv.lines)
  }

  // MARK: - Intro

  private var intro: some View {
    VStack(spacing: 12) {
      Button { app.interview.begin() } label: {
        ZStack {
          Circle().fill(Theme.lake.opacity(0.14)).frame(width: 112, height: 112)
          Image(systemName: "mic.fill")
            .font(.system(size: 34, weight: .semibold))
            .foregroundStyle(Theme.onFill)
            .frame(width: 84, height: 84)
            .background(Theme.lake, in: Circle())
            .shadow(color: Theme.lake.opacity(0.35), radius: 12, y: 5)
        }
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Talk it through")
      .accessibilityHint("Your witness asks a few questions and plans the evidence")
      Text("Talk it through").font(.title3.bold())
      Text("Say what you'll do. Your witness plans the proof.")
        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
      HStack(spacing: 6) {
        HybridBadge(onDevice: HybridAI.onDeviceAvailable,
                    text: HybridAI.onDeviceAvailable ? "questions on device" : "questions in cloud")
        HybridBadge(onDevice: false, text: "plan in cloud")
      }
      Button("Type instead", action: typeInstead)
        .font(.subheadline.weight(.semibold))
        .frame(minHeight: 44)
    }
    .frame(maxWidth: .infinity)
  }

  // MARK: - Conversation

  private func conversation(_ iv: InterviewModel) -> some View {
    @Bindable var iv = iv
    let voice = VoiceIO.shared
    return VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 4) {
        Label("Witness", systemImage: Glyph.witness).font(.headline)
        Spacer()
        Button { voice.muted.toggle() } label: {
          Image(systemName: voice.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
            .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .accessibilityLabel(voice.muted ? "Unmute voice" : "Mute voice")
        Button("Cancel") { iv.cancel() }.font(.subheadline).frame(minHeight: 44)
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
              .foregroundStyle(Theme.onFill)
              .frame(width: 56, height: 56)
              .background(voice.listening ? Theme.bad : Theme.lake, in: Circle())
              .symbolEffect(.pulse, options: .repeating, isActive: voice.listening)
          }
          .accessibilityLabel(voice.listening ? "Stop listening" : "Speak")
          TextField("Or type your answer", text: $iv.typed)
            .textFieldStyle(.plain)
            .padding(.horizontal, 12).padding(.vertical, 10)
            .frame(minHeight: 44)
            .background(Theme.raised, in: Capsule())
            .focused($answerFocused)
            .submitLabel(.send)
            .onSubmit { iv.submitTyped() }
          if !iv.typed.isEmpty {
            Button { iv.submitTyped() } label: {
              Image(systemName: "arrow.up.circle.fill").font(.title).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Send")
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
          .foregroundStyle(line.role == .me ? Theme.onFill : .primary)
          .padding(.horizontal, 12).padding(.vertical, 8)
          .background(line.role == .me ? AnyShapeStyle(Theme.lake.opacity(live ? 0.6 : 1)) : AnyShapeStyle(Theme.raised),
                      in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        if let mode = line.mode {
          Image(systemName: mode == "on_device" ? Glyph.onDevice : Glyph.cloud)
            .font(.caption2).foregroundStyle(.secondary)
            .accessibilityLabel(mode == "on_device" ? "on device" : "cloud")
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
          Label(result.activity.isEmpty ? result.category.label : result.activity.capitalized,
                systemImage: result.category.icon)
            .font(.caption.weight(.bold)).foregroundStyle(Theme.track)
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
          Image(systemName: "ellipsis.circle").font(.title3).frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .accessibilityLabel("Interview options")
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
              Chip(text: "\(q.label) · \(q.measuredBy)", systemImage: "ruler", color: Theme.lake)
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
          Label("AI assumed · tap to remove", systemImage: "lightbulb")
            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          FlowChips {
            ForEach(result.assumptions, id: \.self) { a in
              Button { iv.removeAssumption(a) } label: { Chip(text: a, systemImage: "xmark.circle.fill", color: Theme.warn) }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove assumption: \(a)")
            }
          }
        }
      }
      BarPreviewRow(preview: result.preview, recheck: { Task { await iv.previewBar() } })
      HStack(spacing: 6) {
        Chip(text: "\(result.turns) \(result.turns == 1 ? "answer" : "answers")", systemImage: "waveform")
        if result.mode == "typed" {
          Chip(text: modeLabel(result.mode), systemImage: "keyboard")
        } else {
          HybridBadge(onDevice: result.mode != "cloud", text: modeLabel(result.mode))
        }
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

/// "Bar ≈ 0.73 (preview)" as a ring with the bar tick: the score this Moment will likely have to reach. Binding bar:
/// set server-side at submit. The rationale sits behind the info button.
struct BarPreviewRow: View {
  let preview: StructuredIntention.Preview?
  let recheck: () -> Void

  var body: some View {
    HStack(spacing: 14) {
      if let p = preview {
        ScoreRing(p: nil, bar: p.bar, size: 64)
      } else {
        Image(systemName: Glyph.bar).font(.title2).foregroundStyle(.secondary)
          .frame(width: 64, height: 64)
          .background(Circle().stroke(Color.primary.opacity(0.14), lineWidth: 6))
          .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 6) {
        Label("Bar preview", systemImage: Glyph.bar).font(.subheadline.bold())
        if let p = preview {
          HybridBadge(onDevice: p.mode == "on_device")
        } else {
          Button("Retry", action: recheck).font(.subheadline.weight(.semibold)).frame(minHeight: 44)
        }
      }
      Spacer(minLength: 0)
      InfoButton(title: "Bar preview",
                 text: [preview?.rationale ?? "",
                        "The binding bar is set in the cloud when you submit. Harder or more tempting claims need more evidence."]
                   .filter { !$0.isEmpty }.joined(separator: "\n\n"))
    }
    .padding(12)
    .background(Theme.raised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .accessibilityElement(children: .contain)
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
          Capsule().fill(score >= bar ? Theme.ok : Theme.bad)
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
