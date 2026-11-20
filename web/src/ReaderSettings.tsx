import { useEffect, useRef, useState } from "react";

export interface Prefs {
  size: number; // rem
  leading: number;
  font: "literata" | "atkinson";
  eyeScroll: boolean; // look at the top/bottom edge to scroll
  eyeClick: boolean; // look at a button for a second to press it
  learnFromMouse: boolean; // moving or clicking the mouse corrects gaze drift
}

const DEFAULT_PREFS: Prefs = {
  size: 1.1875,
  leading: 1.75,
  font: "literata",
  eyeScroll: true,
  eyeClick: true,
  learnFromMouse: true,
};
const SIZES = [
  { label: "Smaller", value: 1.0625 },
  { label: "Normal", value: 1.1875 },
  { label: "Larger", value: 1.4 },
  { label: "Largest", value: 1.7 },
];
const KEY = "linger.prefs";

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: preferences last for this visit only */
  }
}

export function ReaderSettings({ prefs, onChange, eyes }: { prefs: Prefs; onChange: (p: Prefs) => void; eyes?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="settings" ref={ref}>
      <button className="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Text
      </button>
      {open && (
        <div className="settings-panel" role="group" aria-label="Text settings">
          <fieldset>
            <legend>Size</legend>
            {SIZES.map((s) => (
              <button
                key={s.label}
                className={prefs.size === s.value ? "on" : ""}
                aria-pressed={prefs.size === s.value}
                onClick={() => onChange({ ...prefs, size: s.value })}
              >
                {s.label}
              </button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Line spacing</legend>
            {[
              { label: "Normal", value: 1.75 },
              { label: "Roomy", value: 2.1 },
            ].map((l) => (
              <button
                key={l.label}
                className={prefs.leading === l.value ? "on" : ""}
                aria-pressed={prefs.leading === l.value}
                onClick={() => onChange({ ...prefs, leading: l.value })}
              >
                {l.label}
              </button>
            ))}
          </fieldset>
          <fieldset>
            <legend>Typeface</legend>
            <button
              className={prefs.font === "literata" ? "on" : ""}
              aria-pressed={prefs.font === "literata"}
              onClick={() => onChange({ ...prefs, font: "literata" })}
            >
              Book
            </button>
            <button
              className={prefs.font === "atkinson" ? "on" : ""}
              aria-pressed={prefs.font === "atkinson"}
              onClick={() => onChange({ ...prefs, font: "atkinson" })}
            >
              Hyperlegible
            </button>
          </fieldset>
          {eyes && (
            <fieldset>
              <legend>With your eyes</legend>
              <button
                className={prefs.eyeScroll ? "on" : ""}
                aria-pressed={prefs.eyeScroll}
                onClick={() => onChange({ ...prefs, eyeScroll: !prefs.eyeScroll })}
              >
                Scroll at the edges
              </button>
              <button
                className={prefs.eyeClick ? "on" : ""}
                aria-pressed={prefs.eyeClick}
                onClick={() => onChange({ ...prefs, eyeClick: !prefs.eyeClick })}
              >
                Look to press
              </button>
              <button
                className={prefs.learnFromMouse ? "on" : ""}
                aria-pressed={prefs.learnFromMouse}
                onClick={() => onChange({ ...prefs, learnFromMouse: !prefs.learnFromMouse })}
              >
                Learn from my mouse
              </button>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
