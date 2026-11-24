// Pure comparison of the raw vault (this device's journal) with what the server returned.
// Port of android/.../data/Vault.kt VaultCheck.compare; empty result = the server provably holds everything.

export interface VaultChunk {
  seq: number;
  hash: string;
  payload: string;
  frameB64: string | null;
}

export function compareVault(
  localHead: string | null,
  localCount: number,
  serverHead: string | null | undefined,
  serverCount: number | null | undefined,
  serverStatus: string | null | undefined,
  local: VaultChunk[],
  server: VaultChunk[],
): string[] {
  const p: string[] = [];
  if (!["submitted", "sealed", "rejected"].includes(serverStatus as string)) p.push(`status ${serverStatus ?? null}`);
  if ((serverHead ?? null) !== localHead) p.push("headHash");
  if (serverCount !== localCount) p.push(`chunkCount ${serverCount ?? null} != ${localCount}`);
  const bySeq = new Map(server.map((c) => [c.seq, c]));
  if (server.length !== local.length) p.push(`server has ${server.length} chunks, journal ${local.length}`);
  for (const c of local) {
    const s = bySeq.get(c.seq);
    if (!s) {
      p.push(`chunk ${c.seq} missing`);
      continue;
    }
    if (s.hash !== c.hash) p.push(`chunk ${c.seq} hash`);
    if (s.payload !== c.payload) p.push(`chunk ${c.seq} payload`);
    if ((s.frameB64 ?? null) !== (c.frameB64 ?? null)) p.push(`chunk ${c.seq} frame`);
  }
  return p;
}
