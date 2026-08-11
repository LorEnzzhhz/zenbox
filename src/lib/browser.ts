// Client-side helpers for the AI Browser tool. Mirrors the server's URL
// normalizer and defines the window event that pipes "Ask AI about this page"
// into the chat composer (same pattern as TERMINAL_CMD_EVENT in sandboxfs.ts).

export const BROWSER_ASK_EVENT = "zenbox:browser:ask";

/** Prepend https:// when the user pasted a bare domain. */
export function normalizeUrl(input: string): string | null {
  let u = input.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    const parsed = new URL(u);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Trigger a client-side download of a text payload (blob anchor). */
export function downloadTextFile(filename: string, content: string, mime = "text/plain"): boolean {
  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

/** Extract the first http(s) URL from a string, if any. */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}
