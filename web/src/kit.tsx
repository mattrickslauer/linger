// The shared visual vocabulary (docs/superpowers/specs/2026-11-25-ui-overhaul-visual-first.md): one glyph per concept,
// the score ring with the bar tick, the check pips, stat tiles and hybrid badges. Same meaning on every platform.
import type { ReactNode } from "react";
import type { CheckMode, ModuleId, SealChecks } from "./types";
import "./kit.css";

// ------------------------------------------------------------------ glyphs

const PATHS = {
  intent: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" className="g-fill" />
    </>
  ),
  proof: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" className="g-fill" />
    </>
  ),
  seal: (
    <>
      <circle cx="12" cy="9.5" r="6" />
      <path d="M9.2 14.8 7.5 21l4.5-2 4.5 2-1.7-6.2M9.6 9.6l1.7 1.7 3.2-3.4" />
    </>
  ),
  chain: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  timing: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  physics: <path d="M4 17.5a8 8 0 1 1 16 0M12 17.5l3.8-5.2M7 13.2l-.9-.5M12 9.5V8.5M17.9 12.7l-.9.5" />,
  frames: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 15.5-5-5-8.5 8.5" />
    </>
  ),
  ai: <path d="M11 3.5 12.8 8.2 17.5 10 12.8 11.8 11 16.5 9.2 11.8 4.5 10 9.2 8.2zM18 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />,
  witness: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  gps: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  motion: <path d="M3 12h3.5l2.5-6 5 12 2.5-6H21" />,
  ladder: <path d="M4 20h4v-4h4v-4h4V8h4V4" />,
  credits: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m13 6.8-3.2 5.6h4.4L11 17.2" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18h3" />
    </>
  ),
  cloud: <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5-.6 4.6 4.6 0 0 1-.4 9.6z" />,
  bar: <path d="M5.5 21V3.5M5.5 4h12l-2.5 4.2 2.5 4.3h-12" />,
  cheating: <path d="M12 3 19.5 6v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6zM8.8 12l2.2 2.2 4.2-4.4" />,
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5 21 7.5v9l-5-3z" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  route: <path d="M6 17V9.5a3 3 0 0 1 6 0v5a3 3 0 0 0 6 0V7M6 20.5a1.5 1.5 0 1 0 0-.01M18 5a1.5 1.5 0 1 0 0-.01" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  share: <path d="M12 3v12M7 8l5-5 5 5M5 14v5.5h14V14" />,
  back: <path d="M15 5 8 12l7 7" />,
  next: <path d="m9 5 7 7-7 7" />,
  up: <path d="M5 15l7-7 7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5 9.5 17 19 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  feed: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="3" />
      <path d="M10 9.2v5.6l4.6-2.8z" className="g-fill" />
    </>
  ),
  record: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" className="g-fill" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  upload: <path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5-.6 4.6 4.6 0 0 1-.4 9.6M12 20v-8M9 14.5l3-3 3 3" />,
  offline: <path d="M7 18.5a4.5 4.5 0 0 1-.6-9M10 5.2a6 6 0 0 1 7.9 3.7 4.6 4.6 0 0 1 1.4 8.6M3 3l18 18" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2.5" className="g-fill" />,
  play: <path d="M8 5.5v13l10.5-6.5z" className="g-fill" />,
  pause: <path d="M8 5v14M16 5v14" />,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  speaker: <path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />,
  mute: <path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6" />,
  type: <path d="M4 7V5h16v2M12 5v14M9 19h6" />,
  flag: <path d="M5.5 21V3.5M5.5 4h12l-2.5 4.2 2.5 4.3h-12" />,
  hash: <path d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16" />,
} as const;

export type GlyphName = keyof typeof PATHS;

/** An inline SVG glyph. Decorative unless `label` is given (then role="img"). */
export function Glyph({ name, label, className, size }: { name: GlyphName; label?: string; className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`glyph ${className ?? ""}`}
      width={size}
      height={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

// ------------------------------------------------------------------ score ring

export type Tone = "ok" | "bad" | "wait";

/** Arc colour rule: gold if it clears the bar, bad below it, ink-2 while pending. */
export function toneOf(value: number | null | undefined, bar: number | null | undefined, sealed?: boolean | null): Tone {
  if (value == null) return "wait";
  if (bar != null) return value >= bar ? "ok" : "bad";
  if (sealed != null) return sealed ? "ok" : "bad";
  return value >= 0.5 ? "ok" : "bad";
}

/**
 * P(true) as an arc with the big % in the middle and a tick on the ring at the AI-set bar. Replaces
 * "81% likely true · bar 80%" wherever there is room.
 */
export function ScoreRing({
  value,
  bar,
  sealed,
  size = 72,
  caption,
  className,
}: {
  value: number | null | undefined;
  bar?: number | null;
  sealed?: boolean | null;
  size?: number;
  /** a word under the number ("likely true") */
  caption?: string;
  className?: string;
}) {
  const tone = toneOf(value, bar, sealed);
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const pct = value == null ? null : Math.round(v * 100);
  const a = bar == null ? null : (Math.max(0, Math.min(1, bar)) * 2 * Math.PI) - Math.PI / 2;
  const label =
    pct == null
      ? `Not scored yet${bar != null ? `, bar ${Math.round(bar * 100)}%` : ""}`
      : `${pct}% likely true${bar != null ? `, bar ${Math.round(bar * 100)}%, ${v >= bar ? "clears the bar" : "below the bar"}` : ""}`;
  return (
    <span className={`ring ring-${tone} ${className ?? ""}`} style={{ width: size, height: size, ["--ring-size" as string]: `${size}px` }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={r} />
        {pct != null && (
          <circle className="ring-arc" cx="50" cy="50" r={r} strokeDasharray={`${(v * c).toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 50 50)" />
        )}
        {a != null && (
          <line className="ring-tick-bg" x1={50 + Math.cos(a) * 31} y1={50 + Math.sin(a) * 31} x2={50 + Math.cos(a) * 50} y2={50 + Math.sin(a) * 50} />
        )}
        {a != null && (
          <line
            className="ring-tick"
            x1={50 + Math.cos(a) * 31}
            y1={50 + Math.sin(a) * 31}
            x2={50 + Math.cos(a) * 50}
            y2={50 + Math.sin(a) * 50}
          />
        )}
      </svg>
      <span className="ring-num" aria-hidden="true">
        <span>
          {pct == null ? "–" : pct}
          {pct != null && <small>%</small>}
        </span>
        {caption && <em>{caption}</em>}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ check pips

export type CheckKey = keyof SealChecks;
export const CHECK_META: Record<CheckKey, { name: string; glyph: GlyphName }> = {
  chain: { name: "Chain", glyph: "chain" },
  timing: { name: "Timing", glyph: "timing" },
  physics: { name: "Physics", glyph: "physics" },
  frames: { name: "Frames", glyph: "frames" },
  ai: { name: "AI", glyph: "ai" },
  cheating: { name: "No cheating", glyph: "cheating" },
  bar: { name: "Bar", glyph: "bar" },
};
export const FIVE: CheckKey[] = ["chain", "timing", "physics", "frames", "ai"];

/** Small circles in a row, each with its glyph: filled = passed, red ring = failed, grey = pending. */
export function CheckPips({
  checks,
  keys = FIVE,
  labels = false,
  size = "md",
  className,
}: {
  checks: Partial<SealChecks> | null | undefined;
  keys?: CheckKey[];
  labels?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const state = (k: CheckKey) => (checks == null || checks[k] === undefined ? "wait" : checks[k] ? "ok" : "bad");
  const passed = keys.filter((k) => state(k) === "ok").length;
  const desc = keys.map((k) => `${CHECK_META[k].name} ${state(k) === "ok" ? "passed" : state(k) === "bad" ? "failed" : "pending"}`).join(", ");
  return (
    <span
      className={`cpips cpips-${size} ${labels ? "cpips-labels" : ""} ${className ?? ""}`}
      role="img"
      aria-label={checks ? `${passed} of ${keys.length} seal checks passed: ${desc}` : "Seal checks pending"}
    >
      {keys.map((k) => (
        <span key={k} className={`cpip cpip-${state(k)}`} title={`${CHECK_META[k].name}: ${state(k) === "ok" ? "passed" : state(k) === "bad" ? "failed" : "pending"}`}>
          <span className="cpip-dot">
            <Glyph name={CHECK_META[k].glyph} />
          </span>
          {labels && <span className="cpip-name">{CHECK_META[k].name}</span>}
        </span>
      ))}
    </span>
  );
}

// ------------------------------------------------------------------ stats, badges, disclosure

export interface StatItem {
  glyph: GlyphName;
  value: ReactNode;
  label: string;
}

/** Glyph + value + one-word label. `overlay` sits on media (photo, map) with a scrim. */
export function Stats({ items, overlay, className }: { items: StatItem[]; overlay?: boolean; className?: string }) {
  return (
    <dl className={`kstats ${overlay ? "kstats-over" : ""} ${className ?? ""}`}>
      {items.map((s) => (
        <div key={s.label}>
          <dt>
            <Glyph name={s.glyph} />
            <span>{s.label}</span>
          </dt>
          <dd>{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "on device" vs "cloud": the hybrid in one glance. */
export function Hybrid({ mode, className, label }: { mode: CheckMode | "on_device" | "cloud" | undefined | null; className?: string; label?: string }) {
  if (!mode || mode === "none") return null;
  const dev = mode === "on_device";
  return (
    <span className={`hybrid ${dev ? "hybrid-device" : "hybrid-cloud"} ${className ?? ""}`}>
      <Glyph name={dev ? "device" : "cloud"} />
      {label ?? (dev ? "on device" : "cloud")}
    </span>
  );
}

/** A small glyph chip: "witness 2/2", "+1 check". */
export function GlyphChip({ glyph, children, tone, className, title }: { glyph: GlyphName; children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span className={`gchip ${tone ? `gchip-${tone}` : ""} ${className ?? ""}`} title={title}>
      <Glyph name={glyph} />
      {children}
    </span>
  );
}

/** Prose behind a tap: a native <details> styled as a quiet "More" row. */
export function More({ summary = "Why?", children, className, open }: { summary?: ReactNode; children: ReactNode; className?: string; open?: boolean }) {
  return (
    <details className={`more ${className ?? ""}`} open={open}>
      <summary>
        <span>{summary}</span>
        <Glyph name="down" className="more-chev" />
      </summary>
      <div className="more-body">{children}</div>
    </details>
  );
}

/** The three-waypoint mark (Intent → Proof → Result) used as a section marker. */
export function Waypoint({ kind, tone }: { kind: "intent" | "proof" | "result"; tone?: "ok" | "bad" }) {
  return <span className={`wpdot wpdot-${kind} ${tone === "bad" ? "wpdot-bad" : ""}`} aria-hidden="true" />;
}

// ------------------------------------------------------------------ ladder preview

const n2 = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(2));
const clamp01 = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10}%`;

/**
 * Current score → pass / fail outcomes on one track ("0.62 → 0.79 ↑ / 0.50 ↓"), with the bar ticked.
 * The numbers stay as text beside the track.
 */
export function Preview({ from, pass, fail, bar, className }: { from: number | null; pass: number; fail: number; bar?: number | null; className?: string }) {
  const lo = Math.min(pass, fail);
  const hi = Math.max(pass, fail);
  return (
    <span
      className={`pv ${className ?? ""}`}
      role="img"
      aria-label={`now ${n2(from)}; if it passes ${n2(pass)}, if it fails ${n2(fail)}${bar != null ? `; bar ${n2(bar)}` : ""}`}
    >
      <span className="pv-track" aria-hidden="true">
        <span className="pv-range" style={{ left: clamp01(lo), width: clamp01(hi - lo) }} />
        {bar != null && <span className="pv-bar" style={{ left: clamp01(bar) }} />}
        <span className="pv-pt pv-fail" style={{ left: clamp01(fail) }} />
        <span className="pv-pt pv-pass" style={{ left: clamp01(pass) }} />
        {from != null && <span className="pv-pt pv-now" style={{ left: clamp01(from) }} />}
      </span>
      <span className="pv-nums" aria-hidden="true">
        {from != null && (
          <>
            <b>{n2(from)}</b> →{" "}
          </>
        )}
        <span className="up">{n2(pass)} ↑</span> / <span className="down">{n2(fail)} ↓</span>
      </span>
    </span>
  );
}

export const MODULE_GLYPH: Record<ModuleId, GlyphName> = {
  second_look: "ai",
  place_time: "gps",
  witness_review: "witness",
  count_measure: "physics",
  full_video: "video",
  human_review: "me",
};
export const KIND_GLYPH: Record<string, GlyphName> = {
  action: "motion",
  count: "hash",
  measure: "physics",
  place: "gps",
  time: "timing",
  object: "frames",
  outcome: "seal",
};
