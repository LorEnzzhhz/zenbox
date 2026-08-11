import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  clearLinuxSnapshot,
  linuxSnapshotFlagged,
  loadLinuxSnapshot,
  saveLinuxSnapshot,
} from "@/lib/linux-snapshot";
import {
  AlertTriangle,
  Camera,
  Cpu,
  Download,
  Loader2,
  Power,
  RefreshCw,
  Terminal,
  Upload,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Real Linux sandbox — boots an actual Linux kernel + a full Alpine Linux root
// filesystem (initramfs) inside the browser via the v86 x86 emulator. This is
// a genuine Linux: real /proc, /dev, processes, apk packages, and commands,
// with full root access.
//
// Assets ship with the app under /linux/ (v86.wasm, seabios.bin, vgabios.bin,
// kernel.bin, rootfs.cpio) so it works inside the APK. The kernel exposes a
// serial console; we bridge it to a DOM terminal and pipe keystrokes to the
// root shell that /init spawns on ttyS0.
//
// File bridge (serial, marker-delimited):
//   - Pull:  `base64 <path> | tr -d '\n'` → captured until ##ZENBOX_EOF##,
//            decoded to a real Blob and downloaded to the device.
//   - Push:  device file → base64 chunks piped through `base64 -d` into
//            /root/<name>, terminated with Ctrl-D (EOF).
// ---------------------------------------------------------------------------

type Line = { kind: "out" | "err" | "sys"; text: string };

const STATUS_BASE = ["Loading BIOS…", "…", "Booting Linux kernel…", "…"];

// Per-distro boot configuration: Alpine is the fast default; Debian 12 is a
// full Debian rootfs (dpkg/apt/python3/vim/curl) booted by the same v86
// kernel with a bigger RAM allocation.
const DISTROS = {
  alpine: {
    label: "Alpine",
    initrd: "/linux/rootfs.cpio",
    memory: 128 * 1024 * 1024,
    banner: "Zenbox Root Linux",
    bootMsgs: ["Loading kernel + Alpine rootfs (17 MB)…", "Mounting Alpine root filesystem…"],
    quick: ["ls /root", "uname -a", "cat /etc/os-release", "apk update"],
    fallbackMs: 15_000,
  },
  debian: {
    label: "Debian 12",
    initrd: "/linux/debian.cpio.gz",
    memory: 512 * 1024 * 1024,
    banner: "Zenbox Debian Linux ready",
    bootMsgs: ["Loading kernel + Debian 12 rootfs (~55 MB)…", "Mounting Debian root filesystem…"],
    quick: ["cat /etc/os-release", "uname -a", "python3 --version", "dpkg -l | head -5"],
    fallbackMs: 30_000,
  },
} as const;
export type LinuxDistro = keyof typeof DISTROS;

const PULL_START = "##ZENBOX_START##";
const PULL_END = "##ZENBOX_EOF##";
const MAX_PUSH_BYTES = 256 * 1024; // serial transfers: keep files small
const PUSH_CHUNK = 200; // bytes of base64 per serial write (~5 KB/s)

export function RealLinux({ distro = "alpine" }: { distro?: LinuxDistro } = {}) {
  const d = DISTROS[distro];
  const statusMsgs = [STATUS_BASE[0], d.bootMsgs[0], STATUS_BASE[2], d.bootMsgs[1]];
  const [key, setKey] = useState(0);
  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emulatorRef = useRef<{ destroy: () => void } | null>(null);
  const pendingRef = useRef<string[]>([]);
  const [lines, setLines] = useState<Line[]>([
    { kind: "sys", text: `Zenbox ${d.label} — booting a genuine kernel + ${d.label} root filesystem (v86)…` },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(0);
  const [started, setStarted] = useState(false);
  const [booted, setBooted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const bufferRef = useRef("");
  const lastSerialAtRef = useRef(0);
  const staleWatchRef = useRef<number | null>(null);

  // File bridge state
  const [pullOpen, setPullOpen] = useState(false);
  const [pullPath, setPullPath] = useState("");
  const [transfer, setTransfer] = useState<string | null>(null);
  const pullRef = useRef<{ active: boolean; buf: string; path: string }>({ active: false, buf: "", path: "" });
  const loginStageRef = useRef<"none" | "user" | "done">("none");
  const recentRef = useRef("");

  // Snapshot / instant-boot bookkeeping
  const bootedRef = useRef(false);
  const bootStartedAtRef = useRef(0);
  const bootFallbackRef = useRef<number | null>(null);
  const snapshotBusyRef = useRef(false);
  const snapshotSavedRef = useRef(false);
  const pausedRef = useRef(false);
  const restoredRef = useRef(false);
  const [hasSnapshot, setHasSnapshot] = useState(() => linuxSnapshotFlagged(distro));
  const [restored, setRestored] = useState(false);

  /** Write raw bytes to the emulated serial console (no-op before boot). */
  const send = (text: string) => {
    const emu = emulatorRef.current as unknown as { serial0_send?: (s: string) => void } | null;
    emu?.serial0_send?.(text);
  };

  const appendSys = (text: string) => {
    setLines((prev) => [...prev.slice(-400), { kind: "sys", text }]);
  };

  // Append output from the emulated serial console.
  const append = (chunk: string) => {
    bufferRef.current += chunk;
    const parts = bufferRef.current.split("\n");
    bufferRef.current = parts.pop() ?? "";
    if (parts.length > 0) {
      setLines((prev) => [
        ...prev.slice(-400),
        ...parts.map((t) => ({ kind: "out" as const, text: t })),
      ]);
    }
  };

  /** Finish a Pull: decode captured base64 → download Blob to the device. */
  const finishPull = (raw: string, path: string) => {
    setTransfer(null);
    if (/no such file|not found|permission denied|is a directory/i.test(raw)) {
      appendSys(`Pull failed — ${path} not found or unreadable.`);
      return;
    }
    // Only keep the payload between the START and EOF markers; shell prompts
    // and CR/LF noise outside that window are discarded.
    const start = raw.lastIndexOf(PULL_START);
    const payload = start !== -1 ? raw.slice(start + PULL_START.length) : raw;
    const b64 = payload.replace(/[^A-Za-z0-9+/=]/g, "");
    if (!b64) {
      appendSys(`Pull failed — empty response for ${path}.`);
      return;
    }
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const name = path.split("/").filter(Boolean).pop() || "file";
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      appendSys(`Downloaded ${name} from Linux (${bytes.length.toLocaleString()} bytes).`);
    } catch {
      appendSys(`Pull failed — could not decode the response for ${path}.`);
    }
  };

  /** Start a Pull: disable input echo, then capture base64 until the marker. */
  const startPull = (path: string) => {
    const p = path.trim();
    if (!p || !booted) return;
    setPullOpen(false);
    setPullPath("");
    setTransfer(`Receiving ${p}…`);
    // Turn echo off first — its own echo lands before we begin capturing.
    send("stty -echo 2>/dev/null\n");
    window.setTimeout(() => {
      if (!emulatorRef.current) return;
      pullRef.current = { active: true, buf: "", path: p };
      const q = p.replace(/'/g, `'\\''`);
      send(
        `echo '${PULL_START}'; cat '${q}' 2>/dev/null | base64 | tr -d '\\n'; echo; echo '${PULL_END}'; stty echo 2>/dev/null\n`,
      );
    }, 250);
  };

  /** Push a device file into /root/<name> via chunked base64 + Ctrl-D EOF. */
  const startPush = (file: File) => {
    if (!booted) {
      appendSys("Linux is still booting — wait for the root shell first.");
      return;
    }
    if (file.size > MAX_PUSH_BYTES) {
      appendSys(`Push skipped — ${file.name} is over the 256 KB serial limit.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const b64 = dataUrl.split(",")[1] ?? "";
      if (!b64) return;
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
      const dest = `/root/${safe}`;
      setTransfer(`Sending ${file.name} (0%)…`);
      send(`stty -echo 2>/dev/null; base64 -d > '${dest}' 2>/dev/null\n`);
      const chunks = Math.ceil(b64.length / PUSH_CHUNK);
      window.setTimeout(() => pushChunks(b64, 0, dest, file.name, chunks), 300);
    };
    reader.readAsDataURL(file);
  };

  const pushChunks = (
    b64: string,
    i: number,
    dest: string,
    name: string,
    total: number,
  ) => {
    if (!emulatorRef.current) {
      setTransfer(null);
      return;
    }
    if (i >= b64.length) {
      send("\u0004"); // Ctrl-D = EOF → base64 -d writes the file and exits
      window.setTimeout(() => {
        setTransfer(null);
        appendSys(`Pushed ${name} → ${dest}`);
        send(`stty echo 2>/dev/null; ls -l '${dest}'\n`);
      }, 700);
      return;
    }
    send(b64.slice(i, i + PUSH_CHUNK) + "\n");
    const done = Math.min(i + PUSH_CHUNK, b64.length);
    setTransfer(`Sending ${name} (${Math.round((done / b64.length) * 100)}%)…`);
    window.setTimeout(() => pushChunks(b64, done, dest, name, total), 30);
  };

  const flushPending = () => {
    const emu = emulatorRef.current as unknown as {
      serial0_send?: (s: string) => void;
      keyboard_send_text?: (s: string) => void;
    } | null;
    if (!emu) return;
    const items = pendingRef.current.splice(0);
    for (const t of items) {
      if (emu.serial0_send) emu.serial0_send(`${t}\n`);
      else if (emu.keyboard_send_text) emu.keyboard_send_text(`${t}\n`);
    }
  };

  /** Serialize the live VM state to IndexedDB (stop → save → resume). */
  const saveSnapshotNow = async () => {
    const emu = emulatorRef.current as unknown as {
      save_state?: () => Promise<ArrayBuffer>;
      stop?: () => Promise<void>;
      run?: () => void;
    } | null;
    if (!emu?.save_state || snapshotBusyRef.current) return;
    snapshotBusyRef.current = true;
    setTransfer("Snapshotting VM state…");
    const resume = !!emu.run && !pausedRef.current;
    try {
      if (emu.stop) await emu.stop();
      const buf = await emu.save_state();
      await saveLinuxSnapshot(buf, distro);
      setHasSnapshot(true);
      appendSys(
        `VM snapshot saved (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB) — next boot will be instant.`,
      );
    } catch (err) {
      appendSys(`Snapshot failed — ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      try {
        if (resume) emu.run?.();
      } catch {
        /* ignore */
      }
      snapshotBusyRef.current = false;
      setTransfer(null);
    }
  };

  /** Fired once — by the serial `# ` prompt (cold boot) or by emulator-started
   *  when a saved snapshot was restored. Idempotent. */
  const markBooted = () => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    setBooted(true);
    setHasSnapshot(linuxSnapshotFlagged(distro));
    flushPending();
    // A few seconds after the shell settles, snapshot the VM so the next visit
    // restores instantly instead of cold-booting (~15 s → ~1 s).
    if (!snapshotSavedRef.current) {
      snapshotSavedRef.current = true;
      window.setTimeout(() => {
        if (!bootedRef.current || !emulatorRef.current) return;
        void saveSnapshotNow();
      }, 6000);
    }
  };

  // Greet once the shell is live. The elapsed-time read lives in an effect so
  // renders stay pure (no Date.now() during render).
  useEffect(() => {
    if (!booted) return;
    if (restoredRef.current) {
      appendSys("Restored from snapshot — instant boot complete, files persisted.");
    } else {
      const elapsed = Math.max(0, Math.round((Date.now() - bootStartedAtRef.current) / 1000));
      appendSys(`Root shell ready — Linux booted in ${elapsed}s. Full root access, everything writable.`);
    }
  }, [booted]);

  useEffect(() => {
    let destroyed = false;
    let emulator: { destroy: () => void } | null = null;

    async function boot() {
      if (destroyed) return;
      try {
        // Dynamically import v86 (it's large; keep it out of the main bundle).
        const mod = await import("v86");
        const V86 = mod.V86 as typeof import("v86").V86;
        type V86Opts = ConstructorParameters<typeof V86>[0];
        if (destroyed) return;

        setStatus(1);
        const elem = screenRef.current;
        if (!elem) return;

        // Instant boot: when a saved snapshot exists, restore it instead of
        // re-downloading the kernel + rootfs and cold-booting Linux. The
        // snapshot also carries the live filesystem, so VM files persist too.
        const snapshot = await loadLinuxSnapshot(distro);
        if (destroyed) return;
        let restoring = false;
        const restoreOpts: Partial<V86Opts> = {};
        if (snapshot) {
          restoring = true;
          restoreOpts.initial_state = { buffer: snapshot };
          appendSys("Found saved Linux state — restoring snapshot for instant boot…");
        } else {
          restoreOpts.bzimage = { url: "/linux/kernel.bin" };
          restoreOpts.initrd = { url: d.initrd };
          restoreOpts.cmdline = "console=ttyS0 rdinit=/init panic=10";
        }
        restoredRef.current = restoring;
        setRestored(restoring);
        bootStartedAtRef.current = Date.now();

        const typed = new V86({
          wasm_path: "/linux/v86.wasm",
          memory_size: d.memory,
          vga_memory_size: 8 * 1024 * 1024,
          screen_container: elem,
          bios: { url: "/linux/seabios.bin" },
          vga_bios: { url: "/linux/vgabios.bin" },
          ...restoreOpts,
          autostart: true,
          disable_keyboard: true,
        });
        emulator = typed as unknown as { destroy: () => void };
        emulatorRef.current = emulator;

        typed.add_listener("download-progress", (e) => {
          const { file_index, file_count, loaded, total } = e;
          if (file_index === file_count - 1 && total > 0) {
            const pct = Math.min(100, Math.round((loaded / total) * 100));
            setLines((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.kind === "sys" && last.text.startsWith("Downloading Linux assets")) {
                return [...prev.slice(0, -1), { kind: "sys", text: `Downloading Linux assets… ${pct}%` }];
              }
              return [...prev, { kind: "sys", text: `Downloading Linux assets… ${pct}%` }];
            });
          }
        });
        typed.add_listener("serial0-output-byte", (byte) => {
          lastSerialAtRef.current = Date.now();
          const ch = String.fromCharCode(byte);

          // Pull capture mode — buffer everything until the EOF marker.
          if (pullRef.current.active) {
            pullRef.current.buf += ch;
            const eof = pullRef.current.buf.indexOf(PULL_END);
            if (eof !== -1) {
              const { path } = pullRef.current;
              const raw = pullRef.current.buf.slice(0, eof);
              pullRef.current = { active: false, buf: "", path };
              finishPull(raw, path);
            } else if (pullRef.current.buf.length % 8192 < 2) {
              setTransfer(
                `Receiving ${pullRef.current.path} (${(pullRef.current.buf.length / 1024).toFixed(0)} KB)…`,
              );
            }
            return;
          }

          // Auto-login: Alpine's getty shows a `login:` prompt; sign in as root.
          recentRef.current = (recentRef.current + ch).slice(-160);
          if (loginStageRef.current === "none" && recentRef.current.includes("login:")) {
            loginStageRef.current = "user";
            appendSys("Detected login prompt — signing in as root…");
            window.setTimeout(() => send("root\n"), 350);
          } else if (loginStageRef.current === "user" && recentRef.current.includes("Password:")) {
            loginStageRef.current = "done";
            window.setTimeout(() => send("\n"), 350);
          } else if (loginStageRef.current === "user" && /[#$]\s$/.test(recentRef.current.slice(-3))) {
            loginStageRef.current = "done";
          }

          // This rootfs has no getty — /init spawns the root shell directly
          // and prints a banner first. That banner is our "login done" signal;
          // the `# ` prompt below then marks the shell live.
          if (loginStageRef.current === "none" && recentRef.current.includes(d.banner)) {
            loginStageRef.current = "done";
          }

          // Prompt-based readiness: as soon as the root shell prints its
          // `# ` prompt, /init is done and getty is up — no fixed timeout
          // guessing. (Also catches our own echoed prompts, which is fine:
          // the shell is equally live then.)
          if (loginStageRef.current === "done" && /[#$][ \t]*$/.test(recentRef.current)) {
            markBooted();
          }

          append(ch);
        });
        typed.add_listener("emulator-loaded", () => {
          if (!destroyed) setStatus(2);
        });
        typed.add_listener("emulator-started", () => {
          if (destroyed) return;
          setStatus(3);
          setStarted(true);
          if (restoring) {
            // Restored state: the VM was already booted when we saved it, so
            // the shell is live the moment the CPU starts.
            markBooted();
            // Watchdog: a stale/corrupt saved snapshot can freeze the VM
            // silently. If no serial output arrives within ~10s of the restore,
            // drop the snapshot and cold-boot so Linux still comes up.
            lastSerialAtRef.current = Date.now();
            if (staleWatchRef.current) window.clearInterval(staleWatchRef.current);
            staleWatchRef.current = window.setInterval(() => {
              if (destroyed) return;
              if (Date.now() - lastSerialAtRef.current > 10_000) {
                if (staleWatchRef.current) window.clearInterval(staleWatchRef.current);
                staleWatchRef.current = null;
                if (!emulatorRef.current) return;
                appendSys("Saved snapshot did not respond — clearing it and cold-booting…");
                bootedRef.current = false;
                void clearLinuxSnapshot(distro);
                setHasSnapshot(false);
                try {
                  emulatorRef.current?.destroy();
                } catch {
                  /* ignore */
                }
                emulatorRef.current = null;
                setKey((k) => k + 1);
              }
            }, 3000);
          } else {
            // Cold boot — fallback in case the serial prompt regex misses
            // (e.g. a different getty banner). Never leave the user locked out.
            bootFallbackRef.current = window.setTimeout(() => {
              if (destroyed) return;
              if (!bootedRef.current) {
                appendSys("Could not detect the shell prompt — assuming boot completed.");
                markBooted();
              }
            }, d.fallbackMs);
          }
        });

        // Advance the status bar as boot progresses (a cold boot takes ~10-20s).
        const timers = [2, 3].map((i) =>
          window.setTimeout(() => {
            if (!destroyed) setStatus(i);
          }, 4000 * i),
        );

        // Restores are fast; cold boots need a moment before the shell exists.
        window.setTimeout(() => inputRef.current?.focus(), restoring ? 400 : 8000);

        return () => {
          timers.forEach(clearTimeout);
          if (bootFallbackRef.current) window.clearTimeout(bootFallbackRef.current);
        };
      } catch (err) {
        if (destroyed) return;
        setFailed(err instanceof Error ? err.message : "Failed to start the Linux emulator");
      }
    }

    void boot();

    return () => {
      destroyed = true;
      if (bootFallbackRef.current) window.clearTimeout(bootFallbackRef.current);
      if (staleWatchRef.current) {
        window.clearInterval(staleWatchRef.current);
        staleWatchRef.current = null;
      }
      // Persist the session: serialize the live VM state (stop → save) so the
      // files created inside Linux survive and the next boot is instant. The
      // save chain delays destroy by a moment so the state is captured first.
      const emu = emulator as unknown as {
        save_state?: () => Promise<ArrayBuffer>;
        stop?: () => Promise<void>;
      } | null;
      const doDestroy = () => {
        try {
          emulator?.destroy();
        } catch {
          /* ignore */
        }
        emulatorRef.current = null;
      };
      if (bootedRef.current && !snapshotBusyRef.current && emu?.save_state && emu.stop) {
        snapshotBusyRef.current = true;
        emu
          .stop()
          .then(() => emu.save_state?.())
          .then((buf) => (buf ? saveLinuxSnapshot(buf, distro) : undefined))
          .catch(() => undefined)
          .finally(() => {
            snapshotBusyRef.current = false;
            doDestroy();
          });
      } else {
        doDestroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const sendLine = (text: string) => {
    setInput("");
    if (!booted) {
      // Kernel is up but /init hasn't spawned the shell yet — buffer the
      // command so nothing the user types is lost.
      pendingRef.current.push(text);
      setLines((prev) => [...prev, { kind: "sys", text: `Queued while booting: ${text}` }]);
      return;
    }
    const emu = emulatorRef.current as unknown as {
      serial0_send?: (s: string) => void;
      keyboard_send_text?: (s: string) => void;
    } | null;
    if (!emu) return;
    if (emu.serial0_send) emu.serial0_send(`${text}\n`);
    else if (emu.keyboard_send_text) emu.keyboard_send_text(`${text}\n`);
  };

  const restart = () => {
    setFailed(null);
    setStarted(false);
    setBooted(false);
    setStatus(0);
    setPaused(false);
    pausedRef.current = false;
    setTransfer(null);
    setPullOpen(false);
    pendingRef.current = [];
    pullRef.current = { active: false, buf: "", path: "" };
    loginStageRef.current = "none";
    recentRef.current = "";
    // Fresh cold boot: drop the saved snapshot so the kernel re-boots clean.
    bootedRef.current = false;
    restoredRef.current = false;
    setRestored(false);
    snapshotSavedRef.current = false;
    setHasSnapshot(false);
    void clearLinuxSnapshot(distro);
    setLines([{ kind: "sys", text: "Restarting the Linux kernel — fresh boot…" }]);
    try {
      emulatorRef.current?.destroy();
    } catch {
      /* ignore */
    }
    emulatorRef.current = null;
    setKey((k) => k + 1);
  };

  const togglePause = () => {
    const emu = emulatorRef.current as unknown as { stop?: () => void; run?: () => void } | null;
    if (!emu) return;
    const next = !paused;
    if (next) emu.stop?.();
    else emu.run?.();
    pausedRef.current = next;
    setPaused(next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 px-2.5 py-1.5">
        <Cpu className="size-3.5 text-emerald-400" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
          Root Linux · {d.label} · v86
        </span>          <span
            className={cn(
              "ml-1 flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[9px] font-medium",
              booted ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-800 text-neutral-400",
            )}
            title={restored ? "This session was restored from a saved snapshot — no boot needed" : "v86 Linux VM state"}
          >
            <span className={cn("size-1.5 rounded-full", booted ? "animate-pulse bg-emerald-400" : "bg-neutral-500")} />
            {booted ? (restored ? "instant restore" : "root shell") : "booting"}
          </span>
        {transfer && (
          <span className="ml-1 flex items-center gap-1.5 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300">
            <Loader2 className="size-2.5 animate-spin" />
            <span className="max-w-[140px] truncate">{transfer}</span>
          </span>
        )}
        {hasSnapshot && !transfer && (
          <span
            className="ml-1 hidden items-center gap-1 rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-300 sm:flex"
            title="A saved VM snapshot is stored — the next boot restores instantly and files persist"
          >
            <Zap className="size-2.5" />
            instant boot
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void saveSnapshotNow()}
            disabled={!booted || !!transfer}
            className="flex items-center gap-1 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
            title="Save the current VM state — next boot is instant, files persist"
          >
            <Camera className="size-3" />
            Snap
          </button>
          <button
            type="button"
            onClick={() => setPullOpen((o) => !o)}
            disabled={!booted || !!transfer}
            className="flex items-center gap-1 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
            title="Download a file from Linux to this device"
          >
            <Download className="size-3" />
            Pull
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!booted || !!transfer}
            className="flex items-center gap-1 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
            title="Upload a file from this device into /root (max 256 KB)"
          >
            <Upload className="size-3" />
            Push
          </button>
          <button
            type="button"
            onClick={togglePause}
            disabled={!started}
            className="flex items-center gap-1 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-40"
            title={paused ? "Resume" : "Pause"}
          >
            <Power className="size-3" />
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            onClick={restart}
            className="flex items-center gap-1 rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
            title="Restart the kernel"
          >
            <RefreshCw className="size-3" />
            Restart
          </button>
        </div>
      </div>

      {/* Pull path form */}
      {pullOpen && booted && !failed && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            startPull(pullPath);
          }}
          className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-2"
        >
          <Download className="size-3.5 shrink-0 text-emerald-400" />
          <input
            autoFocus
            value={pullPath}
            onChange={(e) => setPullPath(e.target.value)}
            placeholder="Path in Linux — e.g. /root/notes.txt or /etc/os-release"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-100 caret-emerald-400 outline-none placeholder:text-neutral-600"
            aria-label="Path of the file to pull from Linux"
          />
          <button
            type="submit"
            className="rounded-sm border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/10"
          >
            Pull file
          </button>
        </form>
      )}

      {/* Hidden file picker for Push */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) startPush(f);
        }}
      />

      {/* Boot status */}
      {!started && !failed && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-neutral-800 px-3 py-2">
          <Loader2 className="size-3.5 animate-spin text-emerald-400" />
          <span className="text-[12px] text-neutral-300">{statusMsgs[status]}</span>
          <div className="ml-2 flex gap-1">
            {statusMsgs.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 w-6 rounded-full transition-colors",
                  i < status ? "bg-emerald-400" : "bg-neutral-800",
                )}
              />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {failed && (
        <div className="flex shrink-0 items-center gap-2.5 border-b border-red-500/30 bg-red-500/5 px-3 py-2">
          <AlertTriangle className="size-3.5 shrink-0 text-red-400" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-red-300">{failed}</span>
          <button
            type="button"
            onClick={restart}
            className="rounded-sm border border-red-500/40 px-2 py-0.5 text-[10px] text-red-300 transition-colors hover:bg-red-500/10"
          >
            Retry
          </button>
        </div>
      )}

      {/* Hidden VGA screen (v86 draws its framebuffer here; the kernel prints
          to the serial console which we render as text below). */}
      <div ref={screenRef} className="hidden" aria-hidden />

      {/* Serial terminal */}
      <div className="flex min-h-0 flex-1 flex-col font-mono">
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[12px] leading-5">
          {lines.map((l, i) => (
            <pre
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                l.kind === "out" && "text-neutral-300",
                l.kind === "err" && "text-emerald-300",
                l.kind === "sys" && "text-neutral-500",
              )}
            >
              {l.text || " "}
            </pre>
          ))}
          {!failed && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) sendLine(input.trim());
              }}
              className="mt-0.5 flex items-center gap-0"
            >
              {!started && <span className="shrink-0 select-none text-emerald-400">root@zenbox:/# </span>}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (input.trim()) sendLine(input.trim());
                  }
                }}
                disabled={!started}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-neutral-100 caret-emerald-400 outline-none placeholder:text-neutral-600 disabled:opacity-40"
                placeholder={booted ? "type a command — e.g. ls /proc or cat /etc/os-release" : "booting…"}
                aria-label="Real Linux terminal input"
              />
            </form>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 border-t border-neutral-800 px-2.5 py-1.5">
          {booted &&
            d.quick.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => sendLine(cmd)}
                className="rounded-sm border border-neutral-800 px-1.5 py-0.5 text-[9px] text-neutral-500 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
              >
                {cmd}
              </button>
            ))}
          <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-neutral-500 sm:flex">
            <Terminal className="size-3" />
            Pull / Push move files between this device and the VM.
          </span>
        </div>
      </div>
    </div>
  );
}
