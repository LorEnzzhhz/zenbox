// Session telemetry helpers: figure out which device a client is running on
// and (keylessly) which public IP it is connecting from. Used by the
// useSessionReport hook to keep the developer's live roster up to date.

const OS_ORDER: Array<[RegExp, string]> = [
  [/windows/i, "Windows"],
  [/iphone|ipad|ipod/i, "iOS"],
  [/mac os/i, "macOS"],
  [/android/i, "Android"],
  [/linux/i, "Linux"],
];

const BROWSER_ORDER: Array<[RegExp, string]> = [
  [/edg\//i, "Edge"],
  [/opr\//i, "Opera"],
  [/firefox\//i, "Firefox"],
  [/chrome\//i, "Chrome"],
  [/safari\//i, "Safari"],
];

export function detectDevice(ua: string = navigator.userAgent): string {
  const os = OS_ORDER.find(([re]) => re.test(ua))?.[1] ?? "Other";
  const browser = BROWSER_ORDER.find(([re]) => re.test(ua))?.[1] ?? "Browser";
  const device = /iphone/i.test(ua)
    ? "iPhone"
    : /ipad/i.test(ua)
      ? "iPad"
      : /android/i.test(ua) && /mobile/i.test(ua)
        ? "Phone"
        : /android/i.test(ua)
          ? "Tablet"
          : /windows|macintosh/i.test(ua)
            ? "Desktop"
            : "Device";
  return `${device} · ${os} · ${browser}`;
}

/** Keyless public IP via ipify (CORS-enabled, no account needed). */
export async function fetchPublicIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ip?: string };
    return typeof data.ip === "string" && data.ip ? data.ip : null;
  } catch {
    return null;
  }
}
