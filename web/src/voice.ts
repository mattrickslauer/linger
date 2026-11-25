// Voice in and out through the platform (docs/ARCHITECTURE.md v3.2): Web Speech API recognition for the person,
// speechSynthesis for the interviewer and the witness, one sentence at a time. Both are optional: every place that
// listens also has a text field.

type Rec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecCtor = new () => Rec;

const recCtor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const sttSupported = () => typeof window !== "undefined" && recCtor() != null;
export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

export interface Listening {
  /** Final transcript ("" when nothing was heard). Rejects only on a permission / service error. */
  done: Promise<string>;
  stop(): void;
}

/** Listen for one utterance. `onPartial` streams the interim words for the live caption. */
export function listen(onPartial?: (text: string) => void): Listening {
  const C = recCtor();
  if (!C) return { done: Promise.reject(new Error("Speech recognition isn't available in this browser.")), stop() {} };
  stopSpeaking(); // never transcribe our own voice
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  let final = "";
  let interim = "";
  const done = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      onPartial?.((final + " " + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // onend resolves with what we have
      reject(new Error(e.error === "not-allowed" ? "Microphone permission was denied." : `Speech recognition failed (${e.error}).`));
    };
    r.onend = () => resolve((final || interim).trim());
  });
  r.start();
  return { done, stop: () => r.stop() };
}

let speakToken = 0;
/** Speak text one sentence at a time; resolves when finished or interrupted. No-op without TTS. */
export async function speak(text: string): Promise<void> {
  if (!ttsSupported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const token = ++speakToken;
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  for (const s of sentences) {
    if (token !== speakToken) return;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(s);
      u.lang = navigator.language || "en-US";
      u.rate = 1.04;
      u.onend = u.onerror = () => resolve();
      synth.speak(u);
      // Some engines never fire onend for an utterance cut off by cancel(); don't hang the interview.
      setTimeout(resolve, 400 + s.length * 90);
    });
  }
}

export function stopSpeaking() {
  speakToken++;
  if (ttsSupported()) window.speechSynthesis.cancel();
}
