import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTheme, type Theme } from "@/lib/theme";
import { AppearancePrefs } from "@/components/AppearancePrefs";
import { CognitionPanel } from "@/components/CognitionPanel";
import { cn } from "@/lib/utils";
import { Activity, Bot, Check, ClipboardCopy, Cpu, Eye, EyeOff, KeyRound, Loader2, Monitor, Moon, PlugZap, RefreshCw, Rocket, Send, Shield, Sun, Trash2, Zap } from "lucide-react";
import { useNavigate } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  backgroundSupported,
  readBackgroundPref,
  startBackground,
  stopBackground,
  writeBackgroundPref,
} from "@/lib/background";

const THEMES: Array<{ id: Theme; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

function KeySection({
  title,
  icon,
  description,
  status,
  placeholder,
  onSave,
  onRemove,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  description: string;
  status: { hasKey: boolean; masked: string | null } | undefined;
  placeholder: string;
  onSave: (key: string) => Promise<{ masked: string }>;
  onRemove: () => Promise<void>;
  footer: React.ReactNode;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleSave = async () => {
    const value = keyInput.trim();
    if (!value) return;
    setSaving(true);
    try {
      const { masked } = await onSave(value);
      toast.success(`API key saved (${masked})`);
      setKeyInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the API key");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await onRemove();
      toast.success("API key removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the API key");
    } finally {
      setRemoving(false);
    }
  };

  const hasKey = status?.hasKey ?? false;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[13px] font-semibold">{title}</p>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">{description}</p>

      {/* Current status */}
      <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2.5">
        <div className="flex items-center gap-2.5 text-[13px]">
          {status === undefined ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : hasKey ? (
            <>
              <Check className="size-3.5 text-foreground" />
              <span className="font-medium">Key configured</span>
              {status?.masked && (
                <span className="font-mono text-[11px] text-muted-foreground">{status.masked}</span>
              )}
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">No key saved</span>
            </>
          )}
        </div>
        {hasKey && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => void handleRemove()}
            disabled={removing}
          >
            {removing ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Remove
          </Button>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={show ? "text" : "password"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="pr-9 font-mono text-[13px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSave();
            }}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={show ? "Hide key" : "Show key"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1.5 text-xs"
          onClick={() => void handleSave()}
          disabled={saving || !keyInput.trim()}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
          Save
        </Button>
      </div>

      <p className="text-[11px] leading-5 text-muted-foreground">{footer}</p>
    </div>
  );
}

/** Your personal Zenbox API key — auto-generated on first use, copyable, and
 *  accepted as `Authorization: Bearer <key>` by the HTTP API. */
function ApiKeySection({ hasKey, masked }: { hasKey: boolean; masked: string | null }) {
  const getKey = useMutation(api.settings.getMyApiKey);
  const [full, setFull] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async (regenerate: boolean) => {
    setBusy(true);
    try {
      const res = await getKey({ regenerate });
      setFull(res.apiKey ?? null);
      setShow(true);
      if (regenerate) {
        toast.success("New API key generated — the old one is instantly revoked.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the API key");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    let key = full;
    if (!key) {
      setBusy(true);
      try {
        key = (await getKey({ regenerate: false })).apiKey ?? null;
        setFull(key);
        setShow(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load the API key");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast.success("API key copied to clipboard.");
    } catch {
      toast.error("Clipboard unavailable — select and copy the key manually.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 text-muted-foreground" />
        <p className="text-[13px] font-semibold">Your Zenbox API key</p>
      </div>
      <p className="text-[12px] leading-5 text-muted-foreground">
        Auto-generated for your account — call the API with{" "}
        <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Copy it anywhere; you
        can rotate it any time.
      </p>

      <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2.5">
        <div className="flex items-center gap-2.5 text-[13px]">
          {hasKey ? (
            <>
              <Check className="size-3.5 text-foreground" />
              <span className="font-medium">Key ready</span>
              {masked && <span className="font-mono text-[11px] text-muted-foreground">{masked}</span>}
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-muted-foreground/40" />
              <span className="text-muted-foreground">Generated on first copy</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            disabled={busy}
            onClick={() => void copy()}
          >
            {copied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            title={show ? "Hide key" : "Show key"}
            disabled={busy}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            disabled={busy}
            onClick={() => void load(true)}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Regenerate
          </Button>
        </div>
      </div>

      {show && full && (
        <div className="rounded-md border border-foreground/20 bg-muted/20 px-3 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            {hasKey ? "Your key" : "Your new key"}
          </p>
          <p className="select-all break-all font-mono text-[12px] leading-5 text-foreground">{full}</p>
        </div>
      )}
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const settings = useQuery(api.settings.getSettings);
  const saveKey = useAction(api.settings.saveOpenrouterKey);
  const removeKey = useAction(api.settings.removeOpenrouterKey);
  const saveZen = useAction(api.settings.saveOpenCodeKey);
  const removeZen = useAction(api.settings.removeOpenCodeKey);
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const adminStatus = useQuery(api.admin.myStatus);
  const adminExists = useQuery(api.admin.adminExists);
  const ensureAdmin = useMutation(api.admin.ensureAdmin);
  const latestUpdate = useQuery(api.updates.latestShipped);
  const botStatus = useQuery(api.bots.getBotStatus);
  const saveTelegram = useAction(api.bots.saveTelegramToken);
  const removeTelegram = useAction(api.bots.removeTelegramToken);
  const setupWebhook = useAction(api.bots.setupTelegramWebhook);
  const tgStatus = useAction(api.bots.telegramStatus);
  const saveDiscord = useAction(api.bots.saveDiscordWebhook);
  const removeDiscord = useAction(api.bots.removeDiscordWebhook);
  const discordTest = useAction(api.bots.discordSend);
  const [claiming, setClaiming] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [showTg, setShowTg] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgInfo, setTgInfo] = useState<string | null>(null);
  const [dcUrl, setDcUrl] = useState("");
  const [dcBusy, setDcBusy] = useState(false);
  const [dcInfo, setDcInfo] = useState<string | null>(null);
  const [background, setBackground] = useState<boolean>(() => readBackgroundPref());

  const toggleBackground = async (on: boolean) => {
    setBackground(on);
    writeBackgroundPref(on);
    if (on) {
      const ok = await startBackground();
      if (!ok) {
        toast.info("Background running needs the Android app — enabling it on your next APK launch.");
      } else {
        toast.success("Running in background — streams keep going even if you exit.");
      }
    } else {
      await stopBackground();
      toast.success("Background running turned off.");
    }
  };

  const handleSaveTg = async () => {
    if (!tgToken.trim() || tgBusy) return;
    setTgBusy(true);
    setTgInfo(null);
    try {
      const res = await saveTelegram({ token: tgToken });
      if (res.error) setTgInfo(res.error);
      else {
        setTgToken("");
        setTgInfo(`Connected as ${res.username} — now press Connect webhook.`);
      }
    } catch (err) {
      setTgInfo(err instanceof Error ? err.message : "Could not save the Telegram token.");
    } finally {
      setTgBusy(false);
    }
  };

  const handleConnectTg = async () => {
    setTgBusy(true);
    setTgInfo(null);
    try {
      const res = await setupWebhook();
      setTgInfo(res.error ?? "Webhook connected — message your bot in Telegram and try /status.");
    } catch (err) {
      setTgInfo(err instanceof Error ? err.message : "Could not connect the webhook.");
    } finally {
      setTgBusy(false);
    }
  };

  const handleCheckTg = async () => {
    setTgBusy(true);
    setTgInfo(null);
    try {
      const res = await tgStatus();
      setTgInfo(res.info ?? (res.ok ? "Webhook OK" : "Not connected"));
    } catch (err) {
      setTgInfo(err instanceof Error ? err.message : "Could not check the webhook.");
    } finally {
      setTgBusy(false);
    }
  };

  const handleRemoveTg = async () => {
    setTgBusy(true);
    try {
      await removeTelegram();
      setTgInfo("Telegram bot removed.");
      toast.success("Telegram bot disconnected.");
    } catch (err) {
      setTgInfo(err instanceof Error ? err.message : "Could not remove the bot.");
    } finally {
      setTgBusy(false);
    }
  };

  const handleSaveDc = async () => {
    if (!dcUrl.trim() || dcBusy) return;
    setDcBusy(true);
    setDcInfo(null);
    try {
      const res = await saveDiscord({ url: dcUrl });
      if (res.error) setDcInfo(res.error);
      else {
        setDcUrl("");
        setDcInfo("Discord webhook saved.");
      }
    } catch (err) {
      setDcInfo(err instanceof Error ? err.message : "Could not save the webhook.");
    } finally {
      setDcBusy(false);
    }
  };

  const handleTestDc = async () => {
    setDcBusy(true);
    setDcInfo(null);
    try {
      const res = await discordTest({
        content: "Zenbox connected ✓ — this is a test from Settings → Bots.",
      });
      setDcInfo(res.error ?? "Test message sent to your Discord channel.");
    } catch (err) {
      setDcInfo(err instanceof Error ? err.message : "Could not send the test.");
    } finally {
      setDcBusy(false);
    }
  };

  const handleRemoveDc = async () => {
    setDcBusy(true);
    try {
      await removeDiscord();
      setDcInfo("Discord webhook removed.");
      toast.success("Discord webhook removed.");
    } catch (err) {
      setDcInfo(err instanceof Error ? err.message : "Could not remove the webhook.");
    } finally {
      setDcBusy(false);
    }
  };

  const status = settings === undefined ? undefined : { hasKey: settings.hasKey, masked: settings.masked };
  const zenStatus =
    settings === undefined
      ? undefined
      : { hasKey: settings.hasOpenCodeKey, masked: settings.openCodeMasked };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Bring your own keys — stored server-side, used only by your requests, never shown back.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto py-1 pr-1">
          {/* Appearance — theme + palettes + wallpaper + sounds + thinking */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Monitor className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">Appearance</p>
            </div>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Brightness, color palette, and a live animated wallpaper — everything is remembered
              per device.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {THEMES.map((t) => {
                const Icon = t.icon;
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-sm border px-2 py-2 text-xs font-medium transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/80 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
            <div className="pt-1">
              <AppearancePrefs />
            </div>
          </div>

          <div className="h-px bg-border/70" />

          {/* Cognition — the full interactive operating configuration */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Cpu className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">Cognition</p>
            </div>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Everything here applies live to your next reply — no restart needed. Changes are
              remembered on this device.
            </p>
            <CognitionPanel />
          </div>

          <div className="h-px bg-border/70" />

          {/* Your personal API key — auto-generated, copyable, rotatable */}
          <ApiKeySection hasKey={settings?.hasApiKey ?? false} masked={settings?.apiKeyMasked ?? null} />

          <div className="h-px bg-border/70" />

          {/* Updates — latest shipped release */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Rocket className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">Updates</p>
            </div>
            {latestUpdate === undefined ? (
              <p className="text-[12px] text-muted-foreground">Checking for updates…</p>
            ) : latestUpdate ? (
              <div className="rounded-md border border-border/80 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium">
                    v{latestUpdate.version} — {latestUpdate.title}
                  </p>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {new Date(latestUpdate.shippedAt ?? latestUpdate.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {latestUpdate.changes.slice(0, 3).map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground">
                      <Check className="mt-0.5 size-3 shrink-0" />
                      {c.title}
                    </li>
                  ))}
                </ul>
                {latestUpdate.changes.length > 3 && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground/60">
                    +{latestUpdate.changes.length - 3} more changes
                  </p>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">No updates shipped yet.</p>
            )}
          </div>

          <div className="h-px bg-border/70" />

          <KeySection
            title="OpenRouter"
            icon={<KeyRound className="size-3.5 text-muted-foreground" />}
            description="Unlocks 200+ free models (GPT-OSS, Gemma, Nemotron, Tencent Hunyuan 3…) and token streaming."
            status={status}
            placeholder="sk-or-v1-…"
            onSave={async (key) => saveKey({ key })}
            onRemove={async () => {
              await removeKey();
            }}
            footer={
              <>
                Get a key at{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  openrouter.ai/keys
                </a>{" "}
                — free models cost nothing. Overrides the project-wide{" "}
                <span className="font-mono">OPENROUTER_API_KEY</span> for your account.
              </>
            }
          />

          <div className="h-px bg-border/70" />

          {/* Developer tools */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Shield className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">Developer console</p>
            </div>
            {adminStatus?.isAdmin ? (
              <div className="flex items-center justify-between rounded-md border border-border/80 px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Check className="size-3.5" />
                  <span className="font-medium">You are the admin</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => navigate("/admin")}
                >
                  <Shield className="size-3" />
                  Open console
                </Button>
              </div>
            ) : adminStatus?.isGuest ? (
              <p className="text-[11px] leading-5 text-muted-foreground">
                Guests can't manage the app. Sign in with your email to claim the developer role.
              </p>
            ) : adminStatus?.isAuthed && adminExists ? (
              <div className="rounded-md border border-border/80 px-3 py-2.5">
                <p className="text-[12px] leading-5 text-muted-foreground">
                  The developer role has already been claimed by another account — the console is
                  owned and locked. You can keep using the studio as a signed-in user.
                </p>
              </div>
            ) : adminStatus?.isAuthed ? (
              <div className="rounded-md border border-border/80 px-3 py-2.5">
                <p className="text-[12px] leading-5 text-muted-foreground">
                  First account to claim becomes the developer — with the console to monitor guests,
                  sessions, and everything they search.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2.5 h-7 gap-1.5 text-[11px]"
                  disabled={claiming || adminStatus === undefined}
                  onClick={() => {
                    setClaiming(true);
                    void ensureAdmin()
                      .then(() => toast.success("You are now the developer."))
                      .catch((err: unknown) =>
                        toast.error(err instanceof Error ? err.message : "Could not claim admin"),
                      )
                      .finally(() => setClaiming(false));
                  }}
                >
                  {claiming ? <Loader2 className="size-3 animate-spin" /> : <Shield className="size-3" />}
                  Claim developer role
                </Button>
              </div>
            ) : null}
          </div>

          <div className="h-px bg-border/70" />

          {/* Bots & integrations — Telegram reply bot + Discord webhook */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Bot className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">Bots &amp; integrations</p>
            </div>
            <p className="text-[12px] leading-5 text-muted-foreground">
              Talk to your AI app from Telegram, and mirror updates to a Discord channel.
            </p>

            {/* Telegram */}
            <div className="rounded-md border border-border/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Telegram bot</p>
                {botStatus === undefined ? null : botStatus.telegramConnected ? (
                  <span className="rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background">
                    {botStatus.telegramUsername}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Not connected</span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Create a bot with <span className="font-mono">@BotFather</span>, paste the token, then
                connect the webhook. Message your bot anywhere — <span className="font-mono">/status</span>{" "}
                shows the app version and who's online.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showTg ? "text" : "password"}
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    placeholder="123456:ABC-DEF…"
                    autoComplete="off"
                    spellCheck={false}
                    className="h-8 pr-8 font-mono text-xs"
                    disabled={tgBusy}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleSaveTg();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowTg((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showTg ? "Hide token" : "Show token"}
                  >
                    {showTg ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1 text-[11px]"
                  disabled={tgBusy || !tgToken.trim()}
                  onClick={() => void handleSaveTg()}
                >
                  {tgBusy ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
                  Save
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={!botStatus?.telegramConnected || tgBusy}
                  onClick={() => void handleConnectTg()}
                >
                  <PlugZap className="size-3" />
                  Connect webhook
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={!botStatus?.telegramConnected || tgBusy}
                  onClick={() => void handleCheckTg()}
                >
                  <Activity className="size-3" />
                  Check
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                  disabled={!botStatus?.telegramConnected || tgBusy}
                  onClick={() => void handleRemoveTg()}
                >
                  <Trash2 className="size-3" />
                  Remove
                </Button>
              </div>
              {botStatus?.telegramWebhook && !tgInfo && (
                <p className="mt-1.5 text-[11px] text-foreground/80">
                  Webhook connected — try <span className="font-mono">/status</span> in Telegram.
                </p>
              )}
              {tgInfo && <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{tgInfo}</p>}
            </div>

            {/* Discord */}
            <div className="rounded-md border border-border/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold">Discord webhook</p>
                {botStatus === undefined ? null : botStatus.discordWebhookSet ? (
                  <span className="rounded-sm bg-foreground px-1.5 py-0.5 font-mono text-[10px] text-background">
                    {botStatus.discordWebhookTail}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Not set</span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                Paste a channel webhook URL (Discord → Server Settings → Integrations → Webhooks).
                Send test messages and share updates to that channel.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={dcUrl}
                  onChange={(e) => setDcUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 flex-1 font-mono text-xs"
                  disabled={dcBusy}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveDc();
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1 text-[11px]"
                  disabled={dcBusy || !dcUrl.trim()}
                  onClick={() => void handleSaveDc()}
                >
                  {dcBusy ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
                  Save
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  disabled={!botStatus?.discordWebhookSet || dcBusy}
                  onClick={() => void handleTestDc()}
                >
                  <Send className="size-3" />
                  Send test message
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-[11px] text-muted-foreground hover:text-destructive"
                  disabled={!botStatus?.discordWebhookSet || dcBusy}
                  onClick={() => void handleRemoveDc()}
                >
                  <Trash2 className="size-3" />
                  Remove
                </Button>
              </div>
              {dcInfo && <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{dcInfo}</p>}
            </div>
          </div>

          <div className="h-px bg-border/70" />

          <KeySection
            title="OpenCode Zen"
            icon={<Zap className="size-3.5 text-muted-foreground" />}
            description="Free gateway for Big Pickle — a 200K-context coding model. One key unlocks it here."
            status={zenStatus}
            placeholder="opencode-…"
            onSave={async (key) => saveZen({ key })}
            onRemove={async () => {
              await removeZen();
            }}
            footer={
              <>
                Get a free key at{" "}
                <a
                  href="https://opencode.ai/auth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  opencode.ai/auth
                </a>{" "}
                — free tier models like Big Pickle cost nothing.
              </>
            }
          />

          <div className="h-px bg-border/70" />

          {/* App — background running on Android */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Activity className="size-3.5 text-muted-foreground" />
              <p className="text-[13px] font-semibold">App &amp; background</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/80 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">Keep running in background</p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                  {backgroundSupported()
                    ? "Exit keeps the app alive — replies and sandbox work continue, with a small notification."
                    : "Android only — install the APK to keep replies running after you exit."}
                </p>
              </div>
              <Switch checked={background} onCheckedChange={(on) => void toggleBackground(on)} />
            </div>
          </div>
        </div>

        <DialogFooter className="text-left">
          <p className="w-full text-[11px] leading-5 text-muted-foreground/80">
            Keys are used server-side only and are never shown again after saving. Files you attach
            are stored in Convex storage and only shared with the model you pick.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
