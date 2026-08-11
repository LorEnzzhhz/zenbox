import { useCallback, useEffect, useRef } from "react";
import { playSound } from "@/lib/sounds";

const PERM_KEY = "zenbox.notif.permission";
const LAST_KEY = "zenbox.notif.lastSeen";

interface NotifyOpts {
  title: string;
  body?: string;
  tag?: string;
  icon?: string;
  sound?: "ready" | "error" | "tick";
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when the browser supports the Notifications API (incl. WebView). */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationsEnabled(): boolean {
  const store = safeStorage();
  if (!store) return false;
  try {
    return store.getItem(PERM_KEY) === "granted";
  } catch {
    return false;
  }
}

/** Request permission once (auto-requested after login / on first visit). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  try {
    const result = await Notification.requestPermission();
    const granted = result === "granted";
    safeStorage()?.setItem(PERM_KEY, granted ? "granted" : "denied");
    return granted;
  } catch {
    return false;
  }
}

/** Register a "seen marker" so we only notify about genuinely new things. */
export function markNotificationSeen(key: string): void {
  safeStorage()?.setItem(`${LAST_KEY}.${key}`, String(Date.now()));
}

function wasSeen(key: string): boolean {
  return Boolean(safeStorage()?.getItem(`${LAST_KEY}.${key}`));
}

/** Core notifier: system notification when allowed, toast + sound otherwise. */
export function notifyUser(opts: NotifyOpts): void {
  if (!opts.title && !opts.body) return;
  const granted = notificationsEnabled();
  if (granted && notificationsSupported()) {
    try {
      new Notification(opts.title, {
        body: opts.body,
        tag: opts.tag,
        icon: opts.icon ?? "/logo192.png",
      });
    } catch {
      /* WebView fallback below */
    }
  }
  if (opts.sound) {
    try {
      playSound(opts.sound);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Watches an array of items (updates/announcements). When a new item appears
 * whose id hasn't been marked seen, it fires a system notification and marks
 * it seen. Pass `enabled=false` to skip (e.g. while unauthenticated).
 */
export function useChangeNotifier<T extends { _id: string; _creationTime?: number }>(
  items: T[] | undefined,
  opts: { prefix: string; title: string; body?: (item: T) => string; sound?: "ready" | "tick" },
): void {
  const enabled = useRef(notificationsEnabled()).current;
  useEffect(() => {
    if (!items || !enabled) return;
    // Only consider items created in the last minute (i.e. brand new).
    const cutoff = Date.now() - 60_000;
    for (const item of items) {
      const created = item._creationTime ?? 0;
      if (created < cutoff) continue;
      const key = `${opts.prefix}.${item._id}`;
      if (wasSeen(key)) continue;
      markNotificationSeen(key);
      notifyUser({
        title: opts.title,
        body: opts.body ? opts.body(item) : undefined,
        tag: key,
        sound: opts.sound ?? "ready",
      });
    }
  }, [items, enabled, opts.prefix, opts.title]);
}

/** Small helper for imperative notifications (e.g. "your file is ready"). */
export function useNotifier() {
  const notify = useCallback((opts: NotifyOpts) => notifyUser(opts), []);
  return { notify };
}
