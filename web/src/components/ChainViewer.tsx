// The hash chain as a strip of blocks. "Re-verify" refetches every chunk and recomputes each
// SHA-256 with WebCrypto in the visitor's browser: no trust in our server needed for this part.
import { useEffect, useMemo, useState } from "react";
import { genesis, sha256hex, verifyChain, type ChainReport, type LinkStatus } from "../chain";
import { getChunks } from "../data";
import type { Chunk } from "../types";

interface Props {
  momentId: string;
  chunks: Chunk[];
  headHash: string | null;
  chunkCount: number | null;
  activeSeq: number | null;
  onPick: (seq: number) => void;
}

const short = (h: string) => (h.startsWith("GENESIS:") ? "GENESIS" : h.slice(0, 10) + "…" + h.slice(-6));

export default function ChainViewer({ momentId, chunks, headHash, chunkCount, activeSeq, onPick }: Props) {
  const [status, setStatus] = useState<Record<number, LinkStatus>>({});
  const [report, setReport] = useState<ChainReport | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [payloadSha, setPayloadSha] = useState<string>("");
  const sel = useMemo(() => chunks.find((c) => c.seq === activeSeq) ?? chunks[chunks.length - 1], [chunks, activeSeq]);

  useEffect(() => {
    let live = true;
    if (sel) sha256hex(sel.payload).then((h) => live && setPayloadSha(h));
    return () => {
      live = false;
    };
  }, [sel]);

  async function reverify() {
    setRunning(true);
    setReport(null);
    setStatus({});
    const t0 = performance.now();
    try {
      const fresh = await getChunks(momentId, true);
      const acc: Record<number, LinkStatus> = {};
      let n = 0;
      const r = await verifyChain(momentId, fresh, {
        headHash,
        chunkCount,
        onLink: (l) => {
          acc[l.seq] = l.status;
          // Paint progress in batches so a long chain still animates visibly.
          if (++n % Math.max(1, Math.ceil(fresh.length / 40)) === 0) setStatus({ ...acc });
        },
      });
      setStatus({ ...acc });
      setReport(r);
    } catch (e) {
      setReport({ ok: false, links: [], headOk: null, countOk: null });
      console.error(e);
    } finally {
      setElapsed(performance.now() - t0);
      setRunning(false);
    }
  }

  const bad = report?.links.filter((l) => l.status !== "ok") ?? [];
  return (
    <section className="chain" aria-labelledby="chain-h">
      <div className="section-head">
        <h2 id="chain-h">Hash chain</h2>
        <button className="btn btn-primary" onClick={reverify} disabled={running || chunks.length === 0}>
          {running ? "Re-verifying…" : "Re-verify chain in your browser"}
        </button>
      </div>
      <p className="muted">
        {chunks.length} chunks, one every 5 seconds or per proof shot. Each hash covers the previous hash, so changing, inserting or removing
        anything breaks every link after it.
      </p>
      {report && (
        <p className={`notice ${report.ok ? "notice-ok" : "notice-bad"}`} role="status">
          {report.ok
            ? `All ${report.links.length} hashes recomputed in your browser in ${Math.round(elapsed ?? 0)} ms. Every link, proof frame and the head hash match.`
            : bad.length
              ? `${bad.length} link${bad.length > 1 ? "s" : ""} failed. First failure at chunk ${bad[0].seq}: ${bad[0].status.replace("bad-", "")} mismatch.`
              : report.links.length === 0
                ? "Couldn't fetch the chunks to verify."
                : `Links match, but the ${report.headOk === false ? "head hash" : "chunk count"} recorded at submit does not.`}
        </p>
      )}
      <div className="blocks" role="list" aria-label="Chunks">
        {chunks.map((c) => (
          <button
            key={c.seq}
            role="listitem"
            className={`block ${c.frame ? "block-frame" : ""} ${status[c.seq] ? `block-${status[c.seq]}` : ""} ${sel?.seq === c.seq ? "block-sel" : ""}`}
            title={`Chunk ${c.seq}${c.frame ? " (proof shot)" : ""}`}
            aria-label={`Chunk ${c.seq}${c.frame ? ", proof shot" : ""}${status[c.seq] ? ", " + status[c.seq] : ""}`}
            onClick={() => onPick(c.seq)}
          />
        ))}
      </div>
      {sel && (
        <dl className="hashes">
          <div>
            <dt>chunk</dt>
            <dd>
              {sel.seq} of {chunks.length}, {((sel.t1 - sel.t0) / 1000).toFixed(1)} s{sel.frame ? ", with proof shot" : ""}
            </dd>
          </div>
          <div>
            <dt>previous</dt>
            <dd className="mono" title={sel.prevHash}>
              {sel.seq === 0 ? genesis(momentId) : short(sel.prevHash)}
            </dd>
          </div>
          <div>
            <dt>payload</dt>
            <dd className="mono" title={payloadSha}>
              sha256 {payloadSha ? short(payloadSha) : "…"} ({(sel.payload.length / 1024).toFixed(1)} KB of GPS, motion and events)
            </dd>
          </div>
          <div>
            <dt>hash</dt>
            <dd className="mono" title={sel.hash}>
              {short(sel.hash)}
            </dd>
          </div>
          <div className="formula">
            <dt>formula</dt>
            <dd className="mono">sha256(seq | t0 | t1 | previous | sha256(payload))</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
