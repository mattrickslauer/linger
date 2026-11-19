import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttentionEngine, type StuckReason, type Target } from "./gaze/attention";
import { GazeTracker, type Frame } from "./gaze/tracker";
import { fitRidge, predictRidge, type RidgeModel } from "./gaze/ridge";
import { OneEuro } from "./gaze/oneEuro";
import { docFromText, wordCount, type Block, type Doc } from "./content/article";
import { LIBRARY } from "./content/library";
import {
  explainFigure,
  explainParagraph,
  friendlyError,
  onDeviceAvailability,
  type ParagraphHelp,
  type Route,
  type Timed,
} from "./ai/assist";
import { firebaseConfigured, loadTuning, readerModel, type Tuning } from "./firebase";
import { svgToPngBase64 } from "./svgToPng";
import { MarginNote, type Help, type Why } from "./MarginNote";
import { ReaderSettings, loadPrefs, savePrefs, type Prefs } from "./ReaderSettings";

type Mode = "intro" | "setup" | "calibrating" | "eyes" | "mouse";
type DeviceState = "checking" | "available" | "downloadable" | "downloading" | "unavailable";
type SetupStage = "loading" | "camera" | "ready";

const CALIB_POINTS = [0.1, 0.5, 0.9].flatMap((y) => [0.1, 0.5, 0.9].map((x) => ({ x, y })));
const ROUGH_CALIBRATION_PX = 180;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Shown {
  id: string;
  why: Why;
  /** true when the answer was already waiting (prefetched on-device) at the moment it was shown */
  early: boolean;
}

export default function App() {
  const [doc, setDoc] = useState<Doc>(LIBRARY[0].doc);
  const [mode, setMode] = useState<Mode>("intro");
  const [tuning, setTuning] = useState<Tuning | null>(null);
  const [device, setDevice] = useState<DeviceState>("checking");
  const [download, setDownload] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [help, setHelp] = useState<Record<string, Help>>({});
  const [stats, setStats] = useState<{ device: number[]; cloud: number[]; early: number }>({ device: [], cloud: [], early: 0 });
  const [calibIndex, setCalibIndex] = useState(-1);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [showDot, setShowDot] = useState(true);
  const [frames, setFrames] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [nanoHelp, setNanoHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<SetupStage>("loading");
  const [faceSeen, setFaceSeen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [opening, setOpening] = useState(false);

  const blockEls = useRef(new Map<string, HTMLElement>());
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef(new AttentionEngine());
  const trackerRef = useRef<GazeTracker | null>(null);
  const modelRef = useRef<RidgeModel | null>(null);
  const filters = useRef({ x: new OneEuro(0.8, 0.01), y: new OneEuro(0.8, 0.01) });
  const sampling = useRef<{ on: boolean; target: { x: number; y: number } }>({ on: false, target: { x: 0, y: 0 } });
  const samples = useRef<{ f: number[][]; x: number[]; y: number[] }>({ f: [], x: [], y: [] });
  const lastFaceAt = useRef(0);
  const cache = useRef(new Map<string, Promise<void>>());
  /** ids whose help was started speculatively on focus (on-device only) */
  const prefetched = useRef(new Set<string>());
  const helpRef = useRef(help);
  const tuningRef = useRef<Tuning | null>(null);
  const deviceRef = useRef<DeviceState>("checking");
  const docRef = useRef(doc);
  helpRef.current = help;
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

  useEffect(() => savePrefs(prefs), [prefs]);

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
        const message = friendlyError(e);
        setHelp((h) => ({ ...h, [id]: { status: "error", message } }));
      }
    })();
    cache.current.set(id, job);
  }, []);

  const showHelp = useCallback(
    (id: string, why: Why) => {
      const early = prefetched.current.has(id) && helpRef.current[id]?.status === "done";
      prefetched.current.delete(id);
      if (early) setStats((s) => ({ ...s, early: s.early + 1 }));
      setShown({ id, why, early });
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
          if (t?.prefetch && deviceRef.current === "available" && blk?.kind === "p" && !cache.current.has(ev.id)) {
            prefetched.current.add(ev.id);
            requestHelp(ev.id);
          }
        } else if (ev.type === "stuck") {
          showHelp(ev.id, ev.reason as StuckReason);
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
    if (mode !== "eyes" && mode !== "setup") return;
    const id = setInterval(() => {
      setFrames(trackerRef.current?.frames ?? 0);
      setFaceSeen(performance.now() - lastFaceAt.current < 600);
    }, 250);
    return () => clearInterval(id);
  }, [mode]);

  // Mount the live camera preview while setting up.
  useEffect(() => {
    const v = trackerRef.current?.video;
    const host = previewRef.current;
    if (mode !== "setup" || !v || !host) return;
    host.appendChild(v);
    return () => {
      if (v.parentElement === host) host.removeChild(v);
    };
  }, [mode, stage]);

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
    if (f.features) lastFaceAt.current = f.t;
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
    setStage("loading");
    setFaceSeen(false);
    setMode("setup");
    try {
      trackerRef.current?.stop();
      const tracker = new GazeTracker(onFrame);
      trackerRef.current = tracker;
      await tracker.start(setStage);
    } catch (e) {
      setMode("intro");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera in the address bar, or read with the mouse instead."
          : e instanceof DOMException && e.name === "NotFoundError"
            ? "No camera was found. Connect a webcam, or read with the mouse instead."
            : `The eye tracker could not start: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const calibrate = async () => {
    setMode("calibrating");
    samples.current = { f: [], x: [], y: [] };
    modelRef.current = null;
    const perPoint: { start: number; end: number }[] = [];
    for (let i = 0; i < CALIB_POINTS.length; i++) {
      setCalibIndex(i);
      const target = { x: CALIB_POINTS[i].x * window.innerWidth, y: CALIB_POINTS[i].y * window.innerHeight };
      await sleep(900);
      sampling.current = { on: true, target };
      const start = samples.current.f.length;
      await sleep(1300);
      sampling.current.on = false;
      perPoint.push({ start, end: samples.current.f.length });
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
    let counted = 0;
    for (const { start, end } of perPoint) {
      if (end <= start) continue;
      let px = 0;
      let py = 0;
      for (let k = start; k < end; k++) {
        const p = predictRidge(model, s.f[k]);
        px += p.x / (end - start);
        py += p.y / (end - start);
      }
      err += Math.hypot(px - s.x[start], py - s.y[start]);
      counted++;
    }
    setAccuracy(Math.round(err / Math.max(counted, 1)));
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

  const openDoc = (d: Doc) => {
    if (!d.blocks.length) return;
    cache.current.clear();
    prefetched.current.clear();
    setHelp({});
    setShown(null);
    setFocusId(null);
    setDoc(d);
    setPasting(false);
    window.scrollTo({ top: 0 });
  };

  const openPdf = async (file: File) => {
    setOpening(true);
    setError(null);
    try {
      const { docFromPdf } = await import("./content/pdf");
      const d = await docFromPdf(file);
      if (!d.blocks.length) setError("That PDF has no selectable text. Scanned pages are not supported yet.");
      else openDoc(d);
    } catch (e) {
      setError(`That PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOpening(false);
    }
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
  const rough = mode === "eyes" && accuracy !== null && accuracy > ROUGH_CALIBRATION_PX;

  return (
    <div className={`app ${reading && focusId ? "has-focus" : ""}`}>
      <header className="bar">
        <div className="brand">Linger</div>
        <div className="status">
          {device === "unavailable" && firebaseConfigured ? (
            <button className={`pill device-${device}`} onClick={() => setNanoHelp(true)}>
              {deviceLabel}. Turn on Nano
            </button>
          ) : (
            <span className={`pill device-${device}`}>{deviceLabel}</span>
          )}
          {mode === "eyes" && (
            <span className={`pill camera ${rough ? "rough" : ""}`}>
              Camera on, stays on this device{accuracy !== null ? `. Accuracy about ${accuracy} px` : ""}
            </span>
          )}
          {mode === "mouse" && <span className="pill">Reading with the mouse</span>}
        </div>
        <div className="actions">
          <ReaderSettings prefs={prefs} onChange={setPrefs} />
          {mode === "eyes" && (
            <>
              <button className="ghost" onClick={() => setShowDot((v) => !v)}>
                {showDot ? "Hide gaze dot" : "Show gaze dot"}
              </button>
              <button className="ghost" onClick={calibrate}>Recalibrate</button>
            </>
          )}
          {reading && <button className="ghost" onClick={stop}>Stop reading</button>}
        </div>
      </header>

      {rough && (
        <div className="banner" role="status">
          Tracking is rough right now (about {accuracy} px off). Sit an arm's length away with light on your face, then
          recalibrate. <button className="ghost" onClick={calibrate}>Recalibrate</button>
        </div>
      )}

      {!reading && mode !== "calibrating" && mode !== "setup" && (
        <section className="intro">
          <h1>Help appears where your eyes linger.</h1>
          <p>
            Read as you normally would. When you stay on a paragraph, or come back to one, Linger notices and writes a plainer
            version in the margin before you think to ask. Gemini Nano does this on your device, so your camera and what you
            find hard stay private.
          </p>
          <div className="cta">
            <button className="primary" onClick={startEyes}>Start eye reading</button>
            <button className="secondary" onClick={startMouse}>Read with the mouse</button>
          </div>
          <div className="library" role="group" aria-label="Choose something to read">
            {LIBRARY.map((e) => (
              <button
                key={e.doc.title}
                className={`doc-choice ${doc === e.doc ? "chosen" : ""}`}
                aria-pressed={doc === e.doc}
                onClick={() => openDoc(e.doc)}
              >
                <strong>{e.label}</strong>
                <span>{e.hint}</span>
              </button>
            ))}
            <button className="doc-choice" onClick={() => fileRef.current?.click()} disabled={opening}>
              <strong>{opening ? "Opening…" : "Open a PDF"}</strong>
              <span>Read on this device, never uploaded</span>
            </button>
            <button className="doc-choice" onClick={() => setPasting(true)}>
              <strong>Paste text</strong>
              <span>A letter, a contract, an article</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) openPdf(f);
                e.target.value = "";
              }}
            />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          {!firebaseConfigured && (
            <p className="error" role="alert">
              This build has no Firebase project. Copy web/.env.example to web/.env.local and add your config to turn on help.
            </p>
          )}
        </section>
      )}

      {pasting && <PasteDialog onCancel={() => setPasting(false)} onRead={(t) => openDoc(docFromText(t))} />}
      {nanoHelp && <NanoHelp onClose={() => setNanoHelp(false)} />}

      <main className="page">
        <article
          className="doc"
          style={
            {
              "--read-size": `${prefs.size}rem`,
              "--read-leading": prefs.leading,
              "--read-font": prefs.font === "atkinson" ? "var(--ui)" : "var(--read)",
            } as React.CSSProperties
          }
        >
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
                {shown?.id === b.id && help[b.id] ? (
                  <MarginNote help={help[b.id]} kind={b.kind} why={shown.why} early={shown.early} onClose={() => setShown(null)} />
                ) : (
                  <button className="ask" onClick={() => showHelp(b.id, "asked")}>
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
        {stats.early > 0 && <span>{stats.early} ready before you needed it</span>}
        {mode === "eyes" && <span>{frames.toLocaleString()} camera frames read, none uploaded</span>}
      </footer>

      {mode === "setup" && (
        <div className="setup" role="dialog" aria-label="Camera setup">
          <div className="setup-card">
            <div ref={previewRef} className={`preview ${faceSeen ? "found" : ""}`}>
              {stage !== "ready" && <span className="preview-wait">{stage === "loading" ? "Starting the camera…" : "Loading the face tracker…"}</span>}
            </div>
            <h2>{stage !== "ready" ? "Getting ready" : faceSeen ? "We can see your eyes" : "Move into view"}</h2>
            <p>
              {stage !== "ready"
                ? "The face tracker runs in this tab. Nothing from the camera is uploaded."
                : faceSeen
                  ? "Next, look at nine dots in turn so Linger can learn where you are looking. It takes about 20 seconds."
                  : "Sit about an arm's length away, facing the screen, with light on your face."}
            </p>
            <div className="cta">
              <button className="primary" disabled={stage !== "ready" || !faceSeen} onClick={calibrate}>
                Begin calibration
              </button>
              <button className="ghost" onClick={stop}>Cancel</button>
            </div>
          </div>
        </div>
      )}

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
    <div className="scrim" role="dialog" aria-label="Paste text">
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

function NanoHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" role="dialog" aria-label="Turn on Gemini Nano">
      <div className="sheet">
        <h2>Turn on Gemini Nano in Chrome</h2>
        <p>Linger works without it, but with Nano your help is private, instant and works offline.</p>
        <ol>
          <li>Use Chrome 139 or later on a desktop computer.</li>
          <li>
            Open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, set it to Enabled and restart
            Chrome.
          </li>
          <li>
            Open <code>chrome://settings/ai</code> and make sure on-device AI is on.
          </li>
          <li>Come back here and press Start. The model downloads once, in the background.</li>
        </ol>
        <div className="cta">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
