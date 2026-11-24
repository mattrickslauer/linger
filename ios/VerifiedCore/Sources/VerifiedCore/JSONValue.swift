import Foundation

/// A tiny ordered JSON value whose `serialized` output matches JavaScript's `JSON.stringify`
/// byte-for-byte (key order as given, no whitespace, JS number formatting, JS string escaping).
/// This keeps payload strings identical across iOS, Android, web and the Cloud Function.
public indirect enum JSONValue: Sendable, Equatable {
  case null
  case bool(Bool)
  case int(Int64)
  case double(Double)
  case string(String)
  case array([JSONValue])
  case object([(String, JSONValue)])

  public static func == (a: JSONValue, b: JSONValue) -> Bool { a.serialized == b.serialized }

  public var serialized: String {
    var out = ""
    write(into: &out)
    return out
  }

  func write(into out: inout String) {
    switch self {
    case .null: out += "null"
    case .bool(let b): out += b ? "true" : "false"
    case .int(let i): out += String(i)
    case .double(let d): out += JSONValue.jsNumber(d)
    case .string(let s): JSONValue.writeString(s, into: &out)
    case .array(let items):
      out += "["
      for (i, v) in items.enumerated() {
        if i > 0 { out += "," }
        v.write(into: &out)
      }
      out += "]"
    case .object(let pairs):
      out += "{"
      for (i, (k, v)) in pairs.enumerated() {
        if i > 0 { out += "," }
        JSONValue.writeString(k, into: &out)
        out += ":"
        v.write(into: &out)
      }
      out += "}"
    }
  }

  /// Formats a Double exactly like JavaScript's Number#toString (shortest round-trip digits).
  /// NaN and infinities become `null`, as JSON.stringify does.
  public static func jsNumber(_ d: Double) -> String {
    guard d.isFinite else { return "null" }
    if d == 0 { return "0" }  // also -0 -> "0"
    if d == d.rounded(), abs(d) < 1e21, abs(d) < 9.0e15 {
      return String(Int64(d))
    }
    // Swift's description yields the same shortest digits as JS, but different exponent rules.
    let negative = d < 0
    var s = String(describing: abs(d))  // e.g. "0.001", "1e-07", "1.2345e+16", "123.5"
    var exp = 0
    if let e = s.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      exp = Int(s[s.index(after: e)...]) ?? 0
      s = String(s[..<e])
    }
    // Split mantissa into digits and decimal point position.
    let parts = s.split(separator: ".", omittingEmptySubsequences: false)
    let intPart = String(parts[0])
    let fracPart = parts.count > 1 ? String(parts[1]) : ""
    var digits = intPart + fracPart
    var pointPos = intPart.count + exp  // position of decimal point within `digits`
    // Strip leading zeros (adjusting point) and trailing zeros.
    while digits.count > 1, digits.first == "0" {
      digits.removeFirst()
      pointPos -= 1
    }
    while digits.count > 1, digits.last == "0" { digits.removeLast() }
    let k = digits.count
    let n = pointPos  // JS spec: value = 0.digits * 10^n
    var r: String
    if k <= n && n <= 21 {
      r = digits + String(repeating: "0", count: n - k)
    } else if 0 < n && n <= 21 {
      let idx = digits.index(digits.startIndex, offsetBy: n)
      r = String(digits[..<idx]) + "." + String(digits[idx...])
    } else if -6 < n && n <= 0 {
      r = "0." + String(repeating: "0", count: -n) + digits
    } else {
      let e = n - 1
      let sign = e < 0 ? "-" : "+"
      let first = String(digits.first!)
      let rest = String(digits.dropFirst())
      r = first + (rest.isEmpty ? "" : "." + rest) + "e" + sign + String(abs(e))
    }
    return negative ? "-" + r : r
  }

  /// JSON.stringify string escaping (ES2019 well-formed: lone surrogates are \u-escaped).
  static func writeString(_ s: String, into out: inout String) {
    out += "\""
    for unit in s.unicodeScalars {
      switch unit {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      default:
        if unit.value < 0x20 {
          out += String(format: "\\u%04x", unit.value)
        } else {
          out.unicodeScalars.append(unit)
        }
      }
    }
    out += "\""
  }
}

public extension JSONValue {
  /// Optional double helper: nil -> null.
  static func number(_ d: Double?) -> JSONValue { d.map { .double($0) } ?? .null }
}
