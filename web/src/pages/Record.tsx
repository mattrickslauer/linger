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

function Setup({ onStart, guest }: { onStart: (i: Intention) => void; guest: boolean }) {
  const [cat, setCat] = useState<Category>("fishing");
  const [text, setText] = useState("");
  return (
    <form
      className="page setup"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ text: text.trim() || EXAMPLES[cat], category: cat });
      }}
    >
      <h1>What are you about to do?</h1>
      <p className="lede">One sentence. The coach and the judges check every proof shot against it.</p>
      <label className="field">
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
      <button className="btn btn-primary btn-big" type="submit">
        Start Moment
      </button>
      <p className="muted small">
        Uses your location, motion sensor and camera while recording. Works offline.{" "}
        {guest ? "As a guest, the Moment stays on this device until you sign in to upload it." : "It syncs when you're back online."}
      </p>
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

  async function shoot() {
    if (!video.current || shooting) return;
    setShooting(true);
    try {
      const f = captureFrame(video.current);
      setLast(f.jpegB64);
      await session.proofShot(f.jpegB64, await sha256hex(f.jpegB64), f.w, f.h);
    } finally {
      setShooting(false);
    }
  }

  const coach = s.coach;
  const short = s.elapsedMs < 20_000;
  return (
    <div className="page live">
      <p className="live-intent">{session.intention}</p>
      <div className="live-grid">
        <div className="cam">
          <video ref={video} autoPlay playsInline muted className={facing === "user" ? "mirror" : undefined} />
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
          {camErr && <p className="cam-err">Camera unavailable: {camErr}</p>}
          {last && <img className="cam-last" src={jpegSrc(last)} alt="Last proof shot" />}
          {coach && (
            <p className={`coach-banner ${coach.pending ? "pending" : coach.mode === "none" ? "none" : coach.ok ? "ok" : "bad"}`} role="status">
              {coach.pending
                ? "Checking on-device…"
                : coach.mode === "none"
                  ? "Coach offline: shot kept"
                  : coach.ok
                    ? `${coach.mode === "on_device" ? "On-device" : "Cloud"}: keep going`
                    : `Retake: ${coach.reason}`}
              {!coach.pending && coach.label && <span className="muted"> · {coach.label}</span>}
            </p>
          )}
        </div>
        <div className="gauges">
          <div className="gauge gauge-time">
            <span className="g-label">time</span>
            <span className="g-val">{fmtDuration(s.elapsedMs)}</span>
          </div>
          <div className="gauge">
            <span className="g-label">distance</span>
            <span className="g-val">{fmtDistance(s.distanceM)}</span>
          </div>
          <div className="gauge">
            <span className="g-label">location</span>
            <span className="g-val g-small">
              <span className={`gps-dot ${s.gps ? "on" : ""}`} aria-hidden="true" />
              {s.gps ? `±${Math.round(s.gps[3])} m` : (s.gpsError ?? "searching")}
            </span>
          </div>
          <div className="gauge">
            <span className="g-label">motion</span>
            {s.motionOn ? <Spark values={s.motionTail} /> : <span className="g-val g-small">no sensor</span>}
          </div>
          <div className="gauge">
            <span className="g-label">proof shots</span>
            <span className="g-val">
              {s.frames}
              {s.retakes ? <span className="g-small muted"> ({s.retakes} retake)</span> : null}
            </span>
          </div>
          <p className={`sync ${s.online && !session.guest ? "" : "sync-off"}`} role="status">
            {session.guest
              ? `On this device · ${s.chunks} chunks chained`
              : s.online ? (s.queued ? `Syncing · ${s.queued} chunks queued` : `Synced · ${s.chunks} chunks`) : `Offline · ${s.queued} chunks queued`}
          </p>
        </div>
      </div>
      <div className="live-actions">
        <button className="btn btn-primary btn-big" onClick={shoot} disabled={shooting || !!camErr}>
          {shooting ? "Checking…" : "Proof shot"}
        </button>
        <button
          className="btn btn-big"
          onClick={async () => {
            try {
              await session.finish();
              onDone();
            } catch (e) {
              console.error("finish failed", e); // shown below as the vault error
            }
          }}
          disabled={shooting}
        >
          Finish
        </button>
      </div>
      {s.vaultError && (
        <p className="notice notice-bad small" role="alert">
          Couldn't save this Moment's raw data on this device ({s.vaultError}). Recording has stopped writing.
        </p>
      )}
      {short && <p className="muted small center">Moments shorter than 20 seconds can't be sealed.</p>}
    </div>
  );
}

/** A guest's Moment is finished and chained in this browser; uploading it is the first thing that needs an account. */
function GuestDone({ session, onClaimed }: { session: Session; onClaimed: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="page done">
      <h1>Moment recorded.</h1>
      <p className="lede">{session.intention}</p>
      <ol className="steps">
        <li className="step step-done">Recorded and chained on this device ({session.chunks.length} chunks)</li>
        <li className="step step-now">On this device · sign in to verify</li>
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
          {busy ?? "Upload and verify"}
        </button>
        <Link to={`/m/${session.id}`} className="btn">
          Open it
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

  const steps = [
    { name: "Recorded and chained on this device", state: "done" },
    { name: pending ? "Waiting for signal to sync" : "Synced to Firestore", state: pending ? "now" : "done" },
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
      name: m?.seal ? (m.seal.sealed ? "Sealed: Verified ✓" : `Not verified: ${m.seal.reason}`) : "Deterministic seal by Cloud Function",
      state: m?.seal ? (m.seal.sealed ? "done" : "bad") : m?.judge ? "now" : "todo",
    },
  ];
  return (
    <div className="page done">
      <h1>Moment finished.</h1>
      <p className="lede">{session.intention}</p>
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
            Open the sealed Moment
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
  useEffect(() => () => session?.dispose(), [session]);

  if (configured && !ready) return <div className="page" aria-busy="true" />;
  if (session && done) return session.guest && !claimed ? <GuestDone session={session} onClaimed={() => setClaimed(true)} /> : <Done session={session} />;
  if (session) return <Live session={session} onDone={() => setDone(true)} />;
  return (
    <>
      {err && <p className="notice notice-bad page">{err}</p>}
      <Setup
        guest={!user}
        onStart={async (intention) => {
          try {
            // iOS Safari gates motion behind a user gesture.
            const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
            await DME?.requestPermission?.().catch(() => "denied");
            void loadCloudModel();
            const s = new Session(user, intention);
            await s.start(); // rejects if the raw vault can't be written: nothing is recorded
            setSession(s);
          } catch (e) {
            setErr(String((e as Error)?.message ?? e));
          }
        }}
      />
    </>
  );
}
