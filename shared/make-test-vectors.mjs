// Regenerates shared/test-vectors.json. Every platform's chain code must reproduce these hashes.
// Run: node shared/make-test-vectors.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const h = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const id = "3f1c9a2e-7b4d-4e8a-9c1f-2a6b5d8e0f13";

function chunk(seq, t0, t1, prevHash, payload) {
  const payloadSha = h(payload);
  return { seq, t0, t1, prevHash, payload, payloadSha, hash: h(`${seq}|${t0}|${t1}|${prevHash}|${payloadSha}`) };
}

const c0 = chunk(0, 1764000000000, 1764000005000, "GENESIS:" + id, JSON.stringify({
  gps: [[1764000000000, 33.6189, -117.6681, 5.2, null, 0.4]],
  motion: [[1764000000100, 0.01, 9.81, -0.2, 0, 0.001, 0]],
  events: [{ t: 1764000000000, type: "start" }],
  frameSha: null,
  check: null,
}));
const c1 = chunk(1, 1764000005000, 1764000006000, c0.hash, JSON.stringify({
  gps: [],
  motion: [],
  events: [{ t: 1764000006000, type: "stop" }],
  frameSha: h("aGVsbG8="),
  check: { ok: true, reason: "keep going", mode: "on_device", label: "bass in hand" },
}));

writeFileSync(new URL("./test-vectors.json", import.meta.url), JSON.stringify({
  note: "sha256 over UTF-8 bytes, lowercase hex. hash = sha256(`${seq}|${t0}|${t1}|${prevHash}|${sha256(payload)}`). frameSha = sha256 of the base64 string itself (here \"aGVsbG8=\"). Implementations hash the stored payload STRING; they never re-serialize it.",
  momentId: id,
  chunks: [c0, c1],
}, null, 2) + "\n");
console.log("head", c1.hash);

// ── v3 (docs/ARCHITECTURE.md "v3"): a GUEST Moment with witness events, the bar mapping and the ladder math.
// The chain format is unchanged: witness events are ordinary `events` entries inside the hashed payload, and nothing
// in the chain binds an owner uid, so the same chunks stay valid when a guest Moment is claimed by any account.
const gid = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const ask = "Hold the fish next to the ruler";
const g0 = chunk(0, 1764100000000, 1764100005000, "GENESIS:" + gid, JSON.stringify({
  gps: [[1764100000000, 33.6189, -117.6681, 5.2, null, 0.4]],
  motion: [[1764100000100, 0.01, 9.81, -0.2, 0, 0.001, 0]],
  events: [
    { t: 1764100000000, type: "start" },
    { t: 1764100003000, type: "witness", wid: "w1", ask, kind: "show", by: "on_device" },
  ],
  frameSha: null,
  check: null,
}));
const g1 = chunk(1, 1764100005000, 1764100008000, g0.hash, JSON.stringify({
  gps: [],
  motion: [],
  events: [
    { t: 1764100008000, type: "frame", wid: "w1" },
    { t: 1764100008000, type: "witness_answer", wid: "w1", via: "frame" },
  ],
  frameSha: h("aGVsbG8="),
  check: { ok: true, reason: "keep going", mode: "on_device", label: "bass on ruler" },
}));
const g2 = chunk(2, 1764100008000, 1764100030000, g1.hash, JSON.stringify({
  gps: [[1764100029000, 33.619, -117.668, 5.0, null, 0.2]],
  motion: [],
  events: [
    { t: 1764100020000, type: "witness", wid: "w2", ask: "Say the time on your watch", kind: "tell", by: "cloud" },
    { t: 1764100024000, type: "witness_answer", wid: "w2", via: "voice", text: "it's six forty two" },
    { t: 1764100026000, type: "witness", wid: "w3", ask: "Pan slowly across the lake", kind: "show", by: "on_device" },
    { t: 1764100028000, type: "witness_skip", wid: "w3" },
    { t: 1764100030000, type: "stop" },
  ],
  frameSha: null,
  check: null,
}));

// bar = round2(0.5 + 0.45 * clamp01(difficulty)). Round half away from zero on 2 decimals: Math.round(x * 100) / 100.
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const barOf = (d) => Math.round((0.5 + 0.45 * clamp01(d)) * 100) / 100;
const bars = [0, 0.1, 0.2, 0.5, 0.67, 1, 1.4, -0.3].map((difficulty) => ({ difficulty, bar: barOf(difficulty) }));

// Ladder: pass p' = p + s(1-p), fail p' = p(1-s), applied in run order, no rounding between steps.
const step = (p, s, passed) => (passed ? p + s * (1 - p) : p * (1 - s));
function ladder(baseline, bar, runs) {
  let p = baseline;
  const steps = runs.map(([module, strength, passed]) => {
    const before = p;
    p = step(p, strength, passed);
    return { module, strength, passed, before, after: p };
  });
  return { baseline, bar, steps, score: p, verified: p >= bar };
}
const ladders = [
  ladder(0.62, 0.8, [["full_video", 0.45, true]]),
  ladder(0.62, 0.8, [["count_measure", 0.3, true], ["second_look", 0.2, true]]),
  ladder(0.62, 0.8, [["second_look", 0.2, false], ["place_time", 0.2, true]]),
  ladder(0.62, 0.8, [["full_video", 0.45, true], ["second_look", 0.2, true]]),
  ladder(0.55, 0.5, [["witness_review", 0.3, true]]),
  ladder(0.55, 0.5, [["witness_review", 0.3, false]]),
];

writeFileSync(new URL("./test-vectors-v3.json", import.meta.url), JSON.stringify({
  note: "v3 vectors. guestChain: same hashing as test-vectors.json; witness events live in the payload; no owner uid anywhere in the chain. bars: bar = round2(0.5 + 0.45*clamp01(difficulty)). ladders: pass p+s(1-p), fail p(1-s), in order, no intermediate rounding; verified = score >= bar.",
  guestChain: { momentId: gid, headHash: g2.hash, chunks: [g0, g1, g2] },
  bars,
  ladders,
}, null, 2) + "\n");
console.log("v3 guest head", g2.hash);
