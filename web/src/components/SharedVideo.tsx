// v4.12 shared video: the clips uploaded at submit, played from Cloud Storage by anyone who can see the Moment
// (storage.rules: the owner, or anyone once the Moment is sealed/rejected). The feed autoplays the post's feed clip
// muted on the current slide; the evidence room lists every uploaded clip with controls.

import { useEffect, useRef, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import type { FeedVideoClip } from "../types";
import type { VideoReview } from "../v4";
import { bucket } from "../upload";
import { rot, videoRotClass, type Rot } from "../rotate";

const urls = new Map<string, Promise<string>>();

/** Download URL for a clip path, cached for the session; a failure is forgotten so a later call retries. */
export function clipUrl(path: string): Promise<string> {
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
 * Muted, looping, inline video over the slide's hero photo. Mounted only while the slide is current, so one plays at
 * a time; hidden until its first frame renders (the photo is the poster); paused while the tab is hidden.
 */
export function FeedVideo({ clip, active, muted, rotate = 0 }: { clip: FeedVideoClip; active: boolean; muted: boolean; rotate?: number }) {
  const turn = rot(rotate);
  const url = useClipUrl(clip.path, active);
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

  if (!active || !url) return null;
  const video = (
    <video
      ref={el}
      className={turn ? `slide-video ${videoRotClass(turn)} ${shown ? "is-on" : ""}` : `slide-photo slide-video ${shown ? "is-on" : ""}`}
      src={url}
      muted={muted}
      loop
      playsInline
      autoPlay
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

/** Evidence room: every uploaded clip of the Moment, playable with controls. */
export function MomentVideos({
  momentId,
  ownerUid,
  review,
  rotate = 0,
}: {
  momentId: string;
  ownerUid: string | null | undefined;
  review: VideoReview | null | undefined;
  /** The Moment's displayRotation (clockwise degrees). */
  rotate?: number;
}) {
  const turn = rot(rotate);
  const clips = (review?.clips ?? []).filter((c) => c.uploaded && c.ext && ownerUid);
  if (!clips.length) return null;
  return (
    <section className="clips shared-clips" aria-labelledby="shared-clips-h">
      <div className="section-head">
        <h2 id="shared-clips-h">Video</h2>
        <p className="muted small">Uploaded with the Moment. Anyone who can see it can watch; the chain holds each clip's fingerprint.</p>
      </div>
      <div className="clip-grid">
        {clips.map((c) => (
          <SharedClip key={c.sha256} path={`clips/${ownerUid}/${momentId}/${c.sha256}.${c.ext}`} sha256={c.sha256} durationMs={c.durationMs} hashOk={c.hashOk} turn={turn} />
        ))}
      </div>
    </section>
  );
}

function SharedClip({ path, sha256, durationMs, hashOk, turn }: { path: string; sha256: string; durationMs: number; hashOk: boolean | null; turn: Rot }) {
  const url = useClipUrl(path, true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    clipUrl(path).catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <figure className="clip">
      {url && turn ? (
        <TurnedPlayer url={url} turn={turn} />
      ) : url ? (
        <video src={url} controls playsInline preload="metadata" />
      ) : (
        <div className="clip-wait">{failed ? "Video unavailable" : "Loading video…"}</div>
      )}
      <figcaption className="small">
        {durationMs > 0 && <span>{Math.round(durationMs / 1000)} s · </span>}
        <code title={sha256}>sha256 {sha256.slice(0, 12)}…</code>
        {hashOk === false ? <span className="bad">✗ Hash does not match the chain</span> : hashOk === true ? <span className="ok">✓ matches the chain</span> : null}
      </figcaption>
    </figure>
  );
}

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

/**
 * A clip stored sideways, shown turned upright. Native controls would turn with the <video>, so the video plays
 * without them inside a size container (CSS-rotated, still contained) and a small upright control bar sits under it:
 * play/pause, seek, time, sound. Tapping the picture also plays/pauses.
 */
function TurnedPlayer({ url, turn }: { url: string; turn: Rot }) {
  const el = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const toggle = () => {
    const v = el.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  return (
    <div className="turned-player">
      <div className="clip-rot rot-box" onClick={toggle}>
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
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onDurationChange={(e) => setDur(e.currentTarget.duration)}
        />
      </div>
      <div className="turned-bar">
        <button type="button" className="btn btn-small" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
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
