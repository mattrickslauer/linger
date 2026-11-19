import type { ParagraphHelp, Route, Timed } from "./ai/assist";

export type Help =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; kind: "p"; data: Timed<ParagraphHelp> }
  | { status: "done"; kind: "figure"; data: Timed<string> };

export function RouteBadge({ route, ms }: { route: Route; ms: number }) {
  const time = ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
  return (
    <span className={`route ${route}`}>
      {route === "on-device" ? `Answered on this device in ${time}` : `Answered in the cloud in ${time}`}
    </span>
  );
}

export function MarginNote({ help, kind, onClose }: { help: Help; kind: "p" | "figure"; onClose: () => void }) {
  return (
    <div className="note" role="status" aria-live="polite">
      <button className="close" onClick={onClose} aria-label="Close note">
        ×
      </button>
      {help.status === "loading" && (
        <p className="pending">{kind === "p" ? "Writing a plainer version…" : "Reading the chart…"}</p>
      )}
      {help.status === "error" && <p className="error">Help is unavailable: {help.message}</p>}
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
          <RouteBadge route={help.data.route} ms={help.data.ms} />
        </>
      )}
      {help.status === "done" && help.kind === "figure" && (
        <>
          <p className="plain">{help.data.value}</p>
          <RouteBadge route={help.data.route} ms={help.data.ms} />
        </>
      )}
    </div>
  );
}
