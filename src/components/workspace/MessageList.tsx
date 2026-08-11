import { Markdown } from "./markdown";
import { Button } from "@/components/ui/button";
import { formatBytes, modelShortName, type Mode } from "@/lib/zenbox";
import { getMode } from "./modes";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { AlertTriangle, Brain, Check, ChevronDown, Copy, Download, ExternalLink, FileText, Globe, Mail, Pencil, RefreshCw, Repeat2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ViewAttachment = {
  name: string;
  type: string;
  size?: number;
  storageId?: string;
};

export type ViewSource = {
  title: string;
  url: string;
  snippet: string;
  platform?: string;
};

export type ViewUsage = { prompt: number; completion: number };

export type ViewMessage = {
  _id: string;
  role: "user" | "assistant";
  kind: "text" | "image";
  content: string;
  imageUrl?: string;
  attachments?: ViewAttachment[];
  sources?: ViewSource[];
  reasoning?: string;
  usage?: ViewUsage;
  model?: string;
  createdAt?: number;
};

export type StreamingMessage = {
  text: string;
  model: string;
  sources?: ViewSource[];
  reasoning?: string;
};

function timeLabel(ts?: number) {
  return ts ? format(new Date(ts), "HH:mm") : "";
}

function formatTokens(usage: ViewUsage) {
  const total = (usage.prompt ?? 0) + (usage.completion ?? 0);
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k tokens`;
  return `${total} tokens`;
}

/** Estimated confidence for a reply — a transparent heuristic derived from
 *  the reply's grounding (sources), visible reasoning, and length. Shown only
 *  when the "Show confidence score" setting is on. */
function confidenceFor(content: string, sources?: ViewSource[], reasoning?: string): number {
  let c = 84;
  if (reasoning && reasoning.trim().length > 0) c += 5;
  if (sources && sources.length > 0) c += Math.min(6, sources.length * 2);
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  if (words < 15) c -= 8;
  else if (words < 40) c += 1;
  if (words > 500) c += 2;
  return Math.max(62, Math.min(98, c));
}

/** Animated three-dot "the model is thinking" indicator. */
function ThinkingDots({ className }: { className?: string }) {
  const dot = "size-1.5 rounded-full bg-current";
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <motion.span animate={{ y: [0, -2.5, 0], opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 0.9, ease: "easeInOut" }} className={dot} />
      <motion.span animate={{ y: [0, -2.5, 0], opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0.15, ease: "easeInOut" }} className={dot} />
      <motion.span animate={{ y: [0, -2.5, 0], opacity: [0.35, 1, 0.35] }} transition={{ repeat: Infinity, duration: 0.9, delay: 0.3, ease: "easeInOut" }} className={dot} />
    </span>
  );
}

/** Collapsible chain-of-thought panel. While `live` it pulses and shows the
 *  typing dots so the user can watch the model think in real time; once saved
 *  it collapses to a tidy "Thinking" row with a copy button. */
function ReasoningBlock({ text, open, live }: { text: string; open?: boolean; live?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <motion.details
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      open={open}
      className={cn(
        "group mb-3 overflow-hidden rounded-sm border bg-neutral-50 dark:bg-neutral-900/60",
        live ? "border-foreground/30" : "border-border/70",
      )}
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <motion.span
          animate={live ? { opacity: [1, 0.35, 1] } : {}}
          transition={live ? { repeat: Infinity, duration: 1.4 } : {}}
          className="flex size-3.5 shrink-0 items-center justify-center rounded-full border border-current"
        >
          <Brain className="size-2.5" />
        </motion.span>
        <span className="flex-1">Thinking</span>
        {live && <ThinkingDots className="text-muted-foreground" />}
        {!live && <span className="font-mono text-[9px] normal-case tracking-normal text-muted-foreground/60">{text.length} chars</span>}
      </summary>
      <div className="relative">
        <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-border/60 px-3 py-2.5 pr-10 text-[12px] leading-5 text-muted-foreground">
          {text}
        </p>
        <button
          type="button"
          onClick={copy}
          title="Copy reasoning"
          className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-sm text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
    </motion.details>
  );
}

function AttachmentChips({
  attachments,
  urls,
}: {
  attachments: ViewAttachment[];
  urls: Record<string, string | null>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((a, i) => {
        const url = a.storageId ? urls[a.storageId] : undefined;
        const isImage = (a.type ?? "").toLowerCase().startsWith("image/");
        const key = `${a.name}-${i}`;
        if (isImage && url) {
          return (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${a.name} — open original`}
              className="block overflow-hidden rounded-sm border border-border/80 bg-neutral-50 transition-opacity hover:opacity-80 dark:bg-neutral-900"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={a.name} className="h-16 w-16 object-cover" loading="lazy" />
            </a>
          );
        }
        return (
          <a
            key={key}
            href={url ?? undefined}
            download={url ? a.name : undefined}
            target={url ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="flex max-w-56 items-center gap-1.5 rounded-sm border border-border/80 bg-neutral-50 py-1 pl-2 pr-2.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground dark:bg-neutral-900"
          >
            <FileText className="size-3 shrink-0" />
            <span className="truncate font-medium text-foreground/80">{a.name}</span>
            {a.size !== undefined && <span className="shrink-0 opacity-70">{formatBytes(a.size)}</span>}
          </a>
        );
      })}
    </div>
  );
}

const PLATFORM_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  web: "Web",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
};

/** Clickable source cards for deep-research replies — title, platform badge,
 *  host, snippet. */
function SourceCards({ sources }: { sources: ViewSource[] }) {
  const shown = sources.slice(0, 6);
  const extra = sources.length - shown.length;
  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Sources · {sources.length}
      </p>
      <div className="flex flex-col gap-1.5">
        {shown.map((s, i) => {
          let host = "";
          try {
            host = new URL(s.url).hostname.replace(/^www\./, "");
          } catch {
            host = s.url;
          }
          const platformLabel = s.platform ? PLATFORM_LABELS[s.platform] : null;
          return (
            <a
              key={`${s.url}-${i}`}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2.5 rounded-sm border border-border/70 bg-neutral-50 px-2.5 py-2 transition-colors hover:border-foreground/30 hover:bg-neutral-100 dark:bg-neutral-900 dark:hover:bg-neutral-800/60"
            >
              <span className="mt-px shrink-0 font-mono text-[10px] leading-5 text-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-foreground/90 transition-colors group-hover:text-foreground">
                    {s.title}
                  </span>
                  {platformLabel && (
                    <span className="shrink-0 rounded-sm border border-border/70 bg-background px-1 py-px text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {platformLabel}
                    </span>
                  )}
                  <ExternalLink className="size-2.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/70" />
                </span>
                <span className="block truncate text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {host}
                </span>
                {s.snippet && (
                  <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted-foreground">
                    {s.snippet}
                  </span>
                )}
              </span>
            </a>
          );
        })}
        {extra > 0 && (
          <p className="px-0.5 pt-1 text-[10px] text-muted-foreground/60">+{extra} more source{extra > 1 ? "s" : ""}</p>
        )}
      </div>
    </div>
  );
}

/** Small monochrome brand mark shown next to assistant replies. */
function ZenMark() {
  return (
    <span className="flex size-7 shrink-0 select-none items-center justify-center rounded-sm border border-border/80 bg-foreground text-[11px] font-semibold text-background">
      Z
    </span>
  );
}

/** Files the AI actually created in the sandbox — with download buttons. */
/** Prominent "Files created" card — shows a header, the list of paths, and a
 *  download button for each file. Rendered under the assistant reply that
 *  auto-created them. */
function SavedFileChips({
  paths,
  onDownloadFile,
}: {
  paths: string[];
  onDownloadFile?: (path: string) => void;
}) {
  return (
    <div className="mt-4 rounded-md border border-foreground/15 bg-muted/20 p-3">
      <div className="flex items-center gap-2 border-b border-border/60 pb-2 text-[11px] font-medium uppercase tracking-wider text-foreground/70">
        <FileText className="size-3.5" />
        Files created — tap to download
      </div>
      <div className="mt-2 space-y-1.5">
        {paths.map((p, i) => {
          const name = p.replace(/^.*\//, "");
          const dir = p.replace(/\/[^/]+$/, "/");
          return (
            <div
              key={`${p}-${i}`}
              className="group flex items-center justify-between rounded-sm border border-border/60 px-2.5 py-2 transition-colors hover:border-foreground/30"
            >
              <div className="min-w-0 flex-1 pr-2">
                <p className="truncate font-mono text-[13px] font-medium text-foreground/90">{name}</p>
                <p className="truncate text-[10px] text-muted-foreground/70">{dir}</p>
              </div>
              {onDownloadFile && (
                <button
                  type="button"
                  onClick={() => onDownloadFile(p)}
                  title={`Download ${name}`}
                  className="flex shrink-0 items-center gap-1 rounded-sm border border-border/70 bg-background px-2.5 py-1.5 text-[11px] text-foreground/85 transition-colors hover:border-foreground/40 hover:bg-muted"
                >
                  <Download className="size-3.5" />
                  Download
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  mode,
  pending,
  researching,
  streaming,
  attachmentUrls,
  onRunCode,
  onSaveFile,
  onRunTerminal,
  onDownloadCode,
  onEmailCode,
  onPrompt,
  onEditMessage,
  onResend,
  onRegenerate,
  onRerollImage,
  onDownloadFile,
  savedFiles = {},
  showThinking = true,
  richMarkdown = true,
  editable = true,
  showConfidence = false,
  showTokenUsage = true,
  stage,
  error,
  onRetry,
}: {
  messages: ViewMessage[];
  mode: Mode;
  pending: boolean;
  researching?: boolean;
  streaming?: StreamingMessage | null;
  attachmentUrls?: Record<string, string | null>;
  onRunCode: (language: string, code: string) => void;
  onSaveFile?: (hint: string | null, language: string, code: string) => void;
  onRunTerminal?: (command: string) => void;
  onDownloadCode?: (language: string, code: string, hint: string | null) => void;
  onEmailCode?: (language: string, code: string, hint: string | null) => void;
  onPrompt: (suggestion: string) => void;
  onEditMessage?: (messageId: string, content: string) => void;
  onResend?: (messageId: string, content: string) => void;
  onRegenerate?: () => void;
  onRerollImage?: (prompt: string) => void;
  onDownloadFile?: (path: string) => void;
  /** Files auto-created in the sandbox by a reply, keyed by message id. */
  savedFiles?: Record<string, string[]>;
  showThinking?: boolean;
  richMarkdown?: boolean;
  editable?: boolean;
  showConfidence?: boolean;
  showTokenUsage?: boolean;
  /** Best-answer pipeline stage label (e.g. "Reviewing & improving…"). */
  stage?: string | null;
  /** Inline error shown when a reply failed — with an optional Retry action. */
  error?: string | null;
  onRetry?: () => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [liveReasoning, setLiveReasoning] = useState(false);

  // A new message (or a reply starting) always brings the newest into view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  // During streaming, follow the text only while pinned to the bottom — if the
  // user scrolls up to read, stop yanking the viewport. Instant scroll keeps
  // pace with fast token streams without smooth-scroll jank.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [streaming?.text]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const stick = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = stick;
    setAtBottom(stick);
  };

  const copyText = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const startEdit = (m: ViewMessage) => {
    setEditingId(m._id);
    setEditText(m.content);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = (m: ViewMessage) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    onEditMessage?.(m._id, trimmed);
    cancelEdit();
  };

  const busy = pending || streaming !== null;

  if (messages.length === 0 && !pending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">
          {getMode(mode).tagline}
        </p>
        <h2 className="mt-4 max-w-md text-2xl font-semibold tracking-tight sm:text-3xl">
          {mode === "image" ? "Describe it. See it." : "Start with a thought."}
        </h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          {mode === "image"
            ? "Every image is generated free — no credits, no API key, unlimited iterations."
            : "Pick a suggestion or type your own prompt. Replies come from free open models."}
        </p>
        <div className="mt-8 flex max-w-xl flex-col gap-2 sm:flex-row">
          {getMode(mode).suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onPrompt(s)}
              className="rounded-sm border border-border/80 px-3 py-2 text-left text-xs leading-5 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const lastAssistantIndex = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  })();

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto">
      {/* Jump-to-latest — appears while a reply streams and you've scrolled up. */}
      {streaming && !atBottom && (
        <button
          type="button"
          onClick={() => {
            stickRef.current = true;
            setAtBottom(true);
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          }}
          className="absolute bottom-4 right-4 z-10 flex size-9 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition-all hover:border-foreground/40 hover:text-foreground"
          title="Jump to latest"
        >
          <ChevronDown className="size-4" />
        </button>
      )}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-7">
          {messages.map((m, i) => {
            if (m.role === "user") {
              if (editingId === m._id) {
                return (
                  <motion.div
                    key={m._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18 }}
                    className="flex justify-end"
                  >
                    <div className="flex w-full max-w-[85%] flex-col gap-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={Math.min(6, Math.max(2, editText.split("\n").length))}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit(m);
                          }
                        }}
                        className="w-full resize-none rounded-md border border-foreground/40 bg-background px-4 py-2.5 text-[15px] leading-6 outline-none focus:border-foreground"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          disabled={!editText.trim() || busy}
                          onClick={() => saveEdit(m)}
                        >
                          <RefreshCw className="size-3" />
                          Save &amp; resend
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                );
              }
              return (
                <motion.div
                  key={m._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="group flex justify-end"
                >
                  <div className="flex max-w-[85%] flex-col items-end gap-1">
                    <div className="flex flex-col gap-2 rounded-md bg-foreground px-4 py-2.5 text-[15px] leading-6 text-background">
                      {m.content && <p>{m.content}</p>}
                      {m.attachments && m.attachments.length > 0 && (
                        <AttachmentChips attachments={m.attachments} urls={attachmentUrls ?? {}} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 opacity-100 transition-opacity group-hover:opacity-100 md:opacity-0">
                      {timeLabel(m.createdAt) && (
                        <span className="text-[10px] text-muted-foreground/60">{timeLabel(m.createdAt)}</span>
                      )}
                      {onResend && (
                        <button
                          type="button"
                          onClick={() => onResend(m._id, m.content)}
                          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
                          title="Resend this message"
                          disabled={busy}
                        >
                          <Repeat2 className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyText(m._id, m.content)}
                        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
                        title="Copy message"
                      >
                        {copiedId === m._id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                      {onEditMessage && editable && (
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground"
                          title="Edit and resend"
                          disabled={busy}
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            }

            if (m.kind === "image") {
              return (
                <motion.div
                  key={m._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex gap-3"
                >
                  <ZenMark />
                  <div className="min-w-0 max-w-xl flex-1">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                      Generated · {m.model ? modelShortName(m.model) : "Image"}
                      {timeLabel(m.createdAt) && (
                        <span className="ml-2 normal-case tracking-normal text-muted-foreground/60">
                          {timeLabel(m.createdAt)}
                        </span>
                      )}
                    </p>
                    <div className="overflow-hidden rounded-md border border-border/80 bg-neutral-50">
                      <div className="relative aspect-square w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={m.imageUrl} alt={m.content} className="h-full w-full object-cover" loading="lazy" />
                        <span className="absolute left-2 top-2 rounded-sm border border-border/60 bg-background/85 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-muted-foreground">
                          Generated
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-border/70 px-3 py-2">
                        <p className="line-clamp-2 text-xs text-muted-foreground">{m.content}</p>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {onRerollImage && (
                            <button
                              type="button"
                              onClick={() => onRerollImage(m.content)}
                              title="Re-roll with a fresh seed"
                              className="flex items-center gap-1.5 rounded-sm border border-border/80 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                            >
                              <RefreshCw className="size-3" />
                              Re-roll
                            </button>
                          )}
                          <a
                            href={m.imageUrl}
                            download={`zenbox-${m._id}.png`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-sm border border-border/80 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-foreground/30"
                          >
                            <Download className="size-3" />
                            Save
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            }

            const isLastAssistant = i === lastAssistantIndex;
            return (
              <motion.div
                key={m._id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="group flex gap-3"
              >
                <ZenMark />
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/80">
                      Zenbox{m.model ? ` · ${modelShortName(m.model)}` : ""}
                      {showTokenUsage && m.usage ? ` · ${formatTokens(m.usage)}` : ""}
                      {showConfidence ? ` · ≈${confidenceFor(m.content, m.sources, m.reasoning)}% confident` : ""}
                    </p>
                    {timeLabel(m.createdAt) && (
                      <span className="text-[10px] text-muted-foreground/50">{timeLabel(m.createdAt)}</span>
                    )}
                    <div className="ml-auto flex items-center gap-0.5 opacity-100 transition-opacity group-hover:opacity-100 md:opacity-0">
                      {isLastAssistant && onRegenerate && (
                        <button
                          type="button"
                          onClick={onRegenerate}
                          disabled={busy}
                          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                          title="Regenerate reply"
                        >
                          <RefreshCw className={cn("size-3", pending && "animate-spin")} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyText(m._id, m.content)}
                        className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title="Copy reply"
                      >
                        {copiedId === m._id ? <Check className="size-3" /> : <Copy className="size-3" />}
                      </button>
                    </div>
                  </div>
                  {showThinking && m.reasoning && m.reasoning.trim() && <ReasoningBlock text={m.reasoning} />}
                  {richMarkdown ? (
                    <Markdown
                      content={m.content}
                      onRunCode={onRunCode}
                      onSaveFile={onSaveFile}
                      onRunTerminal={onRunTerminal}
                      onDownload={onDownloadCode}
                      onEmail={onEmailCode}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-7">{m.content}</p>
                  )}
                  {savedFiles[m._id] && savedFiles[m._id].length > 0 && (
                    <SavedFileChips paths={savedFiles[m._id]} onDownloadFile={(p) => onDownloadFile?.(p)} />
                  )}
                  {m.sources && m.sources.length > 0 && <SourceCards sources={m.sources} />}
                </div>
              </motion.div>
            );
          })}

          {streaming ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="flex gap-3"
            >
              <ZenMark />
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/80">
                  Zenbox{streaming.model ? ` · ${modelShortName(streaming.model)}` : ""}
                </p>
                {streaming.text ? (
                  <div className="space-y-3">
                    {showThinking && streaming.reasoning && streaming.reasoning.trim() && (
                      <ReasoningBlock text={streaming.reasoning} open={liveReasoning} live />
                    )}
                    <Markdown
                      content={streaming.text}
                      onRunCode={onRunCode}
                      onSaveFile={onSaveFile}
                      onRunTerminal={onRunTerminal}
                      onDownload={onDownloadCode}
                      onEmail={onEmailCode}
                    />
                    {/* Keep the "watch thinking" toggle pinned while the reply
                        streams, so the live reasoning never disappears into the
                        text — tap to expand/collapse the chain of thought. */}
                    {showThinking && streaming.reasoning && streaming.reasoning.trim() && (
                      <button
                        type="button"
                        onClick={() => setLiveReasoning((s) => !s)}
                        className="flex items-center gap-1.5 rounded-sm border border-border/70 bg-muted/20 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                      >
                        <Brain className={cn("size-3", liveReasoning && "text-foreground")} />
                        <span>{liveReasoning ? "Hide thinking" : "Watch thinking"}</span>
                        <ThinkingDots />
                      </button>
                    )}
                    <span className="inline-block h-4 w-[7px] animate-pulse rounded-[1px] bg-foreground/70" />
                    {streaming.sources && streaming.sources.length > 0 && (
                      <SourceCards sources={streaming.sources} />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setLiveReasoning((s) => !s)}
                    disabled={!streaming.reasoning || !streaming.reasoning.trim()}
                    className="flex items-center gap-2 rounded-sm border border-transparent px-1.5 py-1 text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/50 disabled:cursor-default disabled:opacity-70"
                    title={
                      streaming.reasoning && streaming.reasoning.trim()
                        ? "Tap to watch the live reasoning"
                        : "Reasoning will appear as it arrives"
                    }
                  >
                    {showThinking ? (
                      <>
                        <Brain className={cn("size-3.5 animate-pulse", liveReasoning && "text-foreground")} />
                        <ThinkingDots />
                        <span className="text-xs">
                          {liveReasoning && streaming.reasoning?.trim() ? "Hide reasoning" : "Thinking — tap to watch"}
                        </span>
                      </>
                    ) : (
                      <ThinkingDots />
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          ) : pending ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <ZenMark />
              <div className="flex items-center gap-2 text-muted-foreground">
                {mode === "deep" && researching ? (
                  <Globe className="size-3.5 animate-pulse" />
                ) : showThinking ? (
                  <motion.span
                    animate={{ rotate: [0, 12, -12, 0] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut" }}
                    className="flex size-3.5 items-center justify-center"
                  >
                    <Brain className="size-3.5" />
                  </motion.span>
                ) : null}
                {showThinking && <ThinkingDots />}
                <span className="text-xs">
                  {mode === "deep" && researching
                    ? "Searching the web for sources…"
                    : (stage ?? "Thinking")}
                </span>
              </div>
            </motion.div>
          ) : null}
          {error ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-3"
            >
              <AlertTriangle className="size-4 shrink-0 text-destructive" />
              <p className="min-w-0 flex-1 text-[12px] leading-5 text-destructive">{error}</p>
              {onRetry && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 gap-1 text-[11px]"
                  onClick={onRetry}
                >
                  <RefreshCw className="size-3" />
                  Retry
                </Button>
              )}
            </motion.div>
          ) : null}
        </div>
        <div ref={bottomRef} className="h-2" />
      </div>
    </div>
  );
}
