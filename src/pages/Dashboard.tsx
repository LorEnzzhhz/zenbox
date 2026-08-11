import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuthToken } from "@convex-dev/auth/react";
import { useAuth } from "@/hooks/use-auth";
import { useSessionReport } from "@/hooks/use-session-report";
import {
  notificationsSupported,
  requestNotificationPermission,
  useChangeNotifier,
} from "@/hooks/use-notifications";
import { useTheme } from "@/lib/theme";
import {
  AUTO_MODEL,
  AUTO_MODEL_INFO,
  IMAGE_SIZES,
  type ImageSize,
  type Mode,
  type ModelCatalog,
  modelShortName,
  pollinationsUrl,
  titleFromPrompt,
} from "@/lib/zenbox";
import { streamChat } from "@/lib/stream";
import { snapdom } from "@zumer/snapdom";
import {
  createActivityBuffer,
  flushActivityBuffer,
  parseActivityText,
  processChunk,
} from "@/lib/activity";
import { autoStartBackgroundIfEnabled } from "@/lib/background";
import { cn } from "@/lib/utils";
import { Composer } from "@/components/workspace/Composer";
import { MessageList, type ViewMessage, type ViewSource } from "@/components/workspace/MessageList";
import { ModelPicker } from "@/components/workspace/ModelPicker";
import { PluginsDialog } from "@/components/PluginsDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sandbox, type RunTarget } from "@/components/workspace/Sandbox";
import { getMode } from "@/components/workspace/modes";
import { ActivityPanel, type ActivityEvent } from "@/components/workspace/ActivityPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { UpdateNoticeBanner, UpdateNoticeDialog, useUpdateNotice } from "@/components/UpdateNotice";
import { AnnouncementBanner } from "@/components/AnnouncementBanner";
import { HowItWorksDialog } from "@/components/HowItWorksDialog";
import { LiveWallpaper } from "@/components/LiveWallpaper";
import { playErrorTone, playReadyChime, playSendTick } from "@/lib/sounds";
import { buildWorkspaceContext, downloadFsFile, downloadTextFile, fileNameHint, readFile, FS_CHANGED_EVENT, TERMINAL_CMD_EVENT, defaultNameFor, uniquePath, removeFile, writeFile } from "@/lib/sandboxfs";
import { buildProfile } from "@/lib/cognition";
import { speakText, stopSpeech } from "@/lib/tts";
import { haptic } from "@/lib/haptics";
import { formatDistanceToNow } from "date-fns";
import { Activity, Bell, Box, Cpu, Download, Folder, FolderPlus, Info, KeyRound, Loader2, LogOut, Mail, Menu, Moon, MoreHorizontal, Pencil, Plus, Puzzle, Rocket, Search, Send, Settings, Share2, Shield, Sparkles, Sun, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

// Default to the Hy3 Workbench's smart picker: routes each prompt to the best
// free model (Big Pickle for code, DeepSeek V4 Flash for chat/images).
const FALLBACK_MODEL = AUTO_MODEL;

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

function saveLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ---- Reply cache (Settings → Performance → Response caching) ---------------
const REPLY_CACHE_KEY = "zenbox.replyCache";

type CachedReply = { content: string; reasoning?: string };

function readReplyCache(): Record<string, CachedReply> {
  try {
    return JSON.parse(localStorage.getItem(REPLY_CACHE_KEY) ?? "{}") as Record<string, CachedReply>;
  } catch {
    return {};
  }
}

function writeReplyCache(key: string, reply: CachedReply) {
  try {
    const all = readReplyCache();
    all[key] = reply;
    const entries = Object.entries(all);
    if (entries.length > 50) {
      localStorage.setItem(REPLY_CACHE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-50))));
    } else {
      localStorage.setItem(REPLY_CACHE_KEY, JSON.stringify(all));
    }
  } catch {
    /* ignore */
  }
}

function replyCacheKey(model: string, mode: string, text: string): string {
  return `${model}|${mode}|${text.trim()}`;
}

// Fact-seeking prompts get an automatic web search before the best-answer
// pipeline writes — question words, comparisons, and current-events topics.
const FACT_RE =
  /\b(who|what|why|how|when|where|which|latest|newest|news|compare|difference|history|statistics|stats|facts?|meaning|explain|update|best|top|guide|tutorial)\b/i;

// One-mode auto-routing: image requests are detected and sent to the image
// engine; build/write tasks get a plan first, then a grounded execution.
const IMAGE_AUTO_RE =
  /(^|\s)(draw|generate|create|make|paint|imagine|design|illustrate)(\s+(a|an|the|me))?\s+(.{4,})\s+(image|picture|artwork|illustration|logo|poster|wallpaper|portrait|photo|icon|meme|avatar)$/i;
const PLAN_RE =
  /\b(build|create|make|write|develop|implement|fix|debug|add|design|code|app|website|dashboard|component|function|feature|page|file|script|pipeline|game|tool)\b/i;
const QUESTION_RE = /\?\s*$/;

function AccessGate({ onRedeem }: { onRedeem: (code: string) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"code" | "request">("code");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [requested, setRequested] = useState(false);

  const requestAccess = useMutation(api.admin.requestAccess);
  const myRequest = useQuery(api.admin.myAccessRequest);

  const submit = async () => {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRedeem(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not redeem the code.");
      setBusy(false);
    }
  };

  const submitRequest = async () => {
    if (busy || requested) return;
    setBusy(true);
    setError(null);
    try {
      await requestAccess({ name: name || undefined, message: message || undefined });
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  const pending = myRequest?.status === "pending";
  const denied = myRequest?.status === "denied";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-md border border-border/80 p-6">
        <div className="flex items-center justify-center">
          <span className="flex size-10 items-center justify-center rounded-sm bg-foreground text-sm font-bold text-background">
            Z
          </span>
        </div>
        <h1 className="mt-4 text-center text-lg font-semibold tracking-tight">Access required</h1>

        {pending ? (
          <>
            <p className="mt-1.5 text-center text-[13px] leading-5 text-muted-foreground">
              Your access request is with the developer. As soon as they approve it, you'll be
              let in automatically.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 rounded-sm border border-border/70 bg-muted/40 px-3 py-2.5 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Request pending…
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-center text-[13px] leading-5 text-muted-foreground">
              {denied
                ? "Your previous request was declined. You can ask again — or use a code if you have one."
                : "Enter the access code your developer gave you, or request access below."}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-1 rounded-sm border border-border/80 p-1">
              {(["code", "request"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    setError(null);
                  }}
                  className={cn(
                    "rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
                    tab === t ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t === "code" ? "I have a code" : "Request access"}
                </button>
              ))}
            </div>

            {tab === "code" ? (
              <>
                <div className="mt-4 flex items-center gap-2">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ZB-XXXX-XXXX"
                    className="h-10 font-mono text-sm uppercase"
                    disabled={busy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submit();
                    }}
                  />
                  <Button
                    type="button"
                    className="h-10 shrink-0 gap-1.5 text-sm"
                    onClick={() => void submit()}
                    disabled={busy || !code.trim()}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  </Button>
                </div>
              </>
            ) : (
              <div className="mt-4 space-y-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name (optional)"
                  className="h-9 text-[13px]"
                  disabled={busy}
                />
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Why do you need access? (optional)"
                  className="h-9 text-[13px]"
                  disabled={busy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitRequest();
                  }}
                />
                <Button
                  type="button"
                  className="h-9 w-full gap-1.5 text-[13px]"
                  onClick={() => void submitRequest()}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send request to the developer
                </Button>
                {requested && (
                  <p className="rounded-sm border border-foreground/30 bg-muted/40 px-3 py-2 text-center text-[12px] text-foreground">
                    Request sent — the developer has been notified.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="mt-2.5 text-[13px] text-destructive">{error}</p>}
        <p className="mt-4 text-center text-[11px] text-muted-foreground/70">
          Zenbox is invite-only — requests go straight to the developer.
        </p>
      </div>
    </div>
  );
}

function initials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Z";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  // Report this client's IP + device so the developer's console shows a live roster.
  useSessionReport();
  // Auto-request notification permission once (guarded so WebViews don't nag).
  useEffect(() => {
    if (notificationsSupported()) void requestNotificationPermission();
    // Resume native background running if the user left it on.
    void autoStartBackgroundIfEnabled();
  }, []);
  const isMobile = useIsMobile();

  // ---- Workspace state ---------------------------------------------------
  const [mode, setMode] = useState<Mode>(() => loadLS<Mode>("zenbox.mode", "chat"));
  const [model, setModel] = useState<string>(() => loadLS<string>("zenbox.model", FALLBACK_MODEL));
  const [selectedId, setSelectedId] = useState<Id<"conversations"> | null>(() =>
    loadLS<Id<"conversations"> | null>("zenbox.conversation", null),
  );
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);
  const [streaming, setStreaming] = useState<{
    conversationId: Id<"conversations">;
    text: string;
    model: string;
    sources?: ViewSource[];
    reasoning?: string;
  } | null>(null);
  const [pipelineStage, setPipelineStage] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [plan, setPlan] = useState<string>("");
  const [planActive, setPlanActive] = useState(false);
  const [savedFiles, setSavedFiles] = useState<Record<string, string[]>>({});
  const [emailDraft, setEmailDraft] = useState<{ to: string; subject: string; body: string; filename: string; language: string } | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Power shortcut: ⌘/Ctrl+K or ⌘/Ctrl+, opens Settings from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k" || k === ",") {
        e.preventDefault();
        setSettingsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [howWorksOpen, setHowWorksOpen] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const { latest: latestUpdate, unseen, markSeen } = useUpdateNotice();
  // Auto-pop the "a new update has come" dialog once per update — users see
  // the popup with Download & restart right after the boot screen.
  useEffect(() => {
    if (unseen && latestUpdate && !noticeOpen) {
      setNoticeOpen(true);
    }
  }, [unseen, latestUpdate]);
  // Push a system notification when the developer ships a new update.
  useChangeNotifier(latestUpdate ? [latestUpdate] : [], {
    prefix: "zenbox.update",
    title: `Zenbox v${latestUpdate?.version ?? ""} is here`,
    body: (u) => (u.releaseNotes ?? u.title ?? "").slice(0, 120),
    sound: "ready",
  });
  const [convSearch, setConvSearch] = useState("");
  const [activeProjectId, setActiveProjectId] = useState<Id<"projects"> | null>(() =>
    loadLS<Id<"projects"> | null>("zenbox.project", null),
  );
  const [renamingProject, setRenamingProject] = useState<Id<"projects"> | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [expandedGroup, setExpandedGroup] = useState<"general" | Id<"projects"> | null>(null);
  const { resolved, toggleTheme, prefs } = useTheme();

  // Live sandbox snapshot for the AI: refreshed whenever sandbox files change,
  // so the model always sees the current workspace on every turn (full access).
  const [fsTick, setFsTick] = useState(0);
  useEffect(() => {
    const bump = () => setFsTick((t) => t + 1);
    window.addEventListener(FS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FS_CHANGED_EVENT, bump);
  }, []);
  const workspaceCtx = useMemo(
    () => (prefs.fileSystem ? buildWorkspaceContext() : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fsTick, prefs.fileSystem],
  );
  const [runTarget, setRunTarget] = useState<RunTarget | null>(null);
  const [targetKey, setTargetKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Array<{ text: string; files: File[] }>>([]);
  const pendingAutoSaveRef = useRef<{ content: string; matched: boolean } | null>(null);
  // HTML files the AI created in this reply — captured as a screenshot once the
  // reply finishes and posted into the conversation as an image message.
  const htmlShotsRef = useRef<Array<{ path: string; html: string }>>([]);
  // Inline chat error bubble + the last prompt so Retry can resend it.
  const [replyError, setReplyError] = useState<string | null>(null);
  const lastPromptRef = useRef<string>("");

  // The cognition operating profile carried to the model on every turn.
  const profile = useMemo(() => buildProfile(prefs), [prefs]);

  // Push one event into the live activity feed (capped to keep it light).
  const pushActivity = useCallback((e: ActivityEvent) => {
    setActivityEvents((prev) => [...prev.slice(-59), e]);
  }, []);

  // GitHub wiring — executes the `@github:` telemetry markers the AI emits
  // (create repo / push files / release) against the real GitHub API, and
  // streams the result into the Activity panel. Needs GITHUB_TOKEN in the
  // project Keys tab (Settings → GitHub).
  const runGithubOp = useCallback(
    async (marker: string) => {
      const raw = marker.trim();
      if (!raw) return;
      pushActivity({ kind: "github", text: `Requesting GitHub: ${raw}` });
      try {
        // create repo <name> [--private]
        const createMatch = raw.match(/^create\s+repo\s+(.+?)(?:\s+--private)?$/i);
        if (createMatch) {
          const name = createMatch[1].trim();
          pushActivity({ kind: "github", text: `Creating repo ${name}…` });
          const res = await githubCreateRepo({ name, isPrivate: /--private/i.test(raw) });
          if (!res.ok) throw new Error(res.error ?? "Could not create the repo");
          pushActivity({ kind: "done", text: `✓ GitHub repo created — ${res.url ?? name}` });
          return;
        }
        // release <owner/repo> <tag> [assetUrl]
        const releaseMatch = raw.match(/^release\s+([\w.-]+\/[\w.-]+)\s+(\S+)(?:\s+(\S+))?/i);
        if (releaseMatch) {
          const [, repo, tag, assetUrl] = releaseMatch;
          pushActivity({ kind: "github", text: `Creating release ${tag} on ${repo}…` });
          const res = await githubCreateRelease({ repo, tag, assetUrl: assetUrl?.trim() });
          if (!res.ok) throw new Error(res.error ?? "Could not create the release");
          pushActivity({ kind: "done", text: `✓ GitHub release ${tag} — ${res.url ?? repo}` });
          return;
        }
        // push <owner/repo> <path> [path...]
        const pushMatch = raw.match(/^push\s+([\w.-]+\/[\w.-]+)\s+(.+)/i);
        if (pushMatch) {
          const [, repo, rest] = pushMatch;
          const paths = rest
            .split(/\s+/)
            .map((p) => p.replace(/^["'`]|["'`]$/g, "").trim())
            .filter(Boolean);
          const files: Array<{ path: string; content: string }> = [];
          const missing: string[] = [];
          for (const path of paths) {
            const content = readFile(path);
            if (content === null) missing.push(path);
            else files.push({ path, content: content.length > 900_000 ? content.slice(0, 900_000) : content });
          }
          if (missing.length > 0) {
            pushActivity({ kind: "error", text: `Can't push ${missing.join(", ")} — not in the sandbox` });
            if (files.length === 0) return;
          }
          pushActivity({ kind: "github", text: `Pushing ${files.length} file${files.length === 1 ? "" : "s"} to ${repo}…` });
          const res = await githubPushFiles({
            repo,
            files,
            message: `Update from Zenbox (${new Date().toLocaleString()})`,
          });
          if (!res.ok) throw new Error(res.error ?? "Could not push");
          pushActivity({ kind: "done", text: `✓ Pushed ${res.pushed ?? files.length} file(s) — ${res.url ?? repo}` });
          return;
        }
        // Fallback: report connection status + usage.
        const st = await githubStatus();
        if (!st.configured) {
          pushActivity({
            kind: "error",
            text: "GitHub not connected — add a GITHUB_TOKEN in the project Keys tab.",
          });
        } else {
          pushActivity({
            kind: "done",
            text: `GitHub connected${st.username ? ` as @${st.username}` : ""} — try “push you/repo path” to push a sandbox file.`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "GitHub request failed";
        pushActivity({ kind: "error", text: `GitHub: ${msg}` });
        toast.error(`GitHub: ${msg}`);
      }
    },
    // The GitHub action hooks are declared below; they're stable across renders,
    // so the closure only needs pushActivity — referencing them here would be a
    // temporal dead zone error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushActivity],
  );

  // Auto-create real files in the sandbox from any reply that names files via
  // `file:` hints in its code blocks — the AI "creates" actual files now.
  const autoSaveFiles = useCallback(
    (reply: string, messageId: string): string[] => {
      if (!prefs.fileSystem || !reply) return [];
      const blockRe = /```([\w+-]+)\n([\s\S]*?)```/g;
      const created: string[] = [];
      const blocks: Array<{ path: string; code: string }> = [];
      // `// delete: path` blocks give the AI full write access — it can remove
      // any file it created earlier.
      const deleteRe = /```[\w+-]*\n(?:\/\/|#)\s*delete:\s*([\w./-]+)/g;
      const deleted: string[] = [];
      let dm: RegExpExecArray | null;
      while ((dm = deleteRe.exec(reply)) !== null) {
        const target = dm[1].trim();
        if (target) {
          removeFile(target);
          deleted.push(target);
        }
      }
      if (deleted.length > 0) {
        pushActivity({ kind: "done", text: `🗑 Deleted ${deleted.length} file${deleted.length > 1 ? "s" : ""}: ${deleted.join(", ")}` });
      }
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(reply)) !== null) {
        const language = m[1] ?? "";
        const code = m[2];
        if (!code.trim()) continue;
        const hint = fileNameHint(code);
        // The AI can create ANY file — save every code block unless it's
        // clearly not a file (pure output / diff / prose blocks).
        const lang = language.toLowerCase();
        if (!hint && ["text", "plaintext", "console", "output", "diff", "ansi", "terminal"].includes(lang)) continue;
        try {
          const base = hint && hint.trim() ? hint.trim() : defaultNameFor(language);
          const path = uniquePath("/root", base);
          blocks.push({ path, code });
        } catch {
          /* skip */
        }
      }
      if (blocks.length > 0) {
        // Narrate the work: the AI says what it's doing, then what it fixed.
        pushActivity({ kind: "status", text: `Writing ${blocks.length} file${blocks.length > 1 ? "s" : ""} to the sandbox…` });
        for (const b of blocks) {
          writeFile(b.path, b.code);
          created.push(b.path);
          if (/\.html?$/i.test(b.path)) htmlShotsRef.current.push({ path: b.path, html: b.code });
          pushActivity({ kind: "file", text: `✓ Created ${b.path}` });
        }
        setSavedFiles((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), ...created] }));
        window.dispatchEvent(new Event(FS_CHANGED_EVENT));
        pushActivity({ kind: "done", text: `${created.length} file${created.length > 1 ? "s" : ""} ready — tap Download in the message to grab them` });
      }
      return created;
    },
    [prefs.fileSystem, pushActivity],
  );

  // Abort any in-flight stream when leaving the workspace.
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- Convex --------------------------------------------------------------
  const conversations = useQuery(api.conversations.list);
  const projects = useQuery(api.projects.list);
  const createProject = useMutation(api.projects.create);
  const renameProject = useMutation(api.projects.rename);
  const removeProject = useMutation(api.projects.remove);
  const pluginsList = useQuery(api.plugins.list);
  const messages = useQuery(
    api.conversations.messages,
    selectedId ? { conversationId: selectedId } : "skip",
  );
  const listModels = useAction(api.ai.listModels);
  const chat = useAction(api.ai.chat);
  const qualityChat = useAction(api.ai.qualityChat);
  const makePlan = useAction(api.ai.makePlan);
  const sendCodeEmail = useAction(api.email.sendCodeEmail);
  const deepSearch = useAction(api.search.deepSearch);
  const recallMemory = useAction(api.conversations.recallMemory);
  const githubStatus = useAction(api.github.status);
  const githubCreateRepo = useAction(api.github.createRepo);
  const githubPushFiles = useAction(api.github.pushFiles);
  const githubCreateRelease = useAction(api.github.createRelease);
  const createConv = useMutation(api.conversations.create);
  const removeConv = useMutation(api.conversations.remove);
  const addMsg = useMutation(api.conversations.addMessage);
  const editMsg = useMutation(api.conversations.editMessage);
  const getUploadUrl = useMutation(api.files.generateUploadUrl);
  const redeem = useMutation(api.admin.redeemGuest);
  const status = useQuery(api.admin.myStatus);
  const latestAnnouncement = useQuery(api.announcements.latestAnnouncement);
  const authToken = useAuthToken();
  // Push a system notification when the developer posts a new announcement.
  useChangeNotifier(latestAnnouncement ? [latestAnnouncement] : [], {
    prefix: "zenbox.announce",
    title: "New announcement from your developer",
    body: (a) => (a.text ?? "").slice(0, 120),
    sound: "tick",
  });

  // Resolve storage ids → display URLs for attached files in the thread.
  const storageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages ?? []) {
      for (const a of m.attachments ?? []) if (a.storageId) ids.add(a.storageId);
    }
    return [...ids];
  }, [messages]);
  const attachmentUrls = useQuery(
    api.files.getAttachmentUrls,
    storageIds.length > 0 ? { storageIds } : "skip",
  );

  const activeConversation = conversations?.find((c) => c._id === selectedId);

  // Display name for the composer's model pill.
  const modelLabel = useMemo(() => {
    if (model === AUTO_MODEL) return AUTO_MODEL_INFO.name;
    const all = catalog ? [...catalog.free, ...catalog.rest, ...catalog.zen] : [];
    return all.find((m) => m.id === model)?.name ?? modelShortName(model);
  }, [model, catalog]);

  // ---- Model catalog --------------------------------------------------------
  const refreshModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const result = await listModels();
      setCatalog(result);
      setModel((current) => {
        if (current === AUTO_MODEL) return current;
        const known = [...result.free, ...result.rest, ...result.zen].some((m) => m.id === current);
        return known ? current : (result.free[0]?.id ?? FALLBACK_MODEL);
      });
    } catch {
      /* catalog unavailable — picker falls back gracefully */
    } finally {
      setModelsLoading(false);
    }
  }, [listModels]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  useEffect(() => saveLS("zenbox.mode", mode), [mode]);
  useEffect(() => saveLS("zenbox.model", model), [model]);
  useEffect(() => saveLS("zenbox.conversation", selectedId), [selectedId]);
  useEffect(() => saveLS("zenbox.project", activeProjectId), [activeProjectId]);

  // ---- Actions ---------------------------------------------------------------
  const ensureConversation = useCallback(
    async (title: string, m: Mode) => {
      if (selectedId && activeConversation) return selectedId;
      const id = await createConv({
        title: "New conversation",
        mode: m,
        model,
        projectId: activeProjectId ?? undefined,
      });
      setSelectedId(id);
      return id;
    },
    [selectedId, activeConversation, createConv, model, activeProjectId],
  );

  // Upload raw files to Convex storage; returns attachment metadata that gets
  // stored on the message and fed to the model server-side.
  const uploadAttachments = useCallback(
    async (files: File[]) => {
      const attachments: Array<{
        name: string;
        type: string;
        size: number;
        storageId: string;
      }> = [];
      for (const file of files) {
        const uploadUrl = await getUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: file,
        });
        if (!res.ok) {
          throw new Error(`Upload failed for ${file.name} (${res.status})`);
        }
        const { storageId } = (await res.json()) as { storageId: string };
        attachments.push({ name: file.name, type: file.type || "application/octet-stream", size: file.size, storageId });
      }
      return attachments;
    },
    [getUploadUrl, authToken],
  );

  // Native notification when a reply lands while the app is hidden — this is
  // what makes "background running" actually useful on Android: you exit, and
  // a notification tells you the answer is ready.
  const notifyReplyReady = (preview: string) => {
    try {
      if (typeof document !== "undefined" && document.hidden && "Notification" in window && Notification.permission === "granted") {
        new Notification("Zenbox reply ready", {
          body: preview.replace(/```[\s\S]*?```/g, " [code] ").slice(0, 140),
          tag: "zenbox-reply",
        });
      }
    } catch {
      /* ignore */
    }
  };

  // Stream one assistant turn against the /chatStream endpoint and persist the
  // reply. Assumes the user message (with any attachments) is already stored.
  // For deep mode, pass the research digest so the model answers from real
  // web findings.
  const streamReply = async (
    conversationId: Id<"conversations">,
    content: string,
    research?: string,
    sources?: ViewSource[],
    memory?: Array<{ q: string; a: string; title: string }>,
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = "";
    let accumulatedReasoning = "";
    let reasoningOpened = false;
    setStreaming({ conversationId, text: "", model, sources, reasoning: "" });
    haptic("start");
    htmlShotsRef.current = [];
    // Live narration — what the model is doing right now, like a coding agent's
    // progress notes: reading files, planning, running commands, writing.
    pushActivity({ kind: "status", text: `Starting — ${content.slice(0, 90)}${content.length > 90 ? "…" : ""}` });
    pushActivity({
      kind: "tool",
      text: workspaceCtx ? "Reading your sandbox workspace…" : "Planning the approach…",
    });

    // Persist a finished reply, auto-create any files it names, and (optionally)
    // read it aloud.
    const persistReply = async (
      reply: string,
      reasoning?: string,
      usage?: { prompt: number; completion: number },
    ) => {
      if (!reply.trim()) return;
      haptic("success");
      const id = await addMsg({
        conversationId,
        role: "assistant",
        kind: "text",
        content: reply,
        model,
        sources,
        reasoning: reasoning || undefined,
        usage,
      });
      const created = autoSaveFiles(reply, id);
      if (created.length > 0) {
        playReadyChime();
        toast.success(`${created.length} file${created.length > 1 ? "s" : ""} created in the sandbox`);
        pushActivity({
          kind: "done",
          text: `Saved ${created.length} file${created.length > 1 ? "s" : ""} to the sandbox — see Sandbox → Files`,
        });
      }
      // When the AI builds a website, post a rendered screenshot of it straight
      // into the conversation — the finished result, not just the code.
      const htmlShot = htmlShotsRef.current[0];
      if (htmlShot) {
        const shot = await captureSiteScreenshot(htmlShot.html);
        if (shot) {
          try {
            await addMsg({
              conversationId,
              role: "assistant",
              kind: "image",
              content: `📸 Screenshot of ${htmlShot.path} — what it looks like rendered in a browser.`,
              imageUrl: shot,
              model,
            });
            haptic("success");
            pushActivity({ kind: "done", text: `📸 Captured a screenshot of ${htmlShot.path}` });
          } catch {
            /* screenshot message is best-effort */
          }
        }
      }
      if (prefs.tts) speakText(reply, prefs.ttsVoice);
      notifyReplyReady(reply);
    };

    try {
      // Streaming off (Settings → Performance) — one-shot action reply. The
      // `chat` action persists its own reply, so no client-side addMsg here.
      if (!prefs.streaming) {
        const oneShot = await chat({ conversationId, content, model, mode, research, sources, memory, profile, workspace: workspaceCtx });
        setStreaming(null);
        const parsed = parseActivityText(oneShot.content);
        for (const e of parsed.events) {
          if (e.kind === "github") void runGithubOp(e.text);
          else pushActivity(e);
        }
        if (oneShot.error) {
          if (parsed.clean.trim()) {
            if (prefs.tts) speakText(parsed.clean, prefs.ttsVoice);
            toast.error(oneShot.error);
          } else {
            setReplyError(oneShot.error);
            toast.error(oneShot.error);
          }
          return;
        }
        autoSaveFiles(parsed.clean, "oneshot");
        if (prefs.tts) speakText(parsed.clean, prefs.ttsVoice);
        return;
      }

      const actBuf = createActivityBuffer();
      const result = await streamChat({
        conversationId,
        content,
        model,
        mode,
        research,
        memory,
        profile,
        workspace: workspaceCtx,
        token: authToken,
        signal: controller.signal,
        onDelta: (delta) => {
          // Strip `@run:` / `@search:` / `@note:` telemetry lines and surface
          // them live in the Activity panel — the visible reply stays clean.
          const { text, events } = processChunk(delta, actBuf);
          for (const e of events) {
            if (e.kind === "github") void runGithubOp(e.text);
            else pushActivity(e);
          }
          accumulated += text;
          setStreaming((prev) => (prev ? { ...prev, text: accumulated } : prev));
        },
        onReasoning: (delta) => {
          accumulatedReasoning += delta;
          // Live thinking: the moment the first reasoning token arrives, pop
          // the Activity panel open (desktop) so the user can watch the model
          // think in real time — the mobile sheet stays opt-in.
          if (!reasoningOpened && delta) {
            reasoningOpened = true;
            if (!isMobile) setActivityOpen(true);
          }
          setStreaming((prev) => (prev ? { ...prev, reasoning: accumulatedReasoning } : prev));
        },
      });
      // Flush any trailing partial line so the final reply is marker-free.
      const flushed = flushActivityBuffer(actBuf);
      for (const e of flushed.events) {
        if (e.kind === "github") void runGithubOp(e.text);
        else pushActivity(e);
      }
      accumulated += flushed.text;
      setStreaming(null);
      const cleanedReply = accumulated;

      if (result.error === "aborted") {
        // Stopped mid-stream — keep whatever arrived.
        if (cleanedReply.trim()) {
          await persistReply(cleanedReply, result.reasoning || undefined, result.usage ?? undefined);
        }
        return;
      }

      if (result.error) {
        if (cleanedReply.trim()) {
          // Partial reply arrived before the failure — keep it, then warn.
          await persistReply(cleanedReply, result.reasoning || undefined, result.usage ?? undefined);
          toast.error(result.error);
          return;
        }
        // Stream never produced output — fall back to the non-streaming action.
        haptic("error");
        const fallback = await chat({ conversationId, content, model, mode, research, sources, profile, workspace: workspaceCtx });
        if (fallback.error) {
          setReplyError(fallback.error);
          toast.error(fallback.error);
        }
        return;
      }

      if (cleanedReply.trim()) {
        await persistReply(cleanedReply, result.reasoning || undefined, result.usage ?? undefined);
        if (prefs.responseCaching && !research) {
          writeReplyCache(replyCacheKey(model, mode, content), {
            content: cleanedReply,
            reasoning: result.reasoning || undefined,
          });
        }
      }
    } finally {
      abortRef.current = null;
    }
  };

  const retryLast = () => {
    const text = lastPromptRef.current;
    if (!text) return;
    void handleSend(text);
  };

  const handleSend = async (text: string, files: File[] = []) => {
    lastPromptRef.current = text;
    setReplyError(null);
    if (busy) {
      // Multitasking (Settings → Performance): queue the prompt to run after
      // the current reply instead of dropping it.
      if (prefs.parallelTasks && mode !== "image") {
        queueRef.current.push({ text, files });
        toast.info("Queued — runs after the current reply finishes.");
      }
      return;
    }
    playSendTick();
    haptic("tap");
    stopSpeech();
    // One-mode auto-routing: image requests go to the image engine.
    if (files.length === 0 && IMAGE_AUTO_RE.test(text)) {
      await handleGenerateImage(text, IMAGE_SIZES[0]);
      return;
    }
    setBusy(true);
    abortRef.current?.abort();
    try {
      // Memory recall: scan past chats for similar Q/A pairs (Settings → Performance).
      let memory: Array<{ q: string; a: string; title: string }> | undefined;
      if (prefs.memory) {
        setPipelineStage("Recalling similar past conversations…");
        pushActivity({ kind: "status", text: "Recalling similar past conversations…" });
        try {
          memory = await recallMemory({ prompt: text });
          if (memory && memory.length > 0) {
            pushActivity({ kind: "done", text: `Memory: ${memory.length} similar past exchange${memory.length > 1 ? "s" : ""} found` });
          }
        } catch {
          /* memory is best-effort — never block a reply on it */
          memory = undefined;
        }
        if (!memory || memory.length === 0) setPipelineStage(null);
      }

      // Capability gates for attachments (Settings → Agentic & tools / Multimodal).
      if (files.length > 0) {
        const blocked: string[] = [];
        for (const f of files) {
          const type = (f.type || "").toLowerCase();
          if (type.startsWith("image/")) {
            if (!prefs.vision && !prefs.ocr) blocked.push(f.name);
          } else if (type.startsWith("audio/")) {
            if (!prefs.audioTranscription) blocked.push(f.name);
          } else if (!prefs.fileSystem) {
            blocked.push(f.name);
          }
        }
        if (blocked.length > 0) {
          toast.error(
            `Attachments blocked by Settings: ${blocked.join(", ")}. Enable the matching capability in Settings to attach files like this.`,
          );
          return;
        }
      }

      const conversationId = await ensureConversation(titleFromPrompt(text), mode);
      // Upload attachments before persisting so the message is complete.
      const attachments = files.length > 0 ? await uploadAttachments(files) : [];
      // Persist the user message immediately so it appears in the thread
      // while the model works (mirrors the image flow).
      await addMsg({
        conversationId,
        role: "user",
        kind: "text",
        content: text,
        attachments: attachments.length > 0 ? attachments : undefined,
        model,
        title: titleFromPrompt(text),
      });

      // Response caching: exact-prompt repeats come back instantly.
      if (prefs.responseCaching && mode !== "deep" && files.length === 0) {
        const cached = readReplyCache()[replyCacheKey(model, mode, text)];
        if (cached && cached.content.trim()) {
          await addMsg({
            conversationId,
            role: "assistant",
            kind: "text",
            content: cached.content,
            model,
            reasoning: cached.reasoning || undefined,
          });
          if (prefs.tts) speakText(cached.content, prefs.ttsVoice);
          toast.info("Reply loaded from cache — exact prompt match.");
          return;
        }
      }

      // Best-answer pipeline (Settings → Performance): build/write tasks get a
      // plan first, factual prompts get a live web search, then the model
      // writes a draft and self-reviews it — all visible in the Activity panel.
      if (prefs.bestAnswer && mode !== "image") {
        setActivityOpen(true);
        let research: string | undefined;
        let srcs: ViewSource[] | undefined;
        let planText: string | undefined;
        const wantsWeb = mode === "deep" || (mode === "chat" && text.length > 24 && FACT_RE.test(text));
        const wantsPlan = mode !== "deep" && text.length > 14 && PLAN_RE.test(text) && !QUESTION_RE.test(text);
        if (wantsPlan) {
          setPlanActive(true);
          setPipelineStage("Planning before building…");
          pushActivity({ kind: "status", text: "Planning before building…" });
          try {
            const p = await makePlan({ content: text, model, mode });
            if (p.error) {
              pushActivity({ kind: "error", text: p.error });
              playErrorTone();
            } else if (p.plan.trim()) {
              planText = p.plan;
              setPlan(planText);
              for (const line of p.plan.split("\n")) {
                const t = line.trim();
                if (/^\d+[.)\s]/.test(t)) pushActivity({ kind: "status", text: t });
              }
            }
          } catch (err) {
            pushActivity({ kind: "error", text: err instanceof Error ? err.message : "Plan failed" });
          } finally {
            setPlanActive(false);
          }
        } else {
          setPlan("");
        }
        if (wantsWeb) {
          if (prefs.webBrowsing) {
            setResearching(true);
            setPipelineStage("Searching the web for sources…");
            pushActivity({ kind: "search", text: "Searching the web for sources…" });
            try {
              const r = await deepSearch({ query: text });
              if (r.error) {
                pushActivity({ kind: "error", text: r.error });
                toast.error(r.error);
              } else {
                research = r.digest;
                srcs = r.sources;
                pushActivity({ kind: "done", text: `Found ${r.sources?.length ?? 0} sources` });
              }
            } finally {
              setResearching(false);
            }
          } else if (mode === "deep") {
            toast.info("Web browsing is off — answering without a live search.");
          }
        }

        const stages = research
          ? ["Synthesizing the findings…", "Writing a draft answer…", "Reviewing & improving…"]
          : ["Enhancing your prompt…", "Writing a draft answer…", "Reviewing & improving…"];
        setPipelineStage(stages[0]);
        pushActivity({ kind: "status", text: stages[0] });
        const timers = stages.slice(1).map((s, i) =>
          window.setTimeout(() => {
            setPipelineStage(s);
            pushActivity({ kind: "status", text: s });
          }, 7000 * (i + 1)),
        );
        try {
          const res = await qualityChat({
            conversationId,
            content: text,
            model,
            mode,
            research,
            plan: planText,
            sources: srcs,
            memory,
            profile,
            workspace: workspaceCtx,
          });
          if (res.error) {
            pushActivity({ kind: "error", text: res.error });
            playErrorTone();
            toast.error(res.error);
          } else if (res.content.trim()) {
            // qualityChat persists the reply server-side; mark it for file
            // auto-creation once the reactive messages list catches up.
            pendingAutoSaveRef.current = { content: res.content, matched: false };
            pushActivity({ kind: "done", text: "Reply complete" });
            if (prefs.tts) speakText(res.content, prefs.ttsVoice);
          }
        } finally {
          for (const t of timers) window.clearTimeout(t);
          setPipelineStage(null);
        }
        return;
      }

      // Deep mode (streaming path, best-answer off): research, then stream a
      // cited answer.
      if (mode === "deep") {
        // Web browsing off — answer from knowledge alone.
        if (!prefs.webBrowsing) {
          toast.info("Web browsing is off — answering without a live search.");
          await streamReply(conversationId, text);
          return;
        }
        setResearching(true);
        try {
          const research = await deepSearch({ query: text });
          if (research.error) {
            toast.error(research.error);
            return;
          }
          await streamReply(conversationId, text, research.digest, research.sources, memory);
        } finally {
          setResearching(false);
        }
        return;
      }
      await streamReply(conversationId, text, undefined, undefined, memory);
    } catch (err) {
      setStreaming(null);
      setResearching(false);
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
      const next = queueRef.current.shift();
      if (next) window.setTimeout(() => void handleSend(next.text, next.files), 80);
    }
  };

  // When a quality pipeline reply lands in the reactive messages list, attach
  // any files it names (the reply itself was persisted server-side).
  useEffect(() => {
    const pending = pendingAutoSaveRef.current;
    if (!pending || pending.matched) return;
    const match = (messages ?? []).find(
      (m) => m.role === "assistant" && m.content.trim() === pending.content.trim(),
    );
    if (!match) return;
    pending.matched = true;
    autoSaveFiles(pending.content, match._id);
  }, [messages, autoSaveFiles]);

  // Edit a user message (trims the thread after it) and re-run from there.
  const handleEditMessage = async (messageId: string, content: string) => {
    if (busy || !selectedId) return;
    setBusy(true);
    abortRef.current?.abort();
    try {
      await editMsg({ messageId: messageId as Id<"messages">, content });
      await streamReply(selectedId, content);
    } catch (err) {
      setStreaming(null);
      toast.error(err instanceof Error ? err.message : "Could not edit the message");
    } finally {
      setBusy(false);
    }
  };

  // Re-send a user message as-is: trim the thread after it, then re-run it.
  const handleResend = async (messageId: string, content: string) => {
    if (busy || !selectedId) return;
    setBusy(true);
    abortRef.current?.abort();
    try {
      await editMsg({ messageId: messageId as Id<"messages">, content });
      await streamReply(selectedId, content);
    } catch (err) {
      setStreaming(null);
      toast.error(err instanceof Error ? err.message : "Could not resend the message");
    } finally {
      setBusy(false);
    }
  };

  // Re-run the last user prompt: trim the stale reply, then stream anew.
  const handleRegenerate = async () => {
    if (busy || !selectedId || !messages) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setBusy(true);
    abortRef.current?.abort();
    try {
      await editMsg({ messageId: lastUser._id, content: lastUser.content });
      if (mode === "deep") {
        setResearching(true);
        try {
          const research = await deepSearch({ query: lastUser.content });
          if (!research.error) {
            await streamReply(selectedId, lastUser.content, research.digest, research.sources);
            return;
          }
          toast.error(research.error);
          return;
        } finally {
          setResearching(false);
        }
      }
      await streamReply(selectedId, lastUser.content);
    } catch (err) {
      setStreaming(null);
      setResearching(false);
      toast.error(err instanceof Error ? err.message : "Could not regenerate");
    } finally {
      setBusy(false);
    }
  };

  const handleStop = () => {
    stopSpeech();
    abortRef.current?.abort();
  };

  const handleShare = async () => {
    const url = window.location.href;
    const text = "Try Zenbox — a free-model AI studio with chat, code, images, and writing.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Zenbox", text, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied — share it with your guests.");
      }
    } catch {
      /* share cancelled */
    }
  };

  const handleGenerateImage = async (prompt: string, size: ImageSize) => {
    if (busy) return;
    setBusy(true);
    haptic("start");
    setActivityOpen(true);
    pushActivity({ kind: "tool", text: `Generating image · ${size.label}…` });
    setPipelineStage("Generating image…");
    try {
      const conversationId = await ensureConversation(titleFromPrompt(prompt), "image");
      await addMsg({
        conversationId,
        role: "user",
        kind: "text",
        content: prompt,
        model: "Pollinations",
        title: titleFromPrompt(prompt),
      });
      // Try up to 3 seeds so a slow/erroring render doesn't stall the result.
      let url = pollinationsUrl(prompt, size);
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = attempt === 0 ? url : pollinationsUrl(prompt, size);
        let loaded = false;
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            loaded = true;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = candidate;
          window.setTimeout(resolve, attempt === 0 ? 45_000 : 18_000);
        });
        if (loaded) {
          url = candidate;
          break;
        }
        if (attempt < 2) pushActivity({ kind: "status", text: "First render was slow — trying a fresh seed…" });
      }
      await addMsg({
        conversationId,
        role: "assistant",
        kind: "image",
        content: prompt,
        imageUrl: url,
        model: "Pollinations",
      });
      pushActivity({ kind: "done", text: "Image ready" });
      playReadyChime();
      haptic("done");
      notifyReplyReady("Your image is ready — tap to view it.");
    } catch (err) {
      pushActivity({ kind: "error", text: err instanceof Error ? err.message : "Image generation failed" });
      playErrorTone();
      haptic("error");
      toast.error(err instanceof Error ? err.message : "Image generation failed");
    } finally {
      setPipelineStage(null);
      setBusy(false);
    }
  };

  // Re-roll the last image in a conversation with a fresh seed.
  const handleRerollImage = async (prompt: string, size: ImageSize) => {
    await handleGenerateImage(prompt, size);
  };

  const handleNewConversation = async (m: Mode = mode, projectId?: Id<"projects">) => {
    const id = await createConv({
      title: "New conversation",
      mode: m,
      model,
      projectId: projectId ?? activeProjectId ?? undefined,
    });
    setMode(m);
    setSelectedId(id);
  };

  const handleDeleteConversation = async (id: Id<"conversations">) => {
    await removeConv({ conversationId: id });
    if (selectedId === id) setSelectedId(null);
  };

  // ---- Projects -------------------------------------------------------------
  const handleCreateProject = async () => {
    try {
      const id = await createProject({ name: "New project" });
      setActiveProjectId(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create project");
    }
  };

  const handleRenameProject = async (id: Id<"projects">) => {
    const name = projectNameDraft.trim();
    setRenamingProject(null);
    if (!name) return;
    try {
      await renameProject({ projectId: id, name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename project");
    }
  };

  const handleDeleteProject = async (id: Id<"projects">) => {
    try {
      await removeProject({ projectId: id });
      if (activeProjectId === id) setActiveProjectId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete project");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const runCode = (language: string, code: string) => {
    if (!prefs.codeInterpreter) {
      toast.error("Code interpreter is off — enable it in Settings → Agentic & tools.");
      return;
    }
    setRunTarget({ language, code });
    setTargetKey((k) => k + 1);
    setSandboxOpen(true);
    pushActivity({ kind: "command", text: `Running ${language} code in the sandbox…` });
  };

  // "Save file" from a generated code block — writes into the shared virtual
  // Linux filesystem, so it shows up in the sandbox's Files tab and terminal.
  const handleSaveFile = (hint: string | null, language: string, code: string) => {
    if (!prefs.fileSystem) {
      toast.error("File system access is off — enable it in Settings → Agentic & tools.");
      return;
    }
    try {
      const base = hint && hint.trim() ? hint.trim() : defaultNameFor(language);
      const path = uniquePath("/root", base);
      writeFile(path, code);
      toast.success(`Saved ${path} — open the Sandbox → Files, or run \`ls /root\` in the terminal.`);
      pushActivity({ kind: "done", text: `Saved ${path} to the sandbox filesystem` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the file");
    }
  };

  // "Run in terminal" from a bash code block — opens the sandbox and executes
  // the command in the Linux shell, token by token like the user typed it.
  const handleRunTerminal = (command: string) => {
    if (!prefs.codeInterpreter) {
      toast.error("Code interpreter is off — enable it in Settings → Agentic & tools.");
      return;
    }
    setSandboxOpen(true);
    pushActivity({ kind: "command", text: `$ ${command.slice(0, 80)}${command.length > 80 ? "…" : ""}` });
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent<string>(TERMINAL_CMD_EVENT, { detail: command }));
      toast.info("Command sent to the sandbox terminal");
    }, 300);
  };

  // Download a generated code block straight to the device.
  const handleDownloadCode = (language: string, code: string, hint: string | null) => {
    const name = (hint && hint.trim() ? hint.trim() : defaultNameFor(language)).replace(/^\/.*?\//, "");
    downloadTextFile(name, code);
    toast.success(`Downloading ${name}`);
  };

  // Open the "send this code to your inbox" dialog.
  const handleEmailCode = (language: string, code: string, hint: string | null) => {
    const name = (hint && hint.trim() ? hint.trim() : defaultNameFor(language)).replace(/^\/.*?\//, "");
    setEmailDraft({
      to: user?.email ?? "",
      subject: `Zenbox code — ${name}`,
      body: code,
      filename: name,
      language,
    });
  };

  // Send the drafted code to the given inbox via the email gateway (Resend).
  const handleSendEmail = async () => {
    if (!emailDraft || emailSending) return;
    const to = emailDraft.to.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setEmailSending(true);
    try {
      const res = await sendCodeEmail({
        to,
        subject: emailDraft.subject,
        body: emailDraft.body,
        filename: emailDraft.filename,
        language: emailDraft.language,
      });
      if (res.ok) {
        pushActivity({ kind: "done", text: `Code emailed to ${to}` });
        toast.success(`Code sent to ${to}`);
        setEmailDraft(null);
      } else {
        playErrorTone();
        toast.error(res.error ?? "Email send failed");
      }
    } catch (err) {
      playErrorTone();
      toast.error(err instanceof Error ? err.message : "Email send failed");
    } finally {
      setEmailSending(false);
    }
  };

  // Render a created website (HTML file) in a hidden frame and return a JPEG
  // data-URL screenshot — posted into the chat when the AI finishes a build so
  // the user sees the result, not just code.
  const captureSiteScreenshot = async (html: string): Promise<string | null> => {
    try {
      const frame = document.createElement("iframe");
      frame.style.cssText =
        "position:fixed;left:-9999px;top:0;width:640px;height:900px;border:0;background:#fff;visibility:hidden;";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      if (!doc) {
        frame.remove();
        return null;
      }
      doc.open();
      doc.write(html);
      doc.close();
      // Let the page render + settle (fonts, layout, JS) before capturing.
      await new Promise((r) => setTimeout(r, 1700));
      const body = doc.body;
      if (!body || !body.innerHTML.trim()) {
        frame.remove();
        return null;
      }
      const canvas = await snapdom.toCanvas(body, { fast: true });
      const url = canvas.toDataURL("image/jpeg", 0.72);
      frame.remove();
      return url;
    } catch {
      return null;
    }
  };

  // Guests without a redeemed access code see a gate instead of the studio.
  if (status?.needsToken) {
    return (
      <AccessGate
        onRedeem={async (c) => {
          await redeem({ code: c });
        }}
      />
    );
  }

  // ---- Render helpers ----------------------------------------------------------
  const viewMessages: ViewMessage[] = [
    ...(messages ?? []).map((m) => ({
      _id: m._id,
      role: m.role,
      kind: m.kind,
      content: m.content,
      imageUrl: m.imageUrl,
      attachments: m.attachments,
      sources: m.sources,
      reasoning: m.reasoning,
      usage: m.usage,
      model: m.model,
      createdAt: m.createdAt,
    })),
  ];

  // Claude-style centered greeting for the empty studio. The starburst mark,
  // time-of-day welcome and the user's first name keep the first screen calm
  // and personal; suggestions quietly show what one prompt can do.
  function StudioGreeting() {
    const hour = new Date().getHours();
    const period = hour < 5 ? "Up late" : hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : hour < 21 ? "Evening" : "Late night";
    const firstName = (user?.name || user?.email || "there").split(/[\s@.]/)[0];
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8, rotate: -12 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-[0_18px_40px_-16px_rgba(0,0,0,0.5)]"
        >
          <Sparkles className="size-7" />
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 text-2xl font-medium tracking-tight"
        >
          {period}, {firstName}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-2 max-w-60 text-[13px] leading-5 text-muted-foreground"
        >
          Chat, code, generate images, research the web, or write — one prompt routes it automatically.
        </motion.p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.5 }}
          className="mt-5 flex flex-wrap items-center justify-center gap-1.5"
        >
          {["Build a to-do app", "Generate a poster", "Explain this code"].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void handleSend(q)}
              className="rounded-full border border-border/80 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </motion.div>
      </div>
    );
  }

  const filteredConversations = useMemo(() => {
    const q = convSearch.trim().toLowerCase();
    if (!q) return conversations ?? [];
    return (conversations ?? []).filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, convSearch]);

  // Flat thread list for single-session mode (Settings → UX → Multi-session).
  const flatThreads = useMemo(() => {
    const q = convSearch.trim().toLowerCase();
    const list = q
      ? (conversations ?? []).filter((c) => c.title.toLowerCase().includes(q))
      : (conversations ?? []);
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, convSearch]);

  const sidebar = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border/70 px-4">
        <span className="text-sm font-semibold tracking-[0.3em]">ZENBOX</span>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">
          Studio
        </span>
      </div>

      <div className="space-y-1.5 px-2 pt-3">
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 rounded-sm text-sm font-medium"
          onClick={() => void handleNewConversation()}
        >
          <Plus className="size-4" />
          New conversation
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start gap-2 rounded-sm text-sm font-medium"
          onClick={() => setPluginsOpen(true)}
        >
          <Puzzle className="size-4" />
          Plugins &amp; Skills
          {(pluginsList?.filter((p) => p.enabled).length ?? 0) > 0 && (
            <span className="ml-auto rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
              {pluginsList?.filter((p) => p.enabled).length}
            </span>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start gap-2 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setHowWorksOpen(true)}
          title="How Zenbox processes data, runs tools, and keeps you updated"
        >
          <Info className="size-4" />
          How Zenbox works
        </Button>
      </div>

      <div className="px-2 pt-3">
        <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          One mode · auto routes
        </p>
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => void handleNewConversation()}
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-left text-[13px] font-medium transition-colors"
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/50 text-[9px]">
              A
            </span>
            Zen
            <span className="ml-auto text-[10px] font-normal text-muted-foreground/60">chat · code · images · web</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-3">
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="Search chats…"
              className="h-8 rounded-sm pl-8 text-xs"
            />
          </div>
        </div>
        {prefs.multiSession ? (
          <>
        <div className="flex items-center justify-between px-4 pb-1">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Projects &amp; threads
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground"
            title="New project"
            onClick={() => void handleCreateProject()}
          >
            <FolderPlus className="size-3.5" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations === undefined || projects === undefined ? (
            <div className="flex justify-center py-6">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : filteredConversations.length === 0 ? (
            <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
              {conversations.length === 0
                ? "No conversations yet. Start one and it will appear here."
                : "No chats match your search."}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {projects.map((p) => {
                const threads = filteredConversations.filter((c) => c.projectId === p._id);
                if (threads.length === 0) return null;
                const expanded = expandedGroup === p._id;
                return (
                  <div key={p._id} className="flex flex-col">
                    <div
                      className={cn(
                        "group flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 transition-colors",
                        expanded ? "bg-muted/70" : "hover:bg-muted/60",
                      )}
                      onClick={() => {
                        setExpandedGroup(expanded ? null : p._id);
                        setActiveProjectId(p._id);
                      }}
                    >
                      <Folder className={cn("size-3.5 shrink-0", expanded ? "text-foreground" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{p.name}</span>
                      <span className="text-[10px] text-muted-foreground/60">{p.threadCount}</span>
                      {renamingProject === p._id ? (
                        <input
                          value={projectNameDraft}
                          onChange={(e) => setProjectNameDraft(e.target.value)}
                          onBlur={() => void handleRenameProject(p._id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleRenameProject(p._id);
                            if (e.key === "Escape") setRenamingProject(null);
                          }}
                          autoFocus
                          className="h-6 w-24 rounded-sm border border-border bg-background px-1.5 text-[11px] outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span className="hidden items-center gap-0.5 group-hover:flex">
                          <button
                            type="button"
                            title="Rename"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectNameDraft(p.name);
                              setRenamingProject(p._id);
                            }}
                            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            title="New thread"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleNewConversation(mode, p._id);
                            }}
                            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Plus className="size-3" />
                          </button>
                          <button
                            type="button"
                            title="Delete project"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteProject(p._id);
                            }}
                            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        </span>
                      )}
                    </div>
                    {expanded && (
                      <div className="ml-3.5 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                        {threads.map((c) => {
                          const active = c._id === selectedId;
                          return (
                            <div
                              key={c._id}
                              className={cn(
                                "group flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                                active ? "bg-muted" : "hover:bg-muted/60",
                              )}
                              onClick={() => {
                                setSelectedId(c._id);
                                setMode(c.mode);
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className={cn("truncate text-[12px]", active ? "font-medium" : "text-muted-foreground")}>
                                  {c.title}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60">
                                  {getMode(c.mode).label} · {formatDistanceToNow(c.updatedAt, { addSuffix: true })}
                                </p>
                              </div>
                              <button
                                type="button"
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteConversation(c._id);
                                }}
                                className="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive group-hover:flex"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {(() => {
                const general = filteredConversations.filter((c) => !c.projectId);
                if (general.length === 0) return null;
                const expanded = activeProjectId === null;
                return (
                  <div className="flex flex-col">
                    <div
                      className={cn(
                        "group flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 transition-colors",
                        expanded ? "bg-muted/70" : "hover:bg-muted/60",
                      )}
                      onClick={() => {
                        setExpandedGroup(expanded ? null : "general");
                        setActiveProjectId(null);
                      }}
                    >
                      <Folder className={cn("size-3.5 shrink-0", expanded ? "text-foreground" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">General</span>
                      <span className="text-[10px] text-muted-foreground/60">{general.length}</span>
                    </div>
                    {expanded && (
                      <div className="ml-3.5 flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                        {general.map((c) => {
                          const active = c._id === selectedId;
                          return (
                            <div
                              key={c._id}
                              className={cn(
                                "group flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                                active ? "bg-muted" : "hover:bg-muted/60",
                              )}
                              onClick={() => {
                                setSelectedId(c._id);
                                setMode(c.mode);
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className={cn("truncate text-[12px]", active ? "font-medium" : "text-muted-foreground")}>
                                  {c.title}
                                </p>
                                <p className="text-[10px] text-muted-foreground/60">
                                  {getMode(c.mode).label} · {formatDistanceToNow(c.updatedAt, { addSuffix: true })}
                                </p>
                              </div>
                              <button
                                type="button"
                                title="Delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDeleteConversation(c._id);
                                }}
                                className="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive group-hover:flex"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Threads
            </p>
            {flatThreads.length === 0 ? (
              <p className="px-2 py-4 text-xs leading-5 text-muted-foreground">
                {conversations?.length === 0
                  ? "No conversations yet. Start one and it will appear here."
                  : "No chats match your search."}
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {flatThreads.map((c) => {
                  const active = c._id === selectedId;
                  return (
                    <div
                      key={c._id}
                      className={cn(
                        "group flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                        active ? "bg-muted" : "hover:bg-muted/60",
                      )}
                      onClick={() => {
                        setSelectedId(c._id);
                        setMode(c.mode);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-[12px]", active ? "font-medium" : "text-muted-foreground")}>
                          {c.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">
                          {getMode(c.mode).label} · {formatDistanceToNow(c.updatedAt, { addSuffix: true })}
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteConversation(c._id);
                        }}
                        className="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-destructive group-hover:flex"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border/70 px-2 py-2">
        {status?.isAdmin && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
              title="Admin panel — monitor guests and issue access codes"
              onClick={() => navigate("/admin")}
            >
              <Shield className="size-3.5" />
              Admin
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
              title="Control app — command improvements and ship updates"
              onClick={() => navigate("/updater")}
            >
              <Rocket className="size-3.5" />
              Control
            </Button>
          </>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] font-medium text-muted-foreground"
          title="Share Zenbox"
          onClick={() => void handleShare()}
        >
          <Share2 className="size-3.5" />
          Share
        </Button>
      </div>

      <div className="flex items-center gap-2.5 border-t border-border/70 px-3 py-2.5">
        <Avatar className="size-7 rounded-sm">
          {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
          <AvatarFallback className="rounded-sm bg-foreground text-[10px] text-background">
            {initials(user?.name, user?.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{user?.name || "Zenbox user"}</p>
          <p className="truncate text-[10px] text-muted-foreground">{user?.email ?? "guest session"}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title="Sign out"
          onClick={() => void handleSignOut()}
        >
          <LogOut className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <Sheet>
    <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
      <LiveWallpaper />
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-border/70 md:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border/70 px-2 sm:gap-2 sm:px-4">
          {/* Mobile menu button */}
          <SheetTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 md:hidden" aria-label="Open menu">
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>

          {/* Mobile brand center — clean on phones; title shows on desktop */}
          <div className="flex min-w-0 flex-1 items-center justify-center md:hidden">
            <span className="text-xs font-semibold tracking-[0.35em]">ZENBOX</span>
          </div>

          {/* Conversation title — desktop only (mobile keeps the centered brand) */}
          <div className="hidden min-w-0 flex-1 md:block">
            <p className="truncate text-sm font-medium">
              {activeConversation?.title ?? "New conversation"}
            </p>
            <p className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
              Zen mode · {catalog?.hasKey ? "Live free models" : "Curated models"}
            </p>
          </div>

          {/* Mobile activity — one compact icon on phones */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative size-8 shrink-0 md:hidden"
            title="Live activity — what the AI is doing now"
            onClick={() => setActivityOpen((o) => !o)}
          >
            <Activity className={cn("size-4", busy && "animate-pulse")} />
            {busy && <span className="absolute right-1.5 top-1.5 size-1.5 animate-ping rounded-full bg-foreground" />}
          </Button>

          {/* Desktop live-activity button */}
          <Button
            type="button"
            variant={busy ? "default" : "outline"}
            size="sm"
            className={cn("hidden gap-1.5 text-xs md:flex", busy && "bg-foreground text-background")}
            onClick={() => setActivityOpen((o) => !o)}
            title="Watch the AI work — reasoning, plan, tools, status"
          >
            <Activity className={cn("size-3.5", busy && "animate-pulse")} />
            <span className="hidden sm:inline">Activity</span>
            {busy && <span className="size-1.5 animate-pulse rounded-full bg-background" />}
          </Button>

          {/* App version — bumps when the developer ships an update */}
          <span
            className="hidden shrink-0 rounded-sm border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline"
            title={`Zenbox v${latestUpdate?.version ?? 1}`}
          >
            v{latestUpdate?.version ?? 1}
          </span>

          {/* Model picker — desktop only */}
          <div className="hidden md:block">
            <ModelPicker
              catalog={catalog}
              loading={modelsLoading}
              value={model}
              onChange={setModel}
              onRefresh={() => void refreshModels()}
            />
          </div>

          {/* Sandbox — desktop only */}
          <Button
            type="button"
            variant={sandboxOpen ? "default" : "outline"}
            size="sm"
            className={cn("hidden gap-1.5 text-xs md:flex", sandboxOpen && "bg-foreground text-background")}
            onClick={() => setSandboxOpen((o) => !o)}
          >
            <Box className="size-3.5" />
            <span className="hidden sm:inline">Sandbox</span>
          </Button>

          {/* Update bell — desktop only */}
          {unseen && latestUpdate && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="relative hidden size-8 shrink-0 text-muted-foreground lg:flex"
              title="A new update has arrived"
              onClick={() => setNoticeOpen(true)}
            >
              <Bell className="size-4" />
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-foreground" />
            </Button>
          )}

          {/* Theme + settings — desktop only */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-8 shrink-0 text-muted-foreground lg:flex"
            title={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggleTheme}
          >
            {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden size-8 shrink-0 text-muted-foreground lg:flex"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="size-4" />
          </Button>

          {/* Mobile overflow menu — model, sandbox, theme, settings, updates */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground"
                  aria-label="More options"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => window.dispatchEvent(new Event("zenbox.open-model-picker"))}
                >
                  <Cpu className="mr-2 size-4" />
                  Change model
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setSandboxOpen((o) => !o)}
                >
                  <Box className="mr-2 size-4" />
                  Sandbox
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={toggleTheme}>
                  {resolved === "dark" ? <Sun className="mr-2 size-4" /> : <Moon className="mr-2 size-4" />}
                  {resolved === "dark" ? "Light theme" : "Dark theme"}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setSettingsOpen(true)}>
                  <Settings className="mr-2 size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setHowWorksOpen(true)}>
                  <Info className="mr-2 size-4" />
                  How Zenbox works
                </DropdownMenuItem>
                {unseen && latestUpdate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="cursor-pointer" onClick={() => setNoticeOpen(true)}>
                      <Bell className="mr-2 size-4" />
                      What's new — v{latestUpdate.version}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="outline-none" aria-label="Account menu">
                <Avatar className="size-7 rounded-sm ring-1 ring-border/60 transition-colors hover:ring-foreground/40">
                  {user?.image ? <AvatarImage src={user.image} alt="" /> : null}
                  <AvatarFallback className="rounded-sm bg-foreground text-[10px] text-background">
                    {initials(user?.name, user?.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-xs font-medium">{user?.name || "Zenbox user"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email ?? "guest session"}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-destructive focus:text-destructive"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="mr-2 size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Developer announcement (broadcast from Control) */}
        {latestAnnouncement && <AnnouncementBanner id={latestAnnouncement._id} text={latestAnnouncement.text} />}


        {/* Update notice */}
        {unseen && latestUpdate && (
          <UpdateNoticeBanner
            update={latestUpdate}
            onWhatNew={() => setNoticeOpen(true)}
            onDismiss={markSeen}
          />
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            {viewMessages.length === 0 && !busy && !streaming ? <StudioGreeting /> : null}
            <MessageList
              messages={viewMessages}
              mode={mode}
              pending={busy}
              researching={researching}
              streaming={streaming && streaming.conversationId === selectedId ? streaming : null}
              attachmentUrls={attachmentUrls ?? {}}
              onRunCode={runCode}
              onSaveFile={handleSaveFile}
              onRunTerminal={handleRunTerminal}
              onDownloadCode={handleDownloadCode}
              onEmailCode={handleEmailCode}
              onRerollImage={(prompt) => void handleRerollImage(prompt, IMAGE_SIZES[0])}
              onDownloadFile={(path) => {
                if (downloadFsFile(path)) toast.success(`Downloaded ${path.replace(/^.*\//, "")}`);
              }}
              savedFiles={savedFiles}
              showThinking={prefs.showThinking}
              richMarkdown={prefs.richMarkdown}
              editable={prefs.editableOutputs}
              showConfidence={prefs.showConfidence}
              showTokenUsage={prefs.showTokenUsage}
              stage={pipelineStage}
              error={replyError}
              onRetry={retryLast}
              onEditMessage={(id, content) => void handleEditMessage(id, content)}
              onResend={(id, content) => void handleResend(id, content)}
              onRegenerate={() => void handleRegenerate()}
              onPrompt={(s) => {
                if (mode === "image") {
                  void handleGenerateImage(s, IMAGE_SIZES[0]);
                } else {
                  void handleSend(s);
                }
              }}
            />
            <Composer
              mode={mode}
              busy={busy}
              queueable={prefs.parallelTasks}
              researching={researching}
              streaming={streaming !== null}
              modelLabel={modelLabel}
              onSend={(t, f) => void handleSend(t, f)}
              onGenerateImage={(p, s) => void handleGenerateImage(p, s)}
              onStop={handleStop}
              onOpenModelPicker={() => window.dispatchEvent(new Event("zenbox.open-model-picker"))}
            />
          </main>

          {sandboxOpen && (
            <aside className="hidden w-[380px] shrink-0 border-l border-border/70 lg:block">
              <Sandbox onClose={() => setSandboxOpen(false)} runTarget={runTarget} targetKey={targetKey} />
            </aside>
          )}

          <ActivityPanel
            open={activityOpen}
            onClose={() => setActivityOpen(false)}
            stage={pipelineStage}
            reasoning={streaming?.reasoning ?? ""}
            plan={plan}
            planActive={planActive}
            events={activityEvents}
            busy={busy}
            mobile={isMobile}
          />
          {/* Mobile activity backdrop */}
          {isMobile && activityOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/20"
              onClick={() => setActivityOpen(false)}
              aria-hidden
            />
          )}
        </div>
      </div>

      {/* Mobile sandbox overlay */}
      {sandboxOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setSandboxOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 top-14 border-t border-border bg-background">
            <Sandbox onClose={() => setSandboxOpen(false)} runTarget={runTarget} targetKey={targetKey} />
          </div>
        </div>
      )}
    </div>

    {/* Mobile sidebar */}
    <SheetContent side="left" className="w-72 p-0">
      <SheetTitle className="sr-only">Menu</SheetTitle>
      {sidebar}
    </SheetContent>

    {/* Settings */}
    <SettingsDialog
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
      onSaved={() => void refreshModels()}
    />

    {/* Plugins & Skills */}
    <PluginsDialog open={pluginsOpen} onOpenChange={setPluginsOpen} />

    {/* How Zenbox works */}
    <HowItWorksDialog open={howWorksOpen} onOpenChange={setHowWorksOpen} />

    {/* Update release notes */}
    <UpdateNoticeDialog
      open={noticeOpen}
      onOpenChange={(o) => {
        setNoticeOpen(o);
        if (!o) markSeen();
      }}
      update={latestUpdate}
      onDone={markSeen}
    />

    {/* Send code to your inbox */}
    <Dialog open={emailDraft !== null} onOpenChange={(o) => { if (!o) setEmailDraft(null); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-4" />
            Email this code
          </DialogTitle>
          <DialogDescription>
            Sends {emailDraft?.filename ?? "code"} to your inbox as a text file.
          </DialogDescription>
        </DialogHeader>
        {emailDraft && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-to">Recipient</Label>
              <Input
                id="email-to"
                type="email"
                value={emailDraft.to}
                onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })}
                placeholder="you@example.com"
                className="h-9 font-mono text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-subject">Subject</Label>
              <Input
                id="email-subject"
                value={emailDraft.subject}
                onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                className="h-9 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email-body">Note (optional)</Label>
              <Textarea
                id="email-body"
                value={emailDraft.body}
                onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })}
                rows={4}
                className="font-mono text-[12px] leading-5"
                placeholder="The code content…"
              />
            </div>
            <p className="rounded-sm border border-border/70 bg-muted/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              Sent via Resend (free tier). If no RESEND_API_KEY is configured, add one in the project Keys tab.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="h-9 text-xs" onClick={() => setEmailDraft(null)} disabled={emailSending}>
            Cancel
          </Button>
          <Button type="button" className="h-9 gap-1.5 text-xs" onClick={() => void handleSendEmail()} disabled={emailSending}>
            {emailSending ? <Loader2 className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
            {emailSending ? "Sending…" : "Send code"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </Sheet>
  );
}
