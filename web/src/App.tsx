import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttentionEngine, type StuckReason, type Target } from "./gaze/attention";
import { GazeTracker, type Frame } from "./gaze/tracker";
import { predictRidge, type RidgeModel } from "./gaze/ridge";
import { CALIBRATION_POINTS, VALIDATION_POINTS, chooseModel, fit, type Sample } from "./gaze/calibration";
import { DwellClick, ScrollIntent, type ClickTarget } from "./gaze/intent";
import { DEFAULT_ADAPT, GazeAdapter, PointerTrail } from "./gaze/adapt";
import { GazeVisual } from "./GazeVisual";
import { OneEuro } from "./gaze/oneEuro";
import { docFromText, wordCount, type Block, type Doc } from "./content/article";
import { LIBRARY } from "./content/library";
import {
  explainFigure,
  explainParagraph,
  friendlyError,
  nanoReport,
  type NanoReport,
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

const ROUGH_CALIBRATION_PX = 200; // held-out error; higher than the old in-sample number by design
const CALIB_MIN_SAMPLES = 12;
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
  const [calibPhase, setCalibPhase] = useState<"calibrate" | "validate">("calibrate");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [showDot, setShowDot] = useState(true);
  const [frames, setFrames] = useState(0);
  const [pasting, setPasting] = useState(false);
  const [nanoHelp, setNanoHelp] = useState(false);
  const [nano, setNano] = useState<NanoReport | null>(null);
  const refreshNano = useCallback(async () => {
    const r = await nanoReport();
    setNano(r);
    // While our own download call is pending Chrome may still say "downloadable" for a moment.
    // Give it 30 s; after that, Chrome never started, so offer the button again.
    const stalled = downloadStartedAt.current !== null && Date.now() - downloadStartedAt.current > 30_000;
    setDevice((d) => (d === "downloading" && r.state === "downloadable" && !stalled ? d : r.state));
    if (r.state !== "downloading" && (r.state !== "downloadable" || stalled)) downloadStartedAt.current = null;
  }, []);
  const downloadStartedAt = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (device !== "downloading") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [device]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<SetupStage>("loading");
  const [faceSeen, setFaceSeen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [opening, setOpening] = useState(false);

  const blockEls = useRef(new Map<string, HTMLElement>());
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const calibTarget = useRef<{ x: number; y: number } | null>(null);
  const adapterRef = useRef<GazeAdapter | null>(null);
  const pointerTrail = useRef(new PointerTrail());
  const recentFrames = useRef<{ t: number; f: number[] }[]>([]);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerMove = useRef(0);
  const [learning, setLearning] = useState<{ n: number; error: number | null }>({ n: 0, error: null });
  const ringRef = useRef<HTMLDivElement>(null);
  const scrollIntent = useRef(new ScrollIntent());
  const dwellClick = useRef(new DwellClick());
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const fileRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef(new AttentionEngine());
  const trackerRef = useRef<GazeTracker | null>(null);
  const modelRef = useRef<RidgeModel | null>(null);
  const filters = useRef({ x: new OneEuro(0.8, 0.01), y: new OneEuro(0.8, 0.01) });
  const sampling = useRef<{ on: boolean; target: { x: number; y: number }; point: number }>({
    on: false,
    target: { x: 0, y: 0 },
    point: 0,
  });
  const samples = useRef<Sample[]>([]);
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
    refreshNano();
  }, []);

  // Chrome can finish downloading Nano at any time (or the reader flips the flag and comes back),
  // so keep checking until it is ready instead of trusting the first answer.
  useEffect(() => {
    if (device === "available") return;
    const id = setInterval(refreshNano, 4000);
    return () => clearInterval(id);
  }, [device]);

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
    let last = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const targets: Target[] = [];
      docRef.current.blocks.forEach((b: Block, index) => {
        const el = blockEls.current.get(b.id);
        if (!el) return;
        // The whole row (paragraph + its margin), so looking at the note or its buttons
        // doesn't count as leaving the paragraph.
        const r = (el.parentElement ?? el).getBoundingClientRect();
        targets.push({ id: b.id, index, words: wordCount(b), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
      });
      const p = pointRef.current;

      if (mode === "eyes") {
        // Scroll by looking at the top or bottom edge.
        if (prefsRef.current.eyeScroll) {
          const v = scrollIntent.current.update(p, now, window.innerHeight);
          if (v) window.scrollBy(0, v * dt);
        }
        // Click by looking at a gaze-clickable control.
        const ring = ringRef.current;
        if (prefsRef.current.eyeClick) {
          const els = Array.from(document.querySelectorAll<HTMLElement>("[data-gaze-click]"));
          const clickTargets: ClickTarget[] = els.map((el, i) => {
            const r = el.getBoundingClientRect();
            return { id: String(i), rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } };
          });
          const c = dwellClick.current.update(p, now, clickTargets);
          const el = c.id !== null ? els[Number(c.id)] : null;
          if (ring) {
            if (el && c.progress > 0.08) {
              const r = el.getBoundingClientRect();
              ring.style.left = `${r.left + r.width / 2}px`;
              ring.style.top = `${r.top + r.height / 2}px`;
              ring.style.setProperty("--p", String(c.progress));
              ring.style.opacity = "1";
            } else ring.style.opacity = "0";
          }
          if (c.fire !== null) els[Number(c.fire)]?.click();
        } else if (ring) ring.style.opacity = "0";
      }

      for (const ev of engine.update(p, now, targets)) {
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
    if (mode !== "eyes" && mode !== "setup" && mode !== "calibrating") return;
    const id = setInterval(() => {
      setFrames(trackerRef.current?.frames ?? 0);
      setFaceSeen(performance.now() - lastFaceAt.current < 600);
      const a = adapterRef.current;
      if (a) setLearning({ n: a.learned, error: a.liveError });
      // Only draw the eyes-to-cursor line while the mouse is actually being moved.
      if (performance.now() - lastPointerMove.current > 400) cursorRef.current = null;
    }, 250);
    return () => clearInterval(id);
  }, [mode]);

  // In eye mode the mouse is ground truth: moving it while watching it, or clicking, teaches
  // the gaze model and cancels drift.
  useEffect(() => {
    if (mode !== "eyes") return;
    const move = (e: PointerEvent) => {
      const t = performance.now();
      pointerTrail.current.push(t, e.clientX, e.clientY);
      lastPointerMove.current = t;
      if (prefsRef.current.learnFromMouse) cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    const down = (e: PointerEvent) => {
      const a = adapterRef.current;
      if (!a || !prefsRef.current.learnFromMouse) return;
      // People look where they click: label the last ~300 ms of eye frames with the click point.
      const t = performance.now();
      for (const fr of recentFrames.current) if (t - fr.t < 300) a.observe(fr.f, { x: e.clientX, y: e.clientY }, fr.t, "click");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down, true);
    };
  }, [mode]);

  // ------------------------------------------------------------------ starting

  const warmDeviceModel = () => {
    // Must run inside the click handler: Chrome only allows the model download on a user gesture.
    if (!firebaseConfigured) return;
    if (device !== "downloadable" && device !== "downloading") return;
    setDevice("downloading");
    downloadStartedAt.current ??= Date.now();
    readerModel(tuning?.cloudModel ?? "gemini-3.5-flash-lite")
      .initializeDeviceModel((p) => setDownload(p))
      .then(refreshNano)
      .catch((e) => {
        console.warn("Gemini Nano download failed", e);
        refreshNano();
      });
  };

  const onFrame = (f: Frame) => {
    if (f.features) lastFaceAt.current = f.t;
    if (sampling.current.on && f.features) {
      samples.current.push({
        f: f.features,
        x: sampling.current.target.x,
        y: sampling.current.target.y,
        point: sampling.current.point,
      });
    }
    // Keep predicting while validating, so the reader sees the estimate chase the dot.
    const m = modelRef.current;
    if (!m) return;
    if (!f.features) {
      pointRef.current = null;
      return;
    }
    const adapter = adapterRef.current;
    if (adapter) {
      recentFrames.current.push({ t: f.t, f: f.features });
      while (recentFrames.current.length && f.t - recentFrames.current[0].t > 500) recentFrames.current.shift();
      // The reader is moving the mouse and watching it: that's a free calibration sample.
      // Eyes trail a moving cursor slightly, so label with where it was ~80 ms ago.
      if (prefsRef.current.learnFromMouse) {
        const target = pointerTrail.current.at(f.t - 80);
        if (target) adapter.observe(f.features, target, f.t);
      }
    }
    const raw = adapter ? adapter.predict(f.features) : predictRidge(m, f.features);
    const x = Math.min(Math.max(filters.current.x.filter(raw.x, f.t), 0), window.innerWidth);
    const y = Math.min(Math.max(filters.current.y.filter(raw.y, f.t), 0), window.innerHeight);
    pointRef.current = { x, y };
  };

  // The multi-GB Nano download is never started implicitly; only the explicit
  // "Download Gemini Nano (one time)" button in the top bar triggers it.
  const startEyes = async () => {
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

  /** Show one dot, let the eyes settle, then collect until it has enough eye samples. */
  const collectDot = async (pt: { x: number; y: number }, point: number) => {
    const target = { x: pt.x * window.innerWidth, y: pt.y * window.innerHeight };
    calibTarget.current = target;
    await sleep(800);
    const before = samples.current.length;
    sampling.current = { on: true, target, point };
    // At least 1.1 s; up to 5 s if blinks or drop-outs left this dot short of samples.
    const t0 = performance.now();
    await sleep(1100);
    while (samples.current.length - before < CALIB_MIN_SAMPLES && performance.now() - t0 < 5000) await sleep(100);
    sampling.current.on = false;
    return samples.current.length - before;
  };

  const calibrate = async () => {
    setMode("calibrating");
    setError(null);
    samples.current = [];
    modelRef.current = null;
    adapterRef.current = null;
    pointRef.current = null;

    // 1. Sixteen fixation dots.
    setCalibPhase("calibrate");
    const counts: number[] = [];
    for (let i = 0; i < CALIBRATION_POINTS.length; i++) {
      setCalibIndex(i);
      counts.push(await collectDot(CALIBRATION_POINTS[i], i));
    }
    const train = [...samples.current];
    if (train.length < 80 || counts.filter((c) => c < 5).length > 3) {
      console.warn("Calibration samples per dot:", counts);
      return abortCalibration(train.length);
    }
    // A provisional model, so the validation dots can show the live estimate.
    filters.current.x.reset();
    filters.current.y.reset();
    modelRef.current = fit(train, 3);

    // 2. Five held-out dots: the honest accuracy, and the choice of smoothing.
    setCalibPhase("validate");
    for (let i = 0; i < VALIDATION_POINTS.length; i++) {
      setCalibIndex(i);
      await collectDot(VALIDATION_POINTS[i], 100 + i);
    }
    const valid = samples.current.slice(train.length);
    setCalibIndex(-1);
    calibTarget.current = null;
    if (valid.length < 25) return abortCalibration(train.length + valid.length);

    const { model, error, lambda } = chooseModel(train, valid);
    console.info(`Calibration: ${train.length}+${valid.length} samples, λ=${lambda}, held-out error ${Math.round(error)} px`);
    setAccuracy(Math.round(error));
    filters.current.x.reset();
    filters.current.y.reset();
    modelRef.current = model;
    // From here on, the mouse keeps teaching the model (see gaze/adapt.ts).
    adapterRef.current = new GazeAdapter([...train, ...valid], model, { ...DEFAULT_ADAPT, lambda });
    recentFrames.current = [];
    setLearning({ n: 0, error: null });
    setMode("eyes");
  };

  const abortCalibration = (seen: number) => {
    setCalibIndex(-1);
    calibTarget.current = null;
    modelRef.current = null;
    setError(
      `The camera could only see your eyes for ${seen} moments during calibration. Face the screen with light on your face (not behind you), keep your glasses free of glare, and try again.`,
    );
    trackerRef.current?.stop();
    setMode("intro");
  };

  const startMouse = () => {
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
      case "downloading": {
        const pct = download > 0 ? `, ${(download * 100).toFixed(download < 0.1 ? 1 : 0)}%` : "";
        const secs = downloadStartedAt.current ? Math.round((now - downloadStartedAt.current) / 1000) : 0;
        const elapsed = secs ? `, ${secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min`}` : "";
        return `Downloading Gemini Nano${pct}${elapsed}. Help comes from the cloud meanwhile`;
      }
      case "downloadable":
        return "Optional: get private on-device help (one-time download, a few GB)";
      case "checking":
        return "Checking for an on-device model";
      default:
        return "No on-device model here, help comes from the cloud";
    }
  }, [device, download, now]);

  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const reading = mode === "eyes" || mode === "mouse";
  const currentError = learning.error ?? accuracy;
  const rough = mode === "eyes" && currentError !== null && currentError > ROUGH_CALIBRATION_PX;

  return (
    <div className={`app ${reading && focusId ? "has-focus" : ""}`}>
      <header className="bar">
        <div className="brand">Linger</div>
        <div className="status">
          {(device === "unavailable" || device === "downloading") && firebaseConfigured ? (
            <button className={`pill device-${device}`} onClick={() => setNanoHelp(true)}>
              {deviceLabel}. {device === "downloading" ? "Details" : "Why?"}
            </button>
          ) : device === "downloadable" && firebaseConfigured ? (
            <button className={`pill device-${device}`} onClick={warmDeviceModel}>
              {deviceLabel}
            </button>
          ) : (
            <span className={`pill device-${device}`}>{deviceLabel}</span>
          )}
          {mode === "eyes" && (
            <span className={`pill camera ${rough ? "rough" : ""}`}>
              Camera on, stays on this device
              {learning.error !== null
                ? `. Accuracy about ${Math.round(learning.error)} px, learning from your mouse (${learning.n})`
                : accuracy !== null
                  ? `. Accuracy about ${accuracy} px`
                  : ""}
            </span>
          )}
          {mode === "mouse" && <span className="pill">Reading with the mouse</span>}
        </div>
        <div className="actions">
          <ReaderSettings prefs={prefs} onChange={setPrefs} eyes={mode === "eyes"} />
          {mode === "eyes" && (
            <>
              <button className="ghost" onClick={() => setShowDot((v) => !v)} data-gaze-click>
                {showDot ? "Hide tracking" : "Show tracking"}
              </button>
              <button className="ghost" onClick={calibrate}>Recalibrate</button>
            </>
          )}
          {reading && <button className="ghost" onClick={stop} data-gaze-click>Stop reading</button>}
        </div>
      </header>

      {rough && (
        <div className="banner" role="status">
          Tracking is rough right now (about {Math.round(currentError ?? 0)} px off). Move the mouse slowly around the page
          and watch it: Linger learns from it and corrects itself. Or{" "}
          <button className="ghost" onClick={calibrate}>recalibrate</button>
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
      {nanoHelp && <NanoHelp report={nano} onRecheck={refreshNano} onClose={() => setNanoHelp(false)} />}

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
                  <MarginNote help={help[b.id]} kind={b.kind} why={shown.why} early={shown.early} onClose={() => setShown(null)} onRetry={() => requestHelp(b.id)} />
                ) : (
                  <button
                    className="ask"
                    onClick={() => showHelp(b.id, "asked")}
                    {...(focusId === b.id ? { "data-gaze-click": "" } : {})}
                  >
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
            <div className={`preview ${faceSeen ? "found" : ""}`}>
              {stage === "ready" ? (
                <GazeVisual tracker={trackerRef.current} placement="hero" lines={false} />
              ) : (
                <span className="preview-wait">{stage === "loading" ? "Starting the camera…" : "Loading the face tracker…"}</span>
              )}
            </div>
            <h2>{stage !== "ready" ? "Getting ready" : faceSeen ? "We can see your eyes" : "Move into view"}</h2>
            <p>
              {stage !== "ready"
                ? "The face tracker runs in this tab. Nothing from the camera is uploaded."
                : faceSeen
                  ? `Next, follow ${CALIBRATION_POINTS.length} dots with your eyes, then ${VALIDATION_POINTS.length} more that check the accuracy. Keep your head still. About 45 seconds.`
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
        <div className={`calibrate ${calibPhase}`} role="dialog" aria-label="Eye calibration">
          <GazeVisual
            tracker={trackerRef.current}
            placement="center"
            target={calibTarget}
            gaze={calibPhase === "validate" ? pointRef : undefined}
          />
          <p>
            {calibPhase === "calibrate"
              ? `Look at the dot until it moves. Dot ${calibIndex + 1} of ${CALIBRATION_POINTS.length}.`
              : `Checking accuracy: dot ${calibIndex + 1} of ${VALIDATION_POINTS.length}. The green line is where Linger thinks you're looking.`}
            <span className={`eyes-state ${faceSeen ? "ok" : "lost"}`}>
              {faceSeen ? "Eyes found" : "Can't see your eyes. Face the screen."}
            </span>
          </p>
          {(() => {
            const pt = (calibPhase === "calibrate" ? CALIBRATION_POINTS : VALIDATION_POINTS)[calibIndex];
            return <div key={`${calibPhase}${calibIndex}`} className="target" style={{ left: `${pt.x * 100}%`, top: `${pt.y * 100}%` }} />;
          })()}
        </div>
      )}

      {mode === "eyes" && showDot && (
        <GazeVisual tracker={trackerRef.current} placement="corner" gaze={pointRef} target={cursorRef} />
      )}
      {mode === "eyes" && <div ref={ringRef} className="dwell-ring" aria-hidden />}
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

function NanoHelp({
  report,
  onRecheck,
  onClose,
}: {
  report: NanoReport | null;
  onRecheck: () => void;
  onClose: () => void;
}) {
  const isChromium = !!report && /^Chromium/.test(report.browser);
  const isChrome = !!report && /Google Chrome/.test(report.browser);
  const verdict = !report
    ? "Checking…"
    : report.state === "downloading" || report.raw === "downloadable"
      ? "Chrome is fetching the model (2–4 GB). The first download often sits near 0% for several minutes. To watch it: chrome://on-device-internals → Model Status. To nudge it: chrome://components → Optimization Guide On Device Model → Check for update."
      : isChromium
      ? "You're using Chromium. Gemini Nano only ships in Google Chrome, so open this page in Google Chrome."
      : !isChrome
        ? "Gemini Nano runs in Google Chrome on a desktop computer. Open this page in Chrome 139 or later."
        : !report.hasPromptApi
          ? "Chrome hasn't switched on the Prompt API yet. Follow the steps below, then restart Chrome."
          : "Chrome has the Prompt API but says the model can't run here. Open chrome://on-device-internals to see why (usually free disk space or graphics memory).";
  return (
    <div className="scrim" role="dialog" aria-label="Turn on Gemini Nano">
      <div className="sheet">
        <h2>Turn on Gemini Nano in Chrome</h2>
        <p>Linger works without it, but with Nano your help is private, instant and works offline.</p>
        <p className="verdict">{verdict}</p>
        {report && (
          <dl className="diag">
            <div><dt>Browser</dt><dd>{report.browser}</dd></div>
            <div><dt>Prompt API</dt><dd>{report.hasPromptApi ? "present" : "missing"}</dd></div>
            <div><dt>Chrome says</dt><dd>{report.raw}</dd></div>
          </dl>
        )}
        <ol>
          <li>Use Chrome 139 or later on a desktop computer.</li>
          <li>
            Open <code>chrome://flags/#prompt-api-for-gemini-nano-multimodal-input</code>, set it to Enabled and restart
            Chrome.
          </li>
          <li>
            Open <code>chrome://settings/ai</code> and make sure on-device AI is on.
          </li>
          <li>
            Chrome needs about 22 GB of free disk space and a graphics card with more than 4 GB of memory (or 16 GB of RAM).
            <code>chrome://on-device-internals</code> shows whether this computer qualifies.
          </li>
          <li>Come back here. When the top bar offers on-device help, click it once; Chrome downloads the model (a few GB) in the background.</li>
        </ol>
        <div className="cta">
          <button className="primary" onClick={onRecheck}>Check again</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
