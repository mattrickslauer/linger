import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { signInWithGoogle, signOutUser } from "../auth";
import { getChunks, subscribeMyMoments } from "../data";
import { configured } from "../firebase";
import { decodeChunks, fmtDistance, fmtDuration } from "../geo";
import { runCloudReview } from "../recorder";
import type { Moment } from "../types";
import { ago, Link, Stamp } from "../ui";

const STATUS: Record<Moment["status"], string> = {
  recording: "Recording (not finished)",
  submitted: "Submitted, waiting for review",
  sealed: "Sealed",
  rejected: "Not verified",
};

function Row({ m }: { m: Moment }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const needsReview = m.status === "submitted" && !m.judge && !m.pending;
  const done = m.status === "sealed" || m.status === "rejected";
  return (
    <li className="me-row">
      <div>
        <h3>{done ? <Link to={`/m/${m.id}`}>{m.intention.text}</Link> : m.intention.text}</h3>
        <p className="muted small">
          {ago(m.startedAt)}
          {m.summary ? `, ${fmtDuration(m.summary.durationMs)}, ${fmtDistance(m.summary.distanceM)}, ${m.summary.frameCount} frames` : ""}
        </p>
        {err && <p className="notice notice-bad small">{err}</p>}
      </div>
      <div className="me-state">
        {done ? <Stamp sealed={m.status === "sealed"} /> : <span className="chip">{STATUS[m.status]}</span>}
        {m.pending && <span className="chip chip-warn">Offline · queued</span>}
        {needsReview && (
          <button
            className="btn btn-small"
            disabled={busy || !navigator.onLine}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const frames = decodeChunks(await getChunks(m.id)).frames;
                await runCloudReview(m.id, m, frames);
              } catch (e) {
                setErr(String((e as Error)?.message ?? e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Reviewing…" : "Run cloud review"}
          </button>
        )}
      </div>
    </li>
  );
}

export default function Me({ user, ready }: { user: User | null; ready: boolean }) {
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => (user ? subscribeMyMoments(user.uid, setMoments, (e) => setErr(e.message)) : undefined), [user]);

  if (!configured)
    return (
      <div className="page gate">
        <h1>Me</h1>
        <p className="notice">Sign-in needs Firebase. This build is showing sample data only.</p>
      </div>
    );
  if (!ready) return <div className="page" aria-busy="true" />;
  if (!user)
    return (
      <div className="page gate">
        <h1>Your Moments</h1>
        <p className="lede">Sign in to see what you've recorded and what's still syncing.</p>
        <button className="btn btn-primary" onClick={() => signInWithGoogle().catch(() => {})}>
          Sign in with Google
        </button>
      </div>
    );
  return (
    <div className="page me">
      <header className="me-head">
        {user.photoURL && <img src={user.photoURL} alt="" className="avatar" referrerPolicy="no-referrer" />}
        <div>
          <h1>{user.displayName ?? "You"}</h1>
          <p className="muted small">{user.email}</p>
        </div>
        <button className="btn btn-quiet btn-small" onClick={() => signOutUser()}>
          Sign out
        </button>
      </header>
      {err && <p className="notice notice-bad">{err}</p>}
      {moments && moments.length === 0 && (
        <div className="empty">
          <p>No Moments yet.</p>
          <Link to="/record" className="btn btn-primary">
            Record a Moment
          </Link>
        </div>
      )}
      {moments && moments.length > 0 && (
        <ul className="me-list">
          {moments.map((m) => (
            <Row key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}
