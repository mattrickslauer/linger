// Sign-in on write (docs/ARCHITECTURE.md v3.1): nothing asks for an account until an action needs the server.
// requireSignIn("upload this Moment") opens a sheet; it resolves with the user once they sign in (the caller then
// resumes its action) and rejects with SignInDeclined if they close it.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "firebase/auth";
import { signIn, SignInCancelled } from "./auth";
import { auth, configured } from "./firebase";
import { Glyph } from "./kit";

export class SignInDeclined extends Error {
  constructor() {
    super("Sign-in was cancelled");
  }
}

interface Ask {
  action: string;
  resolve: (u: User) => void;
  reject: (e: Error) => void;
}

let current: Ask | null = null;
const listeners = new Set<() => void>();
const set = (a: Ask | null) => {
  current = a;
  listeners.forEach((l) => l());
};

/** Resolves with the signed-in user, asking for sign-in first when needed. `action` completes "Sign in to …". */
export function requireSignIn(action: string): Promise<User> {
  const u = auth?.currentUser;
  if (u) return Promise.resolve(u);
  if (!configured) return Promise.reject(new Error("Signing in needs Firebase; this build shows sample data only."));
  current?.reject(new SignInDeclined());
  return new Promise<User>((resolve, reject) => set({ action, resolve, reject }));
}

export const isDeclined = (e: unknown) => e instanceof SignInDeclined;

export function SignInSheet() {
  const ask = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ask && !d.open) {
      setErr(null);
      d.showModal();
    }
    if (!ask && d.open) d.close();
  }, [ask]);

  const cancel = () => {
    if (!ask) return;
    abort.current?.abort();
    ask.reject(new SignInDeclined());
    set(null);
  };
  const go = async () => {
    if (!ask) return;
    setBusy(true);
    setErr(null);
    try {
      abort.current = new AbortController();
      const u = await signIn(abort.current.signal);
      ask.resolve(u);
      set(null);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (!(e instanceof SignInCancelled) && code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request")
        setErr(String((e as Error)?.message ?? e));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      onClick={(e) => e.target === e.currentTarget && cancel()}
    >
      <div className="sheet-box signin-box">
        <span className="sheet-grab" aria-hidden="true" />
        <span className="signin-mark" aria-hidden="true">
          <Glyph name="seal" />
        </span>
        <h2 id={id}>Sign in to {ask?.action ?? "continue"}</h2>
        <ul className="signin-props" aria-label="An account lets you">
          <li>
            <Glyph name="upload" /> Upload Moments
          </li>
          <li>
            <Glyph name="cloud" /> Get them judged
          </li>
          <li>
            <Glyph name="ladder" /> Run checks
          </li>
        </ul>
        <p className="muted small">Browsing and recording never need an account.</p>
        {err && <p className="notice notice-bad small">Sign-in failed: {err}</p>}
        <div className="sheet-actions">
          <button className="btn btn-primary btn-google" onClick={go} disabled={busy} autoFocus>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="g-logo">
              <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
              <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
              <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" />
              <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" />
            </svg>
            {busy ? "Finish in the sign-in window…" : "Continue with Google"}
          </button>
          <button className="btn btn-quiet" onClick={cancel}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
