import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export function useUser(): { user: User | null; ready: boolean } {
  const [state, set] = useState<{ user: User | null; ready: boolean }>({ user: auth?.currentUser ?? null, ready: !auth });
  useEffect(() => (auth ? onAuthStateChanged(auth, (user) => set({ user, ready: true })) : undefined), []);
  return state;
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth || !db) throw new Error("Firebase is not configured");
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
  // users/{uid}: written on first sign-in (contract), profile refreshed afterwards.
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref).catch(() => null);
  const profile = { displayName: user.displayName ?? "Anonymous", photoURL: user.photoURL ?? null };
  await setDoc(ref, existing?.exists() ? profile : { ...profile, createdAtServer: serverTimestamp() }, { merge: true }).catch((e) =>
    console.warn("profile write failed", e),
  );
  return user;
}

export const signOutUser = () => (auth ? signOut(auth) : Promise.resolve());
