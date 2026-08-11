// Text-to-speech for reply read-out, powered by the device's built-in
// SpeechSynthesis — zero assets, works offline and inside the APK WebView.

export type TtsVoiceKind = "default" | "female" | "male";

let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) cachedVoices = voices;
  return cachedVoices;
}

// Some WebViews populate voices asynchronously — warm the cache on first use.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function pickVoice(kind: TtsVoiceKind): SpeechSynthesisVoice | null {
  if (kind === "default") return null;
  const voices = loadVoices();
  if (voices.length === 0) return null;
  const wanted = kind === "female" ? /female|woman|zira|samantha|victoria|salli|karen|moira|tessa/i : /male|man|david|mark|daniel|alex|guy|fred|george|robert/i;
  const direct = voices.find((v) => wanted.test(v.name));
  return direct ?? null;
}

/** Speak `text` aloud, replacing anything currently playing. Safe no-op when
 *  the platform has no speech synthesis. */
export function speakText(text: string, kind: TtsVoiceKind = "default") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const clean = text.replace(/```[\s\S]*?```/g, " [code block] ").replace(/[#*_`>|[\]()]/g, "").slice(0, 1400);
  if (!clean.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice(kind);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    utterance.pitch = kind === "female" ? 1.1 : kind === "male" ? 0.9 : 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* speech unavailable — ignore */
  }
}

export function stopSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
}
