import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { signOutUser } from "../auth";
import { claimAndVerify, markClaimPrompted } from "../claim";
import { getChunks, subscribeMyMoments } from "../data";
import { canDeleteMoment } from "../canDelete";
import DeleteMoment from "../components/DeleteMoment";
import { configured, FIXTURES } from "../firebase";
import { decodeChunks, fmtDistance, fmtDuration } from "../geo";
import { recordingMomentId, runCloudReview } from "../recorder";
import type { Moment } from "../types";
import { isDeclined, requireSignIn } from "../signin";
import { forgetMoment, unclaimed, useLocalMoments, useVaultHeld, type LocalMoment } from "../vault";
import { ago, Link, Stamp } from "../ui";
import { uploadText, useClipUpload } from "../upload";
import { videoStatusText } from "../v4";

const STATUS: Record<Moment["status"], string> = {
  recording: "Recording (not finished)",
  submitted: "Submitted, waiting for review",
  sealed: "Sealed",
  rejected: "Not verified",
};

function Row({ m, uid }: { m: Moment; uid: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = useClipUpload(m.id);
  const needsReview = m.status === "submitted" && !m.judge && !m.pending;
  const done = m.status === "sealed" || m.status === "rejected";
  const deletable = canDeleteMoment({ fixtures: FIXTURES, uid, ownerUid: m.ownerUid, fromMe: true, id: m.id, recordingId: recordingMomentId() });
  return (
    <li className="me-row">
      <div>
        <h3>{done ? <Link to={`/m/${m.id}?from=me`}>{m.intention.text}</Link> : m.intention.text}</h3>
        {m.recordedAsGuest && <p className="muted small">Recorded as a guest, uploaded {ago(m.claimedAt ?? null)}</p>}
        {m.verification?.score != null && (
          <p className="muted small">
            score {m.verification.score.toFixed(2)} · bar {m.verification.bar.toFixed(2)}
            {m.verification.claims?.length ? ` · ${m.verification.claimsBacked ?? 0}/${m.verification.claims.length} claims backed` : ""}
            {m.verification.modules.length ? ` · ${m.verification.modules.length} extra check${m.verification.modules.length > 1 ? "s" : ""}` : ""}
          </p>
        )}
        {m.status === "submitted" && (videoStatusText(m.videoReview) || uploadText(up)) && (
          <p className="muted small">{m.videoReview && m.videoReview.status !== "none" ? videoStatusText(m.videoReview) : uploadText(up)}</p>
        )}
        {m.status === "recording" && !m.pending && uploadText(up) && <p className="muted small">{uploadText(up)}</p>}
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
        {deletable && <DeleteMoment id={m.id} label={m.intention.text} />}
      </div>
    </li>
  );
}

/** Raw vault: what this browser still keeps until the server confirms every chunk (wording as on Android). */
function VaultLine() {
  const held = Object.values(useVaultHeld());
  const conflicts = held.filter((s) => s === "conflict").length;
  return (
    <p className={`vault-line ${held.length ? "vault-held" : "vault-ok"}`} role="status">
      {held.length === 0
        ? "Raw data: all safely stored on the server ✓"
        : conflicts > 0
          ? `Raw data: ${conflicts} Moment(s) differ from the server — kept on this device`
          : `Raw data: ${held.length} Moment(s) kept on this device until the server confirms every chunk`}
    </p>
  );
}

/** Moments kept only in this browser: a guest's recordings (and any still recording). */
function LocalRow({ m, user }: { m: LocalMoment; user: User | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const finished = m.status === "submitted";
  return (
    <li className="me-row">
      <div>
        <h3>
          <Link to={`/m/${m.id}?from=me`}>{m.intention.text}</Link>
        </h3>
        <p className="muted small">
          {ago(m.startedAt)}
          {m.summary ? `, ${fmtDuration(m.summary.durationMs)}, ${fmtDistance(m.summary.distanceM)}, ${m.summary.frameCount} frames` : ""}
        </p>
        {err && <p className="notice notice-bad small">{err}</p>}
      </div>
      <div className="me-state">
        <span className="chip chip-warn">{finished ? "On this device · sign in to verify" : "Not finished"}</span>
        {finished && configured && (
          <button
            className="btn btn-small btn-primary"
            disabled={!!busy}
            onClick={async () => {
              setErr(null);
              try {
                markClaimPrompted();
                const u = user ?? (await requireSignIn("upload this Moment and get it verified"));
                await claimAndVerify([m.id], u, setBusy);
              } catch (e) {
                if (!isDeclined(e)) setErr(`Upload failed: ${String((e as Error)?.message ?? e)}`);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy ?? "Upload and verify"}
          </button>
        )}
        {confirm ? (
          <>
            <button className="btn btn-small btn-danger" onClick={() => void forgetMoment(m.id)}>
              Delete for good
            </button>
            <button className="btn btn-small btn-quiet" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn btn-small btn-danger-quiet" onClick={() => setConfirm(true)} disabled={!!busy || m.id === recordingMomentId()}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

function LocalList({ user }: { user: User | null }) {
  const local = useLocalMoments();
  const mine = (local ?? []).filter((m) => m.guest && m.ownerUid == null);
  if (!mine.length) return null;
  const waiting = unclaimed(mine).length;
  return (
    <section className="me-local" aria-labelledby="local-h">
      <h2 id="local-h">On this device</h2>
      <p className="muted small">
        {user
          ? `Recorded before you signed in. ${waiting ? "Upload them to get them verified." : ""}`
          : "Recorded as a guest. They never leave this browser until you upload them."}
      </p>
      <ul className="me-list">
        {mine.map((m) => (
          <LocalRow key={m.id} m={m} user={user} />
        ))}
      </ul>
    </section>
  );
}

export default function Me({ user, ready }: { user: User | null; ready: boolean }) {
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => (user ? subscribeMyMoments(user.uid, setMoments, (e) => setErr(e.message)) : undefined), [user]);

  if (configured && !ready) return <div className="page" aria-busy="true" />;
  if (!user)
    return (
      <div className="page me">
        <header className="me-head">
          <div>
            <h1>You're browsing as a guest</h1>
            <p className="muted">Watch the feed and record Moments freely. Sign in when you want one verified.</p>
          </div>
          {configured ? (
            <button className="btn btn-small" onClick={() => requireSignIn("sync your Moments").catch(() => {})}>
              Sign in
            </button>
          ) : (
            <span className="chip">sample-data build</span>
          )}
        </header>
        <LocalList user={null} />
        <GuestEmpty />
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
      <VaultLine />
      <LocalList user={user} />
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
            <Row key={m.id} m={m} uid={user.uid} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GuestEmpty() {
  const local = useLocalMoments();
  if (local == null || local.some((m) => m.guest)) return null;
  return (
    <div className="empty">
      <p>Nothing recorded on this device yet.</p>
      <Link to="/record" className="btn btn-primary">
        Record a Moment
      </Link>
    </div>
  );
}
