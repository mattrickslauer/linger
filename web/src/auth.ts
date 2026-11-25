import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithCustomToken, signInWithPopup, signOut, updateProfile, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, USE_EMULATORS } from "./firebase";

// Sign-in goes through accounts.mattrickslauer.com, exactly like Android and iOS, so one person has ONE Firebase uid
// on every platform:
//   1. OAuth 2.0 authorization code + PKCE at {issuer}/auth (client verified-web, redirect_uri = this site's root)
//   2. {issuer}/token swaps the code for an accounts access token
//   3. {issuer}/v1/firebase/{projectId}/token swaps that for a Firebase custom token
//   4. signInWithCustomToken. Firebase Auth stays underneath for rules, App Check and AI Logic.
// The login page opens in a popup; the popup lands back on "/?code=…&state=…", hands the code to this window over a
// same-origin BroadcastChannel (works even if the login page severs window.opener) and closes. If popups are blocked,
// the whole page goes to the login page and finishes on return (finishRedirectSignIn, called before React renders).

const env = import.meta.env;
export const ACCOUNTS_ISSUER = (env.VITE_ACCOUNTS_ISSUER as string | undefined) || "https://accounts.mattrickslauer.com/t/mattricks";
const CLIENT_ID = (env.VITE_ACCOUNTS_CLIENT_ID as string | undefined) || "verified-web";
const CHANNEL = "verified-auth";
const PENDING = "verified.auth.pending.";
const POPUP_TIMEOUT_MS = 10 * 60 * 1000;

interface Pending {
  verifier: string;
  mode: "popup" | "redirect";
  returnTo: string;
  at: number;
}

export class SignInCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled");
    this.name = "SignInCancelled";
  }
}

export function useUser(): { user: User | null; ready: boolean } {
  const [state, set] = useState<{ user: User | null; ready: boolean }>({ user: auth?.currentUser ?? null, ready: !auth });
  useEffect(() => (auth ? onAuthStateChanged(auth, (user) => set({ user, ready: true })) : undefined), []);
  return state;
}

const redirectUri = () => `${location.origin}/`;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

function store(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function savePending(state: string, p: Pending) {
  const s = store();
  if (!s) return;
  // Drop stale attempts so abandoned popups don't pile up.
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i);
    if (k?.startsWith(PENDING)) {
      try {
        if (Date.now() - (JSON.parse(s.getItem(k) || "{}") as Pending).at > POPUP_TIMEOUT_MS) s.removeItem(k);
      } catch {
        s.removeItem(k);
      }
    }
  }
  s.setItem(PENDING + state, JSON.stringify(p));
}

function takePending(state: string): Pending | null {
  const s = store();
  const raw = s?.getItem(PENDING + state);
  if (!raw) return null;
  s!.removeItem(PENDING + state);
  try {
    return JSON.parse(raw) as Pending;
  } catch {
    return null;
  }
}

async function authorizeUrl(mode: Pending["mode"], returnTo: string): Promise<{ url: string; state: string }> {
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(16);
  savePending(state, { verifier, mode, returnTo, at: Date.now() });
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${ACCOUNTS_ISSUER}/auth?${q}`, state };
}

async function postJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(body.error_description || body.error || `Sign-in failed (${res.status})`));
  return body;
}

/** Steps 2–4: code -> accounts token -> Firebase custom token -> Firebase user; then users/{uid} (contract). */
async function finish(code: string, verifier: string): Promise<User> {
  if (!auth || !db) throw new Error("Firebase is not configured");
  const tokens = await postJson(`${ACCOUNTS_ISSUER}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier }),
  });
  const projectId = auth.app.options.projectId;
  const bridge = await postJson(`${ACCOUNTS_ISSUER}/v1/firebase/${projectId}/token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${String(tokens.access_token)}` },
  });
  const { user } = await signInWithCustomToken(auth, String(bridge.token));
  if (!user.displayName) {
    const email = String(bridge.email ?? "");
    const name = email.split("@")[0].replace(/\./g, " ").replace(/^./, (c) => c.toUpperCase()) || "Verified user";
    await updateProfile(user, { displayName: name }).catch(() => {});
  }
  return writeProfile(user);
}

/** users/{uid}: written on first sign-in (contract), profile refreshed afterwards. */
async function writeProfile(user: User): Promise<User> {
  const ref = doc(db!, "users", user.uid);
  const existing = await getDoc(ref).catch(() => null);
  const profile = { displayName: user.displayName ?? "Verified user", photoURL: user.photoURL ?? null };
  await setDoc(ref, existing?.exists() ? profile : { ...profile, createdAtServer: serverTimestamp() }, { merge: true }).catch((e) =>
    console.warn("profile write failed", e),
  );
  return user;
}

/**
 * Opens the accounts login in a popup and resolves with the signed-in user. Falls back to a full-page redirect when
 * the popup is blocked (the promise then never settles; the page navigates away). Abort with `signal` to cancel.
 */
export async function signIn(signal?: AbortSignal): Promise<User> {
  if (!auth || !db) throw new Error("Firebase is not configured");
  // The Auth emulator can't mint accounts tokens; it fakes Google sign-in instead (scripts/e2e-emu.mjs relies on it).
  if (USE_EMULATORS) return writeProfile((await signInWithPopup(auth, new GoogleAuthProvider())).user);
  const returnTo = location.pathname + location.search + location.hash;
  // Open synchronously-ish: the popup must start inside the click; fill in the URL once PKCE is ready.
  const popup = window.open("about:blank", "verified-signin", "popup,width=480,height=720");
  const { url, state } = await authorizeUrl(popup ? "popup" : "redirect", returnTo);
  if (!popup) {
    location.assign(url);
    return new Promise<User>(() => {});
  }
  popup.location.href = url;
  const code = await new Promise<string>((resolve, reject) => {
    const ch = new BroadcastChannel(CHANNEL);
    const done = () => {
      ch.close();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      takePending(state);
      try {
        popup.close();
      } catch {
        /* cross-origin or gone */
      }
      reject(new SignInCancelled());
    };
    const timer = setTimeout(onAbort, POPUP_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort);
    ch.onmessage = (e: MessageEvent<{ state?: string; code?: string; error?: string }>) => {
      if (e.data?.state !== state) return;
      done();
      if (e.data.code) resolve(e.data.code);
      else reject(new Error(e.data.error === "access_denied" ? "Sign-in was declined." : `Sign-in failed: ${e.data.error ?? "no code"}`));
    };
  });
  const pending = takePending(state);
  if (!pending) throw new Error("Sign-in expired, please try again.");
  return finish(code, pending.verifier);
}

/**
 * Call once before rendering. If this page is the OAuth redirect ("/?code=…&state=…" or "?error=…"):
 * - popup mode: hand the code to the opening tab and close; returns "popup" (don't render the app).
 * - redirect mode: finish sign-in here and restore the page the person started from; returns "redirect".
 * Otherwise returns "none".
 */
export async function finishRedirectSignIn(): Promise<"none" | "popup" | "redirect"> {
  const q = new URLSearchParams(location.search);
  const state = q.get("state");
  const code = q.get("code");
  const error = q.get("error");
  if (!state || (!code && !error)) return "none";
  const raw = store()?.getItem(PENDING + state);
  if (!raw) {
    history.replaceState(null, "", "/");
    return "none";
  }
  const pending = JSON.parse(raw) as Pending;
  if (pending.mode === "popup") {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ state, code, error });
    ch.close();
    window.close();
    // Some browsers refuse to close; leave a short note instead of a second copy of the app.
    document.body.textContent = "Signed in. You can close this window.";
    return "popup";
  }
  takePending(state);
  history.replaceState(null, "", pending.returnTo || "/");
  if (code) {
    try {
      await finish(code, pending.verifier);
    } catch (e) {
      console.error("sign-in failed", e);
    }
  }
  return "redirect";
}

export const signOutUser = () => (auth ? signOut(auth) : Promise.resolve());
