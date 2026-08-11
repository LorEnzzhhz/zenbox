// Haptic feedback for the APK and any vibration-capable device. Every call is
// a silent no-op when vibration is unavailable (most web previews) or the
// "Haptics" setting is off — so this never hurts the browser experience and
// adds tactile polish to the Android app.

const PREFS_KEY = "zenbox.prefs";

export type HapticKind = "tap" | "tick" | "start" | "success" | "done" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  tick: 12,
  start: 16,
  success: [12, 35, 16],
  done: [10, 28, 10],
  error: [45, 60, 45],
};

function enabled(): boolean {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return prefs.haptics !== false;
  } catch {
    return true;
  }
}

/** Fire a short, subtle vibration pattern (no-op unless supported + enabled). */
export function haptic(kind: HapticKind) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (!enabled()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}
