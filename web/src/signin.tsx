// Sign-in on write (docs/ARCHITECTURE.md v3.1): nothing asks for an account until an action needs the server.
// requireSignIn("upload this Moment") opens a sheet; it resolves with the user once they sign in (the caller then
// resumes its action) and rejects with SignInDeclined if they close it.

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "firebase/auth";
import { signInWithGoogle } from "./auth";
import { auth, configured } from "./firebase";

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
    if (busy || !ask) return;
    ask.reject(new SignInDeclined());
    set(null);
  };
  const go = async () => {
    if (!ask) return;
    setBusy(true);
    setErr(null);
    try {
      const u = await signInWithGoogle();
      ask.resolve(u);
      set(null);
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") setErr(String((e as Error)?.message ?? e));
    } finally {
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
      <div className="sheet-box">
        <h2 id={id}>Sign in to {ask?.action ?? "continue"}</h2>
        <p className="muted">
          Browsing and recording work without an account. Anything that goes to the server, like uploading a Moment for review or running a
          check, needs to know it's yours.
        </p>
        {err && <p className="notice notice-bad small">Sign-in failed: {err}</p>}
        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={go} disabled={busy} autoFocus>
            {busy ? "Signing in…" : "Continue with Google"}
          </button>
          <button className="btn btn-quiet" onClick={cancel} disabled={busy}>
            Not now
          </button>
        </div>
      </div>
    </dialog>
  );
}
