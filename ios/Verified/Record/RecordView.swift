import SwiftUI

/// Record tab: intention + category chips -> Start Moment -> live screen -> Finish.
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

          VStack(alignment: .leading, spacing: 8) {
            Text("What are you about to do?").font(.headline)
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
      .safeAreaInset(edge: .bottom) {
        Button {
          focused = false
          guard let user = app.auth.user else { return }
          let recorder = app.recorder
          Task {
            _ = await CameraController.requestAccess()
            recorder.start(owner: user)
          }
        } label: {
          Label("Start Moment", systemImage: "record.circle.fill")
            .font(.title3.bold())
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
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "paperplane.circle.fill").font(.title2).foregroundStyle(Theme.accent)
      VStack(alignment: .leading, spacing: 4) {
        Text("Moment submitted").font(.subheadline.bold())
        Text(done.intention).font(.subheadline).lineLimit(2)
        Text(judging ? "Cloud judge and skeptic are reviewing it…"
             : app.network.isOnline ? "It seals once the cloud judge and skeptic have run. Track it in Me."
             : "Offline: it will sync and be judged when you're back online.")
          .font(.caption).foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .padding(14)
    .background(Theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
  }
}

private struct HowItWorks: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      row("location.fill", "GPS, motion and app events are recorded as a time series.")
      row("camera.fill", "Take proof shots. The on-device coach says “keep going” or “retake”.")
      row("link", "Every 5 s the data is sealed into a SHA-256 chain, offline or not.")
      row("checkmark.seal.fill", "Online again: a cloud judge and skeptic weigh in, then code seals it.")
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
