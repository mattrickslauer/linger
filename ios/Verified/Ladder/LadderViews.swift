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

  @Environment(\.dynamicTypeSize) private var typeSize

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
          let columns = typeSize.isAccessibilitySize
            ? [GridItem(.flexible())]
            : [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
          LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            ForEach(LadderCatalog.shared.modules) { m in tile(m) }
          }
        }
        .padding(16)
        .animation(.snappy, value: result)
      }
      .background(Theme.paper)
      .navigationTitle("Ladder")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
      .task { await app.credits.refresh() }
      .sensoryFeedback(trigger: result) { _, new in
        guard let new else { return nil }
        return new.passed ? .success : .error
      }
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
    HStack(alignment: .center, spacing: 16) {
      ScoreRing(p: score, bar: card.bar?.value, pending: score == nil, size: 84)
      VStack(alignment: .leading, spacing: 8) {
        creditsChip
        Label(card.status == "sealed" ? "Verified" : "Below the bar",
              systemImage: card.status == "sealed" ? "checkmark.seal.fill" : "arrow.up.forward")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(card.status == "sealed" ? Theme.ok : Theme.ink2)
      }
      Spacer(minLength: 0)
      InfoButton(title: "Verification ladder",
                 text: (card.status == "sealed" ? "Verified. A pass makes it stronger; a fail can drop it below the bar."
                        : "Below the bar. Passing modules can lift it over and seal it.")
                   + "\n\nModules that fail lower the score. Credits are spent either way. Each module runs once, in the cloud (Gemini in Cloud Functions). The model only proposes; code applies the math, and the result is public on the post.")
    }
    .surfaceCard(radius: 22)
  }

  @ViewBuilder private var creditsChip: some View {
    if let c = app.credits.credits {
      Label("\(c.balance)", systemImage: Glyph.credits)
        .font(.headline.monospacedDigit())
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(Color(hex: 0x10242B))
        .background(Theme.gold, in: Capsule())
        .accessibilityLabel("\(c.balance) free demo \(c.balance == 1 ? "credit" : "credits")")
    } else if app.credits.loading {
      ProgressView().controlSize(.small)
    }
  }

  /// One module: glyph, title, cost coin, the pass/fail preview on one track, and Run (or why not).
  private func tile(_ m: LadderCatalog.Module) -> some View {
    let done = card.ladder.first { $0.module == m.id }
    let unmet = LadderNeeds(card: card, model: model).unmet(m)
    let balance = app.credits.credits?.balance
    let broke = balance.map { $0 < m.cost } ?? false
    let disabled = done != nil || !m.available || unmet != nil || running != nil || broke || score == nil
    return VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 6) {
        Image(systemName: LadderGlyph.icon(m.id)).font(.title3.weight(.semibold)).foregroundStyle(Theme.lake)
          .frame(height: 28)
        Spacer(minLength: 0)
        InfoButton(title: m.title, text: m.blurb).padding(.vertical, -8).padding(.trailing, -10)
        CostCoin(cost: m.cost)
      }
      Text(m.title).font(.subheadline.weight(.bold)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
      if let done {
        LadderEntryRow(entry: done, claims: card.claims, compact: true)
      } else if !m.available {
        Chip(text: "Coming soon", systemImage: "clock")
      } else {
        if card.isV4 {
          let backed = LadderNeeds(card: card, model: model).backedClaims(m)
          if !backed.isEmpty {
            HStack(spacing: 4) {
              ForEach(backed) { c in
                Image(systemName: c.kind.icon).font(.caption2.weight(.bold))
                  .frame(width: 22, height: 22)
                  .background(Theme.lake.opacity(0.14), in: Circle())
                  .foregroundStyle(Theme.lake)
              }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Backs " + backed.map(\.text).joined(separator: ", "))
          }
        }
        if let pv = preview(m), let p = score {
          LadderPreviewBar(current: p, pass: pv.pass, fail: pv.fail, bar: card.bar?.value)
        }
        Spacer(minLength: 0)
        if running == m.id {
          HStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text(m.id == "full_video" && !card.isV4 ? "Uploading…" : "Running…").font(.caption)
          }
          .frame(minHeight: 44)
        } else if let why = unmet ?? (broke ? "Not enough credits" : nil) {
          Label(why, systemImage: "lock.fill").font(.caption).foregroundStyle(.secondary).lineLimit(2)
        } else {
          Button { confirm = m } label: {
            Label("Run", systemImage: "play.fill").font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent).tint(Theme.lake)
          .disabled(disabled)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(12)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
    let color = result.passed ? Theme.ok : Theme.bad
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 12) {
        Image(systemName: result.passed ? "checkmark.seal.fill" : "xmark.seal.fill").font(.largeTitle)
          .foregroundStyle(color)
        VStack(alignment: .leading, spacing: 2) {
          Text(result.passed ? "Passed" : "Didn't pass").font(.headline).foregroundStyle(color)
          Label(String(format: "%.2f → %.2f", result.before, result.after),
                systemImage: result.after >= result.before ? "arrow.up.right" : "arrow.down.right")
            .font(.subheadline.weight(.semibold).monospacedDigit())
        }
        Spacer()
        ScoreRing(p: result.after, bar: result.bar, size: 56, caption: nil)
      }
      .accessibilityElement(children: .combine)
      ForEach(result.reasons.prefix(4), id: \.self) { r in
        Label { Text(r) } icon: { Image(systemName: "circle.fill").font(.system(size: 5)) }.font(.footnote)
      }
      if !result.claims.isEmpty { ClaimOutcomeList(outcomes: result.claims, claims: claims) }
      if !result.measured.isEmpty {
        FlowChips {
          ForEach(result.measured, id: \.self) { m in
            Chip(text: "\(m.metric): \(formatValue(m.value)) \(m.unit)", systemImage: "ruler", color: Theme.lake)
          }
        }
      }
    }
    .padding(14)
    .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
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
            .foregroundStyle(o.passed ? Theme.ok : Theme.bad)
          Text(claims.first { $0.id == o.id }?.text ?? o.id).lineLimit(1)
          if o.verdict == "missing" { Text("no verdict").foregroundStyle(.secondary) }
          Spacer(minLength: 4)
          Text(String(format: "%.2f → %.2f", o.before, o.after)).monospacedDigit()
            .foregroundStyle(o.after >= o.before ? Theme.ok : Theme.bad)
        }
        .font(.caption.weight(.medium))
      }
    }
  }
}

/// One public ladder result (detail screen and the ladder sheet). `compact`: glyph + numbers only (module tiles).
struct LadderEntryRow: View {
  let entry: LadderEntry
  var claims: [Claim] = []
  var compact = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Image(systemName: entry.passed ? "checkmark.circle.fill" : "xmark.circle.fill")
          .foregroundStyle(entry.passed ? Theme.ok : Theme.bad)
        if !compact {
          Image(systemName: LadderGlyph.icon(entry.module)).foregroundStyle(Theme.lake)
          Text(entry.title).font(.subheadline.weight(.semibold))
        } else {
          Text(entry.passed ? "Passed" : "Failed").font(.subheadline.weight(.semibold))
        }
        Spacer(minLength: 4)
        Text(String(format: "%.2f → %.2f", entry.before, entry.after))
          .font(.subheadline.monospacedDigit())
          .foregroundStyle(entry.after >= entry.before ? Theme.ok : Theme.bad)
      }
      .accessibilityElement(children: .combine)
      if !compact {
        if !entry.claims.isEmpty { ClaimOutcomeList(outcomes: entry.claims, claims: claims) }
        ForEach(entry.reasons.prefix(3), id: \.self) {
          Text($0).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        if !entry.measured.isEmpty {
          FlowChips {
            ForEach(entry.measured, id: \.metric) { m in
              Chip(text: "\(m.metric): \(formatValue(m.value)) \(m.unit)", systemImage: "ruler", color: Theme.lake)
            }
          }
        }
      }
    }
  }
}

/// The detail screen's ladder section: public results, and the owner's way in.
struct LadderSection: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel
  @State private var showing = false

  var body: some View {
    let m = model.card
    let owner = m.ownerUid != nil && m.ownerUid == app.auth.user?.uid
    VStack(alignment: .leading, spacing: 12) {
      if m.ladder.isEmpty {
        Label("No extra checks yet", systemImage: Glyph.ladder).font(.footnote).foregroundStyle(.secondary)
      }
      ForEach(m.ladder) { e in
        LadderEntryRow(entry: e, claims: m.claims)
        if e.id != m.ladder.last?.id { Divider() }
      }
      if owner && m.ladderEligible {
        Button { showing = true } label: {
          Label(m.ladder.isEmpty ? "Raise the score" : "More checks", systemImage: Glyph.ladder)
            .font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(Theme.lake).controlSize(.large)
        Label("Free demo credits · fails lower the score", systemImage: Glyph.credits)
          .font(.caption2).foregroundStyle(.secondary)
      } else if owner, (m.status == "sealed" || m.status == "rejected"), (m.sealVersion ?? 0) >= 3 {
        Label("Ladder closed: an integrity check failed", systemImage: "lock.fill")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .sheet(isPresented: $showing) { LadderSheet(model: model).presentationDetents([.large]) }
  }

  /// Show the section when there is something to show or to do.
  static func visible(_ m: MomentCardData, uid: String?) -> Bool {
    !m.ladder.isEmpty || (m.ownerUid != nil && m.ownerUid == uid && m.ladderEligible)
  }
}

/// v4.11 detail: under a claim, the modules that can still back it, with what its score would become as a preview
/// bar. Owner only, ladder-eligible v4 Moments.
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
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
          ForEach(offers) { mod in
            let pv = V4.preview(claimP: p, strength: mod.strength)
            Button { showing = true } label: {
              VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                  Image(systemName: LadderGlyph.icon(mod.id)).font(.caption.weight(.bold)).foregroundStyle(Theme.lake)
                  Text(mod.title).font(.caption.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                  Spacer(minLength: 4)
                  CostCoin(cost: mod.cost, small: true)
                }
                LadderPreviewBar(current: p, pass: pv.pass, fail: pv.fail, bar: m.bar?.value)
              }
              .frame(width: 200)
              .padding(10)
              .background(Theme.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
          }
        }
      }
      .scrollClipDisabled()
      .padding(.leading, 26)
      .sheet(isPresented: $showing) { LadderSheet(model: model).presentationDetents([.large]) }
    }
  }
}

/// SF Symbol per ladder module.
enum LadderGlyph {
  static func icon(_ id: String) -> String {
    switch id {
    case "second_look": "sparkle.magnifyingglass"
    case "place_time": "mappin.and.ellipse"
    case "witness_review": "eye"
    case "count_measure": "ruler"
    case "full_video": "film"
    default: Glyph.ladder
    }
  }
}

/// The credit cost as a gold coin.
struct CostCoin: View {
  let cost: Int
  var small = false

  var body: some View {
    HStack(spacing: 2) {
      Image(systemName: "bolt.fill").font(.system(size: small ? 8 : 10, weight: .heavy))
      Text("\(cost)").font((small ? Font.caption2 : .caption).weight(.heavy).monospacedDigit())
    }
    .foregroundStyle(Color(hex: 0x10242B))
    .padding(.horizontal, small ? 6 : 8).padding(.vertical, small ? 2 : 4)
    .background(Theme.gold, in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(cost) \(cost == 1 ? "credit" : "credits")")
  }
}

/// Ladder preview on one track: where the score is, where a pass takes it (green, up), where a fail takes it (red,
/// down), and the bar tick. "0.62 → 0.79 ↑ / 0.50 ↓" without the sentence.
struct LadderPreviewBar: View {
  let current: Double
  let pass: Double
  let fail: Double
  var bar: Double?

  var body: some View {
    VStack(spacing: 4) {
      GeometryReader { g in
        let w = g.size.width
        let x = { (v: Double) in w * CGFloat(min(1, max(0, v))) }
        ZStack(alignment: .leading) {
          Capsule().fill(Color.primary.opacity(0.12)).frame(height: 6)
          Capsule().fill(Theme.bad.opacity(0.7)).frame(width: max(2, x(current) - x(fail)), height: 6).offset(x: x(fail))
          Capsule().fill(Theme.ok).frame(width: max(2, x(pass) - x(current)), height: 6).offset(x: x(current))
          if let bar {
            Capsule().fill(Theme.warn).frame(width: 3, height: 14).offset(x: x(bar) - 1.5)
          }
          Circle().fill(Color.primary).frame(width: 10, height: 10).offset(x: x(current) - 5)
        }
        .frame(height: 14)
      }
      .frame(height: 14)
      HStack {
        Label(String(format: "%.2f", fail), systemImage: "arrow.down").foregroundStyle(Theme.bad)
        Spacer(minLength: 2)
        Text(String(format: "%.2f", current)).foregroundStyle(.secondary)
        Spacer(minLength: 2)
        Label(String(format: "%.2f", pass), systemImage: "arrow.up").foregroundStyle(Theme.ok)
      }
      .font(.caption2.weight(.bold).monospacedDigit())
      .labelStyle(TrailingIconLabelStyle())
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(String(format: "Now %.2f. If it passes %.2f, if it fails %.2f", current, pass, fail)
                        + (bar.map { String(format: ", bar %.2f", $0) } ?? ""))
  }
}

/// "0.79 ↑": the number first, then the arrow.
struct TrailingIconLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 2) {
      configuration.title
      configuration.icon
    }
  }
}

func formatValue(_ v: Double) -> String {
  v.rounded() == v ? String(Int(v)) : String(format: "%.1f", v)
}
