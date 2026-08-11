import { v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// Deep search engine. Free, keyless sources:
//   • Wikipedia search + intro extracts (MediaWiki API)
//   • DuckDuckGo HTML results — general web coverage (news, comparisons, non-
//     encyclopedic topics) parsed client-side from the plain result markup
//   • YouTube — public RSS search feed (keyless, real video results)
//   • Social platforms — TikTok, X/Twitter, Instagram, Facebook via site-
//     scoped DuckDuckGo search (these platforms have no keyless public
//     search API, so results are surfaced through their public profiles)
//   • r.jina.ai reader — turns any public page into markdown text
// The action returns a compact research digest plus a list of sources; the
// client streams a synthesized, cited answer with the digest injected into
// the model context.
// ---------------------------------------------------------------------------

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const JINA_PREFIX = "https://r.jina.ai/";

export type SearchSource = { title: string; url: string; snippet: string; platform?: string };

type SearchResult = { digest: string; sources: SearchSource[]; error: string | null };

async function wikiSearch(query: string): Promise<Array<{ title: string; pageid: number }>> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "5",
    format: "json",
  });
  const res = await fetch(`${WIKI_API}?${params}`, { headers: { "User-Agent": "Zenbox/1.0 (research)" } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    query?: { search?: Array<{ title: string; pageid: number }> };
  };
  return data.query?.search ?? [];
}

async function wikiExtract(title: string, chars = 1800): Promise<string> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "extracts",
    exintro: "1",
    explaintext: "1",
    exchars: String(chars),
    format: "json",
  });
  try {
    const res = await fetch(`${WIKI_API}?${params}`, { headers: { "User-Agent": "Zenbox/1.0 (research)" } });
    if (!res.ok) return "";
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { extract?: string; title?: string }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    return page?.extract?.trim() ?? "";
  } catch {
    return "";
  }
}

type DdgResult = { title: string; url: string; snippet: string };

const stripTags = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** Search YouTube through its public RSS feed — no API key needed. Returns
 *  real video results (title + watch URL + description snippet). */
async function youtubeSearch(query: string, limit = 4): Promise<DdgResult[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/feeds/videos.xml?search_query=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const xml = await res.text();
    const out: DdgResult[] = [];
    // Split into entries and parse the fields we need with plain regex.
    const entries = xml.split(/<entry>/).slice(1);
    for (const entry of entries) {
      if (out.length >= limit) break;
      const title = stripTags(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const link = entry.match(/<link\s+rel="alternate"\s+href="([^"]+)"/)?.[1]
        ?? entry.match(/<link\s+href="([^"]+)"[^>]*rel="alternate"/)?.[1]
        ?? "";
      const desc = stripTags(entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? "");
      if (title && /^https?:\/\//.test(link) && !seenHost(link, "youtube")) {
        out.push({ title, url: link, snippet: desc.slice(0, 220) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Site-scoped search for platforms without a keyless search API (TikTok, X,
 *  Instagram, Facebook) — surfaces public profiles/posts via DDG. */
async function platformSearch(site: string, query: string, limit = 2): Promise<DdgResult[]> {
  const results = await ddgSearch(`site:${site} ${query}`, limit);
  return results.filter((r) => {
    try {
      return new URL(r.url).hostname.includes(site.replace("www.", ""));
    } catch {
      return false;
    }
  });
}

function seenHost(url: string, host: string): boolean {
  try {
    return new URL(url).hostname.includes(host);
  } catch {
    return false;
  }
}

/** Scrape DuckDuckGo's plain HTML results. Returns up to `limit` clean
 *  { title, url, snippet } rows; fails silently (empty) on any hiccup. */
async function ddgSearch(query: string, limit = 4): Promise<DdgResult[]> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Zenbox/1.0 research",
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();

    const titleRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

    const results: DdgResult[] = [];
    let m: RegExpExecArray | null;
    while ((m = titleRe.exec(html)) && results.length < limit) {
      let url = m[1];
      // DDG wraps links through its own redirect: //duckduckgo.com/l/?uddg=<encoded>
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) {
        try {
          url = decodeURIComponent(uddg[1]);
        } catch {
          continue;
        }
      }
      const title = stripTags(m[2]);
      if (title && /^https?:\/\//.test(url) && !url.includes("duckduckgo.com")) {
        results.push({ title, url, snippet: "" });
      }
    }
    let i = 0;
    while ((m = snippetRe.exec(html)) && i < results.length) {
      results[i].snippet = stripTags(m[1]).slice(0, 300);
      i++;
    }
    return results;
  } catch {
    return [];
  }
}

/** Fetch a page through the jina reader and return its text (capped). */
async function fetchPageText(url: string, maxChars = 4000): Promise<string> {
  try {
    const res = await fetch(`${JINA_PREFIX}${url}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return "";
    const text = await res.text();
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

/** Strip markdown-ish noise from reader output for the digest. */
function clean(text: string): string {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, 60)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 900);
}

export const deepSearch = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<SearchResult> => {
    const q = query.trim();
    if (!q) return { digest: "", sources: [], error: "Empty query" };

    const sources: SearchSource[] = [];
    const parts: string[] = [];
    const seenUrls = new Set<string>();

    const push = (src: SearchSource) => {
      if (seenUrls.has(src.url)) return;
      seenUrls.add(src.url);
      sources.push(src);
    };

    // 1) Wikipedia — search the query plus a couple of angles.
    const angles = [q, `${q} overview`, `${q} latest developments`];
    for (const angle of angles.slice(0, 2)) {
      const hits = await wikiSearch(angle);
      for (const hit of hits.slice(0, 3)) {
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`;
        const snippet = await wikiExtract(hit.title);
        push({ title: hit.title, url, snippet: snippet.slice(0, 300), platform: "wikipedia" });
        if (snippet) parts.push(`**${hit.title}** — ${clean(snippet)}`);
      }
    }

    // 2) General web — DuckDuckGo for news, comparisons, and anything that
    //    isn't an encyclopedia topic. Two angles for freshness.
    for (const angle of [q, `${q} latest 2026`]) {
      if (sources.length >= 8) break;
      for (const hit of await ddgSearch(angle)) {
        push({ title: hit.title, url: hit.url, snippet: hit.snippet, platform: "web" });
        if (sources.length >= 8) break;
      }
    }

    // 3) YouTube — keyless RSS search for video results on the topic.
    for (const hit of await youtubeSearch(q)) {
      push({ title: hit.title, url: hit.url, snippet: hit.snippet, platform: "youtube" });
    }

    // 4) Social platforms — public profiles & posts via site-scoped search.
    const social: Array<{ site: string; platform: string; label: string }> = [
      { site: "tiktok.com", platform: "tiktok", label: "TikTok" },
      { site: "x.com", platform: "x", label: "X (Twitter)" },
      { site: "instagram.com", platform: "instagram", label: "Instagram" },
      { site: "facebook.com", platform: "facebook", label: "Facebook" },
    ];
    for (const s of social) {
      if (sources.length >= 14) break;
      for (const hit of await platformSearch(s.site, q)) {
        push({ title: hit.title, url: hit.url, snippet: hit.snippet, platform: s.platform });
      }
    }

    // 5) Pull the top sources' content through the reader for real detail.
    for (const src of sources.slice(0, 3)) {
      const pageText = await fetchPageText(src.url);
      if (pageText) parts.push(`**From ${src.title} (full page):** ${clean(pageText)}`);
    }

    if (sources.length === 0) {
      return {
        digest: "",
        sources: [],
        error: "No results found. Try rephrasing the question or a simpler topic.",
      };
    }

    const digest = [
      `Research on "${q}":`,
      "",
      ...parts,
      "",
      "Answer the user's original question using these findings. Cite sources as markdown links.",
      "",
      "Note: TikTok, X, Instagram and Facebook results are public profiles/posts surfaced by search — prefer Wikipedia and general web sources for factual claims.",
    ].join("\n");

    return { digest: digest.slice(0, 14_000), sources, error: null };
  },
});
