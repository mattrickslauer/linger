// Per-Moment display rotation. Some Moments' media were stored sideways (iPhone 17 front camera, before the
// per-camera capture fix). Their evidence is hash-chained and stays untouched; instead `displayRotation` on the
// feed/moment doc says how many degrees CLOCKWISE to turn every photo, frame and clip of that Moment when showing it.
// Photos are re-drawn rotated on a canvas (so object-fit: contain and the FitImg backdrop see the true aspect ratio);
// videos are turned with CSS (see SharedVideo). Rotation 0 never touches a canvas.

import { useEffect, useState } from "react";

export type Rot = 0 | 90 | 180 | 270;

/** 0 | 90 | 180 | 270 from whatever is stored: snapped to the nearest quarter turn, anything non-numeric → 0. */
export function rot(v: unknown): Rot {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return ((((Math.round(v / 90) * 90) % 360) + 360) % 360) as Rot;
}

/** Canvas size for an image of w×h turned by deg clockwise. */
export function rotatedSize(w: number, h: number, deg: Rot): { w: number; h: number } {
  return deg === 90 || deg === 270 ? { w: h, h: w } : { w, h };
}

/** Class that turns a <video> by deg inside a size-container box (see .rot-box in kit.css); "" for 0. */
export const videoRotClass = (deg: Rot): string => (deg ? `rot-v rot-v${deg}` : "");

const cache = new Map<string, Promise<string>>();
const done = new Map<string, string>();

/** Rotated copy of an image src as an object URL, memoised by src+deg for the session. */
export function rotatedSrc(src: string, deg: Rot): Promise<string> {
  if (!deg) return Promise.resolve(src);
  const key = `${deg}|${src}`;
  let p = cache.get(key);
  if (!p) {
    p = draw(src, deg).then((u) => {
      done.set(key, u);
      return u;
    });
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

function draw(src: string, deg: Rot): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const size = rotatedSize(w, h, deg);
      const c = document.createElement("canvas");
      c.width = size.w;
      c.height = size.h;
      const g = c.getContext("2d");
      if (!g) return reject(new Error("no 2d context"));
      g.translate(size.w / 2, size.h / 2);
      g.rotate((deg * Math.PI) / 180);
      g.drawImage(img, -w / 2, -h / 2);
      c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92);
    };
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * The src to show for a Moment's photo: `src` itself at rotation 0 (unchanged behaviour); otherwise the rotated copy,
 * or null while it is being drawn (callers hide the image until then rather than flash it sideways). If drawing
 * fails the unrotated src is returned so the photo still shows.
 */
export function useRotatedSrc(src: string | null | undefined, deg: Rot): string | null {
  const key = src && deg ? `${deg}|${src}` : null;
  const [state, setState] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key || !src || done.has(key)) return;
    let live = true;
    rotatedSrc(src, deg).then(
      (url) => live && setState({ key, url }),
      () => live && setState({ key, url: src }),
    );
    return () => {
      live = false;
    };
  }, [key, src, deg]);
  if (!src) return null;
  if (!key) return src;
  return done.get(key) ?? (state?.key === key ? state.url : null);
}
