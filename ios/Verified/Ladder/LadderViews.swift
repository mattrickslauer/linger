import SwiftUI
import VerifiedCore

/// Which ladder modules a Moment can run, from what its chain and intention hold (contract v3.6 `needs`, v4.6
/// `backs`). The function re-checks everything; this only disables offers that would fail.
struct LadderNeeds {
  let card: MomentCardData
  let model: MomentDetailModel

  /// v4: the claims this module would move (kind in `backs`; witness_review only the targeted ones).
  func backedClaims(_ m: LadderCatalog.Module) -> [Claim] {
    let ids = V4.claimsBacked(byModule: m.backKinds, targetedOnly: m.backsTargetedOnly ?? false, claims: card.claims,
                              requirements: card.plan?.requirements ?? [], witness: model.witnessFacts)
    return card.claims.filter { ids.contains($0.id) }
  }

  /// nil when met, else why not ("Needs …").
  func unmet(_ m: LadderCatalog.Module) -> String? {
    if card.isV4 {
      for need in m.needs {
        switch need {
        case "frames" where max(card.summary?.frameCount ?? 0, model.frames.count) == 0:
          return "Needs at least one proof frame"
        case "gps" where model.track.isEmpty:
          return "Needs GPS in the recording"
        case "witness_answered" where max(model.witnessAnswers, card.witnessAnswered) == 0:
          return "Needs an answered witness request"
        case "quantities" where !card.claims.contains(where: { $0.kind.hasQuantity }):
          return "Needs a count or measure claim"
        case "video" where model.videos.isEmpty:
          return "Needs a video clip in the recording"
        case "video" where card.videoReview?.status == "expired":
          return "The clip never arrived"
        default: continue
        }
      }
      return backedClaims(m).isEmpty ? "Backs none of this Moment's claims" : nil
    }
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

  /// The Moment score if this module passes / fails: v3 moves the one score; v4 moves only the claims it backs
  /// (score = min over claims, v4.5).
  private func preview(_ m: LadderCatalog.Module) -> (pass: Double, fail: Double)? {
    guard let p = score else { return nil }
    guard card.isV4, !card.claimScores.isEmpty else { return V4.preview(claimP: p, strength: m.strength) }
    let backed = Set(LadderNeeds(card: card, model: model).backedClaims(m).map(\.id))
    func total(_ passed: Bool) -> Double {
      card.claims.compactMap { c -> Double? in
        guard let cp = card.claimScores[c.id]?.p else { return nil }
        return backed.contains(c.id) ? V3Math.step(cp, strength: m.strength, passed: passed) : cp
      }.min() ?? p
    }
    return (total(true), total(false))
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          header
          if let result {
            ResultBanner(result: result, claims: card.claims).transition(.scale.combined(with: .opacity))
          }
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
        if let pv = preview(m) {
          Text(String(format: "If it passes → %.2f · if it fails → %.2f. Credits are spent either way.", pv.pass, pv.fail))
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
        LadderEntryRow(entry: done, claims: card.claims)
      } else if !m.available {
        Chip(text: "Coming soon", systemImage: "clock")
      } else {
        if card.isV4 {
          let backed = LadderNeeds(card: card, model: model).backedClaims(m)
          if !backed.isEmpty {
            FlowChips { ForEach(backed) { ClaimChip(claim: $0, tint: .purple) } }
          }
        }
        if let pv = preview(m) {
          Text(String(format: "if it passes → %.2f · if it fails → %.2f", pv.pass, pv.fail))
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
              Text(m.id == "full_video" && !card.isV4 ? "Uploading the clip, then reviewing…" : "Running in the cloud…")
                .font(.caption)
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
          // v4: the clip was uploaded at submit; v3 Moments upload it now.
          let clipSha: String? = m.id != "full_video" ? nil
            : card.isV4 ? model.videos.last?.sha256
            : try await ClipUpload.prepare(momentId: id, videos: model.videos)
          let r = try await LadderService.run(momentId: id, module: m.id, requestId: requestId, clipSha: clipSha)
          requestIds[m.id] = nil
          app.credits.set(balance: r.balance)
          result = r
        } catch let f as LadderService.Failure {
          // A definite answer: a retry is a new request. `in_progress` is not definite (the same run is still
          // going), so keep the key and the retry picks up that run's result.
          if !f.reason.isEmpty && f.reason != "in_progress" { requestIds[m.id] = nil }
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
  var claims: [Claim] = []

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
      if !result.claims.isEmpty { ClaimOutcomeList(outcomes: result.claims, claims: claims) }
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

/// v4: per claim, how a module moved it: "✓ 50 claps 0.40 → 0.58".
struct ClaimOutcomeList: View {
  let outcomes: [LadderEntry.ClaimOutcome]
  let claims: [Claim]

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      ForEach(outcomes) { o in
        HStack(spacing: 6) {
          Image(systemName: o.passed ? "checkmark.circle.fill" : "xmark.circle")
            .foregroundStyle(o.passed ? Theme.accent : Theme.bad)
          Text(claims.first { $0.id == o.id }?.text ?? o.id).lineLimit(1)
          if o.verdict == "missing" { Text("no verdict").foregroundStyle(.secondary) }
          Spacer(minLength: 4)
          Text(String(format: "%.2f → %.2f", o.before, o.after)).monospacedDigit()
            .foregroundStyle(o.after >= o.before ? Theme.accent : Theme.bad)
        }
        .font(.caption.weight(.medium))
      }
    }
  }
}

/// One public ladder result (detail screen and the ladder sheet).
struct LadderEntryRow: View {
  let entry: LadderEntry
  var claims: [Claim] = []

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
      if !entry.claims.isEmpty { ClaimOutcomeList(outcomes: entry.claims, claims: claims) }
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
      ForEach(m.ladder) { e in LadderEntryRow(entry: e, claims: m.claims) }
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

/// v4.11 detail: under a claim, the modules that can still back it, with what its score would become
/// ("Count & measure · if it passes → 0.58 · if it fails → 0.28"). Owner only, ladder-eligible v4 Moments.
struct ModuleOffers: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel
  let claim: Claim
  @State private var showing = false

  var body: some View {
    let m = model.card
    let owner = m.ownerUid != nil && m.ownerUid == app.auth.user?.uid
    let needs = LadderNeeds(card: m, model: model)
    let ran = Set(m.ladder.map(\.module))
    let offers = LadderCatalog.shared.modules.filter { mod in
      mod.available && !ran.contains(mod.id) && needs.unmet(mod) == nil
        && needs.backedClaims(mod).contains { $0.id == claim.id }
    }
    if owner && m.isV4 && m.ladderEligible, let p = m.claimScores[claim.id]?.p, !offers.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(offers) { mod in
          let pv = V4.preview(claimP: p, strength: mod.strength)
          Button { showing = true } label: {
            HStack(spacing: 8) {
              Image(systemName: "chart.line.uptrend.xyaxis").font(.caption).foregroundStyle(.purple)
              VStack(alignment: .leading, spacing: 1) {
                Text(mod.title).font(.caption.weight(.semibold)).foregroundStyle(.primary)
                Text(String(format: "if it passes → %.2f · if it fails → %.2f", pv.pass, pv.fail))
                  .font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
              }
              Spacer(minLength: 4)
              Text("\(mod.cost)").font(.caption.weight(.bold).monospacedDigit())
                .frame(minWidth: 22, minHeight: 22)
                .background(Color.purple.opacity(0.12), in: Circle()).foregroundStyle(.purple)
                .accessibilityLabel("\(mod.cost) credits")
            }
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.purple.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(.leading, 26)
      .sheet(isPresented: $showing) { LadderSheet(model: model).presentationDetents([.large]) }
    }
  }
}

func formatValue(_ v: Double) -> String {
  v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}
