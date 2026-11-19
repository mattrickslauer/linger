import type { ParagraphHelp, Route, Timed } from "./ai/assist";

export type Help =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; kind: "p"; data: Timed<ParagraphHelp> }
  | { status: "done"; kind: "figure"; data: Timed<string> };

export type Why = "long-dwell" | "reread" | "asked";

const WHY: Record<Why, string> = {
  "long-dwell": "You stayed on this a while.",
  reread: "You came back to this.",
  asked: "You asked.",
};

export function RouteBadge({ route, ms, early }: { route: Route; ms: number; early: boolean }) {
  const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  const where = route === "on-device" ? "on this device" : "in the cloud";
  return (
    <span className={`route ${route}`}>
      {early ? `Prepared ${where} before you needed it` : `Answered ${where} in ${time}`}
    </span>
  );
}

export function MarginNote({
  help,
  kind,
  why,
  early,
  onClose,
  onRetry,
}: {
  help: Help;
  kind: "p" | "figure";
  why: Why;
  early: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="note" role="status" aria-live="polite">
      <button className="close" onClick={onClose} aria-label="Close note">
        ×
      </button>
      <p className="why">{WHY[why]}</p>
      {help.status === "loading" && (
        <p className="pending">{kind === "p" ? "Writing a plainer version…" : "Reading the chart…"}</p>
      )}
      {help.status === "error" && (
        <>
          <p className="error">{help.message}</p>
          <button className="secondary retry" onClick={onRetry}>Try again</button>
        </>
      )}
      {help.status === "done" && help.kind === "p" && (
        <>
          <p className="plain">{help.data.value.plain}</p>
          {help.data.value.terms.length > 0 && (
            <dl>
              {help.data.value.terms.map((t) => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd>{t.meaning}</dd>
                </div>
              ))}
            </dl>
          )}
          <RouteBadge route={help.data.route} ms={help.data.ms} early={early} />
        </>
      )}
      {help.status === "done" && help.kind === "figure" && (
        <>
          <p className="plain">{help.data.value}</p>
          <RouteBadge route={help.data.route} ms={help.data.ms} early={early} />
        </>
      )}
    </div>
  );
}
