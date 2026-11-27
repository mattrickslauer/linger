import SafariServices
import SwiftUI

/// Buying credits through pay.mattrickslauer.com (same backend as the web): a pack opens a pay checkout in an
/// in-app Safari sheet; when the sheet closes, `confirmCreditPurchase` settles it (the signed webhook does the same,
/// whichever is first, once). Card payments are final on return; ACH and crypto may take longer and arrive by webhook.
struct BuyCreditsSheet: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var busy: String?
  @State private var checkout: LadderService.Checkout?
  /// The checkout last opened, settled when the Safari sheet closes.
  @State private var opened: LadderService.Checkout?
  @State private var state: SettleState?
  @State private var error: String?

  enum SettleState: Equatable {
    case checking
    case ok(credits: Int, balance: Int)
    case pending
    case bad(String)
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 14) {
          if let c = app.credits.credits {
            Label("\(c.balance) \(c.balance == 1 ? "credit" : "credits")", systemImage: Glyph.credits)
              .font(.headline.monospacedDigit())
              .padding(.horizontal, 12).padding(.vertical, 6)
              .foregroundStyle(Color(hex: 0x10242B))
              .background(Theme.gold, in: Capsule())
          }
          Text("Credits run verification checks on your Moments. They buy scrutiny, never a score, and don't expire.")
            .font(.subheadline).foregroundStyle(.secondary)
          ForEach(LadderCatalog.shared.packs) { p in packRow(p) }
          if let state { stateLine(state) }
          if let error {
            Label(error, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Theme.bad)
          }
          Text("Checkout is on pay.mattrickslauer.com: card, ACH or crypto. Close the page when you're done to come back.")
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
      }
      .background(Theme.paper)
      .navigationTitle("Buy credits")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(busy != nil) }
      }
      .fullScreenCover(item: $checkout, onDismiss: settle) { c in
        SafariView(url: c.url).ignoresSafeArea()
      }
      .sensoryFeedback(trigger: state) { _, new in
        if case .ok = new { return .success }
        return nil
      }
    }
  }

  private func packRow(_ p: LadderCatalog.CreditPack) -> some View {
    Button { buy(p) } label: {
      HStack(spacing: 12) {
        Image(systemName: Glyph.credits).font(.title2).foregroundStyle(Theme.gold)
        VStack(alignment: .leading, spacing: 2) {
          Text("\(p.credits) credits").font(.headline)
          Text("\(price(p.priceCents / max(1, p.credits))) each").font(.caption).foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
        if busy == p.id {
          ProgressView()
        } else {
          Text(price(p.priceCents)).font(.headline.monospacedDigit())
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Theme.lake.opacity(0.15), in: Capsule())
        }
      }
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(busy != nil || state == .checking)
    .surfaceCard(padding: 14)
    .accessibilityLabel("\(p.credits) credits for \(price(p.priceCents))")
  }

  @ViewBuilder private func stateLine(_ s: SettleState) -> some View {
    switch s {
    case .checking:
      HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Confirming your payment…") }.font(.footnote)
    case let .ok(credits, balance):
      Label("Payment received: +\(credits) credits. You now have \(balance).", systemImage: "checkmark.circle.fill")
        .font(.footnote.weight(.semibold)).foregroundStyle(Theme.ok)
    case .pending:
      Label("No payment confirmed yet. If you paid by ACH or crypto, credits are added automatically once it clears.",
            systemImage: "hourglass").font(.footnote).foregroundStyle(.secondary)
    case let .bad(text):
      Label(text, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Theme.bad)
    }
  }

  private func buy(_ p: LadderCatalog.CreditPack) {
    error = nil
    state = nil
    busy = p.id
    Task {
      defer { busy = nil }
      do {
        let c = try await LadderService.buyCredits(pack: p.id)
        opened = c
        checkout = c
      } catch {
        self.error = error.localizedDescription
      }
    }
  }

  /// The Safari sheet closed (paid, cancelled or not yet): ask the server a few times, then leave it to the webhook.
  private func settle() {
    guard let c = opened else { return }
    opened = nil
    state = .checking
    Task {
      for attempt in 0..<4 {
        do {
          let r = try await LadderService.confirmPurchase(c.purchaseId)
          if r.status == "paid" {
            state = .ok(credits: r.credits, balance: r.balance)
            await app.credits.refresh()
            return
          }
          if r.status == "refunded" {
            state = .bad("That payment was refunded, so no credits were added.")
            return
          }
        } catch let e as LadderService.Failure where e.reason == "pay_unavailable" {
          // pay is slow to answer: try again below
        } catch {
          state = .bad(error.localizedDescription)
          return
        }
        if attempt < 3 { try? await Task.sleep(for: .seconds(2)) }
      }
      state = .pending
    }
  }

  private func price(_ cents: Int) -> String {
    (Double(cents) / 100).formatted(.currency(code: "USD").precision(.fractionLength(cents % 100 == 0 ? 0 : 2)))
  }
}

/// pay's hosted checkout inside the app (Safari's cookies, autofill and Apple Pay; no access for the app).
/// Done closes the SwiftUI cover (through the delegate), which then settles the purchase.
struct SafariView: UIViewControllerRepresentable {
  let url: URL
  @Environment(\.dismiss) private var dismiss

  func makeCoordinator() -> Coordinator { Coordinator(onFinish: { dismiss() }) }

  func makeUIViewController(context: Context) -> SFSafariViewController {
    let vc = SFSafariViewController(url: url)
    vc.dismissButtonStyle = .done
    vc.delegate = context.coordinator
    return vc
  }

  func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}

  final class Coordinator: NSObject, SFSafariViewControllerDelegate {
    let onFinish: () -> Void
    init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }
    func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onFinish() }
  }
}
