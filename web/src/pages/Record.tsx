import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import type { User } from "firebase/auth";
import { claimAndVerify, markClaimPrompted } from "../claim";
import { sha256hex } from "../chain";
import { configured, db, loadCloudModel } from "../firebase";
import { isDeclined, requireSignIn } from "../signin";
import { fmtDistance, fmtDuration } from "../geo";
import { captureFrame, runCloudReview, Session, type LiveState } from "../recorder";
import { CATEGORIES, type Category, type Intention, type Moment } from "../types";
import { jpegSrc, Link } from "../ui";
import Interview, { RouteChip, Uses } from "../components/Interview";
import { Glyph, ScoreRing } from "../kit";
import "../record.css";
import { WitnessAgent } from "../witnessAgent";
import { clipCapMs, ClipRecorder, clipSupported, sha256Bytes } from "../clip";
import { captured, videoStatusText, type Requirement } from "../v4";
import { uploadText, useClipUpload } from "../upload";
import { PlanList } from "../components/Plan";
import { listen, stopSpeaking, sttSupported } from "../voice";
import { structureIntention } from "../ai";
import { buildContext, withDraftClaims } from "../intention";
import type { WitnessRequest } from "../witness";

const EXAMPLES: Record<Category, string> = {
  fishing: "Catch and release a largemouth bass at Lake Mission Viejo",
  fitness: "Run 5 km without stopping",
  outdoors: "Hike to the top of Cowles Mountain",
  making: "Bake a loaf of sourdough from my own starter",
  other: "Plant three tomato seedlings in the garden",
};

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 120 32" aria-hidden="true" />;
  const mn = Math.min(...values),
    mx = Math.max(...values, mn + 0.5);
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * 120).toFixed(1)},${(30 - ((v - mn) / (mx - mn)) * 28).toFixed(1)}`).join("");
  return (
    <svg className="spark" viewBox="0 0 120 32" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** v1 typed form: the "Skip, just type it" path (a plain {text, category} intention stays valid). */
function Setup({ onStart, guest, onVoice }: { onStart: (i: Intention) => void; guest: boolean; onVoice: () => void }) {
  const [cat, setCat] = useState<Category>("fishing");
  const [text, setText] = useState("");
  const [planning, setPlanning] = useState(false);
  return (
    <form
      className="page setup"
      onSubmit={async (e) => {
        e.preventDefault();
        if (planning) return;
        const typed: Intention = { text: text.trim() || EXAMPLES[cat], category: cat };
        let i = typed;
        // v4.1: a typed sentence may get claims + an evidence plan from the cloud before Start (optional, 8 s).
        if (configured && navigator.onLine) {
          setPlanning(true);
          try {
            const s = await structureIntention(buildContext(null), `me: ${typed.text}`, {}, 8000);
            i = withDraftClaims(typed, s.fields);
          } catch (err) {
            console.warn("typed intention: no plan, the server sets claims at submit", err);
          }
          setPlanning(false);
        }
        onStart(i);
      }}
    >
      <h1>What are you about to do?</h1>
      <p className="lede">One sentence. Every proof shot is checked against it.</p>
      <label className="field field-intent">
        <span className="sr-only">Intention</span>
        <textarea value={text} maxLength={200} rows={2} placeholder={EXAMPLES[cat]} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="cats" role="radiogroup" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button type="button" key={c} role="radio" aria-checked={cat === c} className={`cat-chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <Uses guest={guest} />
      <div className="start-dock">
        <button type="button" className="btn btn-quiet" onClick={onVoice}>
          <Glyph name="mic" />
          <span className="dock-label">Use the voice interview instead</span>
        </button>
        <button className="btn btn-primary btn-big btn-start" type="submit" disabled={planning} aria-busy={planning}>
          <Glyph name="record" /> {planning ? "Planning the evidence…" : "Start Moment"}
        </button>
      </div>
    </form>
  );
}

function Live({ session, onDone }: { session: Session; onDone: () => void }) {
  const [s, setS] = useState<LiveState>(session.state);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [canFlip, setCanFlip] = useState(false);
  // Web has no photo flash for a <video> frame grab: "flash" is the torch, where the browser exposes it.
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [torchOk, setTorchOk] = useState(false);
  const [torch, setTorch] = useState(false);

  useEffect(() => {
    session.onChange = setS;
  }, [session]);
  // Full-bleed camera: the phone tab bar and the footer step aside while recording.
  useEffect(() => {
    document.body.classList.add("rec-live");
    return () => document.body.classList.remove("rec-live");
  }, []);

  // The witness runs only while this screen records; recording never waits for it.
  const [agent] = useState(() => new WitnessAgent(session));
  const [witnessStatus, setWitnessStatus] = useState(agent.status);
  useEffect(() => {
    agent.onStatus = setWitnessStatus;
    agent.start();
    return () => {
      agent.stop();
      stopSpeaking();
    };
  }, [agent]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamErr(null);
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false })
      .then((st) => {
        if (cancelled) return st.getTracks().forEach((t) => t.stop());
        stream = st;
        if (video.current) video.current.srcObject = st;
        const t = st.getVideoTracks()[0] ?? null;
        setTrack(t);
        setTorch(false);
        setTorchOk(!!(t?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);
        // Labels/count are only reliable once permission is granted.
        navigator.mediaDevices
          .enumerateDevices()
          .then((ds) => setCanFlip(ds.filter((d) => d.kind === "videoinput").length > 1))
          .catch(() => {});
      })
      .catch((e) => setCamErr(e?.message ?? "Camera unavailable"));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  async function toggleTorch() {
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setTorchOk(false);
    }
  }

  async function shoot(wid?: string) {
    if (!video.current || shooting || clipRef.current) return; // a clip chains its own middle frame
    setShooting(true);
    try {
      const f = captureFrame(video.current);
      setLast(f.jpegB64);
      await session.proofShot(f.jpegB64, await sha256hex(f.jpegB64), f.w, f.h, wid);
    } finally {
      setShooting(false);
    }
  }

  // Video clip: chained by hash as a `video` event, kept in the vault, uploaded at submit and reviewed as video (v4.4).
  const clipRef = useRef<ClipRecorder | null>(null);
  const [clipAt, setClipAt] = useState<number | null>(null);
  const [clipErr, setClipErr] = useState<string | null>(null);
  // Set when a clip lands: the moment people most often don't realise they still need to end the session.
  const [clipSaved, setClipSaved] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // v4: the plan decides how the record screen opens ("Video" when any requirement needs a continuous clip).
  const plan = session.plan;
  const [mode, setMode] = useState<"video" | "photo">(plan?.recordMode === "video" && clipSupported() ? "video" : "photo");
  const capMs = clipCapMs(plan);
  const needSec = Math.max(0, ...(plan?.requirements ?? []).filter((r) => r.evidence === "video").map((r) => r.minSeconds ?? 0));
  async function startClip() {
    if (!video.current || clipRef.current || shooting) return;
    setClipErr(null);
    setClipSaved(false);
    try {
      const r = new ClipRecorder(video.current, capMs);
      clipRef.current = r;
      session.videoStart();
      setClipAt(r.startedAt);
      r.done.then(
        () => clipRef.current === r && void stopClip(),
        () => {},
      );
    } catch (e) {
      setClipErr(String((e as Error)?.message ?? e));
    }
  }
  async function stopClip() {
    const r = clipRef.current;
    if (!r) return;
    clipRef.current = null;
    setClipAt(null);
    setShooting(true);
    try {
      const c = await r.stop();
      setLast(c.middle.jpegB64);
      await session.videoClip({ ...c, sha256: await sha256Bytes(c.blob) });
      setClipSaved(true);
    } catch (e) {
      setClipErr(String((e as Error)?.message ?? e));
    } finally {
      setShooting(false);
    }
  }
  useEffect(() => () => void clipRef.current?.stop(), []);

  const coach = s.coach;
  const short = s.elapsedMs < 20_000;
  const clipMs = clipAt != null ? Math.min(capMs, Math.max(0, Date.now() - clipAt)) : 0;
  const recording = clipAt != null;
  const clipButton = clipSupported() && (
    <button
      className={`shutter shutter-clip ${mode === "video" ? "shutter-main" : "shutter-side"} ${recording ? "on" : ""}`}
      onClick={() => void (recording ? stopClip() : startClip())}
      disabled={!!camErr || (shooting && !recording)}
      aria-pressed={recording}
    >
      <span className="shutter-disc" aria-hidden="true">
        {recording ? <Glyph name="stop" /> : <span className="rec-dot" />}
      </span>
      <span className="shutter-label">
        {recording ? (
          <>
            Stop video {fmtDuration(clipMs)}
            {needSec > 0 && <span className={`clip-need ${clipMs >= needSec * 1000 ? "ok" : ""}`}> / ≥ {fmtDuration(needSec * 1000)}</span>}
          </>
        ) : mode === "video" ? (
          "Record video"
        ) : (
          "Clip"
        )}
      </span>
    </button>
  );
  const shotButton = (
    <button className={`shutter shutter-shot ${mode === "photo" ? "shutter-main" : "shutter-side"}`} onClick={() => void shoot()} disabled={shooting || !!camErr || recording}>
      <span className="shutter-disc" aria-hidden="true">
        <Glyph name="camera" />
      </span>
      <span className="shutter-label">{shooting ? "Checking…" : "Proof shot"}</span>
    </button>
  );
  const witnessText = !agent.available
    ? "off"
    : witnessStatus === "thinking"
      ? "thinking…"
      : witnessStatus === "unavailable"
        ? "quiet"
        : s.witnessAsked
          ? `${s.witnessAnswered}/${s.witnessAsked}`
          : s.elapsedMs < 30_000
            ? "from 0:30"
            : "watching";
  const planDone = plan?.requirements.filter((r) => captured(r, s.facts)).length ?? 0;
  const planComplete = !!plan && plan.requirements.length > 0 && planDone === plan.requirements.length;
  // Nudge toward ending the session once there's something worth verifying and nothing in flight.
  const readyToFinish = !recording && !shooting && !short && !s.witnessOpen && (clipSaved || planComplete);
  async function finish() {
    if (finishing) return;
    setFinishing(true);
    try {
      if (clipRef.current) await stopClip();
      await session.finish();
      onDone();
    } catch (e) {
      console.error("finish failed", e); // shown above as the vault error
      setFinishing(false);
    }
  }
  return (
    <div className="page live">
      <div className="cam on-media">
        <video ref={video} autoPlay playsInline muted className={facing === "user" ? "mirror" : undefined} />
        {camErr && (
          <p className="cam-err">
            <Glyph name="camera" /> Camera unavailable: {camErr}
          </p>
        )}

        {/* HUD: time, live sensors, chain, shots, witness, sync */}
        <div className="hud">
          <div className="hud-row">
            <span className={`hud-time ${recording ? "hud-rec" : ""}`} role="timer" aria-label={`Elapsed ${fmtDuration(s.elapsedMs)}`}>
              <span className="hud-dot" aria-hidden="true" />
              {fmtDuration(s.elapsedMs)}
            </span>
            {short && (
              <span className="hud-pill hud-warn" title="Moments shorter than 20 seconds can't be sealed.">
                min 0:20
              </span>
            )}
            <p className={`sync hud-pill ${s.online && !session.guest ? "" : "sync-off"}`} role="status">
              <Glyph name={session.guest ? "device" : s.online ? "upload" : "offline"} />
              {session.guest
                ? `On this device · ${s.chunks} chunk${s.chunks === 1 ? "" : "s"} chained`
                : s.online ? (s.queued ? `Syncing · ${s.queued} chunks queued` : `Synced · ${s.chunks} chunks`) : `Offline · ${s.queued} chunks queued`}
            </p>
          </div>
          <dl className="hud-row hud-stats">
            <div className={`hud-pill ${s.gps ? "hud-ok" : ""}`} title="Location">
              <dt>
                <Glyph name="gps" />
                <span className="sr-only">location</span>
              </dt>
              <dd>{s.gps ? `±${Math.round(s.gps[3])} m` : (s.gpsError ?? "searching")}</dd>
            </div>
            <div className="hud-pill" title="Distance">
              <dt>
                <Glyph name="route" />
                <span className="sr-only">distance</span>
              </dt>
              <dd>{fmtDistance(s.distanceM)}</dd>
            </div>
            <div className={`hud-pill ${s.motionOn ? "hud-ok" : ""}`} title="Motion">
              <dt>
                <Glyph name="motion" />
                <span className="sr-only">motion</span>
              </dt>
              <dd>{s.motionOn ? <Spark values={s.motionTail} /> : "no sensor"}</dd>
            </div>
            <div className="hud-pill" title="Chunks chained">
              <dt>
                <Glyph name="chain" />
                <span className="sr-only">chunks chained</span>
              </dt>
              <dd>{s.chunks}</dd>
            </div>
            <div className="hud-pill" title="Proof shots">
              <dt>
                <Glyph name="frames" />
                <span className="sr-only">proof shots</span>
              </dt>
              <dd>
                {s.frames}
                {s.retakes ? <small> · {s.retakes}↻</small> : null}
              </dd>
            </div>
            <div className="hud-pill" title="Witness">
              <dt>
                <Glyph name="witness" />
                <span className="sr-only">witness</span>
              </dt>
              <dd>{witnessText}</dd>
            </div>
          </dl>
        </div>

        <div className="cam-side">
          {clipSupported() && (
            <div className="mode-switch" role="radiogroup" aria-label="Record mode">
              {(["video", "photo"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} disabled={recording} onClick={() => setMode(m)}>
                  <Glyph name={m === "video" ? "video" : "camera"} />
                  <span>{m === "video" ? "Video" : "Photo"}</span>
                </button>
              ))}
            </div>
          )}
          <div className="cam-tools">
            {torchOk && (
              <button type="button" className="cam-tool" aria-pressed={torch} aria-label={torch ? "Flash on" : "Flash off"} onClick={toggleTorch}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill={torch ? "currentColor" : "none"} />
                  {!torch && <path d="M3 3l18 18" />}
                </svg>
              </button>
            )}
            {canFlip && (
              <button
                type="button"
                className="cam-tool"
                aria-label={facing === "user" ? "Switch to back camera" : "Switch to front camera"}
                disabled={shooting}
                onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                  <path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2M14 9.5v1.7h-1.7M10 16.5v-1.7h1.7" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="cam-mid">
          {!!plan?.requirements.length && (
            <details className="live-plan" open>
              <summary>
                <h2 id="live-plan-h">
                  <Glyph name="intent" />
                  <span className="sr-only">To get this verified · </span>
                  {planDone}/{plan.requirements.length} captured
                </h2>
                <Glyph name="down" className="more-chev" />
              </summary>
              <PlanList compact requirements={plan.requirements} state={(r) => (captured(r as Requirement, s.facts) ? "captured" : "todo")} />
            </details>
          )}
          <p className="live-intent">{session.intention}</p>
        </div>

        {last && <img className="cam-last" src={jpegSrc(last)} alt="Last proof shot" />}
        {s.witnessOpen?.kind === "show" && (
          <p className="cam-ask" aria-hidden="true">
            <Glyph name="witness" /> {s.witnessOpen.ask}
          </p>
        )}

        <div className="cam-bottom">
          {coach && (
            <p className={`coach-banner ${coach.pending ? "pending" : coach.mode === "none" ? "none" : coach.ok ? "ok" : "bad"}`} role="status">
              <Glyph name={coach.pending ? "ai" : coach.mode === "none" ? "offline" : coach.ok ? "check" : "close"} />
              <span>
                {coach.pending
                  ? "Checking on-device…"
                  : coach.mode === "none"
                    ? "Coach offline: shot kept"
                    : coach.ok
                      ? `${coach.mode === "on_device" ? "On-device" : "Cloud"}: keep going`
                      : `Retake: ${coach.reason}`}
                {!coach.pending && coach.label && <span className="muted"> · {coach.label}</span>}
              </span>
            </p>
          )}
          {s.witnessOpen && (
            <WitnessToast
              req={s.witnessOpen}
              busy={shooting}
              voice={agent.voice}
              onVoice={(v) => {
                agent.voice = v;
                if (!v) stopSpeaking();
              }}
              onShow={() => void shoot(s.witnessOpen!.wid)}
              onAnswer={(via, text) => session.witnessAnswer(via, text)}
              onSkip={() => session.witnessSkip()}
              canShoot={!camErr && clipAt == null}
            />
          )}
          {s.vaultError && (
            <p className="notice notice-bad small" role="alert">
              Couldn't save this Moment's raw data on this device ({s.vaultError}). Recording has stopped writing.
            </p>
          )}
          {clipErr && <p className="notice notice-bad small">Clip: {clipErr}</p>}
          {readyToFinish && (
            <div className="finish-nudge" role="status">
              <Glyph name="check" />
              <span>
                {clipSaved ? "Video saved." : "Everything on the plan is captured."} <strong>All done?</strong> End the session to verify it.
              </span>
              <button type="button" className="btn btn-small finish-nudge-btn" onClick={() => void finish()} disabled={finishing}>
                End &amp; verify
              </button>
            </div>
          )}
          <div className="live-actions">
            <button
              className={`shutter shutter-finish ${readyToFinish ? "ready" : ""}`}
              onClick={() => void finish()}
              disabled={finishing || (shooting && !recording)}
              aria-label={recording ? "Stop video and end session" : "End session and verify"}
            >
              <span className="shutter-disc" aria-hidden="true">
                <Glyph name="check" />
              </span>
              <span className="shutter-label">{finishing ? "Ending…" : "End & verify"}</span>
            </button>
            {mode === "video" ? (
              <>
                {clipButton}
                {shotButton}
              </>
            ) : (
              <>
                {shotButton}
                {clipButton}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The witness's open request: spoken already; Show / Answer / Done / Skip here. */
function WitnessToast({
  req,
  busy,
  canShoot,
  voice,
  onVoice,
  onShow,
  onAnswer,
  onSkip,
}: {
  req: WitnessRequest;
  busy: boolean;
  canShoot: boolean;
  voice: boolean;
  onVoice: (v: boolean) => void;
  onShow: () => void;
  onAnswer: (via: "voice" | "text" | "done", text?: string) => void;
  onSkip: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [heard, setHeard] = useState("");
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(voice);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setTyping(false);
    setText("");
    setHeard("");
    setErr(null);
  }, [req.wid]);
  const talk = async () => {
    setErr(null);
    setListening(true);
    try {
      const said = await listen(setHeard).done;
      setListening(false);
      if (said) onAnswer("voice", said);
    } catch (e) {
      setListening(false);
      setErr(String((e as Error)?.message ?? e));
      setTyping(true);
    }
  };
  return (
    <section className="witness" role="alert" aria-labelledby={`w-${req.wid}`}>
      <div className="witness-head">
        <span className="witness-who">
          <Glyph name="witness" /> Witness
        </span>
        <RouteChip mode={req.by} />
        <button
          type="button"
          className="btn btn-quiet btn-small witness-voice"
          aria-pressed={voiceOn}
          onClick={() => {
            onVoice(!voiceOn);
            setVoiceOn(!voiceOn);
          }}
        >
          <Glyph name={voiceOn ? "speaker" : "mute"} />
          <span className="sr-only">voice {voiceOn ? "on" : "off"}</span>
        </button>
      </div>
      <p className="witness-ask" id={`w-${req.wid}`}>
        {req.ask}
      </p>
      {req.why && (
        <p className="muted small witness-why">
          <Glyph name="intent" /> {req.why}
        </p>
      )}
      {heard && listening && <p className="small">“{heard}”</p>}
      {err && <p className="notice notice-bad small">{err}</p>}
      {typing ? (
        <form
          className="talk-type"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) onAnswer("text", text.trim());
          }}
        >
          <label className="sr-only" htmlFor={`wa-${req.wid}`}>
            Your answer
          </label>
          <input id={`wa-${req.wid}`} value={text} maxLength={200} autoFocus onChange={(e) => setText(e.target.value)} placeholder="Type your answer" />
          <button className="btn btn-small btn-primary" disabled={!text.trim()}>
            Answer
          </button>
        </form>
      ) : (
        <div className="witness-actions">
          {req.kind === "show" && (
            <button className="btn btn-primary" onClick={onShow} disabled={busy || !canShoot}>
              <Glyph name="camera" />
              {busy ? "Checking…" : "Show"}
            </button>
          )}
          {req.kind === "tell" &&
            (sttSupported() ? (
              <button className="btn btn-primary" onClick={() => void talk()} disabled={listening}>
                {listening ? "Listening…" : "Answer"}
              </button>
            ) : null)}
          {(req.kind === "tell" || req.kind === "show") && (
            <button className="btn" onClick={() => setTyping(true)}>
              Type it
            </button>
          )}
          {req.kind === "do" && (
            <button className="btn btn-primary" onClick={() => onAnswer("done")}>
              Done
            </button>
          )}
          <button className="btn btn-quiet" onClick={onSkip}>
            Skip
          </button>
        </div>
      )}
    </section>
  );
}

/** A guest's Moment is finished and chained in this browser; uploading it is the first thing that needs an account. */
function GuestDone({ session, onClaimed }: { session: Session; onClaimed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const up = useClipUpload(session.id);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="page done">
      <span className="done-badge" aria-hidden="true">
        <Glyph name="device" />
      </span>
      <h1>Moment recorded.</h1>
      <p className="lede done-intent">{session.intention}</p>
      <ol className="steps">
        <li className="step step-done">Recorded and chained on this device ({session.chunks.length} chunks)</li>
        <li className="step step-now">On this device · sign in to verify</li>
        {session.hasClips && <li className="step step-todo">Video uploads when you sign in, then a free video review</li>}
        <li className="step step-todo">Cloud judge, skeptic + scorer</li>
        <li className="step step-todo">Deterministic seal by Cloud Function</li>
      </ol>
      {err && <p className="notice notice-bad small">{err}</p>}
      <div className="hero-actions">
        <button
          className="btn btn-primary"
          disabled={!!busy || !configured}
          onClick={async () => {
            setErr(null);
            try {
              markClaimPrompted(); // this action claims it; don't also pop the "recorded as a guest" sheet
              const user = await requireSignIn("upload this Moment and get it verified");
              await claimAndVerify([session.id], user, setBusy);
              onClaimed();
            } catch (e) {
              setBusy(null);
              if (!isDeclined(e)) setErr(`Upload failed: ${String((e as Error)?.message ?? e)}. It stays on this device.`);
            }
          }}
        >
          <Glyph name="upload" /> {busy ? (up?.phase === "uploading" ? uploadText(up) : busy) : "Upload and verify"}
        </button>
        <Link to={`/m/${session.id}`} className="btn">
          <Glyph name="search" /> Open it
        </Link>
        <Link to="/me" className="btn btn-quiet">
          Moments on this device
        </Link>
      </div>
      {!configured && <p className="muted small">This sample-data build can't upload; the Moment stays in this browser.</p>}
    </div>
  );
}

function Done({ session }: { session: Session }) {
  const [m, setM] = useState<Moment | null>(null);
  const [pending, setPending] = useState(true);
  const [review, setReview] = useState<"waiting" | "running" | "done" | "failed">("waiting");
  const [reviewErr, setReviewErr] = useState<string | null>(null);
  const started = useRef(false);
  const up = useClipUpload(session.id);

  useEffect(
    () =>
      onSnapshot(doc(db!, "moments", session.id), { includeMetadataChanges: true }, (snap) => {
        if (snap.exists()) setM({ ...(snap.data() as Moment), id: snap.id });
        setPending(snap.metadata.hasPendingWrites);
      }),
    [session.id],
  );

  // Judge, skeptic + scorer run once we're online and the submit has reached the server.
  useEffect(() => {
    const go = () => {
      if (started.current || !navigator.onLine || !m || m.status !== "submitted" || m.judge || pending) return;
      started.current = true;
      setReview("running");
      runCloudReview(session.id, m, session.framesForJudge()).then(
        () => setReview("done"),
        (e) => {
          started.current = false;
          setReview("failed");
          setReviewErr(String(e?.message ?? e));
        },
      );
    };
    go();
    window.addEventListener("online", go);
    return () => window.removeEventListener("online", go);
  }, [m, pending, session]);

  const vr = m?.videoReview ?? null;
  const submitted = !!m && m.status !== "recording";
  const steps = [
    { name: "Recorded and chained on this device", state: "done" },
    { name: pending ? "Waiting for signal to sync" : "Synced to Firestore", state: pending ? "now" : "done" },
    // v4.4: the clip goes up before the submit, then the server reviews the clip itself (free).
    ...(session.hasClips
      ? [
          {
            name: submitted && (!up || up.phase !== "failed") ? "Video uploaded" : (uploadText(up) ?? (navigator.onLine ? "Uploading video…" : "Video waits for a connection")),
            state: submitted || up?.phase === "done" ? "done" : up?.phase === "failed" ? "bad" : "now",
          },
          {
            name: vr?.status === "done" ? `Video reviewed${vr.summary ? `: ${vr.summary}` : ""}` : (videoStatusText(vr) ?? "Free video review by a Cloud Function"),
            state: !vr ? "todo" : vr.status === "done" ? "done" : vr.status === "running" || vr.status === "waiting" ? "now" : vr.status === "none" ? "done" : "bad",
          },
        ]
      : []),
    {
      name:
        review === "failed"
          ? `Cloud judge, skeptic + scorer failed: ${reviewErr}`
          : m?.judge
            ? `Judge: ${m.judge.verdict}. Skeptic: ${m.skeptic?.verdict ?? "…"}.` +
              (m.score ? ` Score: ${Math.round(m.score.probability * 100)}% likely true` : "")
            : "Cloud judge, skeptic + scorer",
      state: m?.judge ? "done" : review === "running" ? "now" : review === "failed" ? "bad" : "todo",
    },
    {
      // v3.3: the binding bar, set by the Cloud Function from the claim once the Moment is submitted.
      name: m?.bar
        ? `Bar set by ${m.bar.source === "ai" ? "AI" : "default"}: ${m.bar.value.toFixed(2)}${m.claims?.items?.length ? ` · ${m.claims.items.length} claim${m.claims.items.length > 1 ? "s" : ""}: ${m.claims.items.map((c) => c.text).join(" · ")}` : ""}${m.bar.rationale ? `. ${m.bar.rationale}` : ""}`
        : "Cloud Function sets the bar and the claims",
      state: m?.bar ? "done" : m?.status === "submitted" && !pending ? "now" : "todo",
    },
    {
      name: m?.seal ? (m.seal.sealed ? "Sealed: Verified ✓" : `Not verified: ${m.seal.reason}`) : "Deterministic seal by Cloud Function",
      state: m?.seal ? (m.seal.sealed ? "done" : "bad") : m?.judge ? "now" : "todo",
    },
  ];
  return (
    <div className="page done">
      <span className={`done-badge ${m?.seal ? (m.seal.sealed ? "done-ok" : "done-bad") : ""}`} aria-hidden="true">
        <Glyph name={m?.seal ? "seal" : "upload"} />
      </span>
      <h1>Moment finished.</h1>
      <p className="lede done-intent">{session.intention}</p>
      {(m?.score || m?.verification) && (
        <ScoreRing value={m.verification?.score ?? m.score?.probability ?? null} bar={m.verification?.bar ?? m.bar?.value ?? null} sealed={m.seal ? m.seal.sealed : null} size={84} caption="likely true" />
      )}
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.name} className={`step step-${s.state}`}>
            {s.name}
          </li>
        ))}
      </ol>
      {review === "failed" && (
        <button
          className="btn"
          onClick={() => {
            setReview("waiting");
            setM(m ? { ...m } : m);
          }}
        >
          Try the cloud review again
        </button>
      )}
      <div className="hero-actions">
        {m?.seal && (
          <Link to={`/m/${session.id}`} className="btn btn-primary">
            <Glyph name="seal" /> Open the sealed Moment
          </Link>
        )}
        <Link to="/me" className="btn btn-quiet">
          See all my Moments
        </Link>
      </div>
    </div>
  );
}

export default function Record({ user, ready }: { user: User | null; ready: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [done, setDone] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [typed, setTyped] = useState(false);
  useEffect(() => () => session?.dispose(), [session]);
  const begin = async (intention: Intention, transcript?: string[]) => {
    try {
      // iOS Safari gates motion behind a user gesture.
      const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
      await DME?.requestPermission?.().catch(() => "denied");
      // Witness requests may arrive while the tab is in the background: ask once, on this gesture.
      if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
      void loadCloudModel();
      const s = new Session(user, intention, transcript);
      await s.start(); // rejects if the raw vault can't be written: nothing is recorded
      setSession(s);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };

  if (configured && !ready) return <div className="page" aria-busy="true" />;
  if (session && done) return session.guest && !claimed ? <GuestDone session={session} onClaimed={() => setClaimed(true)} /> : <Done session={session} />;
  if (session) return <Live session={session} onDone={() => setDone(true)} />;
  return (
    <>
      {err && <p className="notice notice-bad page">{err}</p>}
      {typed ? (
        <Setup guest={!user} onStart={(i) => void begin(i)} onVoice={() => setTyped(false)} />
      ) : (
        <Interview guest={!user} onStart={(i, t) => void begin(i, t)} onSkip={() => setTyped(true)} />
      )}
    </>
  );
}
