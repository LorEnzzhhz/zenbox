import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BROWSER_ASK_EVENT, downloadTextFile, normalizeUrl } from "@/lib/browser";
import {
  ArrowRight,
  Brain,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  MessageSquarePlus,
  RotateCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SearchSource = { title: string; url: string; snippet: string; platform?: string };

const PLATFORM_LABEL: Record<string, string> = {
  wikipedia: "Wikipedia",
  web: "Web",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

function PlatformTag({ platform }: { platform?: string }) {
  if (!platform) return null;
  return (
    <Badge variant="outline" className="h-4 rounded-sm px-1 text-[8px] font-normal uppercase tracking-wider text-muted-foreground">
      {PLATFORM_LABEL[platform] ?? platform}
    </Badge>
  );
}

/** The AI's Chrome: search the web, open any URL in reader view, and hand the
 *  page text to the chat. */
export function Browser({ onClose }: { onClose: () => void }) {
  const deepSearch = useAction(api.search.deepSearch);
  const browseUrl = useAction(api.browser.browseUrl);

  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchSource[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState<{ url: string; title: string; text: string } | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ url: string; title: string }>>([]);

  const go = async (raw?: string) => {
    const input = (raw ?? address).trim();
    if (!input) return;
    const url = normalizeUrl(input);
    if (!url) {
      setPageError(`"${input.slice(0, 60)}" isn't a valid web address.`);
      return;
    }
    setLoading(true);
    setPageError(null);
    try {
      const res = await browseUrl({ url });
      if (res.error) {
        setPageError(res.error);
        setPage(null);
      } else {
        setPage({ url: res.url, title: res.title || res.url, text: res.text });
        setHistory((h) => [{ url: res.url, title: res.title || res.url }, ...h.filter((x) => x.url !== res.url)].slice(0, 12));
      }
    } catch {
      setPageError("The reader could not reach that page. Try again or pick a different URL.");
      setPage(null);
    } finally {
      setLoading(false);
    }
  };

  const runSearch = async (raw?: string) => {
    const q = (raw ?? query).trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await deepSearch({ query: q });
      if (res.error) {
        setSearchError(res.error);
        setResults([]);
      } else {
        setResults(res.sources);
      }
    } catch {
      setSearchError("Search failed — try again in a moment.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const askAi = () => {
    if (!page) return;
    const prompt = [
      `I'm browsing ${page.title} — please read this page and answer my questions about it (summarize, quote, or analyze as needed).`,
      `Page URL: ${page.url}`,
      "",
      "Page content:",
      page.text.slice(0, 8000),
    ].join("\n");
    window.dispatchEvent(new CustomEvent<string>(BROWSER_ASK_EVENT, { detail: prompt }));
    toast.success("Page sent to the chat — ask away.");
  };

  const downloadPage = () => {
    if (!page) return;
    const name = `page-${page.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "read"}.txt`;
    if (downloadTextFile(name, `${page.title}\n${page.url}\n\n${page.text}`)) {
      toast.success(`Downloaded ${name}`);
    } else {
      toast.error("Download blocked by the browser");
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Close browser"
        >
          <X className="size-3.5" />
        </button>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          <Globe className="size-3" />
          Browser
        </span>
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="Open any URL — e.g. https://example.com"
            aria-label="Address bar"
            className="h-7 min-w-0 flex-1 rounded-sm border border-border/80 bg-transparent px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-foreground/40"
          />
          <Button type="submit" size="sm" className="h-7 shrink-0 gap-1 text-[11px]" disabled={loading || !address.trim()}>
            {loading ? <Loader2 className="size-3 animate-spin" /> : <ArrowRight className="size-3" />}
            Open
          </Button>
        </form>
        {page && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1 text-[11px] text-muted-foreground"
            title="Open in a new tab"
            onClick={() => window.open(page.url, "_blank", "noopener")}
          >
            <ExternalLink className="size-3" />
            <span className="hidden sm:inline">Tab</span>
          </Button>
        )}
      </div>

      {/* Quick search strip */}
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-muted/20 px-3 py-1.5">
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            placeholder="Quick search — TikTok, X, Instagram, YouTube, Wikipedia, the whole web…"
            aria-label="Quick search"
            className="h-6 min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {searching ? (
            <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Button type="submit" variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground" disabled={!query.trim()}>
              Search
            </Button>
          )}
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-16">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground">Reading the page…</p>
          </div>
        ) : pageError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="text-[12px] leading-5 text-destructive">{pageError}</p>
            <p className="max-w-sm text-[11px] leading-5 text-muted-foreground">
              Some sites block readers. Try the search below, or ask the AI to browse it — it uses the same reader and can often work around the block.
            </p>
          </div>
        ) : page ? (
          <div className="flex h-full flex-col">
            {/* Reader header */}
            <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{page.title}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{page.url}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-[11px] text-muted-foreground" onClick={downloadPage} title="Download page text">
                  <Download className="size-3" />
                  <span className="hidden sm:inline">Download</span>
                </Button>
                <Button type="button" size="sm" className="h-7 gap-1 text-[11px]" onClick={askAi} title="Ask the AI about this page">
                  <MessageSquarePlus className="size-3" />
                  <span className="hidden sm:inline">Ask AI</span>
                </Button>
              </div>
            </div>
            {/* Reader body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-foreground/90">{page.text}</p>
            </div>
          </div>
        ) : searchError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="text-[12px] text-destructive">{searchError}</p>
          </div>
        ) : results.length > 0 ? (
          <div className="flex flex-col gap-1.5 p-3">
            <p className="px-1 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
              Results — click to open in reader view
            </p>
            {results.map((r, i) => (
              <button
                key={`${r.url}-${i}`}
                type="button"
                onClick={() => {
                  setAddress(r.url);
                  void go(r.url);
                }}
                className="flex flex-col gap-0.5 rounded-sm border border-border/70 px-3 py-2 text-left transition-colors hover:border-foreground/40"
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{r.title}</span>
                  <PlatformTag platform={r.platform} />
                </span>
                {r.snippet && <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{r.snippet}</span>}
                <span className="truncate font-mono text-[10px] text-muted-foreground/60">{r.url}</span>
              </button>
            ))}
            {history.length > 0 && (
              <>
                <p className="mt-3 px-1 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">Recently read</p>
                {history.map((h, i) => (
                  <button
                    key={`${h.url}-${i}`}
                    type="button"
                    onClick={() => {
                      setAddress(h.url);
                      void go(h.url);
                    }}
                    className="flex items-center gap-2 rounded-sm border border-border/60 px-3 py-1.5 text-left transition-colors hover:border-foreground/40"
                  >
                    <RotateCw className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[11px]">{h.title}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex size-9 items-center justify-center rounded-sm border border-border/70">
              <Sparkles className="size-4 text-muted-foreground" />
            </span>
            <p className="max-w-xs text-[12px] leading-5 text-muted-foreground">
              Open a URL above to read it here, or run a quick search — the AI reads the page and you can hand it straight to the chat.
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {["latest AI news", "best free AI models 2026", "React 19 tutorial", "today's tech trends"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setQuery(s);
                    void runSearch(s);
                  }}
                  className="rounded-sm border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  <Search className="mr-1 inline size-2.5" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-1.5 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground/70">
        <Brain className="size-3" />
        Reader view — pages are fetched through the AI's browser reader and cleaned into text.
      </div>
    </div>
  );
}
