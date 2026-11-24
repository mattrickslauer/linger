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
