// Tiny synthesized sound effects via Web Audio — no asset files, works offline
// and inside the APK. Each effect checks the matching preference in
// `zenbox.prefs` before playing (boot chime default ON, send tick default OFF).

export const PREFS_KEY = "zenbox.prefs";

function prefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function enabled(key: string, fallback: boolean): boolean {
  const value = prefs()[key];
  return typeof value === "boolean" ? value : fallback;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  type: OscillatorType,
  peak: number,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + startAt);
  gain.gain.setValueAtTime(0.0001, c.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(peak, c.currentTime + startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + startAt + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(c.currentTime + startAt);
  osc.stop(c.currentTime + startAt + duration + 0.05);
}

/** Soft two-note rising chime — played when the app finishes loading. */
export function playBootChime() {
  if (!enabled("bootSound", true)) return;
  const c = audio();
  if (!c) return;
  tone(c, 523.25, 0, 0.5, "sine", 0.05);
  tone(c, 783.99, 0.12, 0.6, "sine", 0.045);
  tone(c, 1046.5, 0.24, 0.7, "sine", 0.035);
}

/** Quick tick — played when a message is sent. */
export function playSendTick() {
  if (!enabled("sendSound", false)) return;
  const c = audio();
  if (!c) return;
  tone(c, 880, 0, 0.09, "triangle", 0.05);
  tone(c, 1320, 0.05, 0.1, "triangle", 0.035);
}

/** Soft step tick — played as the loading screen advances a phase. */
export function playStepTick() {
  if (!enabled("bootSound", true)) return;
  const c = audio();
  if (!c) return;
  tone(c, 392, 0, 0.08, "sine", 0.035);
}

/** Rising sparkle — played when a phase completes. */
export function playReadyChime() {
  if (!enabled("bootSound", true)) return;
  const c = audio();
  if (!c) return;
  tone(c, 659.25, 0, 0.35, "sine", 0.045);
  tone(c, 880, 0.09, 0.4, "sine", 0.04);
}

/** Low warning tone — played when an error appears. */
export function playErrorTone() {
  if (!enabled("sendSound", true)) return;
  const c = audio();
  if (!c) return;
  tone(c, 220, 0, 0.28, "sawtooth", 0.04);
  tone(c, 174.61, 0.12, 0.34, "sawtooth", 0.035);
}

export type SoundName = "boot" | "send" | "step" | "tick" | "ready" | "error";

/** Generic dispatcher — "boot" -> chime, "send"/"tick" -> tick, "step" -> step, "ready" -> chime, "error" -> tone. */
export function playSound(name: SoundName) {
  switch (name) {
    case "boot":
      playBootChime();
      break;
    case "send":
    case "tick":
      playSendTick();
      break;
    case "step":
      playStepTick();
      break;
    case "ready":
      playReadyChime();
      break;
    case "error":
      playErrorTone();
      break;
  }
}
