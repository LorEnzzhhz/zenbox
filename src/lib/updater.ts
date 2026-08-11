import type { Doc } from "@/convex/_generated/dataModel";
import { downloadTextFile } from "./browser";

// ---------------------------------------------------------------------------
// Client-side update flow for shipped Zenbox updates:
//   1. notice with a short "what changed" summary  (UpdateNotice components)
//   2. Update button → download the update files (JSON manifest)
//   3. service worker fetches the new app shell in the background
//   4. restart the app (reload — webview/PWA; the SW keeps it current)
// The background updater polls while the app runs so every user is always on
// the latest version, even if they never press the button.
// ---------------------------------------------------------------------------

export type UpdateDoc = Doc<"updates">;
export type UpdateStatus = "downloading" | "installing" | "restarting";

/** Which Zenbox app is running right now — the studio or the Control app.
 *  control-main.tsx stamps documentElement.dataset.app = "control"; the studio
 *  never sets it, so any other value means the studio. */
export function currentApp(): "studio" | "control" {
  try {
    return document.documentElement.dataset.app === "control" ? "control" : "studio";
  } catch {
    return "studio";
  }
}

/** The Capacitor global as injected into the webview at runtime. */
type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
};

function capacitor(): CapacitorGlobal | null {
  try {
    return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
  } catch {
    return null;
  }
}

/** True when the app runs inside the Capacitor (Android APK) webview. */
export function isNativePlatform(): boolean {
  try {
    return capacitor()?.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

/** The native ApkUpdater plugin added to the Control Android project. */
export type ApkUpdater = {
  downloadAndInstall: (opts: { url: string }) => Promise<{ installed: boolean }>;
};

function apkUpdaterPlugin(): ApkUpdater | null {
  try {
    return (capacitor()?.Plugins?.["ApkUpdater"] as ApkUpdater | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Build a downloadable manifest of everything the update ships — version,
 *  summary, every change (with verify status where available) and notes. */
export function buildUpdateManifest(update: UpdateDoc): string {
  return JSON.stringify(
    {
      app: "Zenbox",
      version: update.version,
      title: update.title,
      shippedAt: update.shippedAt ?? update.createdAt,
      command: update.command,
      summary: update.verdict,
      changes: update.changes.map((c, i) => {
        const vc = update.verifyPerChange?.[i];
        return {
          title: c.title,
          detail: c.detail,
          verifyStatus: vc?.status ?? "ok",
          verifyNote: vc?.note ?? "",
        };
      }),
      gaps: update.verifyGaps ?? [],
      releaseNotes: update.releaseNotes ?? "",
      apkUrl: update.apkUrl ?? "",
    },
    null,
    2,
  );
}

/** Download the update's files as a JSON manifest (works in the browser and
 *  in the Capacitor webview). */
export function downloadUpdateFiles(update: UpdateDoc): boolean {
  const name = `zenbox-update-v${update.version}.json`;
  return downloadTextFile(name, buildUpdateManifest(update), "application/json");
}

/** Ask the service worker to fetch the latest app shell right now. */
export async function checkForUpdates(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.update();
    // New worker waiting to activate? Tell it to take over immediately.
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  } catch {
    return false;
  }
}

let applying = false;

/** Result of an update attempt — the caller decides what to tell the user.
 *  `skipped` means the APK targets the OTHER Zenbox app (studio vs control),
 *  so it was NOT installed here on purpose. */
export type UpdateResult = { ok: boolean; error?: string; skipped?: boolean };

/** The full user-facing update flow: download the files → install the new
 *  shell in the background → restart the app. On the Android APK with a hosted
 *  apkUrl, it downloads and installs the real .apk via the native plugin.
 *
 *  Never throws: failures come back as { ok: false, error } so the UI can show
 *  a real message instead of hanging on "Downloading…". */
export async function applyAppUpdate(
  update: UpdateDoc,
  onStatus?: (status: UpdateStatus) => void,
): Promise<UpdateResult> {
  if (applying) return { ok: false, error: "An update is already in progress." };
  applying = true;
  try {
    onStatus?.("downloading");

    // Native Android + a hosted APK → download and install a real .apk.
    // The OS installer takes over; opening the new version runs the update.
    if (update.apkUrl && isNativePlatform()) {
      // The studio and Control apps share one update feed. If the shipped APK
      // targets the OTHER app, installing it here would replace this app with
      // the wrong binary — so refuse and tell the user why.
      const apkFor = update.apkFor;
      if (apkFor && apkFor !== currentApp()) {
        return {
          ok: true,
          skipped: true,
          error: `This update's APK is for Zenbox ${apkFor === "control" ? "Control" : "Studio"} — not the app you're running.`,
        };
      }
      const plugin = apkUpdaterPlugin();
      if (plugin) {
        try {
          await plugin.downloadAndInstall({ url: update.apkUrl });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "The download failed.";
          return {
            ok: false,
            error: `Could not download the update: ${msg} Check the APK link and your connection, then try again.`,
          };
        }
        onStatus?.("installing");
        return { ok: true };
      }
      // No native plugin (e.g. a bare webview build) → let the system browser
      // handle the APK download + install prompt.
      try {
        window.open(update.apkUrl, "_system");
        return { ok: true };
      } catch {
        return { ok: false, error: "Could not open the APK download link." };
      }
    }

    // Download the update's files first so the user keeps them regardless of
    // what happens during the restart.
    downloadUpdateFiles(update);
    await new Promise((r) => setTimeout(r, 400));

    onStatus?.("installing");
    await checkForUpdates();
    await new Promise((r) => setTimeout(r, 600));

    onStatus?.("restarting");
    // Restart the app — the freshly activated service worker serves the new
    // shell, and the background updater keeps it current from here on.
    window.location.reload();
    return { ok: true };
  } finally {
    applying = false;
  }
}

let backgroundStarted = false;

/** Keep the app up to date while it runs: poll the service worker every
 *  few minutes and whenever the app becomes visible again. Safe to call
 *  multiple times (idempotent). */
export function startBackgroundUpdater(intervalMs = 15 * 60_000): void {
  if (backgroundStarted || !("serviceWorker" in navigator)) return;
  backgroundStarted = true;

  const tick = () => {
    void checkForUpdates();
  };

  window.setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tick();
  });
  // First check shortly after load.
  window.setTimeout(tick, 8_000);
}
