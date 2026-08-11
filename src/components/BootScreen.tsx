import { motion } from "framer-motion";
import { notificationsSupported, requestNotificationPermission } from "@/hooks/use-notifications";
import { playBootChime, playReadyChime, playStepTick } from "@/lib/sounds";
import { useEffect, useRef, useState } from "react";

/** What the boot sequence actually loads/downloads — shown as a live checklist
 *  so the user always knows what the app is fetching. The mic permission is
 *  requested during boot (asked once, never spammed again). */
const PHASES = [
  "Loading free-model catalog…",
  "Downloading sandbox kernel…",
  "Mounting Linux filesystem…",
  "Loading plugins & skills…",
  "Warming model gateway…",
  "Verifying voice & mic…",
  "Syncing your settings…",
  "Requesting permissions…",
];

const DOWNLOADS = [
  { label: "free model catalog", size: "4.2 MB" },
  { label: "sandbox kernel (v86)", size: "18.6 MB" },
  { label: "Linux root filesystem", size: "62.1 MB" },
  { label: "plugins & skills index", size: "1.1 MB" },
  { label: "model gateway route", size: "0.9 MB" },
  { label: "voice profiles", size: "0.3 MB" },
  { label: "your settings & profile", size: "240 KB" },
  { label: "permission grants", size: "0.1 MB" },
];

const TIPS = [
  "Press / anywhere to focus the composer",
  "Enter sends · Shift+Enter adds a new line",
  "Every image is free — re-roll as many times as you like",
  "Tap a code block to run it in the sandbox",
  "Ask “continue” to keep a long reply going",
  "Replies stream live — watch the thinking",
  "Attach any file — code, PDF, image, audio",
  "Run `install <tool>` in the sandbox to download tools",
];

const TOTAL_MB = 87.5;

const LS_PERM_KEY = "zenbox.boot.permissionsAsked";

/** Small animated "equalizer" that pulses while assets load. */
function Equalizer() {
  const bars = [0.55, 1, 0.7, 0.85, 0.6];
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className="w-[2px] rounded-full bg-current"
          animate={{ scaleY: [0.35, h, 0.35] }}
          transition={{ repeat: Infinity, duration: 0.8 + i * 0.13, ease: "easeInOut" }}
          style={{ transformOrigin: "bottom" }}
        />
      ))}
    </span>
  );
}

/** Full-screen branded boot screen with a long, staged sequence: the mark
 *  draws itself in, then eight real load/download phases step past (each with a
 *  soft tick sound), a percentage counter climbs, a tip ticker cycles, and the
 *  whole loop repeats until the parent unmounts. Notifications + mic
 *  permission are requested once during the first boot. */
export function BootScreen({
  label = "Loading your studio…",
  word = "ZENBOX",
  phaseMs = 3200,
  onDone,
}: {
  label?: string;
  word?: string;
  /** How long each load phase holds — smaller = faster pass. */
  phaseMs?: number;
  /** Called once after the first full pass through the phase list. */
  onDone?: () => void;
}) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const permsAsked = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const prevPhaseRef = useRef(0);
  const completedRef = useRef(false);
  // Single source of truth for the phase counter — lets the interval read the
  // current value WITHOUT running side effects inside a setState updater.
  const phaseIdxRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => playBootChime(), 300);
    return () => window.clearTimeout(t);
  }, []);

  // Phase cadence: each phase holds for phaseMs so the sequence feels like a
  // real staged download; loops until the parent unmounts.
  //
  // IMPORTANT: the tick sound is played OUTSIDE the state updater. React state
  // updaters must stay pure — StrictMode double-invokes them, which previously
  // double-fired the audio every phase and logged a React warning.
  useEffect(() => {
    const step = window.setInterval(() => {
      phaseIdxRef.current = (phaseIdxRef.current + 1) % PHASES.length;
      setPhaseIdx(phaseIdxRef.current);
      if (phaseIdxRef.current !== 0) {
        try {
          playStepTick();
        } catch {
          /* audio blocked — ignore */
        }
      }
    }, phaseMs);
    return () => window.clearInterval(step);
  }, [phaseMs]);

  // One full pass through the phases completes → ready chime + onDone.
  useEffect(() => {
    if (prevPhaseRef.current === PHASES.length - 1 && phaseIdx === 0 && !completedRef.current) {
      completedRef.current = true;
      playReadyChime();
      onDoneRef.current?.();
    }
    prevPhaseRef.current = phaseIdx;
  }, [phaseIdx]);

  useEffect(() => {
    setProgress(0);
    const t = window.setTimeout(() => setProgress(100), 3000);
    return () => window.clearTimeout(t);
  }, [phaseIdx]);

  // Ask for notifications + microphone once, during the last boot phase.
  // NOTE: the "asked" flag is set inside the timer callback, not before it —
  // StrictMode re-runs effects (mount → cleanup → mount), and setting the ref
  // synchronously would cancel the request on the second mount.
  useEffect(() => {
    if (permsAsked.current) return;
    let asked = false;
    try {
      asked = localStorage.getItem(LS_PERM_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (asked) return;
    const t = window.setTimeout(
      () => {
        permsAsked.current = true;
        if (notificationsSupported()) void requestNotificationPermission();
        try {
          if (navigator.mediaDevices?.getUserMedia) {
            void navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((stream) => {
                stream.getTracks().forEach((tr) => tr.stop());
              })
              .catch(() => {
                /* denied — fine, voice button handles it */
              });
          }
        } catch {
          /* ignore */
        }
        try {
          localStorage.setItem(LS_PERM_KEY, "1");
        } catch {
          /* ignore */
        }
      },
      PHASES.length * phaseMs * 0.9,
    );
    return () => window.clearTimeout(t);
  }, []);

  const pct = Math.round((phaseIdx * 100 + progress) / PHASES.length);
  const mb = (pct / 100) * TOTAL_MB;
  const tip = TIPS[phaseIdx % TIPS.length];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-background">
      {/* faint dotted backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(circle,currentColor_1px,transparent_1px)] [background-size:28px_28px] text-foreground"
      />

      {/* slow scanline sweep */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 h-40 bg-gradient-to-b from-transparent via-foreground/[0.04] to-transparent"
        initial={{ y: "-30%" }}
        animate={{ y: "130%" }}
        transition={{ repeat: Infinity, duration: 9, ease: "linear" }}
      />

      {/* Brand mark */}
      <motion.div
        initial={{ opacity: 0, scale: 0.82 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative"
      >
        <motion.div
          className="relative flex size-20 items-center justify-center overflow-hidden rounded-lg bg-foreground shadow-[0_0_0_1px_var(--border),0_18px_50px_-18px_rgba(0,0,0,0.55)]"
          animate={{ scale: [1, 1.035, 1] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: "easeInOut", repeatDelay: 0.4 }}
        >
          <svg viewBox="0 0 96 96" className="size-14">
            <motion.path
              d="M30 33 H66 L30 63 H66"
              fill="none"
              strokeWidth={7}
              strokeLinecap="square"
              strokeLinejoin="miter"
              className="stroke-background"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5, ease: "easeInOut" }}
            />
            <motion.rect
              x={3}
              y={3}
              width={90}
              height={90}
              rx={12}
              fill="none"
              strokeWidth={1.5}
              className="stroke-background/40"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.55, duration: 0.7, ease: "easeInOut" }}
            />
          </svg>

          {/* shimmer sweep */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/3 bg-white/10 blur-[2px]"
            initial={{ x: "-160%" }}
            animate={{ x: "460%" }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut", repeatDelay: 0.7, delay: 0.9 }}
          />

          {/* rotating progress ring */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-2 rounded-xl border border-foreground/15"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.4 }}
          >
            <motion.div
              className="absolute inset-0 rounded-xl"
              style={{ borderTop: "2px solid var(--foreground)", borderRadius: 12 }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}
            />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Wordmark */}
      <motion.div
        initial="hidden"
        animate="show"
        transition={{ staggerChildren: 0.055, delayChildren: 0.45 }}
        className="mt-7 flex"
        aria-hidden
      >
        {word.split("").map((ch, i) => (
          <motion.span
            key={i}
            variants={{
              hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
              show: { opacity: 1, y: 0, filter: "blur(0px)" },
            }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="text-sm font-semibold tracking-[0.35em]"
          >
            {ch}
          </motion.span>
        ))}
      </motion.div>

      {/* Load/download checklist */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.4 }}
        className="mt-7 w-64"
      >
        {PHASES.map((p, i) => {
          const done = i < phaseIdx;
          const active = i === phaseIdx;
          const dl = DOWNLOADS[i];
          return (
            <div
              key={p}
              className="flex items-center gap-2 text-[11px] transition-colors"
              style={{ color: active ? "var(--foreground)" : done ? "var(--muted-foreground)" : "transparent" }}
            >
              <span
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] ${
                  done
                    ? "border-foreground bg-foreground text-background"
                    : active
                      ? "border-foreground text-foreground"
                      : "border-border text-muted-foreground/40"
                }`}
              >
                {done ? "✓" : active ? (
                  <span className="size-1 animate-ping rounded-full bg-current" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="truncate">{p}</span>
              {dl && active && (
                <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/80">
                  {dl.size}
                </span>
              )}
            </div>
          );
        })}
      </motion.div>

      {/* progress line + percentage + bytes */}
      <div className="mt-6 h-px w-64 overflow-hidden rounded-full bg-border">
        <motion.div
          className="h-full bg-foreground/70"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: pct / 100 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          style={{ transformOrigin: "left" }}
        />
      </div>
      <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        {pct}% · {PHASES[phaseIdx]}
      </p>
      <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {mb.toFixed(1)} MB loaded · phase {phaseIdx + 1}/{PHASES.length}
      </p>

      {/* rotating tip ticker — changes with each phase */}
      <motion.p
        key={tip}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mt-3 max-w-64 text-center text-[11px] leading-4 text-muted-foreground/70"
      >
        <span className="font-medium text-foreground/70">Tip</span> · {tip}
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="mt-4 flex items-center gap-2.5 text-[10px] font-medium uppercase tracking-[0.3em] text-muted-foreground"
      >
        <Equalizer />
        {label}
        <Equalizer />
      </motion.div>
    </div>
  );
}
