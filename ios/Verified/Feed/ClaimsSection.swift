import SwiftUI
import VerifiedCore

/// v4.11 detail: the overall verdict on top ("Verified ✓" / "Not verified", "score 0.52 · bar 0.52",
/// "2/2 claims backed"), a red banner when cheating was detected, then one row per claim with its requirements
/// (`✓ met` / `○ not met`) and the modules that can still back it, with local previews (v4.5 math on that claim).
struct ClaimsSection: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel

  var body: some View {
    let m = model.card
    VStack(alignment: .leading, spacing: 14) {
      ClaimsVerdictHeader(card: m)
      if m.cheating { CheatingBanner(signals: m.cheatingSignals) }
      ForEach(m.claims) { c in
        ClaimRow(model: model, claim: c)
        if c.id != m.claims.last?.id { Divider() }
      }
      if m.claims.isEmpty {
        Text(m.status == "submitted" ? "The cloud is splitting the intention into claims…" : "No claims.")
          .font(.footnote).foregroundStyle(.secondary)
      } else if !m.claimsFromServer {
        Text(m.local ? "Draft claims from the interview. The cloud sets the binding claims and plan after upload."
             : "Draft claims from the interview. The cloud sets the binding claims and plan at submit.")
          .font(.caption2).foregroundStyle(.tertiary)
      }
    }
  }

  static func visible(_ m: MomentCardData) -> Bool { !m.claims.isEmpty || m.isV4 }
}

/// "Verified ✓ · score 0.52 · bar 0.52 · 2/2 claims backed"
struct ClaimsVerdictHeader: View {
  let card: MomentCardData

  var body: some View {
    let scored = !card.claimScores.isEmpty
    let sealedOrRejected = card.status == "sealed" || card.status == "rejected"
    let backed = card.claimsBacked ?? backedCount
    HStack(alignment: .center, spacing: 12) {
      Image(systemName: card.isVerified ? "checkmark.seal.fill" : sealedOrRejected ? "xmark.seal.fill" : "hourglass")
        .font(.system(size: 30, weight: .semibold))
        .foregroundStyle(card.isVerified ? Theme.accent : sealedOrRejected ? Theme.bad : .secondary)
        .symbolEffect(.bounce, value: card.isVerified)
      VStack(alignment: .leading, spacing: 2) {
        Text(card.isVerified ? "Verified ✓" : sealedOrRejected ? "Not verified" : "Not sealed yet")
          .font(.title3.bold())
          .foregroundStyle(card.isVerified ? Theme.accent : sealedOrRejected ? Theme.bad : .primary)
        if let score = card.finalScore, let bar = card.bar?.value, scored {
          Text("score \(V4Words.p(score)) · bar \(V4Words.p(bar))").font(.subheadline.monospacedDigit())
            .foregroundStyle(.secondary)
        } else if let bar = card.bar?.value {
          Text("bar \(V4Words.p(bar))").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      if scored && card.claimsTotal > 0 {
        ClaimsBackedChip(backed: backed, total: card.claimsTotal)
      }
    }
  }

  private var backedCount: Int {
    guard let bar = card.bar?.value else { return 0 }
    return card.claims.filter { (card.claimScores[$0.id]?.p ?? 0) >= bar }.count
  }
}

/// "2/2 claims backed" (detail header and feed card).
struct ClaimsBackedChip: View {
  let backed: Int
  let total: Int

  var body: some View {
    let all = backed >= total && total > 0
    Chip(text: "\(backed)/\(total) claims backed", systemImage: all ? "checkmark.circle.fill" : "circle.lefthalf.filled",
         color: all ? Theme.accent : Theme.warn)
  }
}

struct CheatingBanner: View {
  let signals: [String]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("Cheating detected", systemImage: "exclamationmark.octagon.fill").font(.headline)
      ForEach(signals, id: \.self) { s in
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text("•")
          Text(s).fixedSize(horizontal: false, vertical: true)
        }
        .font(.footnote)
      }
    }
    .foregroundStyle(.white)
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.bad, in: RoundedRectangle(cornerRadius: 14))
  }
}

/// One claim: `clapping ✓ backed by video review` or `50 claps · 0.40 / bar 0.52`, its requirements and the
/// modules that can still back it.
struct ClaimRow: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel
  let claim: Claim

  var body: some View {
    let m = model.card
    let score = m.claimScores[claim.id]
    let bar = m.bar?.value
    let backed = score.map { s in bar.map { s.p >= $0 } ?? false } ?? false
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Image(systemName: claim.kind.icon).font(.footnote.weight(.semibold))
          .foregroundStyle(backed ? Theme.accent : .secondary).frame(width: 18)
        Text(claim.text).font(.headline)
        if backed { Text("✓").font(.headline).foregroundStyle(Theme.accent) }
        Spacer(minLength: 4)
        if let score, let bar, !backed {
          Text("\(V4Words.p(score.p)) / bar \(V4Words.p(bar))").font(.subheadline.monospacedDigit().weight(.semibold))
            .foregroundStyle(Theme.bad)
        } else if let score, backed {
          Text(V4Words.p(score.p)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.accent)
        }
      }
      if let score, backed, !score.backedBy.isEmpty {
        Text(V4Words.backedBy(score.backedBy)).font(.footnote).foregroundStyle(Theme.accent)
      } else if let score, !score.backedBy.isEmpty {
        Text(V4Words.backedBy(score.backedBy)).font(.footnote).foregroundStyle(.secondary)
      }
      if let score, let bar {
        BarGauge(score: score.p, bar: bar).frame(height: 6)
      }
      if let v = m.videoReview?.claims[claim.id] {
        let verdict = v.verdict.verdict.replacingOccurrences(of: "_", with: " ")
        let conf = Int(((v.verdict.confidence ?? 0) * 100).rounded())
        VStack(alignment: .leading, spacing: 2) {
          Label("Video review: \(verdict) · \(conf)%" + (v.measured.map { " · counted \($0)" } ?? ""),
                systemImage: "film")
            .font(.caption.weight(.semibold))
            .foregroundStyle(V4.backs(v.verdict) ? Theme.accent : .secondary)
          ForEach(v.reasons.prefix(2), id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
        }
      }
      let reqs = m.plan?.requirements(for: claim.id) ?? []
      if !reqs.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          ForEach(reqs) { r in RequirementRow(requirement: r, state: state(r, score: score), compact: true) }
        }
        .padding(.leading, 26)
      } else if m.claimsFromServer {
        Text("No evidence plan for this claim: it can't reach the bar for free.")
          .font(.caption).foregroundStyle(.secondary).padding(.leading, 26)
      }
    }
  }

  private func state(_ r: Requirement, score: ClaimScoreInfo?) -> RequirementRow.Status {
    let m = model.card
    if let score, !score.met.isEmpty || !score.unmet.isEmpty { return score.met.contains(r.id) ? .met : .unmet }
    if !m.planMet.isEmpty || score != nil { return m.planMet.contains(r.id) ? .met : .unmet }
    return .plan
  }
}
