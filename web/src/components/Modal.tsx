// A pop-out viewer on the native <dialog>: focus trap, Escape and an inert page come from the browser. Used by the
// evidence room to open one piece of evidence (a clip, the proof shots, the route, the chain) over a compact page.

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Glyph } from "../kit";

export default function Modal({
  open,
  title,
  sub,
  wide,
  media,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  sub?: ReactNode;
  /** Wider box for the proof viewer and the map. */
  wide?: boolean;
  /** Dark media stage (video, photos). */
  media?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""} ${media ? "modal-media" : ""}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop
      }}
    >
      {open && (
        <div className="modal-box">
          <header className="modal-head">
            <div>
              <h2 id={id}>{title}</h2>
              {sub && <p className="muted small">{sub}</p>}
            </div>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close" autoFocus>
              <Glyph name="close" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
