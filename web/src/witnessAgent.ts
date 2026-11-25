// The realtime witness (docs/ARCHITECTURE.md v3.4): every few seconds while recording, if pacing allows, draft
// the one request that would convince a skeptic most (on-device first), refine it in the cloud with the latest
// frames when online (4 s budget), record it in the chain, then say it aloud and show it; in the background, a
// local Notification. It never verifies anything and recording never waits for it.

import { intentionForPrompt, witnessDraft, witnessRefine, type WitnessAsk } from "./ai";
import { configured, FIXTURES } from "./firebase";
import type { Session } from "./recorder";
import { speak } from "./voice";
import { askedText, canAsk, sessionText, worthAsking } from "./witness";

export class WitnessAgent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private stopped = false;
  voice = true;
  /** Last reason the witness stayed quiet, for the record screen. */
  status: "idle" | "thinking" | "unavailable" = "idle";
  onStatus: (s: WitnessAgent["status"]) => void = () => {};

  constructor(private session: Session) {}

  /** Sample-data builds have no model; `?witness=demo` plays scripted asks so the UI and chain events can be seen. */
  readonly demo = FIXTURES && typeof location !== "undefined" && new URLSearchParams(location.search).get("witness") === "demo";
  get available() {
    return configured || this.demo;
  }

  start() {
    if (!this.available || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.demo ? 1000 : 5000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private set(s: WitnessAgent["status"]) {
    this.status = s;
    this.onStatus(s);
  }

  async tick() {
    const s = this.session;
    if (this.demo) return this.demoTick();
    if (this.busy || this.stopped || !canAsk(Date.now(), s.startedAt, s.witness)) return;
    this.busy = true;
    this.set("thinking");
    try {
      const intention = intentionForPrompt(s.intentionObj);
      const session = sessionText({ elapsedMs: Date.now() - s.startedAt, distanceM: s.state.distanceM, labels: s.labels, gpsCount: s.gpsCount, motionOn: s.state.motionOn });
      const asked = askedText(s.witness);
      let a: WitnessAsk & { mode: "on_device" | "cloud" } = await witnessDraft(intention, session, asked);
      if (navigator.onLine) {
        const frames = s.framesForJudge().slice(-3);
        try {
          const r = await witnessRefine(intention, session, asked, a, frames, s.startedAt);
          if (r.ask.trim()) a = { ...r, mode: "cloud" };
        } catch {
          /* 4 s budget or offline: keep the on-device draft */
        }
      }
      if (this.stopped || !worthAsking(a) || !canAsk(Date.now(), s.startedAt, s.witness)) return this.set("idle");
      const req = s.witnessAsk(a.ask, a.kind, a.why, a.mode);
      this.deliver(req.ask, req.wid);
      this.set("idle");
    } catch (e) {
      console.warn("witness unavailable", e);
      this.set("unavailable");
    } finally {
      this.busy = false;
    }
  }

  private demoTick() {
    const s = this.session;
    const DEMO = [
      { ask: "Show me the water you're fishing", kind: "show" as const, why: "the place matches the claim" },
      { ask: "What lure are you using?", kind: "tell" as const, why: "detail a stager wouldn't plan" },
    ];
    const n = s.witness.requests.length;
    const last = s.witness.requests[n - 1];
    if (n >= DEMO.length || s.state.witnessOpen || Date.now() - s.startedAt < 3000 || (last && Date.now() - (last.closedAt ?? last.at) < 3000)) return;
    const req = s.witnessAsk(DEMO[n].ask, DEMO[n].kind, DEMO[n].why, "on_device");
    this.deliver(req.ask, req.wid);
  }

  private deliver(ask: string, wid: string) {
    if (this.voice) void speak(ask);
    if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification("Your witness asks", { body: ask, tag: wid, requireInteraction: true });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch (e) {
        console.warn("notification failed", e); // e.g. Android Chrome needs a service worker; the toast still shows
      }
    }
  }
}
