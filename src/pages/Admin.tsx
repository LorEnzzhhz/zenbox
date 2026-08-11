import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useSessionReport } from "@/hooks/use-session-report";
import { LiveWallpaper } from "@/components/LiveWallpaper";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/80 p-4">
      <p className="text-2xl font-semibold tracking-tight">{value.toLocaleString()}</p>
      <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}

function Overview() {
  const overview = useQuery(api.admin.overview);
  if (!overview) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="Users" value={overview.users} />
      <Stat label="Guests" value={overview.guests} />
      <Stat label="Conversations" value={overview.conversations} />
      <Stat label="Messages" value={overview.messages} />
      <Stat label="Messages today" value={overview.messagesToday} />
      <Stat label="Active sessions" value={overview.activeSessions} />
    </div>
  );
}

function UsersPanel() {
  const users = useQuery(api.admin.users);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<string | null>(null);

  if (!users) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {users.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No users yet.</p>}
      {users.map((u) => {
        const open = openUserId === u._id;
        const label = u.guestName ?? u.email ?? u.name ?? "Anonymous";
        return (
          <div key={u._id} className="rounded-md border border-border/80">
            <button
              type="button"
              onClick={() => {
                setOpenUserId(open ? null : u._id);
                setActiveConv(null);
              }}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-[10px] font-semibold text-background">
                {label.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-[13px] font-medium">{label}</p>
                  {u.isAnonymous && <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">Guest</Badge>}
                  {u.role === "admin" && <Badge className="h-5 rounded-sm bg-foreground px-1.5 text-[9px] font-normal text-background">Admin</Badge>}
                  {u.isAnonymous && !u.hasAccessToken && <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">No code</Badge>}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {u.conversationCount} chats · {u.messageCount} messages · {u.sessionCount} sessions
                  {u.lastActiveAt ? ` · active ${formatDistanceToNow(u.lastActiveAt, { addSuffix: true })}` : ""}
                </p>
                {(u.lastIp || u.lastDevice) && (
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                    <Globe className="size-3 shrink-0" />
                    <span className="font-mono">{u.lastIp ?? "no IP yet"}</span>
                    {u.lastDevice && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="truncate">{u.lastDevice}</span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
            </button>

            {open && (
              <div className="border-t border-border/70 px-3.5 py-3">
                {activeConv ? (
                  <ConversationTranscript conversationId={activeConv} onBack={() => setActiveConv(null)} />
                ) : (
                  <ConversationList userId={u._id} onOpen={setActiveConv} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConversationList({ userId, onOpen }: { userId: string; onOpen: (id: string) => void }) {
  const convs = useQuery(api.admin.userConversations, { userId: userId as never });
  if (!convs) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (convs.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">No conversations.</p>;
  return (
    <div className="space-y-1">
      {convs.map((c) => (
        <button
          key={c._id}
          type="button"
          onClick={() => onOpen(c._id)}
          className="flex w-full items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
        >
          <span className="truncate text-[13px]">{c.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {formatDistanceToNow(c.updatedAt, { addSuffix: true })}
          </span>
        </button>
      ))}
    </div>
  );
}

function ConversationTranscript({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const msgs = useQuery(api.admin.conversationMessages, { conversationId: conversationId as never });
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="size-3" /> back to conversations
      </button>
      {!msgs ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : msgs.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No messages.</p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {msgs.map((m) => (
            <div key={m._id} className="rounded-sm border border-border/60 p-2.5">
              <p className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                {m.role === "user" ? "Prompt" : "Reply"}
                {m.model && <span className="normal-case tracking-normal">{m.model}</span>}
                <span className="ml-auto normal-case tracking-normal">
                  {format(new Date(m.createdAt), "MMM d, HH:mm")}
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/85">
                {m.kind === "image" ? `[image] ${m.content}` : m.content}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityFeed() {
  const activity = useQuery(api.admin.activity);
  if (!activity) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (activity.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No guest activity yet.</p>;
  }
  return (
    <div className="space-y-2">
      {activity.map((a) => (
        <div key={a._id} className="rounded-md border border-border/80 p-3.5">
          <p className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{a.userName}</span>
            {a.isGuest && <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">Guest</Badge>}
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
          {a.model && <p className="mt-1 text-[10px] text-muted-foreground">model: {a.model}</p>}
        </div>
      ))}
    </div>
  );
}

function RequestsPanel() {
  const requests = useQuery(api.admin.requests);
  const approveRequest = useMutation(api.admin.approveRequest);
  const denyRequest = useMutation(api.admin.denyRequest);
  const [newCode, setNewCode] = useState<{ requestId: string; code: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      const { code } = await approveRequest({ requestId: id as never });
      setNewCode({ requestId: id, code });
      toast.success("Request approved — the guest now has access.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve the request");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeny = async (id: string) => {
    setBusyId(id);
    try {
      await denyRequest({ requestId: id as never });
      toast.success("Request denied.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not deny the request");
    } finally {
      setBusyId(null);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const pendingCount = (requests ?? []).filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-3">
      {requests === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : requests.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No access requests yet — guests who hit the gate can ask you for access.
        </p>
      ) : (
        requests.map((r) => {
          const pending = r.status === "pending";
          const showCode = newCode?.requestId === r._id;
          return (
            <div key={r._id} className="rounded-md border border-border/80 p-3.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{r.name ?? r.requesterName}</span>
                {r.isGuest && <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">Guest</Badge>}
                <span className="truncate">requested {formatDistanceToNow(r.createdAt, { addSuffix: true })}</span>
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest",
                    pending
                      ? "border-foreground/40 bg-foreground text-background"
                      : r.status === "approved"
                        ? "border-border/70 text-muted-foreground"
                        : "border-destructive/30 text-destructive",
                  )}
                >
                  {r.status}
                </span>
              </div>
              {r.message && (
                <p className="mt-2 text-[13px] leading-6 text-foreground/85">“{r.message}”</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pending ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 text-[11px]"
                      disabled={busyId === r._id}
                      onClick={() => void handleApprove(r._id)}
                    >
                      {busyId === r._id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                      Approve &amp; grant
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-[11px] text-muted-foreground"
                      disabled={busyId === r._id}
                      onClick={() => void handleDeny(r._id)}
                    >
                      <X className="size-3" />
                      Deny
                    </Button>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    {r.status === "approved"
                      ? `Granted${r.masked ? ` — code ${r.masked}` : ""} · ${r.hasAccess ? "guest has access" : "guest not linked"}`
                      : "Declined"}
                  </span>
                )}
                {showCode && newCode && (
                  <span className="flex items-center gap-2 rounded-sm border border-foreground/30 bg-muted px-2.5 py-1.5">
                    <KeyRound className="size-3.5" />
                    <code className="font-mono text-[12px] font-semibold tracking-widest">{newCode.code}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 text-[10px]"
                      onClick={() => void copyCode(newCode.code)}
                    >
                      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
      {pendingCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {pendingCount} pending request{pendingCount > 1 ? "s" : ""} — approving grants the guest instantly and
          also gives you a shareable code.
        </p>
      )}
    </div>
  );
}

function TokensPanel() {
  const tokens = useQuery(api.admin.tokens);
  const createToken = useMutation(api.admin.createToken);
  const toggleToken = useMutation(api.admin.toggleToken);
  const deleteToken = useMutation(api.admin.deleteToken);

  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(25);
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { code } = await createToken({ label, maxUses });
      setNewCode(code);
      setLabel("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the code");
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4">
      {/* Create */}
      <div className="rounded-md border border-border/80 p-4">
        <p className="text-[13px] font-semibold">Issue a guest access code</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label — e.g. Family, Friend A…"
            className="h-9 text-[13px]"
          />
          <Input
            type="number"
            min={1}
            max={500}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value) || 1)}
            className="h-9 w-28 text-[13px]"
            title="Max uses"
          />
          <Button type="button" className="h-9 gap-1.5 text-xs" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create code
          </Button>
        </div>
        {newCode && (
          <div className="mt-3 flex items-center gap-2 rounded-sm border border-foreground/30 bg-muted px-3 py-2.5">
            <KeyRound className="size-4 shrink-0" />
            <code className="flex-1 font-mono text-sm font-semibold tracking-widest">{newCode}</code>
            <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => void copyCode(newCode)}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          Share this code with a guest. It's shown once — copy it now.
        </p>
      </div>

      {/* List */}
      {!tokens ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : tokens.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No codes yet — create the first one above.</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t._id} className="flex items-center gap-3 rounded-md border border-border/80 px-3.5 py-3">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium">{t.label}</p>
                  <code className="font-mono text-[11px] text-muted-foreground">{t.masked}</code>
                  <Badge variant={t.enabled ? "default" : "outline"} className="h-5 rounded-sm px-1.5 text-[9px] font-normal">
                    {t.enabled ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t.usedCount} / {t.maxUses} used · created {formatDistanceToNow(t.createdAt, { addSuffix: true })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void toggleToken({ tokenId: t._id, enabled: !t.enabled })}
                className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={t.enabled ? "Disable code" : "Enable code"}
              >
                <RefreshCw className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void deleteToken({ tokenId: t._id })}
                className="flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                title="Delete code"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  useSessionReport();
  const [tab, setTab] = useState("overview");
  // Standalone Control APK has no studio route — its back target is the console.
  const isControl = typeof document !== "undefined" && document.documentElement.dataset.app === "control";

  return (
    <div className="relative flex min-h-dvh flex-col bg-background text-foreground">
      <LiveWallpaper />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => navigate(isControl ? "/" : "/dashboard")}
          title={isControl ? "Back to console" : "Back to studio"}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Shield className="size-4" />
          <span className="text-sm font-semibold tracking-[0.2em]">ADMIN</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:block">{user?.email ?? user?.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => void signOut().then(() => navigate("/"))}
          >
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-5 rounded-sm">
            <TabsTrigger value="overview" className="rounded-sm text-xs">Overview</TabsTrigger>
            <TabsTrigger value="users" className="rounded-sm text-xs">Users</TabsTrigger>
            <TabsTrigger value="activity" className="rounded-sm text-xs">Search log</TabsTrigger>
            <TabsTrigger value="codes" className="rounded-sm text-xs">Access codes</TabsTrigger>
            <TabsTrigger value="requests" className="rounded-sm text-xs">Requests</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <Overview />
          </TabsContent>
          <TabsContent value="users" className="mt-4">
            <UsersPanel />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <ActivityFeed />
          </TabsContent>
          <TabsContent value="codes" className="mt-4">
            <TokensPanel />
          </TabsContent>
          <TabsContent value="requests" className="mt-4">
            <RequestsPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border/70 px-4 py-3 text-center text-[11px] text-muted-foreground">
        <span className="font-semibold tracking-[0.25em]">ZENBOX</span> · developer console · everything guests search is logged here
      </footer>
    </div>
  );
}
