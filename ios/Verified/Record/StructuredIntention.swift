import Foundation
import VerifiedCore

/// `moments/{id}.intention` v3 (docs/ARCHITECTURE.md v3.2). All v3 keys are optional on the server, so a plain
/// `{text, category}` stays valid; this type is what the voice interview produces.
struct StructuredIntention: Equatable, Sendable {
  struct Quantity: Equatable, Sendable, Identifiable {
    var metric: String
    var value: Double
    var unit: String
    var measuredBy: String  // scale|ruler|photo|count|gps|motion|claim
    var id: String { "\(metric)|\(value)|\(unit)" }
    var label: String {
      let v = value == value.rounded() ? String(Int64(value)) : String(format: "%g", value)
      return "\(v) \(unit) \(metric == "count" || metric == "other" ? "" : metric)".trimmingCharacters(in: .whitespaces)
    }
  }

  struct Place: Equatable, Sendable {
    var name: String?
    var lat: Double?
    var lng: Double?
    var region: String?
    var country: String?
    var label: String? {
      let parts = [name, region, country].compactMap { $0 }.filter { !$0.isEmpty }
      return parts.isEmpty ? nil : parts.prefix(2).joined(separator: ", ")
    }
  }

  struct Preview: Equatable, Sendable {
    var bar: Double
    var difficulty: Double
    var mode: String  // on_device | cloud
    var rationale: String
    var factors: [String]
  }

  var text: String
  var category: Category
  var activity: String
  var goal: String
  var quantities: [Quantity] = []
  var place: Place?
  var expectedMinutes: Double?
  var conditions: [String] = []
  var assumptions: [String] = []
  var turns = 0
  var mode = "typed"  // on_device | cloud | mixed | typed
  var preview: Preview?

  /// From the JSON the interview / structuring prompts return (their shared `draft` shape). "" → nil, 0 → nil.
  init?(json d: [String: Any], location: (lat: Double, lng: Double)?) {
    let text = (d["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let goal = (d["goal"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty || !goal.isEmpty else { return nil }
    self.text = String((text.isEmpty ? goal : text).prefix(200))
    category = Category(rawValue: d["category"] as? String ?? "") ?? .other
    activity = String((d["activity"] as? String ?? "").prefix(40))
    self.goal = String(goal.prefix(120))
    quantities = ((d["quantities"] as? [[String: Any]]) ?? []).prefix(5).compactMap { q in
      guard let metric = q["metric"] as? String, let value = (q["value"] as? NSNumber)?.doubleValue, value != 0 else { return nil }
      let by = q["measuredBy"] as? String ?? "claim"
      let allowed = ["scale", "ruler", "photo", "count", "gps", "motion", "claim"]
      return Quantity(metric: metric, value: value, unit: q["unit"] as? String ?? "", measuredBy: allowed.contains(by) ? by : "claim")
    }
    func nonEmpty(_ s: Any?) -> String? {
      let t = (s as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      return t.isEmpty ? nil : t
    }
    let p = d["place"] as? [String: Any] ?? [:]
    // lat/lng always come from GPS, never from the model.
    let place = Place(name: nonEmpty(p["name"]), lat: location?.lat, lng: location?.lng,
                      region: nonEmpty(p["region"]), country: nonEmpty(p["country"]))
    self.place = (place.label == nil && place.lat == nil) ? nil : place
    if let m = (d["expectedMinutes"] as? NSNumber)?.doubleValue, m > 0 { expectedMinutes = m }
    conditions = Array(((d["conditions"] as? [String]) ?? []).filter { !$0.isEmpty }.prefix(6))
    assumptions = Array(((d["assumptions"] as? [String]) ?? []).filter { !$0.isEmpty }.prefix(6))
  }

  /// The draft shape the prompts read back as `{{draft}}` / `{{intention}}`.
  var promptJSON: [String: Any] {
    [
      "text": text, "category": category.rawValue, "activity": activity, "goal": goal,
      "quantities": quantities.map { ["metric": $0.metric, "value": $0.value, "unit": $0.unit, "measuredBy": $0.measuredBy] },
      "place": ["name": place?.name ?? "", "region": place?.region ?? "", "country": place?.country ?? ""],
      "expectedMinutes": expectedMinutes ?? 0, "conditions": conditions, "assumptions": assumptions,
    ]
  }

  /// `moments/{id}.intention` (v3.2). `window.start` is the Moment's start time.
  func firestoreData(startedAt: Int64) -> [String: Any] {
    func orNull(_ v: Any?) -> Any { v ?? NSNull() }
    var d: [String: Any] = [
      "text": String(text.prefix(200)), "category": category.rawValue, "v": 3,
      "activity": String(activity.prefix(40)), "goal": String(goal.prefix(120)),
      "quantities": quantities.prefix(5).map {
        ["metric": $0.metric, "value": $0.value, "unit": $0.unit, "measuredBy": $0.measuredBy] as [String: Any]
      },
      "place": place.map {
        ["name": orNull($0.name), "lat": orNull($0.lat), "lng": orNull($0.lng),
         "region": orNull($0.region), "country": orNull($0.country)] as [String: Any] as Any
      } ?? NSNull(),
      "window": ["start": startedAt, "expectedMinutes": orNull(expectedMinutes)] as [String: Any],
      "conditions": Array(conditions.prefix(6)),
      "assumptions": Array(assumptions.prefix(6)),
      "interview": ["turns": turns, "mode": mode] as [String: Any],
    ]
    d["preview"] = preview.map {
      ["bar": $0.bar, "difficulty": $0.difficulty, "mode": $0.mode] as [String: Any] as Any
    } ?? NSNull()
    return d
  }
}
