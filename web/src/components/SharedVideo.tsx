// v4.12 shared video: the clips uploaded at submit, played from Cloud Storage by anyone who can see the Moment
// (storage.rules: the owner, or anyone once the Moment is sealed/rejected). The feed autoplays the post's feed clip
// muted on the current slide; the evidence room opens each uploaded clip in a pop-out player.

import { useEffect, useRef, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import type { FeedVideoClip } from "../types";
import type { VideoReview } from "../v4";
import { bucket } from "../upload";
import { rot, videoRotClass, type Rot } from "../rotate";
import { Glyph } from "../kit";
import { FIXTURES } from "../firebase";

const urls = new Map<string, Promise<string>>();

/** Download URL for a clip path, cached for the session; a failure is forgotten so a later call retries. */
export function clipUrl(path: string): Promise<string> {
  // Fixture builds have no Storage: VITE_FIXTURE_CLIP (a dev-only URL) stands in for every clip.
  if (FIXTURES && import.meta.env.VITE_FIXTURE_CLIP) return Promise.resolve(import.meta.env.VITE_FIXTURE_CLIP as string);
  let p = urls.get(path);
  if (!p) {
    try {
      p = getDownloadURL(ref(bucket(), path));
    } catch (e) {
      return Promise.reject(e); // no Firebase app (fixtures): keep the photo, don't cache
    }
    urls.set(path, p);
    p.catch(() => urls.delete(path));
  }
  return p;
}

/** The post's feed clip: the last uploaded clip whose hash did not fail, else none. */
export function feedClip(clips: FeedVideoClip[] | null | undefined): FeedVideoClip | null {
  const ok = (clips ?? []).filter((c) => c.hashOk !== false);
  return ok.length ? ok[ok.length - 1] : null;
}

function useClipUrl(path: string | null, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || !enabled || url) return;
    let live = true;
    clipUrl(path).then(
      (u) => live && setUrl(u),
      () => {}, // the photo stays
    );
    return () => {
      live = false;
    };
  }, [path, enabled, url]);
  return url;
}

/**
 * Muted, looping, inline video over the slide's hero photo. Plays only while the slide is current, so one plays at a
 * time; hidden until its first frame renders (the photo is the poster); paused while the tab is hidden. `warm` (the
 * next slide) mounts it paused so the browser buffers the start; the same element then plays when it turns current.
 */
export function FeedVideo({ clip, active, warm = false, muted, rotate = 0 }: { clip: FeedVideoClip; active: boolean; warm?: boolean; muted: boolean; rotate?: number }) {
  const turn = rot(rotate);
  const url = useClipUrl(clip.path, active || warm);
  const el = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const v = el.current;
    if (!v) return;
    const sync = () => {
      if (active && document.visibilityState === "visible") v.play().catch(() => {});
      else v.pause();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active, url]);

  useEffect(() => {
    if (el.current) el.current.muted = muted;
  }, [muted, url]);

  if (!(active || warm) || !url) return null;
  const on = shown && active;
  const video = (
    <video
      ref={el}
      className={turn ? `slide-video ${videoRotClass(turn)} ${on ? "is-on" : ""}` : `slide-photo slide-video ${on ? "is-on" : ""}`}
      src={url}
      muted={muted}
      loop
      playsInline
      autoPlay={active}
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
      onPlaying={() => setShown(true)}
    />
  );
  // Turned clips play inside a size container that takes the photo's place, so the turned video still fits (contain).
  return turn ? <div className="slide-photo slide-video-box rot-box">{video}</div> : video;
}

export function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      {muted ? <path d="M16 9l5 6M21 9l-5 6" /> : <path d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" />}
    </svg>
  );
}

/** One uploaded clip of a Moment, as the evidence room lists it. */
export type RoomClip = { path: string; sha256: string; durationMs: number; hashOk: boolean | null };

/** Evidence room: every uploaded clip of the Moment (storage path + what the chain says about it). */
export function roomClips(momentId: string, ownerUid: string | null | undefined, review: VideoReview | null | undefined): RoomClip[] {
  if (!ownerUid) return [];
  return (review?.clips ?? [])
    .filter((c) => c.uploaded && c.ext)
    .map((c) => ({ path: `clips/${ownerUid}/${momentId}/${c.sha256}.${c.ext}`, sha256: c.sha256, durationMs: c.durationMs, hashOk: c.hashOk }));
}

/** A clip in the evidence room's pop-out: the player at the clip's upright shape, then its fingerprint. */
export function ClipPlayer({ clip, rotate = 0 }: { clip: RoomClip; rotate?: number }) {
  const turn = rot(rotate);
  const url = useClipUrl(clip.path, true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    clipUrl(clip.path).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [clip.path]);
  return (
    <figure className="clip-view">
      {url ? <OrientedPlayer url={url} turn={turn} /> : <div className="clip-wait">{failed ? "Video unavailable" : "Loading video…"}</div>}
      <figcaption className="small">
        {clip.durationMs > 0 && <span>{Math.round(clip.durationMs / 1000)} s</span>}
        <code title={clip.sha256}>sha256 {clip.sha256.slice(0, 12)}…</code>
        {clip.hashOk === false ? <span className="bad">✗ Hash does not match the chain</span> : clip.hashOk === true ? <span className="ok">✓ matches the chain</span> : null}
      </figcaption>
    </figure>
  );
}

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/**
 * A clip shown upright at its own shape, whole (never cropped), sized to fit the pop-out. The browser already applies
 * the file's rotation metadata, so videoWidth/videoHeight are the shape it plays at; the Moment's displayRotation
 * (clockwise) is applied on top, swapping the shape for quarter turns.
 *
 * Upright clips use the native controls. A turned clip plays without them (native controls would turn with the
 * <video>) inside a size container, with a small upright control bar under it; tapping the picture plays/pauses.
 */
function OrientedPlayer({ url, turn }: { url: string; turn: Rot }) {
  const el = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState<number | null>(null); // shown width / height
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const quarter = turn === 90 || turn === 270;
  const onMeta = (v: HTMLVideoElement) => {
    if (v.videoWidth && v.videoHeight) setAspect(quarter ? v.videoHeight / v.videoWidth : v.videoWidth / v.videoHeight);
    setDur(v.duration);
    v.play().catch(() => {}); // opened by a tap: start playing (a browser may still want another tap)
  };
  const toggle = () => {
    const v = el.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const a = aspect ?? 9 / 16;
  // As wide as fits while the height stays within the stage's max height (--clip-max-h), never wider than the box.
  const width = `min(100%, calc(var(--clip-max-h) * ${a.toFixed(4)}))`;
  if (!turn)
    return (
      <div className="clip-stage" style={{ aspectRatio: String(a), width }}>
        <video ref={el} src={url} controls playsInline preload="metadata" onLoadedMetadata={(e) => onMeta(e.currentTarget)} />
      </div>
    );
  return (
    <div className="turned-player" style={{ width }}>
      <div className="clip-stage rot-box" style={{ aspectRatio: String(a) }} onClick={toggle}>
        <video
          ref={el}
          className={videoRotClass(turn)}
          src={url}
          playsInline
          preload="metadata"
          muted={muted}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => onMeta(e.currentTarget)}
          onDurationChange={(e) => setDur(e.currentTarget.duration)}
        />
        {!playing && (
          <span className="clip-big-play" aria-hidden="true">
            <Glyph name="play" />
          </span>
        )}
      </div>
      <div className="turned-bar">
        <button type="button" className="btn btn-small" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          <Glyph name={playing ? "pause" : "play"} />
        </button>
        <input
          type="range"
          min={0}
          max={Number.isFinite(dur) && dur > 0 ? dur : 0}
          step={0.05}
          value={t}
          aria-label="Seek"
          onChange={(e) => {
            const v = el.current;
            const x = Number(e.currentTarget.value);
            if (v) v.currentTime = x;
            setT(x);
          }}
        />
        <span className="small turned-time">
          {mmss(t)} / {mmss(dur)}
        </span>
        <button type="button" className="btn btn-small turned-sound" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted}>
          <SpeakerIcon muted={muted} />
        </button>
      </div>
    </div>
  );
}
