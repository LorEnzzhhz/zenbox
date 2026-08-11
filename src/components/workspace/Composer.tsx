import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BROWSER_ASK_EVENT } from "@/lib/browser";
import { PROMPT_TEMPLATE } from "@/lib/prompt-template";
import { formatBytes, IMAGE_SIZES, type ImageSize, type Mode } from "@/lib/zenbox";
import { cn } from "@/lib/utils";
import { useVoiceInput } from "@/lib/voice";
import { ArrowUp, Check, ChevronDown, ClipboardList, Copy, FileText, ImagePlus, Mic, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Live image detection for the unified composer — when the draft looks like an
// image request, the size row appears and Send becomes "Generate image".
const IMAGE_HINT_RE =
  /(^|\s)(draw|generate|create|make|paint|imagine|design|illustrate)(\s+(a|an|the|me))?\s+(.{4,})\s+(image|picture|artwork|illustration|logo|poster|wallpaper|portrait|photo|icon|meme|avatar)$/i;

function looksLikeImage(text: string): boolean {
  return IMAGE_HINT_RE.test(text.trim());
}

/** Minimal animated audio waveform — a few bars dancing while audio mode is on. */
function Waveform({ active }: { active: boolean }) {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0.4, 0.8, 0.55, 1, 0.65, 0.35].map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current transition-all duration-300"
          style={{
            height: active ? `${h * 14}px` : "4px",
            opacity: active ? 1 : 0.45,
          }}
        />
      ))}
    </span>
  );
}

export function Composer({
  mode,
  busy,
  queueable = false,
  researching,
  streaming,
  modelLabel,
  onSend,
  onGenerateImage,
  onStop,
  onOpenModelPicker,
}: {
  mode: Mode;
  busy: boolean;
  /** Parallel task handling: keep sending while a reply is running (prompts queue). */
  queueable?: boolean;
  researching?: boolean;
  streaming?: boolean;
  /** Display name of the currently selected model (shown in the pill). */
  modelLabel?: string;
  onSend: (text: string, files: File[]) => void;
  onGenerateImage: (prompt: string, size: ImageSize) => void;
  onStop?: () => void;
  /** Open the model picker from the composer's model pill (mobile-first UI). */
  onOpenModelPicker?: () => void;
}) {
  const [text, setText] = useState("");
  const [size, setSize] = useState<ImageSize>(IMAGE_SIZES[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [audioMode, setAudioMode] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftLoadedRef = useRef(false);

  // Draft autosave: a half-typed prompt survives refreshes / accidental app
  // closes. One saved draft per mode, restored on mount, cleared on send.
  const draftKey = (m: Mode) => `zenbox.draft.${m}`;
  useEffect(() => {
    if (draftLoadedRef.current) return;
    try {
      const saved = localStorage.getItem(draftKey(mode));
      if (saved) setText(saved);
    } catch {
      /* ignore */
    }
    draftLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(mode), text);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, mode]);

  // Microphone → text (asks for mic permission, streams interim transcript).
  const { state: voice, toggle: toggleVoice } = useVoiceInput((transcript) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${transcript.trim()}` : transcript.trim()));
    window.setTimeout(() => {
      textareaRef.current?.focus();
      autosize();
    }, 0);
  });
  const listening = voice.status === "listening";

  // The AI Browser tool pipes "Ask AI about this page" here (window event,
  // same pattern as the terminal's TERMINAL_CMD_EVENT) — the page text arrives
  // as a ready-made prompt and is sent straight into the conversation.
  useEffect(() => {
    const onBrowserAsk = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (!detail?.trim()) return;
      onSend(detail.trim(), []);
    };
    window.addEventListener(BROWSER_ASK_EVENT, onBrowserAsk);
    return () => window.removeEventListener(BROWSER_ASK_EVENT, onBrowserAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSend]);

  const isImage = looksLikeImage(text);

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setFiles((prev) => [...prev, ...incoming].slice(0, 8));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submit = () => {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || (busy && !queueable)) return;
    if (isImage && files.length === 0) {
      onGenerateImage(trimmed || "Untitled image", size);
    } else {
      onSend(trimmed, files);
    }
    setText("");
    setFiles([]);
    setSize(IMAGE_SIZES[0]);
    try {
      localStorage.removeItem(draftKey(mode));
    } catch {
      /* ignore */
    }
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const autosize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  // Chat-standard shortcut: pressing "/" anywhere (except while typing in
  // another field) focuses the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        t !== null &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const statusLine = busy
    ? researching
      ? "Searching the web for sources…"
      : streaming
        ? "Streaming reply…"
        : "Model is thinking…"
    : listening
      ? "Listening… speak now"
      : isImage
        ? "Image request detected — generate free, no credits, unlimited retries."
        : "One mode auto-routes · Enter to send · attach any file · press / to focus";

  return (
    <div className="border-t border-border/70 bg-background">
      <div className="mx-auto max-w-4xl px-3 pb-3 pt-2.5 sm:px-6 sm:pb-4 sm:pt-3">
        {/* Live image-size row — appears when the draft reads like an image request */}
        {isImage && (
          <div className="mb-2 flex items-center gap-1">
            <span className="mr-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              Image size
            </span>
            {IMAGE_SIZES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSize(s)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                  size.id === s.id
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground/60">Free generation · no key</span>
          </div>
        )}

        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="flex items-center gap-1.5 rounded-sm border border-border/80 bg-neutral-50 py-1 pl-2 pr-1 text-[11px] text-muted-foreground dark:bg-neutral-900"
              >
                <FileText className="size-3 shrink-0" />
                <span className="max-w-40 truncate font-medium text-foreground/80">{f.name}</span>
                <span className="shrink-0 opacity-70">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Model pill — like a chat app's model selector; opens the picker. */}
        <button
          type="button"
          onClick={onOpenModelPicker}
          className="mb-2 flex max-w-full items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-[11px] font-medium text-foreground/85 transition-colors hover:bg-muted"
          title="Choose a model"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
          <span className="max-w-44 truncate">{modelLabel ?? "Zen"}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </button>

        <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-white p-2 shadow-sm transition-shadow focus-within:border-foreground/40 focus-within:shadow-none dark:bg-neutral-950 sm:gap-2">
          <Popover open={templateOpen} onOpenChange={setTemplateOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Insert the structured prompt template (Goal / Context / Constraints / Done when)"
                disabled={busy && !queueable}
              >
                <ClipboardList className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-[min(92vw,24rem)] p-0">
              <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
                <span className="flex size-6 items-center justify-center rounded-sm bg-foreground text-background">
                  <ClipboardList className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold">Structured prompt template</p>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Goal · Context · Constraints · Done when — fill the brackets and send.
                  </p>
                </div>
              </div>
              <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap px-4 py-3 font-mono text-[10px] leading-4 text-muted-foreground">
                {PROMPT_TEMPLATE}
              </pre>
              <div className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 flex-1 gap-1.5 text-[11px]"
                  onClick={() => {
                    setText((prev) => (prev.trim() ? `${prev.trim()}\n\n` : "") + PROMPT_TEMPLATE);
                    setTemplateOpen(false);
                    window.setTimeout(() => {
                      textareaRef.current?.focus();
                      autosize();
                    }, 0);
                  }}
                >
                  <ClipboardList className="size-3" />
                  Insert into message
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 flex-1 gap-1.5 text-[11px]"
                  onClick={() => {
                    void navigator.clipboard?.writeText(PROMPT_TEMPLATE).catch(() => undefined);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files (images, code, documents…)"
            disabled={busy && !queueable}
          >
            <Paperclip className="size-4" />
          </Button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              autosize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              listening
                ? voice.status === "listening" && "interim" in voice && voice.interim
                  ? voice.interim
                  : "Listening…"
                : isImage
                  ? "Describe the image you want — generated free…"
                  : "Chat with Zenbox…"
            }
            className="max-h-44 min-h-12 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => pickFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
              listening && "animate-pulse bg-foreground text-background",
            )}
            onClick={toggleVoice}
            title={listening ? "Stop listening" : "Speak your message (mic permission required)"}
            disabled={busy && !queueable}
          >
            <Mic className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 shrink-0 rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              audioMode && "bg-foreground text-background",
            )}
            onClick={() => setAudioMode((a) => !a)}
            title={audioMode ? "Audio playback on" : "Audio playback off"}
          >
            <Waveform active={audioMode} />
          </Button>
          {busy && onStop ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-9 shrink-0 rounded-full"
              onClick={onStop}
              title="Stop generating"
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              disabled={(busy && !queueable) || (!text.trim() && files.length === 0)}
              onClick={submit}
              title={isImage ? "Generate image" : "Send"}
            >
              {isImage ? <ImagePlus className="size-4" /> : <ArrowUp className="size-4" />}
            </Button>
          )}
        </div>

        <p className="mt-2 px-1 text-center text-[11px] text-muted-foreground sm:text-left">{statusLine}</p>
      </div>
    </div>
  );
}
