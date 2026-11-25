import AVFoundation
import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// The live Moment screen, laid out like Android's: a compact stats bar, then a full-height camera with the coach
/// banner, REC timer, Photo/Video switch, flash + flip and a mini map (tap it to swap camera and map), then the
/// motion sparkline, the shutter / record button and Finish.
struct LiveRecordView: View {
  @Environment(AppModel.self) private var app
  @State private var mapPosition: MapCameraPosition = .userLocation(fallback: .automatic)
  @State private var mapBig = false
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    let rec = app.recorder
    VStack(spacing: 0) {
      header(rec)
      if let plan = rec.plan, !plan.requirements.isEmpty {
        PlanChecklist(plan: plan, claims: rec.claims, captured: rec.captured)
          .padding(.horizontal, 8).padding(.bottom, 6)
      }
      ZStack {
        if mapBig { trackMap(rec, compact: false) } else { cameraView(rec) }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .overlay(alignment: .top) {
        if let coach = rec.coach { CoachBanner(coach: coach).padding(8) }
      }
      .overlay(alignment: .topLeading) {
        if let since = rec.clipStartedAt { recPill(since).padding(.leading, 10).padding(.top, 64) }
      }
      .overlay(alignment: .topTrailing) { miniWindow(rec).padding(.trailing, 10).padding(.top, 64) }
      .overlay(alignment: .bottom) {
        VStack(spacing: 10) {
          if let open = rec.witness.open {
            WitnessCard(request: open).id(open.wid).padding(.horizontal, 10)
          }
          modeToggle(rec)
        }
        .padding(.bottom, 12)
        .animation(.snappy, value: rec.witness.open?.wid)
      }
      .overlay(alignment: .bottomTrailing) {
        if !mapBig { cameraButtons(rec).padding(12) }
      }
      .background(.black)
      .clipShape(RoundedRectangle(cornerRadius: 20))
      .padding(.horizontal, 8)

      bottomBar(rec)
    }
    .background(Color(.systemGroupedBackground))
    .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    // Witness: remind with a local notification when the app leaves the screen with a request open.
    .onChange(of: scenePhase) { _, phase in
      if phase == .background { rec.witness.didEnterBackground() }
      if phase == .active { WitnessNotifier.clear() }
    }
  }

  // MARK: - Top: intention, timer, distance, sync badge

  private func header(_ rec: RecorderModel) -> some View {
    HStack(alignment: .center, spacing: 10) {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 6) {
          Image(systemName: "record.circle.fill").foregroundStyle(Theme.bad)
            .symbolEffect(.pulse, options: .repeating, isActive: rec.phase == .recording)
          Text(rec.phase == .finishing ? "Finishing…" : rec.intention).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
          HStack(alignment: .lastTextBaseline, spacing: 10) {
            Text(formatDuration(ms: rec.elapsedMs(at: ctx.date))).font(.system(size: 30, weight: .bold)).monospacedDigit()
            Text(formatDistance(rec.distanceM)).font(.headline)
          }
        }
      }
      Spacer(minLength: 0)
      if rec.isGuest {
        Chip(text: "On this device · \(rec.chunkCount) chunks", systemImage: "iphone", color: .indigo)
      } else {
        SyncBadge(online: app.network.isOnline, pending: rec.sync.pending, total: max(rec.sync.total, rec.chunkCount))
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 8)
  }

  // MARK: - Camera area

  @ViewBuilder private func cameraView(_ rec: RecorderModel) -> some View {
    #if targetEnvironment(simulator)
      ZStack {
        LinearGradient(colors: [.blue.opacity(0.6), .green.opacity(0.5)], startPoint: .topLeading, endPoint: .bottomTrailing)
        Label("Simulator: synthetic proof frames", systemImage: "camera.metering.unknown")
          .font(.footnote).foregroundStyle(.white)
      }
    #else
      CameraPreview(session: rec.camera.session)
    #endif
  }

  private func trackMap(_ rec: RecorderModel, compact: Bool) -> some View {
    Map(position: $mapPosition, interactionModes: compact ? [] : .all) {
      UserAnnotation()
      if rec.track.count > 1 {
        MapPolyline(coordinates: rec.track).stroke(Theme.accent, lineWidth: compact ? 3 : 4)
      }
    }
  }

  /// The small window (map, or the camera while the map is big). Tap to swap.
  private func miniWindow(_ rec: RecorderModel) -> some View {
    Group {
      if mapBig { cameraView(rec) } else { trackMap(rec, compact: true) }
    }
    .frame(width: 116, height: 150)
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(.white, lineWidth: 2))
    .contentShape(RoundedRectangle(cornerRadius: 14))
    .onTapGesture { mapBig.toggle() }
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(mapBig ? "Show camera" : "Show map")
  }

  private func recPill(_ since: Int64) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let ms = max(0, Int64(ctx.date.timeIntervalSince1970 * 1000) - since)
      Text("● REC \(formatDuration(ms: ms))")
        .font(.caption.weight(.bold)).monospacedDigit()
        .foregroundStyle(.white)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Theme.bad, in: Capsule())
    }
  }

  /// PHOTO | VIDEO, locked while a shot is checked or a clip records.
  private func modeToggle(_ rec: RecorderModel) -> some View {
    let enabled = !rec.cameraBusy && rec.phase == .recording
    return HStack(spacing: 0) {
      ForEach([false, true], id: \.self) { video in
        let sel = rec.videoMode == video
        Button {
          rec.setVideoMode(video)
        } label: {
          Text(video ? "VIDEO" : "PHOTO")
            .font(.system(size: 12, weight: .bold)).kerning(1)
            .foregroundStyle(sel ? .black : .white.opacity(enabled ? 1 : 0.5))
            .padding(.horizontal, 16).padding(.vertical, 7)
            .background(sel ? Color.white : Color.clear, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled || sel)
        .accessibilityAddTraits(sel ? .isSelected : [])
      }
    }
    .padding(4)
    .background(.black.opacity(0.6), in: Capsule())
  }

  /// Flash (only when the lens has one; torch in video mode) and front/back flip.
  @ViewBuilder private func cameraButtons(_ rec: RecorderModel) -> some View {
    VStack(spacing: 10) {
      WitnessToggle()
      if CameraController.hasFlash(rec.position) {
        let ui = flashUI(rec)
        Button { rec.cycleFlash() } label: { roundIcon(ui.icon, enabled: true) }
          .accessibilityLabel(ui.label)
      }
      if CameraController.canFlip {
        Button { rec.flip() } label: { roundIcon("arrow.triangle.2.circlepath.camera.fill", enabled: !rec.cameraBusy) }
          .accessibilityLabel(rec.front ? "Switch to back camera" : "Switch to front camera")
          .disabled(rec.cameraBusy)
      }
    }
  }

  private func flashUI(_ rec: RecorderModel) -> (icon: String, label: String) {
    switch rec.flash {
    case .on: ("bolt.fill", rec.videoMode ? "Torch on" : "Flash on")
    case .auto where !rec.videoMode: ("bolt.badge.automatic.fill", "Flash auto")
    default: ("bolt.slash.fill", rec.videoMode ? "Torch off" : "Flash off")
    }
  }

  private func roundIcon(_ name: String, enabled: Bool) -> some View {
    Image(systemName: name)
      .font(.system(size: 17, weight: .semibold))
      .foregroundStyle(.white.opacity(enabled ? 1 : 0.5))
      .frame(width: 44, height: 44)
      .background(.black.opacity(0.55), in: Circle())
  }

  // MARK: - Bottom: sparkline + counts, shutter, Finish

  private func bottomBar(_ rec: RecorderModel) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let elapsed = rec.elapsedMs(at: ctx.date)
      VStack(spacing: 4) {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 2) {
            MotionSparkline(values: rec.motionTrace).frame(height: 28)
            Text(caption(rec)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
          }
          .frame(maxWidth: .infinity, alignment: .leading)

          Shutter(video: rec.videoMode, recording: rec.clipStartedAt != nil, busy: rec.shooting,
                  witness: rec.witness.armed != nil) {
            if !rec.videoMode { rec.proofShot() }
            else if rec.clipStartedAt == nil { rec.startVideo() }
            else { rec.stopVideo() }
          }
          .disabled(rec.phase != .recording)

          Button {
            Task {
              await rec.finish()
              // A guest Moment finished while signed in (signed in mid-recording): offer it for upload now.
              if rec.lastSubmitted?.guest == true { app.offerClaimIfNeeded(force: true) }
            }
          } label: {
            Label("Finish", systemImage: "stop.fill").font(.headline).padding(.vertical, 6)
          }
          .buttonStyle(.bordered)
          .tint(Theme.bad)
          .controlSize(.large)
          .disabled(!rec.canFinish(at: ctx.date) || rec.shooting)
          .frame(maxWidth: .infinity, alignment: .trailing)
        }
        if rec.phase == .recording && elapsed < RecorderModel.minDurationMs {
          let left = (RecorderModel.minDurationMs - elapsed + 999) / 1000
          Text("Moments shorter than 20 s can't be sealed · \(left)s").font(.caption2).foregroundStyle(.secondary)
        }
      }
      .padding(.horizontal, 16).padding(.vertical, 10)
    }
  }

  private func caption(_ rec: RecorderModel) -> String {
    var s = "\(rec.frameCount) \(rec.frameCount == 1 ? "frame" : "frames")"
    if rec.videoCount > 0 { s += " · \(rec.videoCount) \(rec.videoCount == 1 ? "clip" : "clips")" }
    s += " · " + (rec.lastFix.map { "GPS ±\(Int($0.accuracyM)) m" } ?? "GPS…")
    return s
  }
}

/// The plan's checklist under the timer (v4.11): `○ ask` → `● captured` as the evidence lands on the phone.
/// Collapsed it shows the progress and the next missing item; tap to see every requirement.
struct PlanChecklist: View {
  let plan: EvidencePlan
  let claims: [Claim]
  let captured: Set<String>
  @State private var expanded = false

  var body: some View {
    let done = plan.requirements.filter { captured.contains($0.id) }.count
    let next = plan.requirements.first { !captured.contains($0.id) }
    VStack(alignment: .leading, spacing: 8) {
      Button { withAnimation(.snappy) { expanded.toggle() } } label: {
        HStack(spacing: 8) {
          Image(systemName: done == plan.requirements.count ? "checkmark.seal.fill" : "checklist")
            .foregroundStyle(Theme.accent)
          Text("To get this verified").font(.footnote.weight(.semibold))
          Spacer(minLength: 4)
          Text("\(done)/\(plan.requirements.count) captured").font(.caption.monospacedDigit().weight(.semibold))
            .foregroundStyle(done == plan.requirements.count ? Theme.accent : .secondary)
          Image(systemName: "chevron.down").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            .rotationEffect(.degrees(expanded ? 180 : 0))
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("To get this verified: \(done) of \(plan.requirements.count) captured")
      .accessibilityHint(expanded ? "Collapse the checklist" : "Show every requirement")
      if expanded {
        ForEach(plan.requirements) { r in
          RequirementRow(requirement: r, claim: claims.first { $0.id == r.claimId },
                         state: captured.contains(r.id) ? .captured : .missing, compact: true)
        }
      } else if let next {
        RequirementRow(requirement: next, state: .missing, compact: true)
      }
    }
    .padding(.horizontal, 12).padding(.vertical, 9)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
    .animation(.snappy, value: captured)
  }
}

/// Big round shutter: green camera disc for photo, red disc for video, red rounded square while recording.
private struct Shutter: View {
  let video: Bool
  let recording: Bool
  let busy: Bool
  /// The witness asked to be shown something: the shutter glows.
  var witness = false
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Circle().stroke(Color.primary, lineWidth: 4)
        if busy {
          ProgressView()
        } else if recording {
          RoundedRectangle(cornerRadius: 6).fill(Theme.bad).frame(width: 28, height: 28)
        } else if video {
          Circle().fill(Theme.bad).frame(width: 58, height: 58)
        } else {
          Circle().fill(Theme.accent).frame(width: 58, height: 58)
            .overlay(Image(systemName: "camera.fill").foregroundStyle(.white))
        }
      }
      .frame(width: 78, height: 78)
      .background(Circle().fill(Theme.accent.opacity(witness ? 0.35 : 0)).scaleEffect(witness ? 1.25 : 1))
      .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: witness)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .disabled(busy)
    .accessibilityLabel(recording ? "Stop clip" : video ? "Record clip" : "Proof shot")
  }
}

struct CoachBanner: View {
  let coach: RecorderModel.Coach

  var body: some View {
    HStack(spacing: 8) {
      switch coach.kind {
      case .checking: ProgressView().tint(.white)
      case .ok: Image(systemName: "checkmark.circle.fill")
      case .retake: Image(systemName: "arrow.counterclockwise.circle.fill")
      case .info: Image(systemName: "sparkles")
      }
      Text(coach.text).font(.subheadline.weight(.semibold)).lineLimit(2)
      Spacer(minLength: 0)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 14).padding(.vertical, 10)
    .background(color.opacity(0.88), in: RoundedRectangle(cornerRadius: 14))
    .transition(.move(edge: .top).combined(with: .opacity))
    .animation(.snappy, value: coach)
  }

  private var color: Color {
    switch coach.kind {
    case .checking, .info: .black
    case .ok: Theme.accent
    case .retake: Theme.warn
    }
  }
}

/// "Offline · 12 chunks queued" / "Syncing · 2 queued" / "Synced · 14 chunks"
struct SyncBadge: View {
  let online: Bool
  let pending: Int
  let total: Int

  var body: some View {
    let (text, icon, color): (String, String, Color) =
      if !online { ("Offline · \(pending) \(pending == 1 ? "chunk" : "chunks") queued", "icloud.slash", Theme.warn) }
      else if pending > 0 { ("Syncing · \(pending) queued", "arrow.triangle.2.circlepath.icloud", .blue) }
      else { ("Synced · \(total) \(total == 1 ? "chunk" : "chunks")", "checkmark.icloud", Theme.accent) }
    Chip(text: text, systemImage: icon, color: color)
  }
}

/// Acceleration magnitude, last ~12 s.
struct MotionSparkline: View {
  let values: [Double]
  var body: some View {
    Chart(Array(values.enumerated()), id: \.offset) { item in
      LineMark(x: .value("t", item.offset), y: .value("|a|", item.element))
        .interpolationMethod(.catmullRom)
        .foregroundStyle(Theme.accent)
    }
    .chartXAxis(.hidden)
    .chartYAxis(.hidden)
    .chartXScale(domain: 0...60)
    .accessibilityLabel("Motion")
  }
}
