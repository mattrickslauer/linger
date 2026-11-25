// Video clips this browser holds for a Moment (raw vault). The chain holds their SHA-256; v4 uploads every chained
// clip at submit (upload.ts) and a Cloud Function reviews it as video, so the clip itself backs the claims.

import { useEffect, useState } from "react";
import { clipsOf, type StoredClip } from "../vault";

export default function LocalClips({ momentId, chained }: { momentId: string; chained: string[] }) {
  const [clips, setClips] = useState<(StoredClip & { url: string })[]>([]);
  useEffect(() => {
    let live = true;
    let made: string[] = [];
    clipsOf(momentId)
      .then((cs) => {
        if (!live) return;
        const withUrl = cs.map((c) => ({ ...c, url: URL.createObjectURL(c.blob) }));
        made = withUrl.map((c) => c.url);
        setClips(withUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [momentId]);
  if (!clips.length) return null;
  return (
    <section className="clips" aria-labelledby="clips-h">
      <div className="section-head">
        <h2 id="clips-h">Video clips</h2>
        <p className="muted small">Kept on this device too. The chain holds each clip's fingerprint; the server re-hashes the upload against it.</p>
      </div>
      <div className="clip-grid">
        {clips.map((c) => (
          <figure key={c.sha256} className="clip">
            <video src={c.url} controls playsInline preload="metadata" />
            <figcaption className="small">
              <span>{Math.round(c.durationMs / 1000)} s · {(c.bytes / 1e6).toFixed(1)} MB</span>
              <code title={c.sha256}>sha256 {c.sha256.slice(0, 12)}…</code>
              <span className={chained.includes(c.sha256) ? "ok" : "bad"}>{chained.includes(c.sha256) ? "✓ matches the chain" : "✗ not in the chain"}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
