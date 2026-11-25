import SwiftUI

/// Record tab: voice interview (or typed intention + category chips) -> Start Moment -> live screen -> Finish.
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
  }

  private func form(_ rec: RecorderModel) -> some View {
    @Bindable var rec = rec
    return NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          if let done = rec.lastSubmitted { SubmittedBanner(done: done) }
          if let err = rec.error { Text(err).font(.footnote).foregroundStyle(Theme.bad) }

          InterviewCard(typeInstead: { focused = true })

          VStack(alignment: .leading, spacing: 8) {
            Text(rec.structured == nil ? "Or just type it" : "In one sentence").font(.headline)
            TextField("Catch and release a largemouth bass at Lake Mission Viejo",
                      text: $rec.intention, axis: .vertical)
              .lineLimit(2...4)
              .focused($focused)
              .padding(14)
              .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
              .onChange(of: rec.intention) { _, v in
                if v.count > 200 { rec.intention = String(v.prefix(200)) }
              }
            Text("\(rec.intention.count)/200").font(.caption2).foregroundStyle(.tertiary)
              .frame(maxWidth: .infinity, alignment: .trailing)
          }

          VStack(alignment: .leading, spacing: 8) {
            Text("Category").font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 8) {
                ForEach(Category.allCases) { c in
                  Button {
                    rec.category = c
                  } label: {
                    Label(c.label, systemImage: c.icon)
                      .font(.subheadline.weight(.semibold))
                      .padding(.horizontal, 14).padding(.vertical, 9)
                      .foregroundStyle(rec.category == c ? .white : .primary)
                      .background(rec.category == c ? Theme.accent : Theme.card, in: Capsule())
                  }
                  .buttonStyle(.plain)
                }
              }
            }
          }

          HowItWorks()
        }
        .padding(20)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Color(.systemGroupedBackground))
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
          VStack(spacing: 2) {
            Label("Start Moment", systemImage: "record.circle.fill").font(.title3.bold())
            if app.isGuest {
              Text("as a guest · kept on this phone").font(.caption2.weight(.medium)).opacity(0.85)
            }
          }
          .frame(maxWidth: .infinity)
          .padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(!rec.canStart)
        .padding(.horizontal, 20).padding(.bottom, 8)
      }
    }
  }
}

private struct SubmittedBanner: View {
  @Environment(AppModel.self) private var app
  let done: RecorderModel.Submitted

  var body: some View {
    let judging = app.judge.running.contains(done.id)
    let stillLocal = done.guest && app.vault.guestMoments.contains { $0.id == done.id }
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: stillLocal ? "iphone.circle.fill" : "paperplane.circle.fill").font(.title2)
        .foregroundStyle(stillLocal ? .indigo : Theme.accent)
      VStack(alignment: .leading, spacing: 4) {
        Text(stillLocal ? "Saved on this phone" : "Moment submitted").font(.subheadline.bold())
        Text(done.intention).font(.subheadline).lineLimit(2)
        if stillLocal {
          Text("Recorded as a guest: chained and kept on this device. Sign in to upload it and get it verified.")
            .font(.caption).foregroundStyle(.secondary)
          Button {
            if let m = app.vault.guestMoments.first(where: { $0.id == done.id }) { app.upload(m) }
          } label: {
            Label("Sign in & verify", systemImage: "icloud.and.arrow.up").font(.subheadline.weight(.semibold))
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
          .padding(.top, 4)
        } else {
        VideoStatusLine(momentId: done.id)
        Text(judging ? "Cloud judge, skeptic and scorer are reviewing it…"
             : app.network.isOnline ? "It seals once the cloud judge, skeptic and scorer have run. Track it in Me."
             : "Offline: it will sync and be judged when you're back online.")
          .font(.caption).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(14)
    .background((stillLocal ? Color.indigo : Theme.accent).opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct HowItWorks: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      row("location.fill", "GPS, motion and app events are recorded as a time series.")
      row("camera.fill", "Take proof shots or video clips. The on-device coach says “keep going” or “retake”.")
      row("link", "Every 5 s the data is sealed into a SHA-256 chain, offline or not.")
      row("checkmark.seal.fill", "Online again: a cloud judge, skeptic and scorer weigh in, then code seals it.")
    }
    .font(.footnote)
    .foregroundStyle(.secondary)
    .padding(14)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
  }

  private func row(_ icon: String, _ text: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: icon).frame(width: 18).foregroundStyle(Theme.accent)
      Text(text)
    }
  }
}
