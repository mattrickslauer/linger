import SwiftUI
import VerifiedCore

/// v4.11 detail: a header (glyph + "n/m backed"), a red banner when cheating was detected, then one row per claim
/// with its own score ring (bar tick on the ring), its requirements (`✓ met` / `○ not met`) and the modules that can
/// still back it, with local previews (v4.5 math on that claim). The overall verdict sits in the card above.
struct ClaimsSection: View {
  @Environment(AppModel.self) private var app
  let model: MomentDetailModel

  var body: some View {
    let m = model.card
    VStack(alignment: .leading, spacing: 14) {
      GlyphHeader(icon: Glyph.claims, title: m.claimsFromServer || m.claims.isEmpty ? "Claims" : "Draft claims") {
        if !m.claimScores.isEmpty && m.claimsTotal > 0 {
          ClaimsBackedChip(backed: m.claimsBacked ?? backedCount(m), total: m.claimsTotal)
        } else if !m.claimsFromServer && !m.claims.isEmpty {
          InfoButton(title: "Draft claims",
                     text: m.local ? "Draft claims from the interview. The cloud sets the binding claims and plan after upload."
                       : "Draft claims from the interview. The cloud sets the binding claims and plan at submit.")
        }
      }
      if m.cheating { CheatingBanner(signals: m.cheatingSignals) }
      ForEach(m.claims) { c in
        ClaimRow(model: model, claim: c)
        if c.id != m.claims.last?.id { Divider() }
      }
      if m.claims.isEmpty {
        Label(m.status == "submitted" ? "Splitting the intention into claims…" : "No claims.",
              systemImage: m.status == "submitted" ? "hourglass" : "checklist")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
  }

  private func backedCount(_ card: MomentCardData) -> Int {
    guard let bar = card.bar?.value else { return 0 }
    return card.claims.filter { (card.claimScores[$0.id]?.p ?? 0) >= bar }.count
  }

  static func visible(_ m: MomentCardData) -> Bool { !m.claims.isEmpty || m.isV4 }
}

/// "2/2 claims backed" (detail header and feed card).
struct ClaimsBackedChip: View {
  let backed: Int
  let total: Int

  var body: some View {
    let all = backed >= total && total > 0
    Chip(text: "\(backed)/\(total) backed", systemImage: all ? "checkmark.circle.fill" : "circle.lefthalf.filled",
         color: all ? Theme.ok : Theme.warn)
      .accessibilityLabel("\(backed) of \(total) claims backed")
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
      HStack(alignment: .center, spacing: 10) {
        Image(systemName: claim.kind.icon).font(.subheadline.weight(.semibold))
          .foregroundStyle(backed ? Theme.ok : .secondary).frame(width: 22)
        VStack(alignment: .leading, spacing: 2) {
          Text(claim.text).font(.headline)
          if let score, !score.backedBy.isEmpty {
            Text(V4Words.backedBy(score.backedBy)).font(.caption).foregroundStyle(backed ? Theme.ok : .secondary)
          }
        }
        Spacer(minLength: 4)
        if let score {
          ScoreRing(p: score.p, bar: bar, size: 46, caption: nil)
        }
      }
      .accessibilityElement(children: .combine)
      if let v = m.videoReview?.claims[claim.id] {
        let verdict = v.verdict.verdict.replacingOccurrences(of: "_", with: " ")
        let conf = Int(((v.verdict.confidence ?? 0) * 100).rounded())
        VStack(alignment: .leading, spacing: 2) {
          Label("Video review: \(verdict) · \(conf)%" + (v.measured.map { " · counted \($0)" } ?? ""),
                systemImage: "film")
            .font(.caption.weight(.semibold))
            .foregroundStyle(V4.backs(v.verdict) ? Theme.ok : .secondary)
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
      ModuleOffers(model: model, claim: claim)
    }
  }

  private func state(_ r: Requirement, score: ClaimScoreInfo?) -> RequirementRow.Status {
    let m = model.card
    if let score, !score.met.isEmpty || !score.unmet.isEmpty { return score.met.contains(r.id) ? .met : .unmet }
    if !m.planMet.isEmpty || score != nil { return m.planMet.contains(r.id) ? .met : .unmet }
    return .plan
  }
}
