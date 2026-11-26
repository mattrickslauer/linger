import SwiftUI

/// Record tab: voice interview (or typed intention) -> Start Moment -> live screen -> Finish.
struct RecordView: View {
  @Environment(AppModel.self) private var app
  @FocusState private var focused: Bool

  var body: some View {
    @Bindable var rec = app.recorder
    Group {
      if rec.phase == .idle {
        form(rec)
      } else {
        LiveRecordView()
      }
    }
    .animation(.snappy, value: rec.phase)
    // Haptics: a firm tap when the Moment starts recording, a heavier one when it stops.
    .sensoryFeedback(trigger: rec.phase) { old, new in
      if old == .idle && new == .recording { return .start }
      if old == .recording && new != .recording { return .stop }
      return nil
    }
  }

  private func form(_ rec: RecorderModel) -> some View {
    @Bindable var rec = rec
    return NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if let done = rec.lastSubmitted { SubmittedBanner(done: done) }
          if let err = rec.error {
            Label(err, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Theme.bad)
          }

          InterviewCard(typeInstead: { focused = true })

          VStack(alignment: .leading, spacing: 8) {
            Label(rec.structured == nil ? "Or type it" : "In one sentence", systemImage: "character.cursor.ibeam")
              .font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            TextField("Catch and release a largemouth bass at Lake Mission Viejo",
                      text: $rec.intention, axis: .vertical)
              .lineLimit(2...4)
              .focused($focused)
              .padding(14)
              .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
              .onChange(of: rec.intention) { _, v in
                if v.count > 200 { rec.intention = String(v.prefix(200)) }
              }
            HStack(spacing: 8) {
              if rec.structured == nil && !app.interview.active && app.network.isOnline
                && !rec.intention.trimmingCharacters(in: .whitespaces).isEmpty {
                Button {
                  focused = false
                  app.interview.structureTyped(rec.intention, category: InterviewModel.guessCategory(rec.intention))
                } label: {
                  Label("Plan the evidence", systemImage: Glyph.claims).font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered).tint(Theme.lake)
                HybridBadge(onDevice: false)
              }
              Spacer()
              Text("\(rec.intention.count)/200").font(.caption2.monospacedDigit()).foregroundStyle(.tertiary)
            }
          }
        }
        .padding(20)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Theme.paper)
      .navigationTitle("Record")
      .onChange(of: app.interview.phase) { _, phase in
        if phase == .done, let r = app.interview.result { rec.use(r) }
      }
      .onChange(of: app.interview.result) { _, r in
        // Edits on the card (removed assumptions, re-previewed bar) keep the typed sentence.
        if app.interview.phase == .done { rec.structured = r }
      }
      .safeAreaInset(edge: .bottom) {
        Button {
          focused = false
          if app.interview.active { app.interview.cancel() }
          let user = app.auth.user  // nil: a guest Moment, kept on this phone (v3.1)
          let recorder = app.recorder
          Task {
            _ = await CameraController.requestAccess()
            _ = await CameraController.requestMicAccess()  // clip sound; without it clips are video-only
            recorder.start(owner: user)
          }
        } label: {
          HStack(spacing: 12) {
            ZStack {
              Circle().fill(.white).frame(width: 30, height: 30)
              Circle().fill(Theme.track).frame(width: 18, height: 18)
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) {
              Text("Start Moment").font(.title3.bold())
              if app.isGuest {
                Label("guest · stays on this phone", systemImage: Glyph.onDevice)
                  .font(.caption2.weight(.semibold)).opacity(0.85)
              }
            }
          }
          .foregroundStyle(.white)
          .frame(maxWidth: .infinity, minHeight: 60)
          .background(Color(hex: 0xD9480F), in: Capsule())
          .opacity(rec.canStart ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!rec.canStart)
        .padding(.horizontal, 20).padding(.bottom, 8)
      }
    }
  }
}

/// The Moment just finished, as one card: track sketch + stats, its status, and the video upload ring.
private struct SubmittedBanner: View {
  @Environment(AppModel.self) private var app
  let done: RecorderModel.Submitted

  var body: some View {
    let judging = app.judge.running.contains(done.id)
    let stillLocal = done.guest && app.vault.guestMoments.contains { $0.id == done.id }
    let card = app.mine.items.first { $0.id == done.id } ?? app.vault.guestMoments.first { $0.id == done.id }
    let upload = ClipUploader.shared.states[done.id]
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 12) {
        if let card, card.track.count > 1 {
          TrackSketch(track: card.track, width: 72, height: 72)
        } else {
          Image(systemName: stillLocal ? Glyph.onDevice : "paperplane.fill")
            .font(.title2).foregroundStyle(Theme.lake)
            .frame(width: 72, height: 72)
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 6) {
            StatusBadge(status: stillLocal ? "local" : card?.status ?? "submitted")
            if judging { HybridBadge(onDevice: false, text: "judging") }
            if !app.network.isOnline { Chip(text: "offline", systemImage: "wifi.slash", color: Theme.warn) }
          }
          Text(done.intention).font(.subheadline.weight(.semibold)).lineLimit(2)
          if let s = card?.summary {
            HStack(spacing: 12) {
              StatChip(icon: Glyph.timing, value: formatDuration(ms: s.durationMs))
              StatChip(icon: Glyph.gps, value: formatDistance(s.distanceM))
              StatChip(icon: Glyph.shots, value: "\(s.frameCount)")
            }
          }
        }
        Spacer(minLength: 0)
        if let f = upload?.fraction {
          Gauge(value: f) { Image(systemName: Glyph.video) }
            .gaugeStyle(.accessoryCircularCapacity)
            .tint(Theme.lake)
            .accessibilityLabel("Video upload \(Int(f * 100)) percent")
        }
      }
      if stillLocal {
        Button {
          if let m = app.vault.guestMoments.first(where: { $0.id == done.id }) { app.upload(m) }
        } label: {
          Label("Sign in & verify", systemImage: "icloud.and.arrow.up").font(.subheadline.weight(.semibold))
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent).tint(Theme.lake)
      } else {
        VideoStatusLine(momentId: done.id)
        if let card {
          NavigationLink {
            MomentDetailView(initial: card, fromMyMoments: true)
          } label: {
            Label("Open evidence", systemImage: "magnifyingglass").font(.subheadline.weight(.semibold))
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.bordered).tint(Theme.lake)
        }
      }
    }
    .surfaceCard(radius: 22)
  }
}
