import SwiftUI
import VerifiedCore

/// Which ladder modules a Moment can run, from what its chain and intention hold (contract v3.6 `needs`).
/// The function re-checks everything; this only disables offers that would fail.
struct LadderNeeds {
  let card: MomentCardData
  let model: MomentDetailModel

  /// nil when met, else why not ("Needs …").
  func unmet(_ m: LadderCatalog.Module) -> String? {
    for need in m.needs {
      switch need {
      case "frames" where max(card.summary?.frameCount ?? 0, model.frames.count) == 0:
        return "Needs at least one proof frame"
      case "gps" where model.track.isEmpty:
        return "Needs GPS in the recording"
      case "witness_answered" where max(model.witnessAnswers, card.witnessAnswered) == 0:
        return "Needs an answered witness request"
      case "quantities" where card.structured?.quantities.isEmpty ?? true:
        return "Needs a number in the intention (use the interview)"
      case "video" where model.videos.isEmpty:
        return "Needs a video clip in the recording"
      case "video" where card.ownerUid != nil && card.platform != "ios":
        return "The clip is on the phone that recorded it"
      default: continue
      }
    }
    return nil
  }
}

/// Owner-only: spend free demo credits on verification modules (v3.6). Each module runs once, in the cloud; a pass
/// lifts the score `p + s(1 − p)`, a fail lowers it `p(1 − s)`, and credits are spent either way.
struct LadderSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let model: MomentDetailModel
  @State private var running: String?
  @State private var confirm: LadderCatalog.Module?
  @State private var result: LadderService.RunResult?
  @State private var error: String?
  /// Idempotency keys (`requestId`) kept across retries of the same module until the call gives a definite answer.
  @State private var requestIds: [String: String] = [:]

  private var card: MomentCardData { model.card }
  private var score: Double? { card.finalScore ?? card.baselineScore ?? card.score?.probability }
  private var ran: Set<String> { Set(card.ladder.map(\.module)) }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          header
          if let result { ResultBanner(result: result).transition(.scale.combined(with: .opacity)) }
          if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill")
              .font(.footnote).foregroundStyle(Theme.bad)
          }
          ForEach(LadderCatalog.shared.modules) { m in row(m) }
          Text("Modules that fail lower the score. Credits are spent either way.")
            .font(.footnote).foregroundStyle(.secondary)
          Text("Each module runs once, in the cloud (Gemini in Cloud Functions). The model only proposes; code applies the math, and the result is public on the post.")
            .font(.caption).foregroundStyle(.tertiary)
        }
        .padding(16)
        .animation(.snappy, value: result)
      }
      .background(Color(.systemGroupedBackground))
      .navigationTitle("Verification ladder")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
      .task { await app.credits.refresh() }
      .confirmationDialog(confirm.map { "Run \($0.title)?" } ?? "", isPresented: Binding(
        get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible, presenting: confirm) { m in
        Button("Spend \(m.cost) \(m.cost == 1 ? "credit" : "credits")") { run(m) }
        Button("Cancel", role: .cancel) {}
      } message: { m in
        if let p = score {
          Text(String(format: "If it passes → %.2f · if it fails → %.2f. Credits are spent either way.",
                      V3Math.step(p, strength: m.strength, passed: true), V3Math.step(p, strength: m.strength, passed: false)))
        }
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        if let p = score {
          Text(String(format: "score %.2f", p)).font(.title2.bold().monospacedDigit())
            .foregroundStyle(card.bar.map { p >= $0.value ? Theme.accent : Theme.bad } ?? .primary)
        }
        if let b = card.bar {
          Text(String(format: "· bar %.2f", b.value)).font(.title2.bold().monospacedDigit()).foregroundStyle(Theme.warn)
        }
        Spacer()
        creditsChip
      }
      if let b = card.bar { BarGauge(score: score, bar: b.value).frame(height: 10) }
      Text(card.status == "sealed" ? "Verified. A pass makes it stronger; a fail can drop it below the bar."
           : "Below the bar. Passing modules can lift it over and seal it.")
        .font(.footnote).foregroundStyle(.secondary)
    }
    .padding(14)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
  }

  @ViewBuilder private var creditsChip: some View {
    if let c = app.credits.credits {
      Chip(text: "\(c.balance) \(c.balance == 1 ? "credit" : "credits")", systemImage: "circle.hexagongrid.fill",
           color: Theme.accent)
        .accessibilityHint("Free demo credits")
    } else if app.credits.loading {
      ProgressView().controlSize(.small)
    }
  }

  private func row(_ m: LadderCatalog.Module) -> some View {
    let done = card.ladder.first { $0.module == m.id }
    let unmet = LadderNeeds(card: card, model: model).unmet(m)
    let balance = app.credits.credits?.balance
    let broke = balance.map { $0 < m.cost } ?? false
    let disabled = done != nil || !m.available || unmet != nil || running != nil || broke || score == nil
    return VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 3) {
          Text(m.title).font(.headline)
          Text(m.blurb).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 8)
        Text("\(m.cost)").font(.headline.monospacedDigit())
          .frame(minWidth: 30, minHeight: 30)
          .background(Theme.accent.opacity(0.12), in: Circle())
          .foregroundStyle(Theme.accent)
          .accessibilityLabel("\(m.cost) credits")
      }
      if let done {
        LadderEntryRow(entry: done)
      } else if !m.available {
        Chip(text: "Coming soon", systemImage: "clock")
      } else {
        if let p = score {
          Text(String(format: "if it passes → %.2f · if it fails → %.2f",
                      V3Math.step(p, strength: m.strength, passed: true), V3Math.step(p, strength: m.strength, passed: false)))
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        HStack {
          if let unmet {
            Label(unmet, systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
          } else if broke {
            Label("Not enough credits", systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary)
          }
          Spacer()
          if running == m.id {
            HStack(spacing: 6) {
              ProgressView().controlSize(.small)
              Text(m.id == "full_video" ? "Uploading the clip, then reviewing…" : "Running in the cloud…").font(.caption)
            }
          } else {
            Button { confirm = m } label: {
              Label("Run", systemImage: "play.fill").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.borderedProminent).controlSize(.small).tint(Theme.accent)
            .disabled(disabled)
          }
        }
      }
    }
    .padding(14)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
    .opacity(!m.available ? 0.6 : 1)
  }

  private func run(_ m: LadderCatalog.Module) {
    let id = card.id
    app.requireSignIn("run a verification module") { _ in
      let requestId = requestIds[m.id] ?? UUID().uuidString.lowercased()
      requestIds[m.id] = requestId
      running = m.id
      error = nil
      result = nil
      Task {
        defer { running = nil }
        do {
          let clipSha = m.id == "full_video" ? try await ClipUpload.prepare(momentId: id, videos: model.videos) : nil
          let r = try await LadderService.run(momentId: id, module: m.id, requestId: requestId, clipSha: clipSha)
          requestIds[m.id] = nil
          app.credits.set(balance: r.balance)
          result = r
        } catch let f as LadderService.Failure {
          if !f.reason.isEmpty { requestIds[m.id] = nil }  // a definite answer: a retry is a new request
          error = f.localizedDescription
          await app.credits.refresh()
        } catch {
          self.error = error.localizedDescription
        }
      }
    }
  }
}

/// The run that just finished: pass/fail, before → after, the model's reasons and anything it measured.
private struct ResultBanner: View {
  let result: LadderService.RunResult

  var body: some View {
    let color = result.passed ? Theme.accent : Theme.bad
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Image(systemName: result.passed ? "checkmark.seal.fill" : "xmark.seal.fill").font(.title2)
        VStack(alignment: .leading, spacing: 0) {
          Text(result.passed ? "Passed" : "Didn't pass").font(.headline)
          Text(String(format: "%.2f → %.2f · bar %.2f", result.before, result.after, result.bar))
            .font(.subheadline.monospacedDigit())
        }
        Spacer()
        Text(result.verified ? "Verified ✓" : "Below the bar").font(.subheadline.weight(.bold))
      }
      .foregroundStyle(color)
      ForEach(result.reasons.prefix(4), id: \.self) { Text("• \($0)").font(.footnote) }
      if !result.measured.isEmpty {
        FlowChips {
          ForEach(result.measured, id: \.self) { m in
            Chip(text: "\(m.metric): \(formatValue(m.value)) \(m.unit)", systemImage: "ruler", color: Theme.accent)
          }
        }
      }
    }
    .padding(14)
    .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
  }
}

/// One public ladder result (detail screen and the ladder sheet).
struct LadderEntryRow: View {
  let entry: LadderEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Image(systemName: entry.passed ? "checkmark.circle.fill" : "xmark.circle.fill")
          .foregroundStyle(entry.passed ? Theme.accent : Theme.bad)
        Text(entry.title).font(.subheadline.weight(.semibold))
        Spacer()
        Text(String(format: "%.2f → %.2f", entry.before, entry.after))
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(entry.after >= entry.before ? Theme.accent : Theme.bad)
      }
      ForEach(entry.reasons.prefix(3), id: \.self) {
        Text($0).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      if !entry.measured.isEmpty {
        FlowChips {
          ForEach(entry.measured, id: \.metric) { m in
            Chip(text: "\(m.metric): \(formatValue(m.value)) \(m.unit)", systemImage: "ruler", color: Theme.accent)
          }
        }
      }
    }
  }
}

/// The detail screen's "Verification ladder" section: public results, and the owner's way in.
struct LadderSection: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel
  @State private var showing = false

  var body: some View {
    let m = model.card
    let owner = m.ownerUid != nil && m.ownerUid == app.auth.user?.uid
    VStack(alignment: .leading, spacing: 12) {
      if m.ladder.isEmpty {
        Text("No extra checks yet.").font(.footnote).foregroundStyle(.secondary)
      }
      ForEach(m.ladder) { e in LadderEntryRow(entry: e) }
      if owner && m.ladderEligible {
        Button { showing = true } label: {
          Label(m.ladder.isEmpty ? "Raise the score" : "More checks", systemImage: "chart.line.uptrend.xyaxis")
            .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(Theme.accent)
        Text("Free demo credits. Modules that fail lower the score.").font(.caption2).foregroundStyle(.tertiary)
      } else if owner, (m.status == "sealed" || m.status == "rejected"), (m.sealVersion ?? 0) >= 3 {
        Text("The ladder is closed for this Moment: an integrity check failed.").font(.caption).foregroundStyle(.secondary)
      }
    }
    .sheet(isPresented: $showing) { LadderSheet(model: model).presentationDetents([.large]) }
  }

  /// Show the section when there is something to show or to do.
  static func visible(_ m: MomentCardData, uid: String?) -> Bool {
    !m.ladder.isEmpty || (m.ownerUid != nil && m.ownerUid == uid && m.ladderEligible)
  }
}

func formatValue(_ v: Double) -> String {
  v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}
