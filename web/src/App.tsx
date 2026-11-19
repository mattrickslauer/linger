import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttentionEngine, type Target } from "./gaze/attention";
import { GazeTracker, type Frame } from "./gaze/tracker";
import { fitRidge, predictRidge, type RidgeModel } from "./gaze/ridge";
import { OneEuro } from "./gaze/oneEuro";
import { DEMO_DOC, docFromText, wordCount, type Block, type Doc } from "./content/article";
import {
  explainFigure,
  explainParagraph,
  onDeviceAvailability,
  type ParagraphHelp,
  type Route,
  type Timed,
} from "./ai/assist";
import { firebaseConfigured, loadTuning, readerModel, type Tuning } from "./firebase";
import { svgToPngBase64 } from "./svgToPng";
import { MarginNote, type Help } from "./MarginNote";

type Mode = "intro" | "calibrating" | "eyes" | "mouse";
type DeviceState = "checking" | "available" | "downloadable" | "downloading" | "unavailable";

const CALIB_POINTS = [0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y })));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [doc, setDoc] = useState<Doc>(DEMO_DOC);
  const [mode, setMode] = useState<Mode>("intro");
  const [tuning, setTuning] = useState<Tuning | null>(null);
  const [device, setDevice] = useState<DeviceState>("checking");
  const [download, setDownload] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [help, setHelp] = useState<Record<string, Help>>({});
  const [stats, setStats] = useState<{ device: number[]; cloud: number[] }>({ device: [], cloud: [] });
  const [calibIndex, setCalibIndex] = useState(-1);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [showDot, setShowDot] = useState(true);
  const [frames, setFrames] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockEls = useRef(new Map<string, HTMLElement>());
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef(new AttentionEngine());
  const trackerRef = useRef<GazeTracker | null>(null);
  const modelRef = useRef<RidgeModel | null>(null);
  const filters = useRef({ x: new OneEuro(0.8, 0.01), y: new OneEuro(0.8, 0.01) });
  const sampling = useRef<{ on: boolean; target: { x: number; y: number } }>({ on: false, target: { x: 0, y: 0 } });
  const samples = useRef<{ f: number[][]; x: number[]; y: number[] }>({ f: [], x: [], y: [] });
  const cache = useRef(new Map<string, Promise<void>>());
  const tuningRef = useRef<Tuning | null>(null);
  const deviceRef = useRef<DeviceState>("checking");
  const docRef = useRef(doc);
  tuningRef.current = tuning;
  deviceRef.current = device;
  docRef.current = doc;

  useEffect(() => {
    loadTuning().then((t) => {
      setTuning(t);
      engineRef.current.cfg = t.attention;
    });
    onDeviceAvailability().then(setDevice);
  }, []);

  // ------------------------------------------------------------------ help requests

  const requestHelp = useCallback((id: string) => {
    const t = tuningRef.current;
    if (!t || cache.current.has(id)) return;
    const block = docRef.current.blocks.find((b) => b.id === id);
    if (!block) return;
    setHelp((h) => ({ ...h, [id]: { status: "loading" } }));
    const record = (r: { route: Route; ms: number }) =>
      setStats((s) => (r.route === "on-device" ? { ...s, device: [...s.device, r.ms] } : { ...s, cloud: [...s.cloud, r.ms] }));

    const job = (async () => {
      try {
        if (block.kind === "p") {
          const r: Timed<ParagraphHelp> = await explainParagraph(block.text, t.cloudModel);
          record(r);
          setHelp((h) => ({ ...h, [id]: { status: "done", kind: "p", data: r } }));
        } else {
          const png = await svgToPngBase64(block.svg, 960);
          const r = await explainFigure(png, block.caption, t.cloudModel);
          record(r);
          setHelp((h) => ({ ...h, [id]: { status: "done", kind: "figure", data: r } }));
        }
      } catch (e) {
        cache.current.delete(id);
        const message = e instanceof Error ? e.message : String(e);
        setHelp((h) => ({ ...h, [id]: { status: "error", message } }));
      }
    })();
    cache.current.set(id, job);
  }, []);

  const showHelp = useCallback(
    (id: string) => {
      setShownId(id);
      requestHelp(id);
    },
    [requestHelp],
  );

  // ------------------------------------------------------------------ attention loop

  useEffect(() => {
    if (mode !== "eyes" && mode !== "mouse") return;
    let raf = 0;
    const engine = engineRef.current;
    engine.reset();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const targets: Target[] = [];
      docRef.current.blocks.forEach((b: Block, index) => {
        const el = blockEls.current.get(b.id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        targets.push({ id: b.id, index, words: wordCount(b), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
      });
      const p = pointRef.current;
      if (dotRef.current) {
        dotRef.current.style.opacity = p ? "1" : "0";
        if (p) dotRef.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
      for (const ev of engine.update(p, performance.now(), targets)) {
        if (ev.type === "focus") {
          setFocusId(ev.id);
          const t = tuningRef.current;
          const blk = docRef.current.blocks.find((b) => b.id === ev.id);
          // Speculative help: only when it is free and private, i.e. Nano is ready.
          if (t?.prefetch && deviceRef.current === "available" && blk?.kind === "p") requestHelp(ev.id);
        } else if (ev.type === "stuck") {
          showHelp(ev.id);
        } else if (ev.type === "blur") {
          setFocusId((f) => (f === ev.id ? null : f));
        }
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [mode, requestHelp, showHelp]);

  // Mouse stands in for the eyes: same engine, same events.
  useEffect(() => {
    if (mode !== "mouse") return;
    const move = (e: PointerEvent) => (pointRef.current = { x: e.clientX, y: e.clientY });
    const leave = () => (pointRef.current = null);
    window.addEventListener("pointermove", move);
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "eyes") return;
    const id = setInterval(() => setFrames(trackerRef.current?.frames ?? 0), 1000);
    return () => clearInterval(id);
  }, [mode]);

  // ------------------------------------------------------------------ starting

  const warmDeviceModel = () => {
    // Must run inside the click handler: Chrome only allows the model download on a user gesture.
    if (!firebaseConfigured || !tuning) return;
    if (device !== "downloadable" && device !== "downloading") return;
    setDevice("downloading");
    readerModel(tuning.cloudModel)
      .initializeDeviceModel((p) => setDownload(p))
      .then(() => onDeviceAvailability().then(setDevice))
      .catch(() => setDevice("unavailable"));
  };

  const onFrame = (f: Frame) => {
    if (sampling.current.on) {
      if (f.features) {
        samples.current.f.push(f.features);
        samples.current.x.push(sampling.current.target.x);
        samples.current.y.push(sampling.current.target.y);
      }
      return;
    }
    const m = modelRef.current;
    if (!m) return;
    if (!f.features) {
      pointRef.current = null;
      return;
    }
    const raw = predictRidge(m, f.features);
    const x = Math.min(Math.max(filters.current.x.filter(raw.x, f.t), 0), window.innerWidth);
    const y = Math.min(Math.max(filters.current.y.filter(raw.y, f.t), 0), window.innerHeight);
    pointRef.current = { x, y };
  };

  const startEyes = async () => {
    warmDeviceModel();
    setError(null);
    try {
      trackerRef.current?.stop();
      const tracker = new GazeTracker(onFrame);
      trackerRef.current = tracker;
      await tracker.start();
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera in the address bar, or read with the mouse instead."
          : `The eye tracker could not start: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    await calibrate();
  };

  const calibrate = async () => {
    setMode("calibrating");
    samples.current = { f: [], x: [], y: [] };
    modelRef.current = null;
    const perPoint: { i: number; start: number; end: number }[] = [];
    for (let i = 0; i < CALIB_POINTS.length; i++) {
      setCalibIndex(i);
      const target = { x: CALIB_POINTS[i].x * window.innerWidth, y: CALIB_POINTS[i].y * window.innerHeight };
      await sleep(900);
      sampling.current = { on: true, target };
      const start = samples.current.f.length;
      await sleep(1300);
      sampling.current.on = false;
      perPoint.push({ i, start, end: samples.current.f.length });
    }
    setCalibIndex(-1);
    const s = samples.current;
    if (s.f.length < 40) {
      setError("The camera could not see your eyes clearly. Face the screen in good light and try again.");
      trackerRef.current?.stop();
      setMode("intro");
      return;
    }
    const model = fitRidge(s.f, s.x, s.y, 2);
    // Accuracy: distance between each point's mean prediction and the point itself.
    let err = 0;
    for (const { start, end } of perPoint) {
      if (end <= start) continue;
      let px = 0, py = 0;
      for (let k = start; k < end; k++) {
        const p = predictRidge(model, s.f[k]);
        px += p.x / (end - start);
        py += p.y / (end - start);
      }
      err += Math.hypot(px - s.x[start], py - s.y[start]) / perPoint.length;
    }
    setAccuracy(Math.round(err));
    filters.current.x.reset();
    filters.current.y.reset();
    modelRef.current = model;
    setMode("eyes");
  };

  const startMouse = () => {
    warmDeviceModel();
    trackerRef.current?.stop();
    setError(null);
    setMode("mouse");
  };

  const stop = () => {
    trackerRef.current?.stop();
    pointRef.current = null;
    setFocusId(null);
    setMode("intro");
  };

  const loadText = (raw: string) => {
    const d = docFromText(raw);
    if (!d.blocks.length) return;
    cache.current.clear();
    setHelp({});
    setShownId(null);
    setFocusId(null);
    setDoc(d);
    setPasting(false);
    window.scrollTo({ top: 0 });
  };

  // ------------------------------------------------------------------ render

  const deviceLabel = useMemo(() => {
    if (!firebaseConfigured) return "Firebase not configured";
    switch (device) {
      case "available":
        return "Gemini Nano ready on this device";
      case "downloading":
        return `Downloading Gemini Nano${download ? `, ${Math.round(download * 100)}%` : ""}`;
      case "downloadable":
        return "Gemini Nano will download when you start";
      case "checking":
        return "Checking for an on-device model";
      default:
        return "No on-device model here, help comes from the cloud";
    }
  }, [device, download]);

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const reading = mode === "eyes" || mode === "mouse";

  return (
    <div className={`app ${reading && focusId ? "has-focus" : ""}`}>
      <header className="bar">
        <div className="brand">Linger</div>
        <div className="status">
          <span className={`pill device-${device}`}>{deviceLabel}</span>
          {mode === "eyes" && (
            <span className="pill camera">
              Camera on, stays on this device{accuracy !== null ? `. Accuracy about ${accuracy} px` : ""}
            </span>
          )}
          {mode === "mouse" && <span className="pill">Reading with the mouse</span>}
        </div>
        <div className="actions">
          {reading ? (
            <>
              {mode === "eyes" && (
                <>
                  <button className="ghost" onClick={() => setShowDot((v) => !v)}>
                    {showDot ? "Hide gaze dot" : "Show gaze dot"}
                  </button>
                  <button className="ghost" onClick={calibrate}>Recalibrate</button>
                </>
              )}
              <button className="ghost" onClick={stop}>Stop reading</button>
            </>
          ) : null}
        </div>
      </header>

      {!reading && mode !== "calibrating" && (
        <section className="intro">
          <h1>Help appears where your eyes linger.</h1>
          <p>
            Look at a paragraph and it comes into the light. Stay on it, or come back to it, and Linger writes a plain-language
            version in the margin. Your camera and what you struggle with stay on this device: Gemini Nano answers locally,
            and only charts go to the cloud.
          </p>
          <div className="cta">
            <button className="primary" onClick={startEyes}>Start eye reading</button>
            <button className="secondary" onClick={startMouse}>Read with the mouse</button>
            <button className="ghost" onClick={() => setPasting(true)}>Read your own text</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {!firebaseConfigured && (
            <p className="error" role="alert">
              This build has no Firebase project. Copy web/.env.example to web/.env.local and add your config to turn on help.
            </p>
          )}
        </section>
      )}

      {pasting && <PasteDialog onCancel={() => setPasting(false)} onRead={loadText} />}

      <main className="page">
        <article className="doc">
          <h2 className="title">{doc.title}</h2>
          {doc.byline && <p className="byline">{doc.byline}</p>}
          {doc.blocks.map((b) => (
            <div className="row" key={b.id}>
              <div
                ref={(el) => {
                  if (el) blockEls.current.set(b.id, el);
                  else blockEls.current.delete(b.id);
                }}
                className={`block ${focusId === b.id ? "lit" : ""} ${b.kind}`}
              >
                {b.kind === "p" ? (
                  <p>{b.text}</p>
                ) : (
                  <figure>
                    <div className="svg" dangerouslySetInnerHTML={{ __html: b.svg }} />
                    <figcaption>{b.caption}</figcaption>
                  </figure>
                )}
              </div>
              <aside className="margin">
                {shownId === b.id && help[b.id] ? (
                  <MarginNote help={help[b.id]} kind={b.kind} onClose={() => setShownId(null)} />
                ) : (
                  <button className="ask" onClick={() => showHelp(b.id)}>
                    {b.kind === "p" ? "Explain this" : "Explain this chart"}
                  </button>
                )}
              </aside>
            </div>
          ))}
        </article>
      </main>

      <footer className="session">
        <span>
          {stats.device.length} answered on this device{stats.device.length ? ` (avg ${avg(stats.device)} ms)` : ""}
        </span>
        <span>
          {stats.cloud.length} from the cloud{stats.cloud.length ? ` (avg ${avg(stats.cloud)} ms)` : ""}
        </span>
        {mode === "eyes" && <span>{frames.toLocaleString()} camera frames read, none uploaded</span>}
      </footer>

      {mode === "calibrating" && calibIndex >= 0 && (
        <div className="calibrate" role="dialog" aria-label="Eye calibration">
          <p>
            Look at the dot until it moves. Point {calibIndex + 1} of {CALIB_POINTS.length}.
          </p>
          <div
            key={calibIndex}
            className="target"
            style={{ left: `${CALIB_POINTS[calibIndex].x * 100}%`, top: `${CALIB_POINTS[calibIndex].y * 100}%` }}
          />
        </div>
      )}

      {mode === "eyes" && <div ref={dotRef} className={`gaze ${showDot ? "" : "hidden"}`} aria-hidden />}
    </div>
  );
}

function PasteDialog({ onCancel, onRead }: { onCancel: () => void; onRead: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="scrim" role="dialog" aria-label="Read your own text">
      <div className="sheet">
        <label htmlFor="paste">Paste an article, a letter or a policy. Blank lines separate paragraphs.</label>
        <textarea id="paste" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={12} />
        <div className="cta">
          <button className="primary" disabled={!text.trim()} onClick={() => onRead(text)}>Read this text</button>
          <button className="ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
