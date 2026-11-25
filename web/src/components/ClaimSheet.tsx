// "You recorded N Moments as a guest" (docs/ARCHITECTURE.md v3.1 claim flow). Shown once per session, after sign-in
// or on start while signed in, when finished guest Moments are waiting on this device.
import { useEffect, useId, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { claimAndVerify, claimPrompted, markClaimPrompted } from "../claim";
import { fmtDuration } from "../geo";
import { navigate } from "../router";
import { forgetMoment, unclaimed, useLocalMoments } from "../vault";

export default function ClaimSheet({ user }: { user: User | null }) {
  const local = useLocalMoments();
  const waiting = local ? unclaimed(local) : [];
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    if (!user || claimPrompted() || !waiting.length) return;
    // Let an action that signed in for a specific Moment claim it first.
    const t = setTimeout(() => {
      if (claimPrompted()) return;
      markClaimPrompted();
      setOpen(true);
    }, 700);
    return () => clearTimeout(t);
  }, [user, waiting.length]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (open && local && waiting.length === 0 && !busy) setOpen(false);
  }, [open, local, waiting.length, busy]);

  const chosen = waiting.filter((m) => !keep.has(m.id));
  const close = () => !busy && setOpen(false);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="sheet-box">
        <h2 id={id}>
          You recorded {waiting.length === 1 ? "a Moment" : `${waiting.length} Moments`} as a guest
        </h2>
        <p className="muted">Upload {waiting.length === 1 ? "it" : "them"} to your account to get {waiting.length === 1 ? "it" : "them"} verified. Nothing in the recording changes.</p>
        <ul className="claim-list">
          {waiting.map((m) => (
            <li key={m.id} className={keep.has(m.id) ? "claim-kept" : ""}>
              <div>
                <strong>{m.intention.text}</strong>
                <span className="muted small">
                  {new Date(m.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  {m.summary ? `, ${fmtDuration(m.summary.durationMs)}, ${m.summary.frameCount} proof shots` : ""}
                </span>
              </div>
              <div className="claim-row-actions">
                <button
                  className="btn btn-small btn-quiet"
                  aria-pressed={keep.has(m.id)}
                  disabled={!!busy}
                  onClick={() =>
                    setKeep((k) => {
                      const n = new Set(k);
                      if (n.has(m.id)) n.delete(m.id);
                      else n.add(m.id);
                      return n;
                    })
                  }
                >
                  {keep.has(m.id) ? "Upload this" : "Keep on this device"}
                </button>
                <button className="btn btn-small btn-danger-quiet" disabled={!!busy} onClick={() => void forgetMoment(m.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
        {err && <p className="notice notice-bad small">{err}</p>}
        <div className="sheet-actions">
          <button
            className="btn btn-primary"
            disabled={!!busy || !chosen.length || !user}
            onClick={async () => {
              if (!user) return;
              setErr(null);
              try {
                await claimAndVerify(
                  chosen.map((m) => m.id),
                  user,
                  setBusy,
                );
                setBusy(null);
                setOpen(false);
                navigate("/me");
              } catch (e) {
                setBusy(null);
                setErr(`Upload failed: ${String((e as Error)?.message ?? e)}. They stay on this device.`);
              }
            }}
          >
            {busy ?? (chosen.length === waiting.length ? "Upload all" : `Upload ${chosen.length}`)}
          </button>
          <button className="btn btn-quiet" onClick={close} disabled={!!busy}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
