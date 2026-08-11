import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { AdminUserRow } from "@/convex/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Markdown } from "@/components/workspace/markdown";
import { AppearancePrefs } from "@/components/AppearancePrefs";
import { LiveWallpaper } from "@/components/LiveWallpaper";
import { UpdateNoticeBanner, UpdateNoticeDialog, useUpdateNotice } from "@/components/UpdateNotice";
import { CODEBASE_MAP } from "@/lib/codebase-map";
import { PROMPT_TEMPLATE } from "@/lib/prompt-template";
import { cn } from "@/lib/utils";
import { useSessionReport } from "@/hooks/use-session-report";
import { AnimatePresence, motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Globe,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  Megaphone,
  Rocket,
  Send,
  Bell,
  Settings,
  ShieldCheck,
  AlertTriangle,
  ClipboardList,
  Smartphone,
  Sparkles,
  Terminal,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Phase = "idle" | "plan" | "revise" | "review" | "verify" | "done" | "error";

type VerifyStatus = { title: string; status: string; note: string };
type Tab = "pipeline" | "monitor" | "history";
type Change = { title: string; detail: string };
type ActivityItem = {
  _id: string;
  content: string;
  model: string | null;
  createdAt: number;
  conversationTitle: string;
  userName: string;
  isGuest: boolean;
  ip?: string;
  device?: string;
};

const STEPS = [
  { id: "plan", label: "Plan" },
  { id: "revise", label: "Revise" },
  { id: "review", label: "Review" },
  { id: "verify", label: "Verify" },
  { id: "ship", label: "Ship" },
] as const;

const PHASE_STATUS: Record<"plan" | "revise" | "review" | "verify", string> = {
  plan: "Planning — scanning the app and drafting an implementation plan…",
  revise: "Revising — sharpening the plan into a final specification…",
  review: "Reviewing — checking for errors, risks, and missing pieces…",
  verify: "Verifying — checking every change against the actual codebase…",
};

const SUGGESTIONS = [
  "Make the app better",
  "Fix the error: conversations don't load",
  "Improve the settings page",
  "Add more animations to the studio",
];

function stepIndex(phase: Phase): number {
  if (phase === "plan") return 0;
  if (phase === "revise") return 1;
  if (phase === "review") return 2;
  if (phase === "verify") return 3;
  if (phase === "done") return 4;
  return -1;
}

function stepDone(phase: Phase, i: number): boolean {
  if (phase === "revise" && i < 1) return true;
  if (phase === "review" && i < 2) return true;
  if (phase === "verify" && i < 3) return true;
  if (phase === "done" && i < 4) return true;
  return false;
}

function fmtElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A ticking "current time" — keeps render pure (no Date.now() in render). */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => 0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Per-change status chip for the Verify phase. */
function VerifyBadge({ status }: { status: string }) {
  const ok = status === "ok";
  const missing = status === "missing";
  return (
    <span
      className={cn(
        "mt-0.5 flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest",
        ok
          ? "border-foreground/40 bg-foreground text-background"
          : missing
            ? "border-destructive/40 bg-destructive/10 text-destructive"
            : "border-border/80 bg-muted/40 text-muted-foreground",
      )}
    >
      {ok ? <Check className="size-2.5" /> : missing ? <X className="size-2.5" /> : <AlertTriangle className="size-2.5" />}
      {ok ? "ok" : missing ? "missing" : "review"}
    </span>
  );
}

function StatCard({ label, value, live }: { label: string; value?: number; live?: boolean }) {
  return (
    <div className="rounded-md border border-border/80 p-3.5">
      <p className="text-xl font-semibold tracking-tight sm:text-2xl">{value?.toLocaleString() ?? "–"}</p>
      <p className="mt-1 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {live && <span className="size-1.5 animate-pulse rounded-full bg-foreground" />}
        {label}
      </p>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
  dot,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  dot?: boolean;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 rounded-t-sm border-b-2 px-3.5 py-2.5 text-[12px] font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn(active ? "text-foreground" : "text-muted-foreground/70")}>{icon}</span>
      {children}
      {dot && <span className="ml-0.5 size-1.5 animate-pulse rounded-full bg-foreground" />}
      {count !== undefined && (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Monitor — live roster of everyone connected + the search feed
// ---------------------------------------------------------------------------

function MonitorTab({
  users,
  activity,
  announcements,
  broadcastText,
  broadcasting,
  onBroadcastChange,
  onBroadcast,
}: {
  users: AdminUserRow[] | undefined;
  activity: ActivityItem[] | undefined;
  announcements: Array<{ _id: string; text: string; createdAt: number }> | undefined;
  broadcastText: string;
  broadcasting: boolean;
  onBroadcastChange: (text: string) => void;
  onBroadcast: () => void;
}) {
  const now = useNow();
  const liveNow = (users ?? []).filter((u) => u.lastActiveAt && now - u.lastActiveAt < 5 * 60_000).length;

  const accessRequests = useQuery(api.admin.requests);
  const approveRequest = useMutation(api.admin.approveRequest);
  const denyRequest = useMutation(api.admin.denyRequest);
  const [granted, setGranted] = useState<{ requestId: string; code: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingRequests = (accessRequests ?? []).filter((r) => r.status === "pending");

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-8">
      {/* Access requests — guests asking the developer for a token */}
      {pendingRequests.length > 0 && (
        <div className="rounded-md border border-border/80 p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-3.5 text-muted-foreground" />
            <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Access requests · {pendingRequests.length} waiting
            </p>
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {pendingRequests.map((r) => (
              <div key={r._id} className="rounded-sm border border-border/70 px-3 py-2">
                <p className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="font-medium">{r.name ?? r.requesterName}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(r.createdAt, { addSuffix: true })}
                  </span>
                </p>
                {r.message && (
                  <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">“{r.message}”</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    className="h-6 gap-1 text-[10px]"
                    disabled={busyId === r._id}
                    onClick={() => {
                      setBusyId(r._id);
                      void approveRequest({ requestId: r._id as never })
                        .then(({ code }) => {
                          setGranted({ requestId: r._id, code });
                          toast.success("Approved — the guest now has access.");
                        })
                        .catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : "Could not approve"),
                        )
                        .finally(() => setBusyId(null));
                    }}
                  >
                    {busyId === r._id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 gap-1 text-[10px] text-muted-foreground"
                    disabled={busyId === r._id}
                    onClick={() => {
                      setBusyId(r._id);
                      void denyRequest({ requestId: r._id as never })
                        .then(() => toast.success("Request denied."))
                        .catch((err: unknown) =>
                          toast.error(err instanceof Error ? err.message : "Could not deny"),
                        )
                        .finally(() => setBusyId(null));
                    }}
                  >
                    <X className="size-3" />
                    Deny
                  </Button>
                  {granted?.requestId === r._id && (
                    <code className="rounded-sm border border-foreground/30 bg-muted px-2 py-1 font-mono text-[10px] font-semibold tracking-widest">
                      {granted.code}
                    </code>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Broadcast — announce to every studio user */}
      <div className="rounded-md border border-border/80 p-4">
        <div className="flex items-center gap-2">
          <Megaphone className="size-3.5 text-muted-foreground" />
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Broadcast · to every studio user
          </p>
        </div>
        <div className="mt-2.5 flex items-end gap-2">
          <textarea
            value={broadcastText}
            onChange={(e) => onBroadcastChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onBroadcast();
              }
            }}
            rows={1}
            placeholder="Heads-up: scheduled maintenance tonight 10 PM — replies may pause briefly."
            className="max-h-28 min-h-[38px] flex-1 resize-none rounded-sm border border-border/80 bg-transparent px-3 py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground/60 focus:border-foreground/40"
          />
          <Button
            type="button"
            size="sm"
            className="h-9 shrink-0 gap-1.5 text-xs"
            onClick={onBroadcast}
            disabled={broadcasting || !broadcastText.trim()}
          >
            {broadcasting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Every signed-in studio user sees it as a dismissible banner. Recent broadcasts:
        </p>
        {announcements !== undefined && announcements.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">            {announcements.slice(0, 3).map((a) => (
              <div key={a._id} className="flex items-center gap-2 rounded-sm border border-border/60 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">“{a.text}”</span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {formatDistanceToNow(a.createdAt, { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Roster */}
      <div>
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            {liveNow > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/40" />}
            <span className={cn("relative inline-flex size-2 rounded-full", liveNow > 0 ? "bg-foreground" : "bg-muted-foreground/40")} />
          </span>
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Live roster · {liveNow} online now
          </p>
        </div>

        {users === undefined ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <p className="mt-3 rounded-md border border-border/70 py-8 text-center text-[12px] text-muted-foreground">
            No users connected yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {users.map((u) => {
              const label = u.guestName ?? u.email ?? u.name ?? "Anonymous";
              const live = Boolean(u.lastActiveAt && now - u.lastActiveAt < 5 * 60_000);
              return (
                <div
                  key={u._id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3.5 py-3 transition-colors",
                    live ? "border-foreground/40" : "border-border/80",
                  )}
                >
                  <span className="relative flex size-2 shrink-0">
                    {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/40" />}
                    <span className={cn("relative inline-flex size-2 rounded-full", live ? "bg-foreground" : "bg-muted-foreground/30")} />
                  </span>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-[10px] font-semibold text-background">
                    {label.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[13px] font-medium">{label}</p>
                      {u.isAnonymous && (
                        <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">
                          Guest
                        </Badge>
                      )}
                      {u.role === "admin" && (
                        <Badge className="h-5 rounded-sm bg-foreground px-1.5 text-[9px] font-normal text-background">Admin</Badge>
                      )}
                      {u.isAnonymous && !u.hasAccessToken && (
                        <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">No code</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Globe className="size-3 shrink-0" />
                      <span className="font-mono">{u.lastIp ?? "no IP yet"}</span>
                      {u.lastDevice && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="truncate">{u.lastDevice}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("text-[10px]", live ? "text-foreground" : "text-muted-foreground/60")}>
                      {u.lastActiveAt ? (live ? "online now" : `seen ${formatDistanceToNow(u.lastActiveAt, { addSuffix: true })}`) : "never"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                      {u.conversationCount} chats · {u.messageCount} msgs
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Search feed */}
      <div>
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Live search feed</p>
        </div>
        {activity === undefined ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : activity.length === 0 ? (
          <p className="mt-3 rounded-md border border-border/70 py-8 text-center text-[12px] text-muted-foreground">
            Nothing searched yet.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-1.5">
            {activity.slice(0, 25).map((a) => (
              <div key={a._id} className="rounded-md border border-border/80 px-3.5 py-3">
                <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{a.userName}</span>
                  {a.isGuest && (
                    <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">Guest</Badge>
                  )}
                  <span>·</span>
                  <span className="truncate">{a.conversationTitle}</span>
                  {a.ip && (
                    <>
                      <span>·</span>
                      <span className="flex items-center gap-1 font-mono">
                        <Globe className="size-3" />
                        {a.ip}
                      </span>
                    </>
                  )}
                  <span className="ml-auto shrink-0">{formatDistanceToNow(a.createdAt, { addSuffix: true })}</span>
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-foreground/90">{a.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// History — every planned and shipped update
// ---------------------------------------------------------------------------

function HistoryTab({ history }: { history: Doc<"updates">[] | undefined }) {
  const [openId, setOpenId] = useState<Id<"updates"> | null>(null);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
      {history === undefined ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : history.length === 0 ? (
        <p className="rounded-md border border-border/70 py-10 text-center text-[12px] text-muted-foreground">
          No updates yet — run your first command in the Pipeline tab.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {history.map((u) => {
            const open = openId === u._id;
            return (
              <div key={u._id} className={cn("rounded-md border transition-colors", open ? "border-foreground/40" : "border-border/80")}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : u._id)}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="w-14 shrink-0 font-mono text-[12px] font-semibold">v{u.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{u.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {u.changes.length} changes ·{" "}
                      {new Date(u.shippedAt ?? u.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest",
                      u.status === "shipped"
                        ? "border-foreground/40 bg-foreground text-background"
                        : u.status === "reviewed"
                          ? "border-border/70 text-muted-foreground"
                          : "border-border/70 text-muted-foreground/60",
                    )}
                  >
                    {u.status === "shipped" ? (
                      <span className="flex items-center gap-1">
                        <Rocket className="size-2.5" />
                        Shipped
                      </span>
                    ) : (
                      u.status
                    )}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-border/70 px-3.5 py-3.5">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Command</p>
                    <p className="mt-1 font-mono text-[12px] text-foreground/85">“{u.command}”</p>
                    <p className="mt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Review verdict</p>
                    <p className="mt-1 text-[13px] leading-6 text-foreground/85">{u.verdict}</p>
                    {u.apkUrl && (
                      <p className="mt-2 flex items-center gap-1.5 rounded-sm border border-border/60 px-2.5 py-1.5 text-[11px]">
                        <Globe className="size-3 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">APK build:</span>
                        <a
                          href={u.apkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate font-mono text-[10px] text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
                        >
                          {u.apkUrl}
                        </a>
                      </p>
                    )}
                    {u.verifyPerChange && u.verifyPerChange.length > 0 && (
                      <>
                        <p className="mt-4 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                          Verification
                          <span
                            className={cn(
                              "ml-2 inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest",
                              u.verifyOverall === "pass"
                                ? "border-foreground/40 bg-foreground text-background"
                                : "border-destructive/40 bg-destructive/10 text-destructive",
                            )}
                          >
                            {u.verifyOverall === "pass" ? (
                              <ShieldCheck className="size-2.5" />
                            ) : (
                              <AlertTriangle className="size-2.5" />
                            )}
                            {u.verifyOverall === "pass" ? "all clear" : "attention"}
                          </span>
                        </p>
                        <div className="mt-2 flex flex-col gap-1.5">
                          {u.verifyPerChange.map((vc, i) => (
                            <div
                              key={`${vc.title}-${i}`}
                              className="flex items-start gap-2.5 rounded-sm border border-border/70 px-3 py-2"
                            >
                              <span className="mt-px font-mono text-[10px] text-muted-foreground/60">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-medium">{vc.title}</p>
                                {vc.note && (
                                  <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{vc.note}</p>
                                )}
                              </div>
                              <VerifyBadge status={vc.status} />
                            </div>
                          ))}
                        </div>
                        {u.verifyGaps && u.verifyGaps.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1">
                            {u.verifyGaps.map((g, i) => (
                              <li key={i} className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground">
                                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
                                {g}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                    <p className="mt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Changes · {u.changes.length}</p>
                    <div className="mt-2 space-y-1.5">
                      {u.changes.map((c, i) => (
                        <div key={`${c.title}-${i}`} className="flex items-start gap-2.5 rounded-sm border border-border/70 px-3 py-2">
                          <span className="mt-px font-mono text-[10px] text-muted-foreground/60">{String(i + 1).padStart(2, "0")}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium">{c.title}</span>
                            {c.detail && <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">{c.detail}</span>}
                          </span>
                          <Check className="mt-0.5 size-3.5 shrink-0 text-foreground/70" />
                        </div>
                      ))}
                    </div>
                    {u.releaseNotes && (
                      <>
                        <p className="mt-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Release notes</p>
                        <div className="mt-1 text-[13px] leading-6 text-foreground/85">
                          <Markdown content={u.releaseNotes} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// The Control room
// ---------------------------------------------------------------------------

export default function Updater() {
  useSessionReport();

  const history = useQuery(api.updates.history);
  const overview = useQuery(api.admin.overview);
  const users = useQuery(api.admin.users);
  const activity = useQuery(api.admin.activity) as ActivityItem[] | undefined;
  const announcementHistory = useQuery(api.announcements.history);
  const sendAnnouncement = useMutation(api.announcements.sendAnnouncement);

  const [broadcastText, setBroadcastText] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const { latest: latestUpdate, unseen: hasUpdate, markSeen } = useUpdateNotice();
  const [noticeOpen, setNoticeOpen] = useState(false);

  const handleBroadcast = async () => {
    const text = broadcastText.trim();
    if (!text || broadcasting) return;
    setBroadcasting(true);
    try {
      await sendAnnouncement({ text });
      setBroadcastText("");
      toast.success("Broadcast sent — every studio user sees it.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the broadcast");
    } finally {
      setBroadcasting(false);
    }
  };

  const planUpdate = useAction(api.updates.planUpdate);
  const reviseUpdate = useAction(api.updates.reviseUpdate);
  const reviewUpdate = useAction(api.updates.reviewUpdate);
  const verifyUpdate = useAction(api.updates.verifyUpdate);
  const createDraft = useMutation(api.updates.createDraft);
  const shipUpdate = useMutation(api.updates.shipUpdate);

  const [tab, setTab] = useState<Tab>("pipeline");

  const [command, setCommand] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const [plan, setPlan] = useState("");
  const [revised, setRevised] = useState("");
  const [review, setReview] = useState("");
  const [verdict, setVerdict] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [verifyOverall, setVerifyOverall] = useState<"pass" | "review" | null>(null);
  const [verifyPerChange, setVerifyPerChange] = useState<VerifyStatus[]>([]);
  const [verifyGaps, setVerifyGaps] = useState<string[]>([]);
  const [draftId, setDraftId] = useState<Id<"updates"> | null>(null);
  const [phaseLog, setPhaseLog] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  const pushLog = (msg: string) => setPhaseLog((p) => [...p, msg]);

  const [includeNotes, setIncludeNotes] = useState(true);
  // Optional hosted APK — when set, the Android apps download and install this
  // real .apk when users tap Update instead of the web flow. apkFor says which
  // app that APK belongs to (studio | control), so neither app ever installs
  // the other's binary.
  const [apkUrl, setApkUrl] = useState("");
  const [apkFor, setApkFor] = useState<"studio" | "control">("studio");
  const [shipping, setShipping] = useState(false);
  const [shipped, setShipped] = useState(false);
  const [mega, setMega] = useState(true);

  // Elapsed-time ticker while the pipeline runs.
  useEffect(() => {
    if (!["plan", "revise", "review", "verify"].includes(phase) || startedAt === 0) return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => window.clearInterval(t);
  }, [phase, startedAt]);

  const reset = () => {
    setPhase("idle");
    setError(null);
    setPlan("");
    setRevised("");
    setReview("");
    setVerdict("");
    setChanges([]);
    setVerifyOverall(null);
    setVerifyPerChange([]);
    setVerifyGaps([]);
    setDraftId(null);
    setShipped(false);
    setPhaseLog([]);
    setLogOpen(false);
  };

  const run = async (raw?: string) => {
    const c = (raw ?? command).trim();
    if (!c || phase === "plan" || phase === "revise" || phase === "review" || phase === "verify") return;
    reset();
    setCommand(c);
    setStartedAt(Date.now());
    setElapsed(0);

    try {
      pushLog("Phase 1: Planning — scanning the app and drafting an implementation plan…");
      setPhase("plan");
      const p = await planUpdate({ command: c, mega });
      if (p.error) throw new Error(p.error);
      setPlan(p.plan);
      const stepCount = p.plan.split("\n").filter((l) => /^\d+[.)\s]/.test(l.trim())).length;
      pushLog(`✓ Plan complete ${stepCount || "several"} actionable steps.`);

      pushLog("Phase 2: Revising — sharpening the plan into a final specification…");
      setPhase("revise");
      const r = await reviseUpdate({ command: c, plan: p.plan, mega });
      if (r.error) throw new Error(r.error);
      setRevised(r.revised);
      pushLog("✓ Revised spec complete — every change now has a concrete implementation path.");

      pushLog("Phase 3: Reviewing — checking for errors, risks, and missing pieces…");
      setPhase("review");
      const rev = await reviewUpdate({ command: c, revised: r.revised, mega });
      if (rev.error) throw new Error(rev.error);
      setReview(rev.review);
      setVerdict(rev.verdict);
      setChanges(rev.changes);
      pushLog(`✓ Review complete ${rev.changes.length} changes identified.`);

      pushLog("Phase 4: Verifying — checking every change against the actual codebase…");
      setPhase("verify");
      const vrf = await verifyUpdate({
        command: c,
        revised: r.revised,
        changes: rev.changes,
        codebaseMap: CODEBASE_MAP,
      });
      if (vrf.error) throw new Error(vrf.error);
      setVerifyOverall(vrf.overall);
      setVerifyPerChange(vrf.perChange);
      setVerifyGaps(vrf.gaps);
      const needAttention = vrf.perChange.filter((x) => x.status !== "ok").length;
      pushLog(
        vrf.overall === "pass"
          ? `✓ Verify complete — ${vrf.perChange.length} changes checked, all clear.`
          : `✓ Verify complete — ${vrf.perChange.length} changes checked, ${needAttention} need attention before shipping.`,
      );

      const id = await createDraft({
        title: c,
        command: c,
        plan: p.plan,
        revised: r.revised,
        review: rev.review,
        verdict: rev.verdict,
        changes: rev.changes,
        verifyOverall: vrf.overall,
        verifyPerChange: vrf.perChange,
        verifyGaps: vrf.gaps,
      });
      setDraftId(id);
      pushLog("✓ Draft created — ready to ship to all studio users.");
      setPhase("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Analysis failed. Try again.";
      pushLog(`✗ Error: ${msg}`);
      setError(msg);
      setPhase("error");
    }
  };

  const ship = async () => {
    if (!draftId || shipping) return;
    setShipping(true);
    try {
      await shipUpdate({
        updateId: draftId,
        includeNotes,
        apkUrl: apkUrl.trim() || undefined,
        apkFor: apkUrl.trim() ? apkFor : undefined,
      });
      setShipped(true);
      toast.success("Update published — every studio user has been notified.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not ship the update");
    } finally {
      setShipping(false);
    }
  };

  const running = phase === "plan" || phase === "revise" || phase === "review" || phase === "verify";
  const activeIdx = stepIndex(phase);
  const latestVersion = history?.[0]?.version;
  // createDraft bumps the version by one on the backend, so the next release
  // the developer is about to ship is always latest + 1.
  const shipVersion = (latestVersion ?? 0) + 1;
  const now = useNow();
  const liveNow = (users ?? []).filter((u) => u.lastActiveAt && now - u.lastActiveAt < 5 * 60_000).length;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <LiveWallpaper />
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-[0.3em]">ZENBOX</span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Control</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-muted-foreground" title="Appearance">
              <Settings className="size-3.5" />
              <span className="hidden sm:inline">Settings</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72">
            <p className="mb-2.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Control appearance
            </p>
            <AppearancePrefs />
          </PopoverContent>
        </Popover>
        <span
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-sm border border-border/70 px-2 py-1 text-[10px] font-medium uppercase tracking-widest",
            liveNow > 0 ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span className={cn("size-1.5 rounded-full", liveNow > 0 ? "animate-pulse bg-foreground" : "bg-muted-foreground/50")} />
          {liveNow > 0 ? `${liveNow} online` : "offline"}
        </span>
        <span className="rounded-sm border border-border/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          {latestVersion ? `v${latestVersion} latest` : "v1 next"}
        </span>
        {hasUpdate && latestUpdate && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="relative size-8 text-muted-foreground"
            title="A new update has arrived"
            onClick={() => setNoticeOpen(true)}
          >
            <Bell className="size-4" />
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-foreground" />
          </Button>
        )}
        {/* The studio link only exists when running inside the studio app — the
            standalone Control APK has no dashboard route. */}
        {typeof document !== "undefined" && document.documentElement.dataset.app !== "control" && (
          <Link to="/dashboard">
            <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              Open studio
              <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        )}
      </header>

      {/* Shipped update notice — the Control app receives its own updates too */}
      {hasUpdate && latestUpdate && (
        <UpdateNoticeBanner
          update={latestUpdate}
          onWhatNew={() => setNoticeOpen(true)}
          onDismiss={markSeen}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-5 pb-16 pt-10 sm:px-6">
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
              <Terminal className="size-3.5" />
              Developer console
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-sm border border-foreground/20 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-foreground/80">
                next release · v{shipVersion}
              </span>
              <span className="rounded-sm border border-border/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {shipped ? "shipped ✓" : running ? "running…" : phase === "done" ? "ready to ship" : "idle"}
              </span>
            </div>
            <h1 className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Command your app. Ship better.
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              Chat with the AI about what to improve — it plans, revises, and reviews every change. Approve
              the result and publish with one click; every user is notified.
            </p>
          </motion.div>

          {/* Live stats */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            <StatCard label="Users" value={overview?.users} />
            <StatCard label="Guests" value={overview?.guests} />
            <StatCard label="Active sessions" value={overview?.activeSessions} />
            <StatCard label="Online now" value={liveNow} live />
          </motion.div>

          {/* Tabs */}
          <div className="mt-8 flex gap-1 border-b border-border/70">
            <TabBtn active={tab === "pipeline"} onClick={() => setTab("pipeline")} icon={<Wand2 className="size-3.5" />}>
              Pipeline
            </TabBtn>
            <TabBtn active={tab === "monitor"} onClick={() => setTab("monitor")} icon={<Activity className="size-3.5" />} dot={liveNow > 0}>
              Monitor
            </TabBtn>
            <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={<History className="size-3.5" />} count={history?.length ?? 0}>
              History
            </TabBtn>
          </div>

          {/* ---- Pipeline tab ---- */}
          {tab === "pipeline" && (
            <div>
              {/* Composer */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="mt-6"
              >
                <div
                  className={cn(
                    "rounded-md border border-border bg-white p-3 shadow-sm transition-shadow dark:bg-neutral-950",
                    running && "animate-pulse border-foreground/30",
                  )}
                >
                  <textarea
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void run();
                      }
                    }}
                    rows={2}
                    placeholder="Command the AI — e.g. “make the app better”, “fix the error: …”"
                    className="max-h-36 min-h-12 w-full resize-none bg-transparent px-2 py-1 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/70"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-2 px-1 text-[11px] text-muted-foreground">
                      <Switch checked={mega} onCheckedChange={setMega} />
                      <span className="flex items-center gap-1">
                        <Sparkles className="size-3" />
                        Mega update
                      </span>
                      <span className="hidden text-[10px] text-muted-foreground/60 sm:inline">— full overhaul, 12–20 changes</span>
                    </label>
                    <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground/60 sm:flex">
                      <kbd className="rounded-sm border border-border/70 px-1 py-px font-mono text-[9px]">Enter</kbd>
                      to run
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setCommand((prev) => (prev.trim() ? `${prev.trim()}\n\n` : "") + PROMPT_TEMPLATE)
                      }
                      disabled={running}
                      className="flex items-center gap-1 rounded-sm border border-border/70 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
                      title="Insert the structured Goal / Context / Constraints / Done-when prompt template"
                    >
                      <ClipboardList className="size-3" />
                      Structured
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      disabled={running || !command.trim()}
                      onClick={() => void run()}
                    >
                      {running ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                      {running ? "Working…" : "Start analysis"}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setCommand(s);
                        void run(s);
                      }}
                      disabled={running}
                      className="rounded-sm border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
                    >
                      <Sparkles className="mr-1 inline size-3" />
                      {s}
                    </button>
                  ))}
                </div>
              </motion.div>

              {/* Pipeline stepper */}
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }} className="mt-9 flex items-center gap-2">
                {STEPS.map((s, i) => {
                  const active = i === activeIdx && !error;
                  const done = stepDone(phase, i) || shipped || (phase === "error" && i < activeIdx);
                  const failed = phase === "error" && i === activeIdx;
                  return (
                    <div key={s.id} className="flex flex-1 items-center gap-2">
                      <div className="flex flex-col items-center gap-1.5">
                        <motion.div
                          animate={
                            active
                              ? { scale: [1, 1.14, 1], boxShadow: ["0 0 0 0 rgba(0,0,0,0.15)", "0 0 0 6px rgba(0,0,0,0)", "0 0 0 0 rgba(0,0,0,0)"] }
                              : { scale: 1 }
                          }
                          transition={active ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : { duration: 0.2 }}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                            done && "border-foreground bg-foreground text-background",
                            active && !done && "border-foreground bg-background text-foreground",
                            failed && "border-destructive text-destructive",
                            !done && !active && !failed && "border-border/80 text-muted-foreground",
                          )}
                        >
                          {done ? (
                            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 25 }}>
                              <Check className="size-3.5" />
                            </motion.span>
                          ) : failed ? (
                            <X className="size-3.5" />
                          ) : active ? (
                            <CircleDot className="size-3.5 animate-spin [animation-duration:2.5s]" />
                          ) : (
                            i + 1
                          )}
                        </motion.div>
                        <span
                          className={cn(
                            "text-[10px] font-medium uppercase tracking-widest",
                            done ? "text-foreground" : active ? "text-foreground" : failed ? "text-destructive" : "text-muted-foreground/60",
                          )}
                        >
                          {s.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <span className={cn("mb-5 h-px flex-1", done || i < activeIdx ? "bg-foreground/60" : "bg-border/70")} />
                      )}
                    </div>
                  );
                })}
              </motion.div>

              {/* Status line */}
              <AnimatePresence mode="wait">
                {running && (
                  <motion.div
                    key="running"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-6 flex items-center gap-3 rounded-md border border-border/80 px-4 py-3"
                  >
                    <Brain className="size-3.5 animate-pulse" />
                    <span className="flex gap-1">
                      {[0, 150, 300].map((d) => (
                        <span key={d} className="size-1.5 animate-pulse rounded-full bg-foreground" style={{ animationDelay: `${d}ms` }} />
                      ))}
                    </span>
                    <span className="flex-1 text-[13px] text-foreground/80">{PHASE_STATUS[phase as "plan" | "revise" | "review" | "verify"]}</span>
                    <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                      <Clock className="size-3" />
                      {fmtElapsed(elapsed)}
                    </span>
                  </motion.div>
                )}
                {/* Phase log — collapsible, shows pipeline progress details */}
                {phaseLog.length > 0 && (
                  <motion.div
                    key="log"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-3"
                  >
                    <button
                      type="button"
                      onClick={() => setLogOpen((o) => !o)}
                      className="flex w-full items-center gap-2 rounded-sm border border-border/80 px-3 py-2 text-left transition-colors hover:border-foreground/30"
                    >
                      <ListChecks className="size-3.5 text-muted-foreground" />
                      <span className="flex-1 text-[11px] font-medium text-foreground/80">
                        Pipeline log — {phaseLog.length} entries
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 text-muted-foreground transition-transform",
                          logOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {logOpen && (
                      <div className="mt-2 flex flex-col gap-1 rounded-sm border border-border/70 bg-muted/20 p-2.5">
                        {phaseLog.map((entry, i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex items-start gap-2 rounded-sm px-2 py-1 text-[11px] leading-5",
                              entry.startsWith("✗")
                                ? "text-destructive"
                                : entry.startsWith("✓")
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/60">{i + 1}.</span>
                            <span className="min-w-0 flex-1">{entry}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
                {phase === "error" && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-6 flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3"
                  >
                    <X className="size-4 shrink-0 text-destructive" />
                    <p className="flex-1 text-[13px] leading-5 text-destructive">{error}</p>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={reset}>
                      Retry
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Artifacts */}
              <AnimatePresence>
                {plan && (
                  <motion.div key="plan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Phase 01 · Plan</p>
                    <div className="mt-2 rounded-md border border-border/80 p-4">
                      <Markdown content={plan} />
                    </div>
                  </motion.div>
                )}
                {revised && (
                  <motion.div key="revised" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Phase 02 · Revised spec</p>
                    <div className="mt-2 rounded-md border border-border/80 p-4">
                      <Markdown content={revised} />
                    </div>
                  </motion.div>
                )}
                {review && (
                  <motion.div key="review" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Phase 03 · Critical review</p>
                    <div className="mt-2 rounded-md border border-border/80 p-4">
                      <p className="text-[13px] leading-6 text-foreground/85">{verdict}</p>
                      {changes.length > 0 && (
                        <div className="mt-4 border-t border-border/70 pt-3">
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Changes to ship · {changes.length}
                          </p>
                          <div className="mt-2.5 space-y-1.5">
                            {changes.map((c, i) => (
                              <motion.div
                                key={`${c.title}-${i}`}
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: 0.05 * i }}
                                className="flex items-start gap-2.5 rounded-sm border border-border/70 px-3 py-2"
                              >
                                <span className="mt-px font-mono text-[10px] text-muted-foreground/60">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] font-medium">{c.title}</span>
                                  {c.detail && (
                                    <span className="mt-0.5 block text-[12px] leading-5 text-muted-foreground">{c.detail}</span>
                                  )}
                                </span>
                                <Check className="mt-0.5 size-3.5 shrink-0 text-foreground/70" />
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Verification results — the Verify phase output, per change */}
              <AnimatePresence>
                {verifyPerChange.length > 0 && (
                  <motion.div
                    key="verify"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6"
                  >
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      Phase 04 · Verification
                    </p>
                    <div
                      className={cn(
                        "mt-2 rounded-md border p-4",
                        verifyOverall === "pass" ? "border-foreground/30" : "border-destructive/30 bg-destructive/[0.03]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {verifyOverall === "pass" ? (
                          <ShieldCheck className="size-3.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                        )}
                        <p className="text-[13px] font-medium">
                          {verifyOverall === "pass"
                            ? "All changes verified against the real codebase — safe to ship."
                            : "Attention needed — some changes don't check out against the codebase."}
                        </p>
                      </div>
                      <div className="mt-3 flex flex-col gap-1.5">
                        {verifyPerChange.map((vc, i) => (
                          <div
                            key={`${vc.title}-${i}`}
                            className="flex items-start gap-2.5 rounded-sm border border-border/70 px-3 py-2"
                          >
                            <span className="mt-px font-mono text-[10px] text-muted-foreground/60">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-medium">{vc.title}</p>
                              {vc.note && (
                                <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{vc.note}</p>
                              )}
                            </div>
                            <VerifyBadge status={vc.status} />
                          </div>
                        ))}
                      </div>
                      {verifyGaps.length > 0 && (
                        <div className="mt-3 border-t border-border/70 pt-3">
                          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                            Gaps flagged
                          </p>
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {verifyGaps.map((g, i) => (
                              <li
                                key={i}
                                className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground"
                              >
                                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
                                {g}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Ship section */}
              <AnimatePresence>
                {phase === "done" && (
                  <motion.div
                    key="ship"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-9 rounded-md border border-foreground/30 p-5"
                  >
                    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                      <div>
                        <p className="text-[13px] font-semibold">Ready to publish</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {changes.length} changes · every studio user will be notified on their next load.
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                          <Switch checked={includeNotes} onCheckedChange={setIncludeNotes} />
                          Release notes
                        </label>
                        <Button type="button" size="lg" className="gap-2 px-6" onClick={() => void ship()} disabled={shipping || shipped}>
                          {shipping ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                          {shipping ? "Publishing…" : `Ship update v${shipVersion}`}
                        </Button>
                      </div>
                    </div>
                    {/* Optional APK for the Android apps — ships with the update */}
                    <div className="mt-4 flex items-center gap-2 rounded-sm border border-border/70 px-3 py-2">
                      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        value={apkUrl}
                        onChange={(e) => setApkUrl(e.target.value)}
                        placeholder="APK download URL (optional) — e.g. https://github.com/…/zenbox-v7.apk"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        className="h-7 min-w-0 flex-1 bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                      {apkUrl.trim() && !/\.apk(\?|#|$)/i.test(apkUrl.trim()) && (
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                          <AlertTriangle className="size-3 text-destructive/70" />
                          URL doesn't end in .apk
                        </span>
                      )}
                    </div>
                    {apkUrl.trim() && (
                      <div className="mt-2 flex items-center gap-2 rounded-sm border border-border/70 px-3 py-2">
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                          This APK is for
                        </span>
                        <div className="flex overflow-hidden rounded-sm border border-border/80">
                          <button
                            type="button"
                            onClick={() => setApkFor("studio")}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors",
                              apkFor === "studio" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <Smartphone className="size-3" />
                            Studio
                          </button>
                          <button
                            type="button"
                            onClick={() => setApkFor("control")}
                            className={cn(
                              "flex items-center gap-1.5 border-l border-border/80 px-2.5 py-1 text-[11px] font-medium transition-colors",
                              apkFor === "control" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <Terminal className="size-3" />
                            Control
                          </button>
                        </div>
                        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-muted-foreground/70">
                          {apkFor === "control"
                            ? "Zenbox Control APK users download & install this file"
                            : "Zenbox Studio APK users download & install this file"}
                        </span>
                      </div>
                    )}
                    {shipping && (
                      <div className="mt-4 h-1 overflow-hidden rounded-full bg-border">
                        <motion.div
                          className="h-full bg-foreground"
                          initial={{ x: "-100%" }}
                          animate={{ x: "0%" }}
                          transition={{ duration: 1.4, ease: "easeInOut" }}
                        />
                      </div>
                    )}
                    {shipped && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 flex items-center gap-3 rounded-sm border border-border/70 bg-neutral-50 px-4 py-3 dark:bg-neutral-900/50"
                      >
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 20 }}
                          className="flex size-6 items-center justify-center rounded-full bg-foreground text-background"
                        >
                          <Check className="size-3.5" />
                        </motion.span>
                        <p className="flex-1 text-[13px] font-medium">
                          Update v{shipVersion} shipped — users have been notified.
                        </p>
                        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={reset}>
                          <Wand2 className="size-3" />
                          New command
                        </Button>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ---- Monitor tab ---- */}
          {tab === "monitor" && (
            <MonitorTab
              users={users}
              activity={activity}
              announcements={announcementHistory}
              broadcastText={broadcastText}
              broadcasting={broadcasting}
              onBroadcastChange={setBroadcastText}
              onBroadcast={() => void handleBroadcast()}
            />
          )}

          {/* ---- History tab ---- */}
          {tab === "history" && <HistoryTab history={history} />}

          {/* Update release dialog */}
          <UpdateNoticeDialog
            open={noticeOpen}
            onOpenChange={(o) => {
              setNoticeOpen(o);
              if (!o) markSeen();
            }}
            update={latestUpdate}
            onDone={markSeen}
          />

          {/* Footer */}
          <div className="mt-12 flex items-center justify-between border-t border-border/60 pt-5">
            <span className="text-[11px] text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3" />
              Developer-only — guests never see this screen.
            </span>
            <span className="hidden text-[11px] text-muted-foreground/60 sm:block">
              <Send className="mr-1 inline size-3" />
              Shipping notifies every studio user
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
