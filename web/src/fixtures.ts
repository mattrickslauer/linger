// Dev-only sample data (VITE_FIXTURES=true): four Moments built at runtime with the real chain code,
// so "Re-verify chain in your browser" genuinely passes (and fails where a fixture was tampered with).
// The backend's seed script replaces this once the emulator is running.

import { makeChunk, sha256hex } from "./chain";
import { computeSummary, downsample } from "./geo";
import { paintScene, type SceneKind } from "./scene";
import type { AiOpinion, AppEvent, Category, Chunk, FeedEntry, GpsRow, LadderResult, LiveCheck, ModuleId, Moment, MotionRow, Platform, SealChecks } from "./types";
import { barFromDifficulty } from "./intention";
import { factsOf, scoreV4, sealReasonV4, type Claim, type Plan, type ScoreInput, type VideoReview } from "./v4";

export interface FixtureSet {
  feed: FeedEntry[];
  moments: Record<string, Moment>;
  chunks: Record<string, Chunk[]>;
}

interface Spec {
  id: string;
  owner: string;
  text: string;
  category: Category;
  platform: Platform;
  device: Moment["device"];
  center: [number, number];
  minutes: number;
  speed: number; // m/s while moving
  bob: number; // motion amplitude
  frames: { at: number; scene: SceneKind; label: string; ok?: boolean; reason?: string }[]; // at = fraction of session
  hero: number; // index into frames
  mode: "on_device" | "cloud";
  agoH: number;
  checks: SealChecks;
  sealReason: string;
  judge: Omit<AiOpinion, "model" | "ranAt">;
  skeptic: Omit<AiOpinion, "model" | "ranAt">;
  score: { probability: number; reasons: string[] };
  teleportAt?: number;
}

const ALL_OK: SealChecks = { chain: true, timing: true, physics: true, frames: true, ai: true, bar: true };

/** v3 sample data per Moment: the server's bar, and ladder results already run by the owner. */
interface V3Fixture {
  difficulty: number;
  rationale: string;
  factors: string[];
  ladder: { module: ModuleId; title: string; cost: number; strength: number; passed: boolean; confidence: number; reasons: string[] }[];
  witness: { asked: number; answered: number; skipped: number };
}
const V3: Record<string, V3Fixture> = {
  "c1a9f00d-5e2b-4c7a-9d14-3b8e6f2a0c50": {
    difficulty: 0.05,
    rationale: "Anyone can clap 50 times; the only question is whether all 50 happened on camera.",
    factors: ["everyday action", "count is the whole claim"],
    ladder: [],
    witness: { asked: 0, answered: 0, skipped: 0 },
  },
  "7c1e4f0a-2b9d-4c3e-8f61-5a0d9b7e2c14": {
    difficulty: 0.4,
    rationale: "A largemouth bass is common here, but a catch-and-release claim is easy to stage with an old photo.",
    factors: ["common species locally", "autumn, good season", "release is hard to prove"],
    ladder: [
      {
        module: "second_look",
        title: "Second opinion",
        cost: 1,
        strength: 0.2,
        passed: true,
        confidence: 0.82,
        reasons: ["The same fish, hand and shoreline appear in three frames taken minutes apart."],
      },
    ],
    witness: { asked: 2, answered: 2, skipped: 0 },
  },
  "2e9b6d31-84a7-4f0c-b5d2-91c3e7a40f58": {
    difficulty: 0.15,
    rationale: "A popular day hike; the summit sign is a well-known photo spot.",
    factors: ["popular trail", "clear weather", "summit sign photographed often"],
    ladder: [],
    witness: { asked: 1, answered: 1, skipped: 0 },
  },
  "b4d07a9e-3c51-4e26-a8f9-0d6e2b1c7f33": {
    difficulty: 0.1,
    rationale: "A first bowl is a modest, low-stakes claim with little reason to fake.",
    factors: ["personal milestone", "no prize at stake"],
    ladder: [],
    witness: { asked: 0, answered: 0, skipped: 0 },
  },
  "e81f5c27-6a03-4b9d-9e44-c2a7d0b95f16": {
    difficulty: 0.67,
    rationale: "Summiting Whitney takes a long day at altitude; a 90-second session can't show it.",
    factors: ["14,505 ft summit", "full-day effort", "permit season"],
    ladder: [],
    witness: { asked: 1, answered: 0, skipped: 1 },
  },
};

/**
 * v4 sample data (docs/ARCHITECTURE.md v4): the production "clap 50 times" case recorded the v4 way, as a video clip
 * uploaded at submit and reviewed by the free video review. The review backs "clapping" but is unsure of the count,
 * so the Moment sits at 1/2 claims backed: the per-claim rows and the Count & measure offer are visible.
 */
interface V4Fixture {
  claims: Claim[];
  plan: Plan;
  clipFrame: number; // index into frames: the clip's middle frame
  clipSeconds: number;
  judgeClaims: NonNullable<AiOpinion["claims"]>;
  review: Pick<VideoReview, "claims" | "cheating" | "summary">;
}
const V4: Record<string, V4Fixture> = {
  "c1a9f00d-5e2b-4c7a-9d14-3b8e6f2a0c50": {
    claims: [
      { id: "c1", kind: "action", text: "clapping" },
      { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
    ],
    plan: {
      requirements: [
        { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera, both hands in frame" },
        { id: "r2", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 },
      ],
      recordMode: "video",
      note: "One unbroken clip is enough; count out loud if you like.",
    },
    clipFrame: 1,
    clipSeconds: 34,
    judgeClaims: [
      { id: "c1", verdict: "backed", confidence: 0.8 },
      { id: "c2", verdict: "unclear", confidence: 0.3 },
    ],
    review: {
      claims: [
        { id: "c1", verdict: "backed", confidence: 0.92, reasons: ["Both hands clap in frame for the whole clip."] },
        { id: "c2", verdict: "unclear", confidence: 0.5, reasons: ["Counted 47 to 52 claps; motion blur hides a few."], measured: { value: 49, unit: "claps" } },
      ],
      cheating: { detected: false, signals: [] },
      summary: "One continuous 34 s clip of a person clapping at a desk; no cuts, loops or screen re-recording.",
    },
  },
};

const SPECS: Spec[] = [
  {
    id: "c1a9f00d-5e2b-4c7a-9d14-3b8e6f2a0c50",
    owner: "Ana Silva",
    text: "Clap 50 times in a row",
    category: "other",
    platform: "web",
    device: { model: "Chrome 142", os: "Android", appVersion: "1.0.0" },
    center: [38.7223, -9.1393],
    minutes: 1.1,
    speed: 0,
    bob: 1.4,
    frames: [
      { at: 0.15, scene: "bench", label: "desk, hands ready" },
      { at: 0.88, scene: "bench", label: "hands clapping" },
    ],
    hero: 1,
    mode: "on_device",
    agoH: 1,
    checks: ALL_OK,
    sealReason: "",
    judge: {
      verdict: "uncertain",
      confidence: 0.5,
      reasons: ["The frames show hands mid-clap at a desk.", "Still frames can't show how many claps happened."],
    },
    skeptic: { verdict: "consistent", confidence: 0.7, reasons: ["Continuous lighting and the same desk in both frames."] },
    score: { probability: 0.4, reasons: ["Hands clapping are visible, but the count can't be read from frames."] },
  },
  {
    id: "7c1e4f0a-2b9d-4c3e-8f61-5a0d9b7e2c14",
    owner: "Maya Ortiz",
    text: "Catch and release a largemouth bass at Lake Mission Viejo",
    category: "fishing",
    platform: "ios",
    device: { model: "iPhone 17 Pro", os: "iOS 26.1", appVersion: "1.0.0" },
    center: [33.6189, -117.6681],
    minutes: 14,
    speed: 0.7,
    bob: 0.9,
    frames: [
      { at: 0.04, scene: "lake", label: "lake shoreline" },
      { at: 0.3, scene: "cast", label: "rod mid-cast" },
      { at: 0.5, scene: "lake", label: "empty water", ok: false, reason: "Fish not visible, hold it up" },
      { at: 0.82, scene: "bass", label: "bass in hand" },
      { at: 0.93, scene: "release", label: "fish in water" },
    ],
    hero: 3,
    mode: "on_device",
    agoH: 2,
    checks: ALL_OK,
    sealReason: "All six checks passed: intact chain, plausible timing and movement, matching frames, AI agreed, score above the bar.",
    judge: {
      verdict: "consistent",
      confidence: 0.86,
      reasons: [
        "Frame at 11:29 shows a largemouth bass held at the waterline, consistent with the intention.",
        "Earlier frames show the same shoreline and a cast, in a believable order.",
        "Slow shoreline walk of a few hundred metres fits bank fishing.",
        "Release frame shows the fish back in the water.",
      ],
    },
    skeptic: {
      verdict: "consistent",
      confidence: 0.74,
      reasons: ["Lighting and water texture match across all frames.", "No screen edges, moire or print grain detected."],
    },
    score: {
      probability: 0.81,
      reasons: ["The bass is held at the waterline in the same light as the cast frames.", "Release frame is hard to stage after the fact.", "Walk along the shore fits the GPS track."],
    },
  },
  {
    id: "2e9b6d31-84a7-4f0c-b5d2-91c3e7a40f58",
    owner: "Dev Patel",
    text: "Hike the last mile to the summit of Mount Baldy",
    category: "outdoors",
    platform: "android",
    device: { model: "Pixel 10", os: "Android 17", appVersion: "1.0.0" },
    center: [34.2889, -117.6464],
    minutes: 26,
    speed: 1.05,
    bob: 1.6,
    frames: [
      { at: 0.06, scene: "trail", label: "rocky trail" },
      { at: 0.55, scene: "ridge", label: "mountain ridge" },
      { at: 0.95, scene: "summit", label: "summit sign" },
    ],
    hero: 2,
    mode: "on_device",
    agoH: 5,
    checks: ALL_OK,
    sealReason: "All six checks passed: intact chain, plausible timing and movement, matching frames, AI agreed, score above the bar.",
    judge: {
      verdict: "consistent",
      confidence: 0.81,
      reasons: [
        "Final frame shows a summit sign reading 10,064 ft, the elevation of Mount Baldy.",
        "1.6 km over 26 minutes is a steep-trail pace.",
        "Motion shows a steady walking cadence throughout.",
      ],
    },
    skeptic: { verdict: "uncertain", confidence: 0.4, reasons: ["Summit sign is legible but generic; no other hikers to cross-check."] },
    score: { probability: 0.58, reasons: ["Steady climb in GPS and motion fits a real hike.", "Summit sign alone is easy to photograph without the hike, so it adds little."] },
  },
  {
    id: "b4d07a9e-3c51-4e26-a8f9-0d6e2b1c7f33",
    owner: "Sam Lee",
    text: "Turn my first walnut bowl on the lathe",
    category: "making",
    platform: "web",
    device: { model: "Chrome 142", os: "macOS", appVersion: "1.0.0" },
    center: [37.7712, -122.4413],
    minutes: 18,
    speed: 0.02,
    bob: 0.25,
    frames: [
      { at: 0.08, scene: "bench", label: "blank on workbench" },
      { at: 0.9, scene: "bowl", label: "turned wooden bowl" },
    ],
    hero: 1,
    mode: "cloud",
    agoH: 9,
    checks: ALL_OK,
    sealReason: "All six checks passed: intact chain, plausible timing and movement, matching frames, AI agreed, score above the bar.",
    judge: {
      verdict: "consistent",
      confidence: 0.77,
      reasons: ["Same workbench and lighting in both frames.", "Rough blank becomes a finished bowl over 18 minutes.", "Stationary GPS fits a workshop."],
    },
    skeptic: { verdict: "consistent", confidence: 0.62, reasons: ["Wood grain and shavings are continuous between frames."] },
    score: { probability: 0.67, reasons: ["The piece changes shape between frames in a way that takes real work.", "Indoor session gives no GPS evidence either way."] },
  },
  {
    id: "e81f5c27-6a03-4b9d-9e44-c2a7d0b95f16",
    owner: "Jordan K.",
    text: "Summit Mount Whitney",
    category: "outdoors",
    platform: "android",
    device: { model: "Galaxy S26", os: "Android 17", appVersion: "1.0.0" },
    center: [36.5785, -118.2923],
    minutes: 1.5,
    speed: 0.1,
    bob: 0.05,
    frames: [{ at: 0.6, scene: "screen", label: "photo of a monitor", ok: false, reason: "Looks like a screen, shoot the real thing" }],
    hero: 0,
    mode: "cloud",
    agoH: 26,
    teleportAt: 0.5,
    checks: { chain: true, timing: true, physics: false, frames: true, ai: false },
    sealReason: "Rejected: GPS jumped 3.2 km in one second, and the skeptic found a photo of a screen.",
    judge: { verdict: "uncertain", confidence: 0.35, reasons: ["The only frame shows a summit sign, but nothing else places the user there."] },
    skeptic: {
      verdict: "inconsistent",
      confidence: 0.91,
      reasons: ["Frame shows a monitor bezel and scanline moire: this is a photo of a screen.", "A 90-second session cannot include a 14,505 ft summit."],
    },
    score: { probability: 0.03, reasons: ["The only proof is a photo of a screen.", "Session is far too short for the claim."] },
  },
];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

async function buildOne(spec: Spec, seed: number) {
  const r = rng(seed);
  const end = Date.now() - spec.agoH * 3600_000;
  const durMs = Math.round(spec.minutes * 60_000);
  const start = end - durMs;

  // GPS at 1 Hz: a wandering walk with pauses.
  const gps: GpsRow[] = [];
  let [lat, lng] = spec.center;
  let heading = r() * Math.PI * 2;
  for (let t = start; t < end; t += 1000) {
    const f = (t - start) / durMs;
    heading += (r() - 0.5) * 0.35;
    const moving = Math.sin(f * 17 + seed) > -0.6;
    const v = moving ? spec.speed * (0.7 + r() * 0.6) : 0;
    lat += (Math.cos(heading) * v) / 111320;
    lng += (Math.sin(heading) * v) / (111320 * Math.cos((lat * Math.PI) / 180));
    if (spec.teleportAt && Math.abs(f - spec.teleportAt) < 1000 / durMs) lat += 3200 / 111320;
    gps.push([t, r5(lat + (r() - 0.5) * 2e-6), r5(lng + (r() - 0.5) * 2e-6), r3(3 + r() * 4), r3(400 + f * 60), r3(v)]);
  }

  // Motion at 10 Hz: gravity + walking cadence + noise.
  const motion: MotionRow[] = [];
  for (let t = start; t < end; t += 100) {
    const s = (t - start) / 1000;
    const step = Math.sin(s * Math.PI * 2 * 1.8);
    const burst = 0.6 + 0.4 * Math.sin(s / 23 + seed);
    const a = spec.bob * burst;
    motion.push([t, r3(a * 0.3 * Math.sin(s * 5.1) + (r() - 0.5) * 0.2), r3(9.81 + a * step + (r() - 0.5) * 0.3), r3(a * 0.4 * Math.cos(s * 3.6) + (r() - 0.5) * 0.2), r3((r() - 0.5) * 0.1 * a), r3(Math.sin(s * 1.3) * 0.08 * a), r3((r() - 0.5) * 0.06)]);
  }

  // Frames land at the end of their chunk (a chunk closes on a proof shot).
  const n = Math.ceil(durMs / 5000);
  const frameAt = new Map<number, Spec["frames"][number] & { idx: number }>();
  spec.frames.forEach((f, idx) => frameAt.set(Math.min(n - 1, Math.floor(f.at * n)), { ...f, idx }));

  const chunks: Chunk[] = [];
  let prev: string | null = null;
  let checks = 0;
  let retakes = 0;
  let heroSeq: number | null = null;
  // v4: a chained video clip ending at its middle frame's chunk (the clip bytes are not in the sample data).
  const v4 = V4[spec.id];
  const clipSeq = v4 ? [...frameAt.entries()].find(([, f]) => f.idx === v4.clipFrame)?.[0] : undefined;
  const clipEnd = clipSeq != null ? Math.min(end, start + clipSeq * 5000 + 5000) : 0;
  const clipStart = clipEnd - (v4?.clipSeconds ?? 0) * 1000;
  const clipSha = v4 ? await sha256hex("sample clip " + spec.id) : "";
  for (let seq = 0; seq < n; seq++) {
    const t0 = start + seq * 5000;
    const t1 = Math.min(end, t0 + 5000);
    const events: AppEvent[] = [];
    if (seq === 0) events.push({ t: start, type: "start" });
    if (v4 && clipStart >= t0 && clipStart < t1) events.push({ t: clipStart, type: "video_start" });
    if (v4 && seq === clipSeq)
      events.push({ t: t1, type: "video", sha256: clipSha, bytes: 6_400_000, durationMs: v4.clipSeconds * 1000, startedAt: clipStart, name: `verified-${spec.id.slice(0, 8)}-${clipStart}.webm` });
    const f = frameAt.get(seq);
    let frame: Chunk["frame"] = null;
    let check: LiveCheck | null = null;
    let frameSha: string | null = null;
    if (f) {
      const jpegB64 = paintScene(f.scene, seed * 31 + seq);
      frame = { jpegB64, w: 640, h: 480, t: t1 };
      frameSha = await sha256hex(jpegB64);
      const ok = f.ok !== false;
      check = { ok, reason: ok ? "keep going" : f.reason!, mode: spec.mode, label: f.label };
      checks++;
      if (!ok) retakes++;
      events.push({ t: t1, type: "frame" }, { t: t1, type: "check", ok });
      if (!ok) events.push({ t: t1, type: "retake", reason: f.reason });
      if (f.idx === spec.hero) heroSeq = seq;
    }
    if (seq === n - 1) events.push({ t: end, type: "stop" });
    const c = await makeChunk(
      spec.id,
      seq,
      t0,
      t1,
      prev,
      { gps: gps.filter((g) => g[0] >= t0 && g[0] < t1), motion: motion.filter((m) => m[0] >= t0 && m[0] < t1), events, frameSha, check },
      frame,
    );
    chunks.push(c);
    prev = c.hash;
  }

  const summary = computeSummary(start, end, chunks, heroSeq);
  const v3 = V3[spec.id];
  const barValue = barFromDifficulty(v3.difficulty);
  let score = spec.score.probability;
  const modules: LadderResult[] = v3.ladder.map((l, k) => {
    const before = score;
    score = l.passed ? score + l.strength * (1 - score) : score * (1 - l.strength);
    return { ...l, runId: `fixture-${seed}-${k}`, before, after: score, model: "gemini-3.5-pro", ranAt: end + 3_600_000 };
  });
  const sealChecks: SealChecks = { ...spec.checks, bar: score >= barValue };
  const sealed = Object.values(sealChecks).every(Boolean);
  const c5 = sealChecks;
  const integrity = c5.chain && c5.timing && c5.physics && c5.frames && c5.ai;
  const op = (o: Spec["judge"]): AiOpinion => ({ ...o, model: "gemini-3.5-flash", ranAt: end + 40_000 });
  const moment: Moment = {
    id: spec.id,
    ownerUid: "fixture-" + seed,
    owner: { name: spec.owner, photoURL: null },
    intention: { text: spec.text, category: spec.category },
    platform: spec.platform,
    device: spec.device,
    status: sealed ? "sealed" : "rejected",
    startedAt: start,
    endedAt: end,
    chunkCount: chunks.length,
    headHash: prev,
    summary,
    onDevice: { mode: spec.mode, checks, retakes },
    judge: op(spec.judge),
    skeptic: op(spec.skeptic),
    score: { ...spec.score, model: "gemini-3.5-flash", ranAt: end + 40_000 },
    seal: { sealed, at: end + 60_000, checks: sealChecks, reason: spec.sealReason, version: 3, ladderEligible: integrity },
    bar: {
      value: barValue,
      difficulty: v3.difficulty,
      rationale: v3.rationale,
      factors: v3.factors,
      source: "ai",
      model: "gemini-3.5-flash",
      ranAt: end + 20_000,
    },
    verification: { version: 3, baseline: spec.score.probability, score, bar: barValue, verified: score >= barValue, modules },
    witness: { ...v3.witness, mode: "on_device" },
  };
  const hero = chunks.find((c) => c.seq === heroSeq)?.frame?.jpegB64 ?? null;
  const feed: FeedEntry = {
    momentId: spec.id,
    owner: moment.owner!,
    intention: moment.intention,
    platform: spec.platform,
    summary,
    onDeviceMode: spec.mode,
    status: moment.status as FeedEntry["status"],
    sealReason: spec.sealReason,
    checks: sealChecks,
    judgeReasons: spec.judge.reasons,
    verificationScore: score,
    baselineScore: spec.score.probability,
    bar: barValue,
    barRationale: v3.rationale,
    difficulty: v3.difficulty,
    ladder: modules.map((m) => ({ module: m.module, title: m.title, passed: m.passed, before: m.before, after: m.after, reasons: m.reasons.slice(0, 2) })),
    witness: v3.witness,
    sealVersion: 3,
    scoreReasons: spec.score.reasons,
    heroJpegB64: hero,
    track: downsample(gps.map((g) => [g[1], g[2]] as [number, number]), 200),
    sealedAtServer: end + 60_000,
  };
  if (v4) {
    const vr: VideoReview = {
      status: "done",
      clips: [{ sha256: clipSha, ext: "webm", durationMs: v4.clipSeconds * 1000, startedAt: clipStart, uploaded: true, hashOk: true }],
      ...v4.review,
      attempts: 1,
      reason: null,
      model: "gemini-3.5-flash",
      ranAt: end + 50_000,
    };
    Object.assign(moment, {
      intention: { text: spec.text, category: spec.category, v: 4, claims: v4.claims, plan: v4.plan },
      judge: { ...moment.judge!, claims: v4.judgeClaims },
      claims: { items: v4.claims, source: "ai", model: "gemini-3.5-flash", ranAt: end + 20_000 },
      plan: { ...v4.plan, source: "ai" },
      videoReview: vr,
    });
    const input = v4Input(moment, chunks, []);
    FIXTURE_V4_INPUTS[spec.id] = input;
    applyV4Result(moment, feed, input, []);
  }
  return { moment, chunks, feed };
}

// ---------------------------------------------------------------- v4 fixtures: the real v4.5 math, as the server runs it

/** Everything scoreV4 needs, from a v4 sample Moment (integrity from its seal checks). */
function v4Input(m: Moment, chunks: Chunk[], ladder: ScoreInput["ladder"]): ScoreInput {
  const f = factsOf(chunks);
  const c = m.seal!.checks;
  return {
    bar: m.bar!.value,
    baseline: m.score?.probability ?? null,
    claims: m.claims!.items,
    requirements: m.plan!.requirements,
    facts: {
      integrity: { chain: c.chain, timing: c.timing, physics: c.physics, frames: c.frames },
      frameCount: f.frameCount,
      gpsFixes: f.gpsFixes,
      motionSeconds: f.motionSeconds,
      clips: (m.videoReview?.clips ?? []).map((x) => ({ sha256: x.sha256, durationMs: x.durationMs, uploaded: x.uploaded, hashOk: x.hashOk })),
      witness: f.witness,
    },
    judge: m.judge,
    skeptic: m.skeptic,
    videoReview: m.videoReview ?? null,
    ladder,
  };
}

/** Writes seal v4, verification v4 and the feed v4 fields the way the Cloud Function does (v4.6 / v4.8). */
export function applyV4Result(m: Moment, feed: FeedEntry | undefined, input: ScoreInput, modules: LadderResult[]) {
  const r = scoreV4(input);
  const claims = input.claims as Claim[];
  const reason = sealReasonV4(r, claims, input.bar);
  m.seal = {
    sealed: r.sealed,
    at: m.seal?.at ?? Date.now(),
    updatedAt: Date.now(),
    checks: r.checks,
    reason,
    version: 4,
    ladderEligible: r.ladderEligible,
    cheatingSignals: r.cheating.signals,
  };
  m.status = r.sealed ? "sealed" : "rejected";
  m.verification = {
    version: 4,
    baseline: input.baseline,
    baselineUsed: r.baselineUsed,
    score: r.score,
    bar: input.bar,
    verified: r.verified,
    cheating: r.cheating,
    claimsBacked: r.claimsBacked,
    claims: r.claims,
    modules,
  };
  if (!feed) return;
  const met = new Set(r.claims.flatMap((c) => c.met));
  Object.assign(feed, {
    status: m.status,
    sealReason: reason,
    checks: r.checks,
    verificationScore: r.score,
    baselineScore: r.baselineUsed,
    sealVersion: 4,
    claims: r.claims.map((c) => {
      const cl = claims.find((x) => x.id === c.id)!;
      return { id: c.id, kind: cl.kind, text: cl.text, p: c.p, backed: c.p >= input.bar, backedBy: c.backedBy, met: c.met.length, total: c.met.length + c.unmet.length };
    }),
    claimsBacked: r.claimsBacked,
    claimsTotal: r.claims.length,
    cheating: r.cheating.detected,
    cheatingSignals: r.cheating.signals,
    video: m.videoReview ? { reviewed: m.videoReview.status === "done", summary: m.videoReview.summary || null, status: m.videoReview.status } : null,
    plan: m.plan ? { recordMode: m.plan.recordMode, requirements: m.plan.requirements.map((q) => ({ id: q.id, claimId: q.claimId, evidence: q.evidence, ask: q.ask, met: met.has(q.id) })) } : null,
    ladder: modules.map((x) => ({ module: x.module, title: x.title, passed: x.passed, before: x.before, after: x.after, reasons: x.reasons.slice(0, 2) })),
  } satisfies Partial<FeedEntry>);
}

/** The scoreV4 input of each v4 sample Moment, for the simulated ladder (`?ladder=demo`). */
export const FIXTURE_V4_INPUTS: Record<string, ScoreInput> = {};

export async function buildFixtures(): Promise<FixtureSet> {
  const set: FixtureSet = { feed: [], moments: {}, chunks: {} };
  for (let i = 0; i < SPECS.length; i++) {
    const { moment, chunks, feed } = await buildOne(SPECS[i], i + 7);
    set.feed.push(feed);
    set.moments[moment.id] = moment;
    set.chunks[moment.id] = chunks;
  }
  set.feed.sort((a, b) => (b.sealedAtServer ?? 0) - (a.sealedAtServer ?? 0));
  return set;
}

export const FIXTURE_IDS = SPECS.map((s) => s.id);
