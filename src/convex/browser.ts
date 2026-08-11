import { v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// AI Browser tool. Gives the model (and the user) a way to read any public
// page: tries the keyless r.jina.ai reader (clean markdown-ish text) first,
// then falls back to fetching the page directly and stripping HTML to text.
// Returns a compact, model-ready digest plus the page title.
// ---------------------------------------------------------------------------

const JINA_PREFIX = "https://r.jina.ai/";
const MAX_CHARS = 24_000;

/** Prepend https:// when the user pasted a bare domain (e.g. "example.com"). */
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

function stripHtml(html: string): string {
  const text = html
    // Collapse block-level tags into newlines so paragraphs survive.
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|pre|br)>/gi, "\n")
    .replace(/<(br|p|div|h[1-6]|li|tr|section|article|blockquote|pre)[^>]*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text;
}

async function fetchViaJina(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(`${JINA_PREFIX}${url}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Zenbox/1.0 browser",
        "X-Return-Format": "text",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const lines = raw.split("\n");
    let title = "";
    let bodyStart = 0;
    for (let i = 0; i < Math.min(lines.length, 8); i++) {
      const t = lines[i].trim();
      if (/^Title:\s*/i.test(t)) {
        title = t.replace(/^Title:\s*/i, "").trim();
      } else if (t.length > 0 && !t.startsWith("URL:") && !t.startsWith("Markdown") && !t.startsWith("Title")) {
        bodyStart = i;
        break;
      }
    }
    const text = lines
      .slice(bodyStart)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { title: title || url, text };
  } catch {
    return null;
  }
}

async function fetchDirect(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Language": "en",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const text = await res.text();
      return { title: url, text: text.slice(0, MAX_CHARS) };
    }
    const html = await res.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? url;
    return { title, text: stripHtml(html) };
  } catch {
    return null;
  }
}

/** The AI's Chrome: read any public page and return clean, model-ready text. */
export const browseUrl = action({
  args: { url: v.string() },
  handler: async (_ctx, { url }): Promise<{ url: string; title: string; text: string; error: string | null }> => {
    const target = normalizeUrl(url);
    if (!target) {
      return { url, title: "", text: "", error: `"${url.slice(0, 80)}" isn't a valid web address.` };
    }

    const jina = await fetchViaJina(target);
    if (jina && jina.text.length > 200) {
      return { url: target, title: jina.title, text: jina.text.slice(0, MAX_CHARS), error: null };
    }

    const direct = await fetchDirect(target);
    if (direct && direct.text.length > 40) {
      return { url: target, title: direct.title, text: direct.text.slice(0, MAX_CHARS), error: null };
    }

    return {
      url: target,
      title: "",
      text: "",
      error:
        "Could not read that page — it may be behind a login, block automated readers, or be temporarily down. Try another URL.",
    };
  },
});
