// Voice interview -> structured intention (docs/ARCHITECTURE.md v3.2). Turns run PREFER_ON_DEVICE, the final
// structuring ONLY_IN_CLOUD, the bar preview PREFER_ON_DEVICE; every bubble says which side answered.
// Voice is optional at every step: the text field is always there, and "Skip, just type it" keeps the v1 form.
import { useEffect, useRef, useState } from "react";
import { barPreview, interviewTurn, structureIntention, type Route } from "../ai";
import { configured } from "../firebase";
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
import { CATEGORIES, type Intention, type Quantity } from "../types";
import { listen, speak, stopSpeaking, sttSupported, ttsSupported, type Listening } from "../voice";
import { withoutClaim } from "../v4";
import { PlanCard } from "./Plan";

const OPENER = "What are you about to do?";
const MAX_QUESTIONS = 3;

export function RouteChip({ mode }: { mode: Route | "none" | undefined }) {
  if (!mode || mode === "none") return null;
  return <span className={`chip chip-route ${mode === "on_device" ? "chip-device" : ""}`}>{mode === "on_device" ? "on-device" : "cloud"}</span>;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mic-icon">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

interface Preview {
  bar: number;
  difficulty: number;
  rationale: string;
  factors: string[];
  mode: Route;
}

export default function Interview({ onStart, onSkip, guest }: { onStart: (i: Intention, transcript: string[]) => void; onSkip: () => void; guest: boolean }) {
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
        guest={guest}
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
      <h1>Record a Moment</h1>
      <p className="lede">Say it the way you'd tell a friend. A few quick questions, then recording starts.</p>
      <ol className="talk" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className={`bubble bubble-${t.who}`}>
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
            <MicIcon />
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
          <button className="btn btn-small" disabled={busy || !typed.trim()}>
            Send
          </button>
        </form>
      </div>
      <div className="talk-foot">
        {ttsSupported() && (
          <button type="button" className="btn btn-quiet btn-small" aria-pressed={voiceOut} onClick={() => (voiceOut ? (stopSpeaking(), setVoiceOut(false)) : setVoiceOut(true))}>
            Spoken replies: {voiceOut ? "on" : "off"}
          </button>
        )}
        {turns.some((t) => t.who === "me") && (
          <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => void finish(turnsRef.current, draftRef.current)}>
            That's it, write it up
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-small" onClick={onSkip}>
          Skip, just type it
        </button>
      </div>
      {!canListen && <p className="muted small">Voice input isn't available in this browser, so type your answers.</p>}
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
  guest,
  onChange,
  onBack,
  onStart,
}: {
  intention: Intention;
  preview: Preview | null;
  guest: boolean;
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
      <p className="lede">Check it, fix anything the AI assumed, then start. It can't change once you finish.</p>
      <div className="claim-card">
        <label className="field">
          <span className="field-label">In one sentence</span>
          <textarea value={i.text} maxLength={200} rows={2} onChange={(e) => onChange({ ...i, text: e.target.value })} />
        </label>
        <dl className="claim-facts">
          {i.goal && (
            <div>
              <dt>Counts as done when</dt>
              <dd>
                <input value={i.goal} maxLength={120} onChange={(e) => onChange({ ...i, goal: e.target.value })} aria-label="Goal" />
              </dd>
            </div>
          )}
          {!!i.quantities?.length && (
            <div>
              <dt>Numbers</dt>
              <dd>
                <Chips label="Numbers" items={i.quantities.map(qText)} onRemove={(n) => onChange({ ...i, quantities: without(i.quantities, n) })} />
              </dd>
            </div>
          )}
          {(where || i.place?.lat != null) && (
            <div>
              <dt>Where</dt>
              <dd>
                {where || "Here"}
                {i.place?.lat != null && <span className="muted small"> · GPS {i.place.lat.toFixed(3)}, {i.place.lng?.toFixed(3)}</span>}
              </dd>
            </div>
          )}
          {i.window?.expectedMinutes ? (
            <div>
              <dt>Expected</dt>
              <dd>about {i.window.expectedMinutes} min</dd>
            </div>
          ) : null}
          {!!i.conditions?.length && (
            <div>
              <dt>Conditions</dt>
              <dd>
                <Chips label="Conditions" items={i.conditions} onRemove={(n) => onChange({ ...i, conditions: without(i.conditions, n) })} />
              </dd>
            </div>
          )}
          {!!i.assumptions?.length && (
            <div>
              <dt>The AI assumed</dt>
              <dd>
                <Chips label="Assumptions" items={i.assumptions} onRemove={(n) => onChange({ ...i, assumptions: without(i.assumptions, n) })} />
              </dd>
            </div>
          )}
        </dl>
        <div className="cats" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={i.category === c} className={`cat-chip ${i.category === c ? "on" : ""}`} onClick={() => onChange({ ...i, category: c })}>
              {c}
            </button>
          ))}
        </div>
        <PlanCard
          claims={i.claims ?? []}
          plan={i.plan}
          onRemoveClaim={(id) => {
            const { claims, plan } = withoutClaim(i.claims ?? [], i.plan, id);
            onChange({ ...i, claims, plan });
          }}
        />
        <BarPreview preview={preview} />
        <p className="muted small">
          Interview: {i.interview?.turns ?? 0} answer{i.interview?.turns === 1 ? "" : "s"}, {i.interview?.mode === "on_device" ? "on-device" : i.interview?.mode}
        </p>
      </div>
      <button className="btn btn-primary btn-big" type="submit" disabled={!i.text.trim()}>
        Start Moment
      </button>
      <button type="button" className="btn btn-quiet" onClick={onBack}>
        Back to the interview
      </button>
      <p className="muted small">
        Uses your location, motion sensor and camera while recording. Works offline.{" "}
        {guest ? "As a guest, the Moment stays on this device until you sign in to upload it." : "It syncs when you're back online."}
      </p>
    </form>
  );
}

export function BarPreview({ preview }: { preview: Preview | null }) {
  if (!preview)
    return (
      <div className="barbox barbox-wait">
        <p className="muted small">The bar this claim must clear is set by a Cloud Function when you finish.</p>
      </div>
    );
  return (
    <div className="barbox">
      <div className="barbox-head">
        <strong>Bar ≈ {preview.bar.toFixed(2)}</strong>
        <span className="muted small">(preview)</span>
        <RouteChip mode={preview.mode} />
      </div>
      <span className="barbox-meter" aria-hidden="true">
        <span style={{ left: `${preview.bar * 100}%` }} />
      </span>
      {preview.rationale && <p className="small">{preview.rationale}</p>}
      <p className="muted small">The score the evidence must reach to count as Verified. The binding bar is set server-side when you finish.</p>
    </div>
  );
}
