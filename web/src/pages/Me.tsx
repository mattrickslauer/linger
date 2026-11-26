import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { signOutUser } from "../auth";
import { claimAndVerify, markClaimPrompted } from "../claim";
import { getChunks, getMomentBundle, subscribeFeed, subscribeMyMoments } from "../data";
import { canDeleteMoment } from "../canDelete";
import DeleteMoment from "../components/DeleteMoment";
import { configured, FIXTURES } from "../firebase";
import { decodeChunks, fmtDistance, fmtDuration } from "../geo";
import { recordingMomentId, runCloudReview } from "../recorder";
import type { Moment } from "../types";
import { isDeclined, requireSignIn } from "../signin";
import { forgetMoment, localChunks, unclaimed, useLocalMoments, useVaultHeld, type LocalMoment } from "../vault";
import { ago, jpegSrc, Link } from "../ui";
import { Glyph, ScoreRing, type GlyphName } from "../kit";
import "../me.css";
import { uploadText, useClipUpload } from "../upload";
import { videoStatusText } from "../v4";

/** Sample-data builds only: `/me?me=demo` shows the signed-in view with the fixture Moments as yours. */
const ME_DEMO = FIXTURES && typeof location !== "undefined" && new URLSearchParams(location.search).get("me") === "demo";
const DEMO_USER = { uid: "demo", displayName: "Maya Ortiz", email: "sample data", photoURL: null } as unknown as User;

/** Proof-shot thumbnails: the feed's hero for sealed Moments, else the last frame this browser holds. */
function useHeroes(): Record<string, string> {
  const [heroes, setHeroes] = useState<Record<string, string>>({});
  useEffect(
    () =>
      subscribeFeed(
        (es) => setHeroes((h) => ({ ...h, ...Object.fromEntries(es.filter((e) => e.heroJpegB64).map((e) => [e.momentId, e.heroJpegB64!])) })),
        () => {},
      ),
    [],
  );
  return heroes;
}
function useLocalThumb(id: string, enabled: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    localChunks(id)
      .then((cs) => {
        const fr = decodeChunks(cs).frames;
        if (live && fr.length) setSrc(fr[fr.length - 1].jpegB64);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, enabled]);
  return src;
}

type Tone = "ok" | "bad" | "wait" | "local";
const BADGE: Record<Tone, GlyphName> = { ok: "seal", bad: "close", wait: "upload", local: "device" };

/** One Moment as a thumbnail tile: proof photo, status badge and score ring over it, title under it. */
function Tile({
  id,
  text,
  thumb,
  tone,
  badge,
  score,
  bar,
  meta,
  href,
  children,
}: {
  id: string;
  text: string;
  thumb: string | null;
  tone: Tone;
  badge: string;
  score?: number | null;
  bar?: number | null;
  meta: string;
  href: string | null;
  children?: React.ReactNode;
}) {
  return (
    <li className={`me-tile tile-${tone}`} data-id={id}>
      <div className="tile-media on-media">
        {thumb ? <img src={jpegSrc(thumb)} alt="" loading="lazy" decoding="async" width={320} height={400} /> : <Glyph name="frames" className="tile-ph" />}
        <span className={`tile-badge badge-${tone}`}>
          <Glyph name={BADGE[tone]} />
          {badge}
        </span>
        {score != null && <ScoreRing value={score} bar={bar} sealed={tone === "ok" ? true : tone === "bad" ? false : null} size={44} className="tile-ring" />}
      </div>
      <h3>{href ? <Link to={href}>{text}</Link> : text}</h3>
      <p className="tile-meta">{meta}</p>
      {children}
    </li>
  );
}

const STATUS: Record<Moment["status"], string> = {
  recording: "Recording (not finished)",
  submitted: "Submitted, waiting for review",
  sealed: "Sealed",
  rejected: "Not verified",
};

function Row({ m, uid, thumb }: { m: Moment; uid: string; thumb: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = useClipUpload(m.id);
  const needsReview = m.status === "submitted" && !m.judge && !m.pending;
  const done = m.status === "sealed" || m.status === "rejected";
  const deletable = canDeleteMoment({ fixtures: FIXTURES, uid, ownerUid: m.ownerUid, fromMe: true, id: m.id, recordingId: recordingMomentId() });
  const tone: Tone = m.status === "sealed" ? "ok" : m.status === "rejected" ? "bad" : "wait";
  const progress =
    m.status === "submitted" && (videoStatusText(m.videoReview) || uploadText(up))
      ? m.videoReview && m.videoReview.status !== "none"
        ? videoStatusText(m.videoReview)
        : uploadText(up)
      : m.status === "recording" && !m.pending
        ? uploadText(up)
        : null;
  return (
    <Tile
      id={m.id}
      text={m.intention.text}
      thumb={thumb}
      tone={tone}
      badge={done ? (m.status === "sealed" ? "Verified" : "Not verified") : STATUS[m.status]}
      score={m.verification?.score ?? m.score?.probability ?? null}
      bar={m.verification?.bar ?? m.bar?.value ?? null}
      meta={[ago(m.startedAt), m.summary ? fmtDuration(m.summary.durationMs) : null, m.summary ? fmtDistance(m.summary.distanceM) : null].filter(Boolean).join(" · ")}
      href={done ? `/m/${m.id}?from=me` : null}
    >
      {(m.recordedAsGuest || m.verification?.claims?.length || m.verification?.modules.length || m.pending || progress) && (
        <p className="tile-chips">
          {m.pending && <span className="chip chip-warn">Offline · queued</span>}
          {m.verification?.claims?.length ? (
            <span className="gchip">
              <Glyph name="intent" />
              {m.verification.claimsBacked ?? 0}/{m.verification.claims.length}
            </span>
          ) : null}
          {m.verification?.modules.length ? (
            <span className="gchip">
              <Glyph name="ladder" />+{m.verification.modules.length}
            </span>
          ) : null}
          {m.recordedAsGuest && (
            <span className="gchip" title={`Recorded as a guest, uploaded ${ago(m.claimedAt ?? null)}`}>
              <Glyph name="device" />
              guest
            </span>
          )}
          {progress && <span className="tile-progress">{progress}</span>}
        </p>
      )}
      {err && <p className="notice notice-bad small">{err}</p>}
      {(needsReview || deletable) && (
        <div className="tile-actions">
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
              <Glyph name="cloud" /> {busy ? "Reviewing…" : "Run cloud review"}
            </button>
          )}
          {deletable && <DeleteMoment id={m.id} label={m.intention.text} className="btn btn-small btn-danger-quiet tile-del" />}
        </div>
      )}
    </Tile>
  );
}

/** Raw vault: what this browser still keeps until the server confirms every chunk (wording as on Android). */
function VaultLine() {
  const held = Object.values(useVaultHeld());
  const conflicts = held.filter((s) => s === "conflict").length;
  return (
    <p className={`vault-line ${held.length ? "vault-held" : "vault-ok"}`} role="status">
      <Glyph name={held.length ? "device" : "cloud"} />
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
  const thumb = useLocalThumb(m.id, true);
  return (
    <Tile
      id={m.id}
      text={m.intention.text}
      thumb={thumb}
      tone="local"
      badge={finished ? "On this device · sign in to verify" : "Not finished"}
      meta={[ago(m.startedAt), m.summary ? fmtDuration(m.summary.durationMs) : null, m.summary ? `${m.summary.frameCount} shots` : null].filter(Boolean).join(" · ")}
      href={`/m/${m.id}?from=me`}
    >
      {err && <p className="notice notice-bad small">{err}</p>}
      <div className="tile-actions">
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
            <Glyph name="upload" /> {busy ?? "Upload and verify"}
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
          <button
            className="btn btn-small btn-danger-quiet tile-del"
            onClick={() => setConfirm(true)}
            disabled={!!busy || m.id === recordingMomentId()}
            aria-label={`Delete ${m.intention.text}`}
          >
            <Glyph name="trash" />
            <span>Delete</span>
          </button>
        )}
      </div>
    </Tile>
  );
}

function LocalList({ user }: { user: User | null }) {
  const local = useLocalMoments();
  const mine = (local ?? []).filter((m) => m.guest && m.ownerUid == null);
  if (!mine.length) return null;
  const waiting = unclaimed(mine).length;
  return (
    <section className="me-local" aria-labelledby="local-h">
      <div className="me-sec-head">
        <h2 id="local-h">
          <Glyph name="device" /> On this device
        </h2>
        <p className="muted small">{user ? (waiting ? "Upload to get them verified" : "Recorded before you signed in") : "Only here until you upload"}</p>
      </div>
      <ul className="me-grid">
        {mine.map((m) => (
          <LocalRow key={m.id} m={m} user={user} />
        ))}
      </ul>
    </section>
  );
}

export default function Me({ user: realUser, ready }: { user: User | null; ready: boolean }) {
  const user = ME_DEMO ? DEMO_USER : realUser;
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const heroes = useHeroes();
  useEffect(() => {
    if (ME_DEMO) {
      let live = true;
      // The fixture Moments, read through the same public readers the evidence room uses.
      const off = subscribeFeed(
        (es) =>
          void Promise.all(es.map((e) => getMomentBundle(e.momentId).then((b) => b.moment))).then((ms) => {
            if (live) setMoments(ms.filter((x): x is Moment => !!x).sort((a, b) => b.startedAt - a.startedAt));
          }),
        (e) => setErr(e.message),
      );
      return () => {
        live = false;
        off();
      };
    }
    return user ? subscribeMyMoments(user.uid, setMoments, (e) => setErr(e.message)) : undefined;
  }, [user]);
  const counts = useMemo(() => {
    const ms = moments ?? [];
    return { ok: ms.filter((m) => m.status === "sealed").length, bad: ms.filter((m) => m.status === "rejected").length, wait: ms.filter((m) => m.status === "submitted" || m.status === "recording").length };
  }, [moments]);

  if (configured && !ready) return <div className="page me" aria-busy="true"><div className="skel me-skel" /></div>;
  if (!user)
    return (
      <div className="page me">
        <section className="guest-card" aria-labelledby="guest-h">
          <span className="guest-glyph" aria-hidden="true">
            <Glyph name="me" />
          </span>
          <h1 id="guest-h">You're browsing as a guest</h1>
          <ul className="guest-props" aria-label="What you can do">
            <li>
              <Glyph name="feed" /> Watch the feed
            </li>
            <li>
              <Glyph name="record" /> Record freely
            </li>
            <li>
              <Glyph name="seal" /> Sign in to verify
            </li>
          </ul>
          {configured ? (
            <button className="btn btn-primary" onClick={() => requireSignIn("sync your Moments").catch(() => {})}>
              <Glyph name="me" /> Sign in
            </button>
          ) : (
            <span className="chip">sample-data build</span>
          )}
        </section>
        <LocalList user={null} />
        <GuestEmpty />
      </div>
    );
  return (
    <div className="page me">
      <header className="me-head">
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="avatar" referrerPolicy="no-referrer" width={56} height={56} />
        ) : (
          <span className="avatar avatar-ph" aria-hidden="true">
            {(user.displayName ?? "You").slice(0, 1)}
          </span>
        )}
        <div>
          <h1>{user.displayName ?? "You"}</h1>
          <p className="muted small">{user.email}</p>
        </div>
        <button className="btn btn-quiet btn-small me-out" onClick={() => (ME_DEMO ? undefined : signOutUser())}>
          <Glyph name="logout" /> Sign out
        </button>
      </header>
      {moments && moments.length > 0 && (
        <dl className="me-tally">
          <div className="tally-ok">
            <dt>
              <Glyph name="seal" /> verified
            </dt>
            <dd>{counts.ok}</dd>
          </div>
          <div className="tally-bad">
            <dt>
              <Glyph name="close" /> not verified
            </dt>
            <dd>{counts.bad}</dd>
          </div>
          <div className="tally-wait">
            <dt>
              <Glyph name="upload" /> pending
            </dt>
            <dd>{counts.wait}</dd>
          </div>
        </dl>
      )}
      <VaultLine />
      <LocalList user={user} />
      {err && <p className="notice notice-bad">{err}</p>}
      {!moments && !err && (
        <ul className="me-grid" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="me-tile">
              <div className="tile-media skel" />
            </li>
          ))}
        </ul>
      )}
      {moments && moments.length === 0 && (
        <div className="empty">
          <Glyph name="record" className="empty-glyph" />
          <p>No Moments yet.</p>
          <Link to="/record" className="btn btn-primary">
            Record a Moment
          </Link>
        </div>
      )}
      {moments && moments.length > 0 && (
        <section aria-labelledby="mine-h">
          <h2 id="mine-h" className="sr-only">
            My Moments
          </h2>
          <ul className="me-grid">
            {moments.map((m) => (
              <Row key={m.id} m={m} uid={user.uid} thumb={heroes[m.id] ?? null} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GuestEmpty() {
  const local = useLocalMoments();
  if (local == null || local.some((m) => m.guest)) return null;
  return (
    <div className="empty">
      <Glyph name="record" className="empty-glyph" />
      <p>Nothing recorded on this device yet.</p>
      <Link to="/record" className="btn btn-primary">
        <Glyph name="record" /> Record a Moment
      </Link>
    </div>
  );
}
