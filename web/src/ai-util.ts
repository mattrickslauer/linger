// Pure helpers for the AI Logic calls (no Firebase import, so they unit-test in Node).

export const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

export function parseJson<T>(raw: string): Partial<T> {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as Partial<T>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as Partial<T>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }
}

/** Hero frame first, then up to 3 others spread across the session (contract: hero + up to 3). */
export function pickFrames<T extends { seq: number; t: number }>(frames: T[], heroSeq: number | null): T[] {
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const hero = sorted.find((f) => f.seq === heroSeq) ?? sorted[sorted.length - 1];
  const rest = sorted.filter((f) => f !== hero);
  const picks: T[] = [];
  for (let i = 0; i < Math.min(3, rest.length); i++) picks.push(rest[Math.round((i * (rest.length - 1)) / Math.max(1, Math.min(3, rest.length) - 1))]);
  return [hero, ...new Set(picks)].filter(Boolean).sort((a, b) => a.t - b.t);
}

