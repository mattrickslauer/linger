import AVFoundation
import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// The live Moment screen: the camera (or the map) full-bleed, with a HUD over it. Top: the elapsed timer, sync
/// state and live indicators (GPS, motion, shots, clips), the plan checklist, the coach toast; the mini map window on
/// the right (tap it to swap camera and map) with the witness and flash buttons. Bottom, in the thumb zone: the
/// witness card, the "All done? End & verify" nudge, Photo/Video, then End & verify, the big shutter and flip.
struct LiveRecordView: View {
  @Environment(AppModel.self) private var app
  @State private var mapPosition: MapCameraPosition = .userLocation(fallback: .automatic)
  @State private var mapBig = false
  /// Set when a clip lands: the moment people most often don't realise they still need to end the session.
  @State private var clipSaved = false
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let rec = app.recorder
    ZStack {
      Group {
        if mapBig { trackMap(rec, compact: false) } else { cameraView(rec) }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .ignoresSafeArea(edges: .top)

      // Scrims so the HUD reads over any scene.
      VStack(spacing: 0) {
        LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom).frame(height: 200)
        Spacer(minLength: 0)
        LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom).frame(height: 280)
      }
      .ignoresSafeArea(edges: .top)
      .allowsHitTesting(false)
      .accessibilityHidden(true)

      VStack(spacing: 8) {
        topHUD(rec)
        indicators(rec)
        HStack(alignment: .top, spacing: 10) {
          VStack(alignment: .leading, spacing: 8) {
            if let plan = rec.plan, !plan.requirements.isEmpty {
              PlanChecklist(plan: plan, claims: rec.claims, captured: rec.captured)
            }
            if let coach = rec.coach { CoachBanner(coach: coach) }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          VStack(spacing: 10) {
            miniWindow(rec)
            WitnessToggle()
            if CameraController.hasFlash(rec.position) {
              let ui = flashUI(rec)
              Button { rec.cycleFlash() } label: { roundIcon(ui.icon, enabled: true) }
                .accessibilityLabel(ui.label)
            }
          }
        }
        Spacer(minLength: 0)
        if let open = rec.witness.open {
          WitnessCard(request: open).id(open.wid)
        }
        modeToggle(rec)
        controls(rec)
      }
      .padding(.horizontal, 12)
      .padding(.bottom, 8)
      .animation(reduceMotion ? nil : .snappy, value: rec.witness.open?.wid)
      .animation(reduceMotion ? nil : .snappy, value: rec.coach)
    }
    .background(Color.black)
    .foregroundStyle(.white)
    .environment(\.colorScheme, .dark)
    .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    // Witness: remind with a local notification when the app leaves the screen with a request open.
    .onChange(of: scenePhase) { _, phase in
      if phase == .background { rec.witness.didEnterBackground() }
      if phase == .active { WitnessNotifier.clear() }
    }
    // Haptics: a tap per proof shot, start/stop for clips, a warning when the coach asks for a retake, a nudge
    // when the witness asks for something.
    .sensoryFeedback(.impact(weight: .medium), trigger: rec.frameCount)
    .onChange(of: rec.videoCount) { old, new in if new > old { clipSaved = true } }
    .onChange(of: rec.clipStartedAt) { _, new in if new != nil { clipSaved = false } }
    .sensoryFeedback(trigger: rec.clipStartedAt) { old, new in
      if old == nil && new != nil { return .start }
      if old != nil && new == nil { return .stop }
      return nil
    }
    .sensoryFeedback(.warning, trigger: rec.retakes)
    .sensoryFeedback(trigger: rec.witness.open?.wid) { _, new in new != nil ? .impact(weight: .light) : nil }
  }

  // MARK: - Top HUD: timer, distance, sync

  private func topHUD(_ rec: RecorderModel) -> some View {
    HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
          HStack(spacing: 8) {
            Image(systemName: "circle.fill").font(.caption)
              .foregroundStyle(Color(hex: 0xF05A4A))
              .opacity(rec.phase == .recording ? 1 : 0.4)
              .symbolEffect(.pulse, options: .repeating, isActive: rec.phase == .recording && !reduceMotion)
              .accessibilityHidden(true)
            Text(formatDuration(ms: rec.elapsedMs(at: ctx.date)))
              .font(.system(.title, design: .rounded).weight(.bold).monospacedDigit())
              .accessibilityLabel("Elapsed \(formatDuration(ms: rec.elapsedMs(at: ctx.date)))")
          }
        }
        Text(rec.phase == .finishing ? "Finishing…" : rec.intention)
          .font(.footnote.weight(.semibold)).lineLimit(1).opacity(0.85)
      }
      .padding(.horizontal, 14).padding(.vertical, 8)
      .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      Spacer(minLength: 0)
      syncPill(rec)
    }
  }

  @ViewBuilder private func syncPill(_ rec: RecorderModel) -> some View {
    let (icon, tint, a11y): (String, Color, String) =
      if rec.isGuest { (Glyph.onDevice, Color(hex: 0x6CC3C6), "Kept on this device") }
      else if !app.network.isOnline { ("icloud.slash", Theme.warn, "Offline, \(rec.sync.pending) queued") }
      else if rec.sync.pending > 0 { ("arrow.triangle.2.circlepath.icloud", Color(hex: 0x6CC3C6), "Syncing, \(rec.sync.pending) queued") }
      else { ("checkmark.icloud", Theme.ok, "Synced") }
    let chunks = rec.isGuest ? rec.chunkCount : max(rec.sync.total, rec.chunkCount)
    HStack(spacing: 6) {
      Image(systemName: icon).foregroundStyle(tint)
      Image(systemName: Glyph.chain).font(.caption.weight(.bold)).opacity(0.7)
      Text("\(chunks)").monospacedDigit()
    }
    .font(.subheadline.weight(.bold))
    .padding(.horizontal, 12)
    .frame(minHeight: 44)
    .background(.ultraThinMaterial, in: Capsule())
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(a11y), \(chunks) chained chunks")
  }

  /// GPS, distance, motion, shots, clips: live, glanceable.
  private func indicators(_ rec: RecorderModel) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        if let since = rec.clipStartedAt { recPill(since) }
        StatChip(icon: Glyph.gps, value: rec.lastFix.map { "±\(Int($0.accuracyM)) m" } ?? "…",
                 tint: rec.lastFix == nil ? Theme.warn : Theme.ok, onMedia: true)
          .accessibilityLabel(rec.lastFix.map { "GPS accuracy \(Int($0.accuracyM)) meters" } ?? "Waiting for GPS")
        StatChip(icon: Glyph.distance, value: formatDistance(rec.distanceM), tint: Theme.track, onMedia: true)
          .accessibilityLabel("\(formatDistance(rec.distanceM)) moved")
        HStack(spacing: 5) {
          Image(systemName: Glyph.motion).font(.caption.weight(.bold)).foregroundStyle(Color(hex: 0x6CC3C6))
          MotionSparkline(values: rec.motionTrace).frame(width: 54, height: 18)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Motion recording")
        StatChip(icon: Glyph.shots, value: "\(rec.frameCount)", onMedia: true)
          .accessibilityLabel("\(rec.frameCount) proof shots")
        if rec.videoCount > 0 {
          StatChip(icon: Glyph.video, value: "\(rec.videoCount)", onMedia: true)
            .accessibilityLabel("\(rec.videoCount) video clips")
        }
      }
    }
    .scrollClipDisabled()
  }

  private func recPill(_ since: Int64) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let ms = max(0, Int64(ctx.date.timeIntervalSince1970 * 1000) - since)
      Label(formatDuration(ms: ms), systemImage: "record.circle")
        .font(.subheadline.weight(.bold).monospacedDigit())
        .foregroundStyle(.white)
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(Color(hex: 0xB8322A), in: Capsule())
        .accessibilityLabel("Recording clip, \(formatDuration(ms: ms))")
    }
  }

  // MARK: - Camera and map

  @ViewBuilder private func cameraView(_ rec: RecorderModel) -> some View {
    #if targetEnvironment(simulator)
      ZStack {
        LinearGradient(colors: [Color(hex: 0x1F6F78), Color(hex: 0x071419)], startPoint: .topLeading, endPoint: .bottomTrailing)
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
        MapPolyline(coordinates: rec.track).stroke(Color(hex: 0xFF8A4C), lineWidth: compact ? 3 : 5)
      }
    }
  }

  /// The small window (map, or the camera while the map is big). Tap to swap.
  private func miniWindow(_ rec: RecorderModel) -> some View {
    Group {
      if mapBig { cameraView(rec) } else { trackMap(rec, compact: true) }
    }
    .frame(width: 96, height: 128)
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.9), lineWidth: 2))
    .overlay(alignment: .bottomTrailing) {
      Image(systemName: "arrow.up.left.and.arrow.down.right")
        .font(.caption2.weight(.heavy))
        .padding(5)
        .background(.black.opacity(0.55), in: Circle())
        .padding(5)
    }
    .contentShape(RoundedRectangle(cornerRadius: 16))
    .onTapGesture { mapBig.toggle() }
    .accessibilityElement(children: .ignore)
    .accessibilityAddTraits(.isButton)
    .accessibilityLabel(mapBig ? "Show camera" : "Show map")
    .accessibilityAction { mapBig.toggle() }
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
          Label(video ? "Video" : "Photo", systemImage: video ? Glyph.video : Glyph.shots)
            .font(.subheadline.weight(.bold))
            .foregroundStyle(sel ? .black : .white.opacity(enabled ? 1 : 0.5))
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(sel ? Color.white : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled || sel)
        .accessibilityAddTraits(sel ? .isSelected : [])
      }
    }
    .padding(4)
    .background(.ultraThinMaterial, in: Capsule())
  }

  private func flashUI(_ rec: RecorderModel) -> (icon: String, label: String) {
    switch rec.flash {
    case .on: ("bolt.fill", rec.videoMode ? "Torch on" : "Flash on")
    case .auto where !rec.videoMode: ("bolt.badge.automatic.fill", "Flash auto")
    default: ("bolt.slash.fill", rec.videoMode ? "Torch off" : "Flash off")
    }
  }

  private func roundIcon(_ name: String, enabled: Bool, size: CGFloat = 44) -> some View {
    Image(systemName: name)
      .font(.system(size: size * 0.4, weight: .semibold))
      .foregroundStyle(.white.opacity(enabled ? 1 : 0.5))
      .frame(width: size, height: size)
      .background(.ultraThinMaterial, in: Circle())
  }

  // MARK: - Thumb zone: End & verify, shutter, flip

  private func finish(_ rec: RecorderModel) {
    Task {
      await rec.finish()
      // A guest Moment finished while signed in (signed in mid-recording): offer it for upload now.
      if rec.lastSubmitted?.guest == true { app.offerClaimIfNeeded(force: true) }
    }
  }

  private func controls(_ rec: RecorderModel) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let elapsed = rec.elapsedMs(at: ctx.date)
      let canFinish = rec.canFinish(at: ctx.date) && !rec.shooting
      let planComplete = rec.plan.map { p in !p.requirements.isEmpty && p.requirements.allSatisfy { rec.captured.contains($0.id) } } ?? false
      // Nudge toward ending the session once there's something worth verifying and nothing in flight.
      let ready = canFinish && rec.witness.open == nil && (clipSaved || planComplete)
      VStack(spacing: 10) {
        if ready {
          FinishNudge(lead: clipSaved ? "Video saved." : "Everything on the plan is captured.") { finish(rec) }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
        HStack(alignment: .center) {
          FinishButton(elapsed: elapsed, finishing: rec.phase == .finishing, enabled: canFinish, ready: ready) { finish(rec) }
            .frame(maxWidth: .infinity)

          Shutter(video: rec.videoMode, recording: rec.clipStartedAt != nil, busy: rec.shooting,
                  witness: rec.witness.armed != nil) {
            if !rec.videoMode { rec.proofShot() }
            else if rec.clipStartedAt == nil { rec.startVideo() }
            else { rec.stopVideo() }
          }
          .disabled(rec.phase != .recording)

          Group {
            if CameraController.canFlip {
              Button { rec.flip() } label: {
                roundIcon("arrow.triangle.2.circlepath.camera.fill", enabled: !rec.cameraBusy, size: 56)
              }
              .accessibilityLabel(rec.front ? "Switch to back camera" : "Switch to front camera")
              .disabled(rec.cameraBusy)
            } else {
              Color.clear.frame(width: 56, height: 56)
            }
          }
            .frame(maxWidth: .infinity)
        }
      }
      .animation(reduceMotion ? nil : .snappy, value: ready)
    }
  }
}

/// Shown once a clip lands (or the plan is fully captured): people otherwise don't realise they still need to end the session.
private struct FinishNudge: View {
  let lead: String
  let action: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "checkmark").font(.headline)
      Text("\(lead) \(Text("All done?").bold()) End the session to verify it.")
        .font(.subheadline)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
      Button(action: action) {
        Text("End & verify").font(.subheadline.weight(.bold))
          .padding(.horizontal, 14).padding(.vertical, 8)
          .background(Color(hex: 0x10242B), in: Capsule())
          .foregroundStyle(Theme.gold)
      }
      .buttonStyle(.plain)
    }
    .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
    .foregroundStyle(Color(hex: 0x10242B))
    .background(Theme.gold, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isButton)
    .accessibilityAction { action() }
  }
}

/// End & verify: a ring that fills over the 20 s minimum (showing the seconds left), then a gold check so it never
/// reads as another capture button; it pulses while `ready`. with a ring that fills over the 20 s minimum; until then it shows the seconds left.
private struct FinishButton: View {
  let elapsed: Int64
  let finishing: Bool
  let enabled: Bool
  var ready = false
  let action: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var pulse = false

  var body: some View {
    let min = RecorderModel.minDurationMs
    let progress = Swift.min(1, Double(elapsed) / Double(min))
    let left = Swift.max(0, (min - elapsed + 999) / 1000)
    Button(action: action) {
      VStack(spacing: 4) {
        ZStack {
          if ready {
            Circle().fill(Theme.gold)
              .scaleEffect(pulse && !reduceMotion ? 1.5 : 1)
              .opacity(reduceMotion ? 0.4 : pulse ? 0 : 0.8)
              .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulse = true }
              }
              .onDisappear { pulse = false }
          }
          if left > 0 {
            Circle().fill(.ultraThinMaterial)
            Circle().inset(by: 2).stroke(.white.opacity(0.2), lineWidth: 4)
            Circle().inset(by: 2).trim(from: 0, to: progress)
              .stroke(.white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
              .rotationEffect(.degrees(-90))
          } else {
            Circle().fill(Theme.gold)
          }
          if finishing {
            ProgressView().tint(Color(hex: 0x10242B))
          } else if left > 0 {
            Text("\(left)").font(.headline.monospacedDigit())
          } else {
            Image(systemName: "checkmark").font(.title2.weight(.bold)).foregroundStyle(Color(hex: 0x10242B))
          }
        }
        .frame(width: 60, height: 60)
        Text(finishing ? "Ending…" : "End & verify").font(.caption.weight(.bold))
          .foregroundStyle(left > 0 ? Color.white : Theme.gold)
      }
      .opacity(enabled || finishing ? 1 : 0.7)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel("End session and verify")
    .accessibilityValue(left > 0 ? "Available in \(left) seconds" : "")
  }
}

/// The plan's checklist (v4.11): `○ ask` → `● captured` as the evidence lands on the phone. Collapsed it is one
/// line (progress ring + next missing item); tap to see every requirement.
struct PlanChecklist: View {
  let plan: EvidencePlan
  let claims: [Claim]
  let captured: Set<String>
  @State private var expanded = false

  var body: some View {
    let total = plan.requirements.count
    let done = plan.requirements.filter { captured.contains($0.id) }.count
    let next = plan.requirements.first { !captured.contains($0.id) }
    VStack(alignment: .leading, spacing: 8) {
      Button { withAnimation(.snappy) { expanded.toggle() } } label: {
        HStack(spacing: 10) {
          Gauge(value: Double(done), in: 0...Double(Swift.max(total, 1))) {
            Image(systemName: Glyph.claims)
          } currentValueLabel: {
            Text("\(done)").monospacedDigit()
          }
          .gaugeStyle(.accessoryCircularCapacity)
          .tint(done == total ? Theme.ok : Color(hex: 0x6CC3C6))
          .scaleEffect(0.62)
          .frame(width: 36, height: 36)
          VStack(alignment: .leading, spacing: 1) {
            if let next, !expanded {
              Text(next.ask.isEmpty ? next.evidence.label.capitalized : next.ask)
                .font(.footnote.weight(.semibold)).lineLimit(1)
              Text("\(done)/\(total) captured").font(.caption2.monospacedDigit()).opacity(0.75)
            } else {
              Text(done == total ? "All captured" : "To get this verified").font(.footnote.weight(.semibold))
              Text("\(done)/\(total) captured").font(.caption2.monospacedDigit()).opacity(0.75)
            }
          }
          Spacer(minLength: 4)
          Image(systemName: "chevron.down").font(.caption.weight(.bold)).opacity(0.7)
            .rotationEffect(.degrees(expanded ? 180 : 0))
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel("To get this verified: \(done) of \(total) captured"
                          + (next.map { ". Next: \($0.ask.isEmpty ? $0.evidence.label : $0.ask)" } ?? ""))
      .accessibilityHint(expanded ? "Collapse the checklist" : "Show every requirement")
      if expanded {
        ForEach(plan.requirements) { r in
          RequirementRow(requirement: r, claim: claims.first { $0.id == r.claimId },
                         state: captured.contains(r.id) ? .captured : .missing, compact: true)
        }
      }
    }
    .padding(.horizontal, 10).padding(.vertical, 6)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    .animation(.snappy, value: captured)
  }
}

/// Big round shutter: white disc for photo, red disc for video, red rounded square while recording.
private struct Shutter: View {
  let video: Bool
  let recording: Bool
  let busy: Bool
  /// The witness asked to be shown something: the shutter glows.
  var witness = false
  let action: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    Button(action: action) {
      ZStack {
        Circle().stroke(.white, lineWidth: 5)
        if busy {
          ProgressView().tint(.white)
        } else if recording {
          RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0xF05A4A)).frame(width: 32, height: 32)
        } else if video {
          Circle().fill(Color(hex: 0xF05A4A)).frame(width: 66, height: 66)
        } else {
          Circle().fill(.white).frame(width: 66, height: 66)
            .overlay(Image(systemName: "camera.fill").font(.title3).foregroundStyle(.black.opacity(0.75)))
        }
      }
      .frame(width: 84, height: 84)
      .background(Circle().fill(Color(hex: 0x6CC3C6).opacity(witness ? 0.45 : 0)).scaleEffect(witness ? 1.28 : 1))
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: witness)
      .contentShape(Circle())
    }
    .buttonStyle(.plain)
    .disabled(busy)
    .accessibilityLabel(recording ? "Stop clip" : video ? "Record clip" : "Proof shot")
  }
}

/// The coach's verdict as a transient toast: green "keep going", amber "retake".
struct CoachBanner: View {
  let coach: RecorderModel.Coach

  var body: some View {
    HStack(spacing: 8) {
      switch coach.kind {
      case .checking: ProgressView().tint(.white)
      case .ok: Image(systemName: "checkmark.circle.fill")
      case .retake: Image(systemName: "arrow.counterclockwise.circle.fill")
      case .info: Image(systemName: Glyph.ai)
      }
      Text(coach.text).font(.subheadline.weight(.semibold)).lineLimit(2)
      Spacer(minLength: 0)
    }
    .foregroundStyle(filled ? Color(hex: 0x0F2127) : .white)
    .padding(.horizontal, 14).padding(.vertical, 10)
    .background {
      if filled {
        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(color)
      } else {
        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.ultraThinMaterial)
      }
    }
    .transition(.move(edge: .top).combined(with: .opacity))
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.updatesFrequently)
  }

  private var filled: Bool { coach.kind == .ok || coach.kind == .retake }

  private var color: Color {
    switch coach.kind {
    case .ok: Color(hex: 0x7FD19B)
    case .retake: Color(hex: 0xF2B65A)
    default: .black
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
      else if pending > 0 { ("Syncing · \(pending) queued", "arrow.triangle.2.circlepath.icloud", Theme.lake) }
      else { ("Synced · \(total) \(total == 1 ? "chunk" : "chunks")", "checkmark.icloud", Theme.ok) }
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
        .foregroundStyle(Color(hex: 0x6CC3C6))
    }
    .chartXAxis(.hidden)
    .chartYAxis(.hidden)
    .chartXScale(domain: 0...60)
    .accessibilityLabel("Motion")
  }
}
