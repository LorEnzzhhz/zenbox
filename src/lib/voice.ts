import { useCallback, useEffect, useRef, useState } from "react";

/** Web Speech API types (not in the standard TS lib for all browsers). */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export type VoiceState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "awaiting-permission" }
  | { status: "listening"; interim: string }
  | { status: "error"; message: string };

/**
 * Microphone → text for the composer. Grants/checks microphone permission
 * before starting recognition (so the "app asks for mic permission" flow is
 * real), streams interim transcripts live, and returns the final transcript
 * when you stop talking or tap the button again.
 */
export function useVoiceInput(onFinal: (transcript: string) => void) {
  const [state, setState] = useState<VoiceState>({ status: "idle" });
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Release the microphone when the component unmounts.
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const stop = useCallback(() => {
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const start = useCallback(async () => {
    const rec = getSpeechRecognition();
    if (!rec) {
      setState({ status: "unsupported" });
      return;
    }
    try {
      // Real permission ask: the browser shows the mic prompt here.
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ status: "error", message: "Microphone permission was denied." });
      return;
    }
    setState({ status: "awaiting-permission" });
    finalRef.current = "";
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i][0];
        if (alt) {
          if (e.results[i].length > 0) {
            // @ts-expect-error — isFinal isn't in the structural type.
            if (e.results[i].isFinal) finalRef.current += alt.transcript + " ";
            else interim += alt.transcript;
          }
        }
      }
      if (interim.trim()) {
        setState({ status: "listening", interim: interim.trim() });
      } else if (finalRef.current.trim()) {
        setState({ status: "listening", interim: finalRef.current.trim() });
      }
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setState({ status: "error", message: `Mic error: ${e.error}` });
    };
    rec.onend = () => {
      const final = finalRef.current.trim();
      setState({ status: "idle" });
      if (final) onFinalRef.current(final);
    };
    recRef.current = rec;
    try {
      rec.start();
      setState({ status: "listening", interim: "" });
    } catch {
      setState({ status: "idle" });
    }
  }, []);

  const toggle = useCallback(() => {
    if (state.status === "listening") stop();
    else void start();
  }, [state.status, start, stop]);

  return { state, toggle, stop };
}
