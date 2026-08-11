import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { playStepTick } from "@/lib/sounds";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  FileDown,
  Github,
  Loader2,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ActivityEvent =
  | { kind: "status"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "command"; text: string }
  | { kind: "file"; text: string }
  | { kind: "search"; text: string }
  | { kind: "error"; text: string }
  | { kind: "done"; text: string }
  | { kind: "github"; text: string };

function EventIcon({ e }: { e: ActivityEvent }) {
  switch (e.kind) {
    case "tool":
      return <Wrench className="size-3 shrink-0 text-muted-foreground" />;
    case "command":
      return <Terminal className="size-3 shrink-0 text-muted-foreground" />;
    case "file":
      return <FileDown className="size-3 shrink-0 text-muted-foreground" />;
    case "search":
      return <Search className="size-3 shrink-0 text-muted-foreground" />;
    case "error":
      return <AlertTriangle className="size-3 shrink-0 text-destructive" />;
    case "done":
      return <CheckCircle2 className="size-3 shrink-0 text-foreground" />;
    case "github":
      return <Github className="size-3 shrink-0 text-foreground" />;
    default:
      return <CircleDot className="size-3 shrink-0 text-muted-foreground/70" />;
  }
}

/** Parse a numbered plan ("1. Do X") into steps. */
export function parsePlanSteps(plan: string | undefined): string[] {
  if (!plan) return [];
  return plan
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)\s]/.test(l) || /^[-•*]\s/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[-•*]\s*/, ""))
    .filter(Boolean)
    .slice(0, 8);
}

/** Live AI activity panel — the running feed of what the model is doing right
 *  now: live chain-of-thought (clickable "Thinking" chip), the plan checklist,
 *  tool/command/file events, the current stage, and any errors. */
export function ActivityPanel({
  open,
  onClose,
  stage,
  reasoning,
  plan,
  planActive,
  events,
  busy,
  mobile = false,
}: {
  open: boolean;
  onClose: () => void;
  stage: string | null;
  reasoning: string;
  plan?: string;
  planActive: boolean;
  events: ActivityEvent[];
  busy: boolean;
  /** True on phones: renders as a fixed bottom sheet instead of a side panel. */
  mobile?: boolean;
}) {
  const [showReasoning, setShowReasoning] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(events.length);
  const lastTickRef = useRef(0);

  // Auto-scroll the event log to the newest entry.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [events, stage]);

  // Subtle typing cue: a soft tick when a new event lands while the model is
  // busy — throttled so a burst of tool events doesn't machine-gun the speaker.
  useEffect(() => {
    if (!busy) {
      lastCountRef.current = events.length;
      return;
    }
    if (events.length > lastCountRef.current) {
      lastCountRef.current = events.length;
      const now = Date.now();
      if (now - lastTickRef.current > 400) {
        lastTickRef.current = now;
        playStepTick();
      }
    }
  }, [events.length, busy]);

  const steps = parsePlanSteps(plan);
  const hasReasoning = reasoning.trim().length > 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={mobile ? { y: 320, opacity: 0 } : { opacity: 0, x: 24 }}
          animate={mobile ? { y: 0, opacity: 1 } : { opacity: 1, x: 0 }}
          exit={mobile ? { y: 320, opacity: 0 } : { opacity: 0, x: 24 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className={
            mobile
              ? "fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col border-t border-border bg-background shadow-2xl"
              : "flex w-[340px] shrink-0 flex-col border-l border-border/70 bg-background"
          }
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-3">
            <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {busy ? (
                <>
                  <Brain className="size-3.5 animate-pulse text-foreground" />
                  Live activity
                </>
              ) : (
                <>
                  <Brain className="size-3.5" />
                  Activity
                </>
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Close activity panel"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Stage */}
            {busy && (
              <div className="border-b border-border/70 px-3 py-2.5">
                <div className="flex items-center gap-2 text-[12px] text-foreground/85">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span className="min-w-0 flex-1 truncate">{stage ?? "Thinking…"}</span>
                </div>
                {/* Thinking chip — tap to watch the live chain-of-thought */}
                {hasReasoning && (
                  <button
                    type="button"
                    onClick={() => setShowReasoning((s) => !s)}
                    className={cn(
                      "mt-2 flex w-full items-center gap-1.5 rounded-sm border px-2 py-1.5 text-left text-[11px] transition-colors",
                      showReasoning
                        ? "border-foreground/40 bg-muted text-foreground"
                        : "border-border/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    <Brain className="size-3 animate-pulse" />
                    {showReasoning ? "Hide reasoning" : "Thinking — tap to watch"}
                    <ChevronRight className={cn("ml-auto size-3 transition-transform", showReasoning && "rotate-90")} />
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {showReasoning && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-sm border border-border/60 bg-neutral-50 p-2.5 text-[11px] leading-5 text-muted-foreground dark:bg-neutral-900/60">
                        {reasoning}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Plan checklist */}
            {steps.length > 0 && (
              <div className="border-b border-border/70 px-3 py-3">
                <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  <CircleDot className="size-3" />
                  Plan {planActive && <Loader2 className="size-2.5 animate-spin" />}
                </p>
                <div className="mt-2 flex flex-col gap-1">
                  {steps.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-[12px] leading-5">
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border/80 font-mono text-[9px] text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="text-foreground/85">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Event log */}
            <div ref={logRef} className="flex flex-col gap-1 px-3 py-3">
              <p className="flex items-center gap-1.5 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {busy ? (
                  <>
                    Doing
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        animate={{ opacity: [0.15, 1, 0.15] }}
                        transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18, ease: "easeInOut" }}
                        className="size-1 rounded-full bg-current"
                      />
                    ))}
                  </>
                ) : (
                  "Recent activity"
                )}
              </p>
              {events.length === 0 && !busy && (
                <p className="text-[11px] leading-5 text-muted-foreground/60">
                  What the AI does — planning, searching, running commands, saving files — will appear here live.
                </p>
              )}
              <AnimatePresence initial={false}>
                {events.map((e, i) => {
                  const isNewest = busy && i === events.length - 1;
                  return (
                    <motion.div
                      key={`${i}-${e.text}`}
                      layout
                      initial={{ opacity: 0, y: mobile ? 14 : 6, scale: mobile ? 0.985 : 1 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 34,
                        mass: 0.7,
                      }}
                      className={cn(
                        "flex items-start gap-2 rounded-sm px-1.5 py-1 text-[11px] leading-5",
                        e.kind === "error"
                          ? "text-destructive"
                          : e.kind === "done"
                            ? "text-foreground"
                            : "text-muted-foreground",
                        isNewest && "bg-foreground/[0.045]",
                      )}
                    >
                      <span className="relative mt-0.5">
                        <EventIcon e={e} />
                        {isNewest && (
                          <motion.span
                            initial={{ opacity: 1, scale: 0.5 }}
                            animate={{ opacity: [1, 0.3, 1], scale: [0.7, 1.1, 0.9] }}
                            transition={{ repeat: Infinity, duration: 1.4, ease: "easeInOut" }}
                            className="absolute -right-0.5 -top-0.5 size-1 rounded-full bg-foreground"
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">{e.text}</span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          <div className="shrink-0 border-t border-border/70 px-3 py-2 text-[10px] text-muted-foreground/60">
            {busy ? "Live · updates as the model works" : "Idle · waiting for your next prompt"}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
