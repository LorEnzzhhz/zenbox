// Native background-running support for the Android shell (Capacitor).
//
// The BackgroundRunner plugin keeps the app alive in the background: it runs
// a foreground service (with a persistent notification) so streams, sandbox
// work and voice keep going even after you "exit" the app, and it disables
// WebView background throttling. On the web this module degrades to a no-op.
//
// The preference is per-device and lives in localStorage.

const LS_BG_KEY = "zenbox.run-in-background";

type BackgroundRunnerPlugin = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
}

function plugin(): BackgroundRunnerPlugin | null {
  if (!isNative()) return null;
  const cap = window as unknown as {
    Capacitor?: { Plugins?: { BackgroundRunner?: BackgroundRunnerPlugin } };
  };
  return cap.Capacitor?.Plugins?.BackgroundRunner ?? null;
}

/** True when this device can actually run in the background natively. */
export function backgroundSupported(): boolean {
  return plugin() !== null;
}

/** Start the keep-alive service. Returns false when unsupported (web). */
export async function startBackground(): Promise<boolean> {
  const p = plugin();
  if (!p) return false;
  try {
    await p.start();
    return true;
  } catch {
    return false;
  }
}

/** Stop the keep-alive service and re-enable background throttling. */
export async function stopBackground(): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.stop();
  } catch {
    /* best-effort */
  }
}

export function readBackgroundPref(): boolean {
  try {
    return localStorage.getItem(LS_BG_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeBackgroundPref(on: boolean): void {
  try {
    localStorage.setItem(LS_BG_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Called once at app start — resumes background running if it was on. */
export async function autoStartBackgroundIfEnabled(): Promise<void> {
  if (!readBackgroundPref()) return;
  await startBackground();
}
