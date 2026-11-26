// Voice interview -> structured intention (docs/ARCHITECTURE.md v3.2). Turns run PREFER_ON_DEVICE, the final
// structuring ONLY_IN_CLOUD, the bar preview PREFER_ON_DEVICE; every bubble says which side answered.
// Voice is optional at every step: the text field is always there, and "Skip, just type it" keeps the v1 form.
import { useEffect, useRef, useState } from "react";
import { barPreview, interviewTurn, structureIntention, type Route } from "../ai";
import { configured, FIXTURES } from "../firebase";
import {
  barFromDifficulty,
  buildContext,
  compactIntention,
  interviewMode,
  normalizeIntention,
  transcriptText,
  wantsToStart,
  type InterviewContext,
  type Turn,
} from "../intention";
import type { Intention, Quantity } from "../types";
import { listen, speak, stopSpeaking, sttSupported, ttsSupported, type Listening } from "../voice";
import { withoutClaim } from "../v4";
import { PlanCard } from "./Plan";
import { Glyph, Hybrid, ScoreRing } from "../kit";

const OPENER = "What are you about to do?";

/**
 * Sample-data builds have no model; `?plan=demo` writes up a canned v4 draft (claims + evidence plan, the shape
 * interviewTurn/structureIntention return) so the end card, the plan-driven record screen and its checklist can be
 * seen and tested. Never active in a configured build.
 */
const PLAN_DEMO = FIXTURES && typeof location !== "undefined" && new URLSearchParams(location.search).get("plan") === "demo";
const DEMO_PLAN = {
  claims: [
    { id: "c1", kind: "action", text: "clapping", metric: "", value: 0, unit: "" },
    { id: "c2", kind: "count", text: "50 claps", metric: "claps", value: 50, unit: "claps" },
  ],
  plan: {
    requirements: [
      { id: "r1", claimId: "c1", evidence: "video", ask: "Clap on camera, both hands in frame", minSeconds: 0 },
      { id: "r2", claimId: "c2", evidence: "video", ask: "One continuous video of all 50 claps", minSeconds: 20 },
      { id: "r3", claimId: "c1", evidence: "witness", ask: "Answer the witness once while you clap", minSeconds: 0 },
    ],
    recordMode: "video",
    note: "One unbroken clip is enough; count out loud if you like.",
  },
};
const MAX_QUESTIONS = 3;

export function RouteChip({ mode }: { mode: Route | "none" | undefined }) {
  if (!mode || mode === "none") return null;
  return <Hybrid mode={mode} className="chip-route" />;
}

function MicIcon() {
  return <Glyph name="mic" className="mic-icon" />;
}

interface Preview {
  bar: number;
  difficulty: number;
  rationale: string;
  factors: string[];
  mode: Route;
}

export default function Interview({ onStart, onSkip }: { onStart: (i: Intention, transcript: string[]) => void; onSkip: () => void }) {
  // State for rendering, refs for the async loop (a hands-free turn starts from a stale closure otherwise).
  const [turns, setTurnsState] = useState<Turn[]>([{ who: "ai", text: OPENER }]);
  const turnsRef = useRef(turns);
  const setTurns = (t: Turn[]) => {
    turnsRef.current = t;
    setTurnsState(t);
  };
  const draftRef = useRef<Record<string, unknown>>({});
  const [phase, setPhase] = useState<"talk" | "thinking" | "structuring" | "card">("talk");
  const [listening, setListening] = useState<Listening | null>(null);
  const [partial, setPartial] = useState("");
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [voiceOut, setVoiceOut] = useState(ttsSupported());
  const [intention, setIntention] = useState<Intention | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const pos = useRef<{ lat: number; lng: number } | null>(null);
  const ctx = useRef<InterviewContext>(buildContext(null));
  const handsFree = useRef(false);
  const spokeOpener = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const canListen = sttSupported();

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        pos.current = { lat: p.coords.latitude, lng: p.coords.longitude };
        ctx.current = buildContext(pos.current);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
    return () => {
      stopSpeaking();
    };
  }, []);
  useEffect(() => {
    if (turns.length > 1) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [turns, partial, phase]);

  const say = async (text: string) => {
    if (voiceOut) await speak(text);
  };

  async function startListening() {
    setErr(null);
    if (!spokeOpener.current) {
      spokeOpener.current = true;
      await say(OPENER); // first gesture: browsers only allow speech after one
    }
    const l = listen(setPartial);
    setListening(l);
    try {
      const heard = await l.done;
      setPartial("");
      setListening(null);
      if (heard) {
        handsFree.current = true;
        await handle(heard);
      }
    } catch (e) {
      setListening(null);
      setPartial("");
      setErr(String((e as Error)?.message ?? e));
    }
  }

  async function handle(said: string) {
    const next: Turn[] = [...turnsRef.current, { who: "me", text: said.slice(0, 300) }];
    setTurns(next);
    const asked = next.filter((t) => t.who === "ai" && t.mode).length;
    if (wantsToStart(said) && next.some((t, i) => t.who === "me" && i < next.length - 1)) return finish(next, draftRef.current);
    setPhase("thinking");
    try {
      if (!configured) throw new Error("no model in this build");
      const r = await interviewTurn(ctx.current, draftRef.current, transcriptText(next));
      const withAi: Turn[] = [...next, { who: "ai", text: r.say || "Got it.", mode: r.mode }];
      setTurns(withAi);
      draftRef.current = r.draft;
      const done = r.done || asked + 1 >= MAX_QUESTIONS;
      if (done) {
        await say(r.say);
        return finish(withAi, r.draft);
      }
      setPhase("talk");
      await say(r.say);
      if (handsFree.current && canListen) void startListening();
    } catch (e) {
      console.warn("interview turn unavailable", e);
      const withAi: Turn[] = [...next, { who: "ai", text: "I can't reach a model right now, so I'll write it up from what you said.", mode: "none" }];
      setTurns(withAi);
      return finish(withAi, draftRef.current);
    }
  }

  async function finish(all: Turn[], lastDraft: Record<string, unknown>) {
    stopSpeaking();
    handsFree.current = false;
    setPhase("structuring");
    const said = all.filter((t) => t.who === "me").map((t) => t.text);
    const modes: (Route | "none" | undefined)[] = all.filter((t) => t.who === "ai").map((t) => t.mode);
    let fields: Record<string, unknown> = lastDraft;
    if (configured && navigator.onLine) {
      try {
        const s = await structureIntention(ctx.current, transcriptText(all), lastDraft);
        fields = s.fields;
        modes.push(s.mode);
      } catch (e) {
        console.warn("cloud structuring unavailable; keeping the on-device draft", e);
      }
    }
    if (PLAN_DEMO && !Array.isArray(fields.claims)) fields = { ...fields, ...DEMO_PLAN };
    const i = normalizeIntention(fields, {
      pos: pos.current,
      start: Date.now(),
      turns: all.filter((t) => t.who === "me").length,
      mode: interviewMode(modes),
      fallbackText: said.join(". "),
    });
    setIntention(i);
    setPhase("card");
    if (configured) {
      try {
        const b = await barPreview(i, ctx.current);
        const p = { bar: barFromDifficulty(b.difficulty), difficulty: b.difficulty, rationale: b.rationale, factors: b.factors, mode: b.mode };
        setPreview(p);
        setIntention((cur) => (cur ? { ...cur, preview: { bar: p.bar, difficulty: p.difficulty, mode: p.mode } } : cur));
      } catch (e) {
        console.warn("bar preview unavailable", e);
      }
    }
  }

  if (phase === "card" && intention)
    return (
      <ClaimCard
        intention={intention}
        preview={preview}
        onChange={setIntention}
        onBack={() => {
          setPhase("talk");
          setIntention(null);
          setPreview(null);
        }}
        onStart={() =>
          onStart(
            compactIntention({ ...intention, window: { start: Date.now(), expectedMinutes: intention.window?.expectedMinutes ?? null } }),
            turns.map((t) => `${t.who}: ${t.text}`),
          )
        }
      />
    );

  const busy = phase !== "talk";
  return (
    <div className="page interview">
      <header className="iv-head">
        <span className="iv-steps" aria-hidden="true">
          <span className="wpdot wpdot-intent" />
          <i />
          <span className="wpdot wpdot-proof" />
          <i />
          <span className="wpdot wpdot-result" />
        </span>
        <h1>Record a Moment</h1>
        <p className="lede">Say what you're about to do. A few questions, then you record.</p>
      </header>
      <ol className="talk" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={`bubble bubble-${t.who}`}>
            {t.who === "ai" && (
              <span className="bubble-av" aria-hidden="true">
                <Glyph name="ai" />
              </span>
            )}
            <p>{t.text}</p>
            {t.who === "ai" && <RouteChip mode={t.mode} />}
          </li>
        ))}
        {partial && (
          <li className="bubble bubble-me bubble-partial">
            <p>{partial}</p>
          </li>
        )}
        {busy && (
          <li className="bubble bubble-ai bubble-wait" aria-label="Thinking">
            <span className="bubble-av" aria-hidden="true">
              <Glyph name="ai" />
            </span>
            <p>{phase === "structuring" ? "Writing it up…" : "…"}</p>
          </li>
        )}
      </ol>
      <div ref={end} />
      {err && <p className="notice notice-bad small">{err} You can type instead.</p>}
      <div className="talk-bar">
        {canListen && (
          <button
            type="button"
            className={`mic ${listening ? "mic-on" : ""}`}
            aria-pressed={!!listening}
            disabled={busy}
            onClick={() => (listening ? listening.stop() : void startListening())}
          >
            <span className="mic-disc" aria-hidden="true">
              <MicIcon />
            </span>
            <span>{listening ? "Listening… tap to stop" : "Tap to talk"}</span>
          </button>
        )}
        <form
          className="talk-type"
          onSubmit={(e) => {
            e.preventDefault();
            const v = typed.trim();
            if (!v || busy) return;
            setTyped("");
            handsFree.current = false;
            void handle(v);
          }}
        >
          <label className="sr-only" htmlFor="talk-input">
            Type your answer
          </label>
          <input
            id="talk-input"
            value={typed}
            maxLength={300}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={canListen ? "…or type it" : "Type it: going fishing, a 5 km run…"}
            autoComplete="off"
          />
          <button className="btn btn-small btn-send" disabled={busy || !typed.trim()}>
            <Glyph name="up" />
            <span>Send</span>
          </button>
        </form>
      </div>
      <div className="talk-foot">
        {ttsSupported() && (
          <button type="button" className="btn btn-quiet btn-small" aria-pressed={voiceOut} onClick={() => (voiceOut ? (stopSpeaking(), setVoiceOut(false)) : setVoiceOut(true))}>
            <Glyph name={voiceOut ? "speaker" : "mute"} /> Spoken replies: {voiceOut ? "on" : "off"}
          </button>
        )}
        {turns.some((t) => t.who === "me") && (
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void finish(turnsRef.current, draftRef.current)}>
            <Glyph name="check" /> That's it, write it up
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-small" onClick={onSkip}>
          <Glyph name="type" /> Skip, just type it
        </button>
      </div>
      {!canListen && <p className="muted small">No voice input in this browser: type your answers.</p>}
    </div>
  );
}

function Chips({ items, onRemove, label }: { items: string[]; onRemove: (i: number) => void; label: string }) {
  if (!items.length) return null;
  return (
    <ul className="tagrow" aria-label={label}>
      {items.map((x, i) => (
        <li key={i} className="tag">
          {x}
          <button type="button" aria-label={`Remove ${x}`} onClick={() => onRemove(i)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

const qText = (q: Quantity) => `${q.metric} ${q.value}${q.unit ? " " + q.unit : ""} · by ${q.measuredBy}`;

/** The structured claim, editable, with the bar preview. */
function ClaimCard({
  intention: i,
  preview,
  onChange,
  onBack,
  onStart,
}: {
  intention: Intention;
  preview: Preview | null;
  onChange: (i: Intention) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const without = <T,>(xs: T[] | undefined, n: number) => (xs ?? []).filter((_, k) => k !== n);
  const where = i.place ? [i.place.name, i.place.region, i.place.country].filter(Boolean).join(", ") : "";
  return (
    <form
      className="page claim"
      onSubmit={(e) => {
        e.preventDefault();
        onStart();
      }}
    >
      <h1>Here's your claim.</h1>
      <p className="lede">Fix anything the AI assumed. It locks when you finish.</p>
      <div className="claim-card">
        <label className="field field-intent">
          <span className="field-label">
            <span className="wpdot wpdot-intent" aria-hidden="true" /> In one sentence
          </span>
          <textarea value={i.text} maxLength={200} rows={2} onChange={(e) => onChange({ ...i, text: e.target.value })} />
        </label>
        <dl className="claim-facts">
          {i.goal && (
            <div>
              <dt>
                <Glyph name="flag" /> Counts as done when
              </dt>
              <dd>
                <input value={i.goal} maxLength={120} onChange={(e) => onChange({ ...i, goal: e.target.value })} aria-label="Goal" />
              </dd>
            </div>
          )}
          {!!i.quantities?.length && (
            <div>
              <dt>
                <Glyph name="hash" /> Numbers
              </dt>
              <dd>
                <Chips label="Numbers" items={i.quantities.map(qText)} onRemove={(n) => onChange({ ...i, quantities: without(i.quantities, n) })} />
              </dd>
            </div>
          )}
          {(where || i.place?.lat != null) && (
            <div>
              <dt>
                <Glyph name="gps" /> Where
              </dt>
              <dd>
                {where || "Here"}
                {i.place?.lat != null && <span className="muted small"> · GPS {i.place.lat.toFixed(3)}, {i.place.lng?.toFixed(3)}</span>}
              </dd>
            </div>
          )}
          {i.window?.expectedMinutes ? (
            <div>
              <dt>
                <Glyph name="timing" /> Expected
              </dt>
              <dd>about {i.window.expectedMinutes} min</dd>
            </div>
          ) : null}
          {!!i.conditions?.length && (
            <div>
              <dt>
                <Glyph name="info" /> Conditions
              </dt>
              <dd>
                <Chips label="Conditions" items={i.conditions} onRemove={(n) => onChange({ ...i, conditions: without(i.conditions, n) })} />
              </dd>
            </div>
          )}
          {!!i.assumptions?.length && (
            <div>
              <dt>
                <Glyph name="ai" /> The AI assumed
              </dt>
              <dd>
                <Chips label="Assumptions" items={i.assumptions} onRemove={(n) => onChange({ ...i, assumptions: without(i.assumptions, n) })} />
              </dd>
            </div>
          )}
        </dl>
        <PlanCard
          claims={i.claims ?? []}
          plan={i.plan}
          onRemoveClaim={(id) => {
            const { claims, plan } = withoutClaim(i.claims ?? [], i.plan, id);
            onChange({ ...i, claims, plan });
          }}
        />
        <BarPreview preview={preview} />
        <p className="muted small iv-meta">
          <Glyph name="mic" /> {i.interview?.turns ?? 0} answer{i.interview?.turns === 1 ? "" : "s"}
          {i.interview?.mode === "on_device" || i.interview?.mode === "cloud" ? <Hybrid mode={i.interview.mode} /> : i.interview?.mode ? <span>{i.interview.mode}</span> : null}
        </p>
      </div>
      <div className="start-dock">
        <button type="button" className="btn btn-quiet" onClick={onBack}>
          <Glyph name="back" />
          <span className="dock-label">Back to the interview</span>
        </button>
        <button className="btn btn-primary btn-big btn-start" type="submit" disabled={!i.text.trim()}>
          <Glyph name="record" /> Start Moment
        </button>
      </div>
    </form>
  );
}

export function BarPreview({ preview }: { preview: Preview | null }) {
  if (!preview)
    return (
      <div className="barbox barbox-wait">
        <ScoreRing value={null} size={52} />
        <p className="muted small">The bar to clear is set by a Cloud Function when you finish.</p>
      </div>
    );
  return (
    <div className="barbox">
      <span className="bar-ring" role="img" aria-label={`Bar preview ${preview.bar.toFixed(2)}`}>
        <ScoreRing value={null} bar={preview.bar} size={60} className="ring-bar-only" />
        <b aria-hidden="true">{Math.round(preview.bar * 100)}</b>
      </span>
      <div>
        <div className="barbox-head">
          <strong>Bar ≈ {preview.bar.toFixed(2)}</strong>
          <span className="muted small">(preview)</span>
          <RouteChip mode={preview.mode} />
        </div>
        {preview.rationale && <p className="small">{preview.rationale}</p>}
        <p className="muted small">The score the evidence must reach. Set for real when you finish.</p>
      </div>
    </div>
  );
}
