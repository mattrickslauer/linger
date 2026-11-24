import AVFoundation
import Charts
import MapKit
import SwiftUI
import VerifiedCore

/// The live Moment screen: camera, coach banner, timer, distance, GPS dot, motion sparkline,
/// sync badge, Proof shot and Finish.
struct LiveRecordView: View {
  @Environment(AppModel.self) private var app
  @State private var mapPosition: MapCameraPosition = .userLocation(fallback: .automatic)
  @State private var front = false
  @State private var flash: AVCaptureDevice.FlashMode = .off

  var body: some View {
    let rec = app.recorder
    VStack(spacing: 12) {
      header(rec)
      ZStack(alignment: .bottom) {
        cameraView(rec)
        if let coach = rec.coach { CoachBanner(coach: coach).padding(10) }
      }
      .overlay(alignment: .topTrailing) { cameraButtons(rec).padding(10) }
      .frame(maxHeight: .infinity)
      .clipShape(RoundedRectangle(cornerRadius: 20))

      stats(rec)
      HStack(spacing: 10) {
        Map(position: $mapPosition) {
          UserAnnotation()
          if rec.track.count > 1 {
            MapPolyline(coordinates: rec.track).stroke(Theme.accent, lineWidth: 4)
          }
        }
        .frame(height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 14))

        MotionSparkline(values: rec.motionTrace)
          .frame(height: 96)
          .padding(8)
          .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
      }
      controls(rec)
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 8)
    .background(Color(.systemGroupedBackground))
  }

  private func header(_ rec: RecorderModel) -> some View {
    HStack(alignment: .center, spacing: 10) {
      Image(systemName: "record.circle.fill").foregroundStyle(Theme.bad)
        .symbolEffect(.pulse, options: .repeating, isActive: rec.phase == .recording)
      VStack(alignment: .leading, spacing: 2) {
        Text(rec.phase == .finishing ? "Finishing…" : "Recording").font(.caption.weight(.bold)).foregroundStyle(Theme.bad)
        Text(rec.intention).font(.subheadline.weight(.semibold)).lineLimit(1)
      }
      Spacer()
      SyncBadge(online: app.network.isOnline, pending: rec.sync.pending, total: max(rec.sync.total, rec.chunkCount))
    }
    .padding(.top, 8)
  }

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

  /// Flash (Off → Auto → On, only when the lens has one) and front/back flip.
  @ViewBuilder private func cameraButtons(_ rec: RecorderModel) -> some View {
    let position: AVCaptureDevice.Position = front ? .front : .back
    VStack(spacing: 10) {
      if CameraController.hasFlash(position) {
        Button {
          flash = switch flash { case .off: .auto; case .auto: .on; default: .off }
          rec.camera.setFlash(flash)
        } label: { roundIcon(flashUI.icon) }
          .accessibilityLabel(flashUI.label)
      }
      if CameraController.canFlip {
        Button {
          front.toggle()
          rec.camera.setPosition(front ? .front : .back)
          rec.camera.setFlash(CameraController.hasFlash(front ? .front : .back) ? flash : .off)
        } label: { roundIcon("arrow.triangle.2.circlepath.camera.fill") }
          .accessibilityLabel(front ? "Switch to back camera" : "Switch to front camera")
          .disabled(rec.shooting)
      }
    }
  }

  private var flashUI: (icon: String, label: String) {
    switch flash {
    case .on: ("bolt.fill", "Flash on")
    case .auto: ("bolt.badge.automatic.fill", "Flash auto")
    default: ("bolt.slash.fill", "Flash off")
    }
  }

  private func roundIcon(_ name: String) -> some View {
    Image(systemName: name)
      .font(.system(size: 17, weight: .semibold))
      .foregroundStyle(.white)
      .frame(width: 44, height: 44)
      .background(.black.opacity(0.55), in: Circle())
  }

  private func stats(_ rec: RecorderModel) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      HStack {
        Stat(value: formatDuration(ms: rec.elapsedMs(at: ctx.date)), label: "time")
        Divider().frame(height: 32)
        Stat(value: formatDistance(rec.distanceM), label: "distance")
        Divider().frame(height: 32)
        Stat(value: "\(rec.frameCount)", label: rec.frameCount == 1 ? "frame" : "frames")
        Divider().frame(height: 32)
        Stat(value: rec.lastFix.map { "±\(Int($0.accuracyM))m" } ?? "—", label: "GPS")
      }
      .padding(.vertical, 10)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
    }
  }

  private func controls(_ rec: RecorderModel) -> some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      let canFinish = rec.canFinish(at: ctx.date)
      HStack(spacing: 12) {
        Button {
          rec.proofShot()
        } label: {
          Label(rec.shooting ? "Checking…" : "Proof shot", systemImage: "camera.fill")
            .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(rec.shooting || rec.phase != .recording)

        Button {
          Task { await rec.finish() }
        } label: {
          VStack(spacing: 0) {
            Label("Finish", systemImage: "stop.fill").font(.headline)
            if !canFinish && rec.phase == .recording {
              let left = max(0, (RecorderModel.minDurationMs - rec.elapsedMs(at: ctx.date)) / 1000)
              Text("min 20 s · \(left)s").font(.caption2)
            }
          }
          .frame(maxWidth: .infinity).padding(.vertical, 6)
        }
        .buttonStyle(.bordered)
        .tint(Theme.bad)
        .controlSize(.large)
        .disabled(!canFinish)
      }
    }
  }
}

private struct Stat: View {
  let value: String
  let label: String
  var body: some View {
    VStack(spacing: 2) {
      Text(value).font(.title3.weight(.bold)).monospacedDigit()
      Text(label).font(.caption2).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
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
    .transition(.move(edge: .bottom).combined(with: .opacity))
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
    VStack(alignment: .leading, spacing: 2) {
      Text("motion").font(.caption2).foregroundStyle(.secondary)
      Chart(Array(values.enumerated()), id: \.offset) { item in
        LineMark(x: .value("t", item.offset), y: .value("|a|", item.element))
          .interpolationMethod(.catmullRom)
          .foregroundStyle(Theme.accent)
      }
      .chartXAxis(.hidden)
      .chartYAxis(.hidden)
      .chartXScale(domain: 0...60)
    }
  }
}
