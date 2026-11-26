import SwiftUI
import VerifiedCore

// v4 building blocks shared by the interview card, the record screen and the detail screen (docs/ARCHITECTURE.md
// v4.11 words: "To get this verified", "captured", "✓ met" / "○ not met", "backed by video review").

extension ClaimKind {
  var icon: String {
    switch self {
    case .action: "figure.wave"
    case .count: "number"
    case .measure: "ruler"
    case .place: "mappin.and.ellipse"
    case .time: "clock"
    case .object: "cube"
    case .outcome: "flag.checkered"
    }
  }
}

extension Evidence {
  var icon: String {
    switch self {
    case .video: "video.fill"
    case .frames: "camera.fill"
    case .gps: "location.fill"
    case .motion: "waveform.path.ecg"
    case .witness: "person.wave.2.fill"
    }
  }

  var label: String {
    switch self {
    case .video: "video"
    case .frames: "proof shots"
    case .gps: "GPS"
    case .motion: "motion"
    case .witness: "witness"
    }
  }
}

enum V4Words {
  /// Source labels for `backedBy` (v4.11).
  static func source(_ s: String) -> String {
    switch s {
    case "video_review": "video review"
    case "frames_judge": "proof shots"
    case "gps": "GPS"
    case "motion": "motion"
    case "witness": "witness"
    default: LadderCatalog.shared.module(s)?.title ?? s
    }
  }

  static func backedBy(_ sources: [String]) -> String {
    sources.isEmpty ? "" : "backed by " + sources.map(source).joined(separator: " + ")
  }

  /// "≥ 20 s"
  static func minSeconds(_ s: Double?) -> String? {
    guard let s, s > 0 else { return nil }
    return s >= 120 && s.truncatingRemainder(dividingBy: 60) == 0 ? "≥ \(Int(s / 60)) min" : "≥ \(Int(s.rounded())) s"
  }

  static func p(_ v: Double) -> String { String(format: "%.2f", v) }
}

/// "clapping" · "50 claps": one chip per claim. Tappable for removal on the interview card.
struct ClaimChip: View {
  let claim: Claim
  var removable = false
  var tint: Color = Theme.lake

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: claim.kind.icon).font(.caption2.weight(.bold))
      Text(claim.text).lineLimit(1)
      if removable { Image(systemName: "xmark").font(.system(size: 8, weight: .heavy)).opacity(0.6) }
    }
    .font(.subheadline.weight(.semibold))
    .padding(.horizontal, 10).padding(.vertical, 6)
    .foregroundStyle(tint)
    .background(tint.opacity(0.12), in: Capsule())
    .overlay(Capsule().stroke(tint.opacity(0.25), lineWidth: 0.5))
    .accessibilityLabel("\(claim.kind.rawValue) claim: \(claim.text)")
  }
}

/// One plan requirement row. `state`: nil = just the plan (interview), `.captured`/`.missing` on the record screen,
/// `.met`/`.unmet` once the server has scored it.
struct RequirementRow: View {
  enum Status { case plan, captured, missing, met, unmet }
  let requirement: Requirement
  var claim: Claim?
  var state: Status = .plan
  var compact = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      marker
      VStack(alignment: .leading, spacing: 2) {
        Text(requirement.ask.isEmpty ? requirement.evidence.label.capitalized : requirement.ask)
          .font(compact ? .footnote.weight(.medium) : .subheadline)
          .foregroundStyle(state == .captured || state == .met ? .secondary : .primary)
          .fixedSize(horizontal: false, vertical: true)
        if !compact {
          HStack(spacing: 6) {
            Label(requirement.evidence.label, systemImage: requirement.evidence.icon)
            if let m = V4Words.minSeconds(requirement.minSeconds) { Text(m).monospacedDigit() }
            if let claim { Text("· \(claim.text)").lineLimit(1) }
          }
          .font(.caption2).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      trailing
    }
    .animation(.snappy, value: state)
  }

  @ViewBuilder private var marker: some View {
    switch state {
    case .plan:
      Image(systemName: requirement.evidence.icon).font(.footnote).foregroundStyle(Theme.lake).frame(width: 18)
    case .captured, .met:
      Image(systemName: state == .met ? "checkmark.circle.fill" : "circle.inset.filled")
        .foregroundStyle(Theme.ok).frame(width: 18)
        .transition(.scale.combined(with: .opacity))
    case .missing, .unmet:
      Image(systemName: "circle").foregroundStyle(.secondary).frame(width: 18)
    }
  }

  @ViewBuilder private var trailing: some View {
    switch state {
    case .captured: Text("captured").font(.caption2.weight(.bold)).foregroundStyle(Theme.ok)
    case .met: Text("✓ met").font(.caption2.weight(.bold)).foregroundStyle(Theme.ok)
    case .unmet: Text("○ not met").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
    case .missing:
      if compact, let m = V4Words.minSeconds(requirement.minSeconds) {
        Text(m).font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
      }
    case .plan: EmptyView()
    }
  }
}

/// Interview end card (v4.11): claims as chips, then "To get this verified" with one row per requirement and the note.
struct PlanSummary: View {
  let claims: [Claim]
  let plan: EvidencePlan?
  var removeClaim: ((String) -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if !claims.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("Claims").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
          FlowChips {
            ForEach(claims) { c in
              if let removeClaim, claims.count > 1 {
                Button { removeClaim(c.id) } label: { ClaimChip(claim: c, removable: true) }.buttonStyle(.plain)
              } else {
                ClaimChip(claim: c)
              }
            }
          }
        }
      }
      if let plan, !plan.requirements.isEmpty {
        VStack(alignment: .leading, spacing: 10) {
          HStack(spacing: 6) {
            Label("To get this verified", systemImage: "checklist").font(.subheadline.bold())
            Spacer(minLength: 4)
            Chip(text: plan.isVideo ? "Video" : "Photo", systemImage: plan.isVideo ? "video.fill" : "camera.fill",
                 color: plan.isVideo ? Theme.track : Theme.lake)
            if !plan.note.isEmpty { InfoButton(title: "Evidence plan", text: plan.note).padding(.vertical, -10) }
          }
          ForEach(plan.requirements) { r in
            RequirementRow(requirement: r, claim: claims.first { $0.id == r.claimId })
          }
        }
        .padding(12)
        .background(Theme.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
    }
  }
}

/// v4.11 finish/sync words: "Uploading video · 34 MB" → "Video uploaded" → "Reviewing video" → sealed;
/// "Waiting for video upload"; "Video never arrived · sealed without it". Nothing for a Moment without video.
struct VideoStatusLine: View {
  let momentId: String
  var review: VideoReviewInfo?
  var status: String = "submitted"

  var body: some View {
    let upload = ClipUploader.shared.states[momentId]
    if let line = text(upload) {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          if busy(upload) { ProgressView().controlSize(.small) } else { Image(systemName: icon).foregroundStyle(color) }
          Text(line).font(.footnote.weight(.semibold)).foregroundStyle(busy(upload) ? .primary : color)
          Spacer(minLength: 0)
        }
        if let f = upload?.fraction { ProgressView(value: f).tint(Theme.lake) }
        if review?.status == "done", let s = review?.summary { Text(s).font(.caption).foregroundStyle(.secondary) }
      }
      .accessibilityElement(children: .combine)
    }
  }

  private func text(_ upload: ClipUploader.State?) -> String? {
    if let upload, case .uploading = upload { return upload.label }
    switch review?.status {
    case "waiting": return upload == .uploaded ? "Video uploaded" : "Waiting for video upload"
    case "running": return "Reviewing video"
    case "done": return "Video reviewed"
    case "expired": return "Video never arrived · sealed without it"
    case "failed": return "Video review failed · sealed without it"
    case "none": return nil
    default: return upload?.label
    }
  }

  private func busy(_ upload: ClipUploader.State?) -> Bool {
    if let upload, case .uploading = upload { return true }
    return review?.status == "running" || (review?.status == "waiting" && status == "submitted")
  }

  private var icon: String {
    switch review?.status {
    case "done": "film.stack"
    case "expired", "failed": "video.slash"
    default: "icloud.and.arrow.up"
    }
  }

  private var color: Color {
    switch review?.status {
    case "done": Theme.ok
    case "expired", "failed": Theme.warn
    default: ClipUploader.shared.states[momentId] == .waiting ? Theme.warn : Theme.lake
    }
  }
}
