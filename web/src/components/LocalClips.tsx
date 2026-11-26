// Video clips this browser holds for a Moment (raw vault). The chain holds their SHA-256; v4 uploads every chained
// clip at submit (upload.ts) and a Cloud Function reviews it as video, so the clip itself backs the claims.

import { useEffect, useState } from "react";
import { clipsOf, type StoredClip } from "../vault";

/** `hide`: clips already shown from Cloud Storage above (the shared Video section); listing them twice reads as two clips. */
export default function LocalClips({ momentId, chained, hide = [] }: { momentId: string; chained: string[]; hide?: string[] }) {
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
  const shown = clips.filter((c) => !hide.includes(c.sha256));
  if (!shown.length) return null;
  return (
    <section className="clips" aria-labelledby="clips-h">
      <div className="section-head">
        <h2 id="clips-h">On this device</h2>
        <p className="muted small">Not uploaded yet. The chain holds each clip's fingerprint; the server re-hashes the upload against it.</p>
      </div>
      <div className="clip-grid">
        {shown.map((c) => (
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
