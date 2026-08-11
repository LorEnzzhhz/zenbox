import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_PLUGINS,
  marketplaceSiteUrl,
} from "@/lib/marketplace-plugins";
import { cn } from "@/lib/utils";
import {
  Camera,
  Check,
  ChevronDown,
  Cpu,
  ExternalLink,
  Github,
  Globe,
  Loader2,
  MapPin,
  Mic,
  Puzzle,
  RefreshCw,
  Search,
  Share2,
  Smartphone,
  Sparkles,
  Store,
  Trash2,
  Upload,
  Vibrate,
  Wand2,
  Wifi,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type Proposal = {
  name: string;
  description: string;
  capabilities: string[];
  features: string[];
  systemPrompt: string;
  source: "github" | "site";
  repoUrl?: string;
  siteUrl?: string;
};

type RepoResult = {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  topics: string[];
};

function ProposalCard({
  proposal,
  busy,
  onEdit,
  onInstall,
  onCancel,
}: {
  proposal: Proposal;
  busy: boolean;
  onEdit: (name: string) => void;
  onInstall: () => void;
  onCancel: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  return (
    <div className="rounded-md border border-border/80 bg-neutral-50 p-4 dark:bg-neutral-900/50">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-foreground" />
        <Input
          value={proposal.name}
          onChange={(e) => onEdit(e.target.value)}
          className="h-8 flex-1 border-transparent bg-transparent px-0 text-sm font-semibold focus:border-border focus:bg-white dark:focus:bg-neutral-950"
          aria-label="Plugin name"
        />
        <Badge variant="outline" className="h-5 rounded-sm text-[10px] font-normal">
          {proposal.source === "github" ? "GitHub" : "Website"}
        </Badge>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{proposal.description}</p>

      {proposal.capabilities.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Capabilities
          </p>
          <ul className="mt-1.5 space-y-1">
            {proposal.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[12px] leading-5 text-foreground/80">
                <Check className="mt-0.5 size-3 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposal.features.length > 0 && (
        <div className="mt-3 border-t border-border/70 pt-3">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Suggested additions
          </p>
          <ul className="mt-1.5 space-y-1">
            {proposal.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[12px] leading-5 text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/30" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowPrompt((s) => !s)}
        className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Plugin instructions
        <ChevronDown className={cn("size-3 transition-transform", showPrompt && "rotate-180")} />
      </button>
      {showPrompt && (
        <p className="mt-2 rounded-sm border border-border/70 bg-background p-3 text-[11px] leading-5 text-muted-foreground">
          {proposal.systemPrompt}
        </p>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={onInstall} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Puzzle className="size-3.5" />}
          Install plugin
        </Button>
      </div>
    </div>
  );
}

export function PluginsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const plugins = useQuery(api.plugins.list);
  const createPlugin = useMutation(api.plugins.create);
  const setEnabled = useMutation(api.plugins.setEnabled);
  const removePlugin = useMutation(api.plugins.remove);
  const searchGithub = useAction(api.plugins.searchGithub);
  const analyzeGithub = useAction(api.plugins.analyzeGithub);
  const analyzeSite = useAction(api.plugins.analyzeSite);
  const getUploadUrl = useMutation(api.files.generateUploadUrl);
  const authToken = useAuthToken();

  const [tab, setTab] = useState("installed");

  // GitHub discovery
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RepoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);

  // Website analysis
  const [url, setUrl] = useState("");
  const [analyzingSite, setAnalyzingSite] = useState<"url" | "file" | null>(null);

  // Shared proposal flow
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [installing, setInstalling] = useState(false);

  const resetProposal = () => {
    setProposal(null);
    setAnalyzingRepo(null);
    setAnalyzingSite(null);
  };

  const handleSearch = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    setSearching(true);
    setResults(null);
    try {
      setResults(await searchGithub({ query: term }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "GitHub search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleAnalyzeRepo = async (fullName: string) => {
    setAnalyzingRepo(fullName);
    setProposal(null);
    try {
      setProposal(await analyzeGithub({ repo: fullName }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyze the repo");
    } finally {
      setAnalyzingRepo(null);
    }
  };

  const handleAnalyzeUrl = async () => {
    if (!url.trim()) return;
    setAnalyzingSite("url");
    setProposal(null);
    try {
      setProposal(await analyzeSite({ url: url.trim() }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyze the site");
    } finally {
      setAnalyzingSite(null);
    }
  };

  const handleAnalyzeFile = async (file: File) => {
    if (!/\.(html?|txt|md|json|csv)$/i.test(file.name)) {
      toast.error("Upload an HTML, text, or markdown file to analyze.");
      return;
    }
    setAnalyzingSite("file");
    setProposal(null);
    try {
      const uploadUrl = await getUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "text/plain",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { storageId } = (await res.json()) as { storageId: string };
      setProposal(await analyzeSite({ storageId, fileName: file.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyze the file");
    } finally {
      setAnalyzingSite(null);
    }
  };

  const handleInstall = async () => {
    if (!proposal || installing) return;
    setInstalling(true);
    try {
      await createPlugin({
        name: proposal.name,
        description: proposal.description,
        source: proposal.source,
        repoUrl: proposal.repoUrl,
        siteUrl: proposal.siteUrl,
        capabilities: proposal.capabilities,
        features: proposal.features,
        systemPrompt: proposal.systemPrompt,
      });
      toast.success(`“${proposal.name}” installed and enabled.`);
      resetProposal();
      setTab("installed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not install the plugin");
    } finally {
      setInstalling(false);
    }
  };

  const handleDelete = async (id: Id<"plugins">, name: string) => {
    try {
      await removePlugin({ pluginId: id });
      toast.success(`“${name}” removed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the plugin");
    }
  };

  const enabledCount = plugins?.filter((p) => p.enabled).length ?? 0;

  // Marketplace — track what's already installed (dedup by marketplace:// id).
  const installedMarketplace = useMemo(
    () => new Set((plugins ?? []).map((p) => p.siteUrl).filter((u): u is string => Boolean(u))),
    [plugins],
  );
  const [marketplaceBusy, setMarketplaceBusy] = useState<string | null>(null);

  const handleMarketplaceInstall = async (plugin: (typeof MARKETPLACE_PLUGINS)[number]) => {
    if (marketplaceBusy) return;
    setMarketplaceBusy(plugin.slug);
    try {
      await createPlugin({
        name: plugin.name,
        description: plugin.description,
        source: "site",
        siteUrl: marketplaceSiteUrl(plugin.slug),
        repoUrl: plugin.repoUrl,
        capabilities: plugin.capabilities,
        features: plugin.features,
        systemPrompt: plugin.systemPrompt,
      });
      toast.success(`“${plugin.name}” installed and enabled.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not install the plugin");
    } finally {
      setMarketplaceBusy(null);
    }
  };

  // ---- device capability scan ----------------------------------------------
  // Detect what this device can do (camera, mic, GPS, NFC, notifications, …)
  // and propose a plugin for each — "auto scan apps on user device that can
  // possibly have plugins to connect with".
  const deviceCapabilities = useMemo(() => {
    const caps: Array<{
      id: string;
      label: string;
      hint: string;
      available: boolean;
      icon: React.ReactNode;
      plugin: {
        name: string;
        description: string;
        capabilities: string[];
        features: string[];
        systemPrompt: string;
      };
    }> = [
      {
        id: "camera",
        label: "Camera / photos",
        hint: "Take pictures & attach them to chats",
        available: typeof navigator !== "undefined" && "mediaDevices" in navigator,
        icon: <Camera className="size-3.5" />,
        plugin: {
          name: "Camera capture",
          description: "Lets the AI take photos on this device and see them (vision).",
          capabilities: ["Image capture", "Vision analysis"],
          features: ["Ask the AI to scan a document, QR code, or object"],
          systemPrompt:
            "The user's device has a camera. When they ask to capture or scan something, guide them to attach a photo, then analyze it with vision.",
        },
      },
      {
        id: "mic",
        label: "Microphone / voice",
        hint: "Record voice notes & transcribe them",
        available: typeof navigator !== "undefined" && "mediaDevices" in navigator,
        icon: <Mic className="size-3.5" />,
        plugin: {
          name: "Voice input",
          description: "Enables voice notes that the AI transcribes and answers.",
          capabilities: ["Audio capture", "Transcription"],
          features: ["Speak instead of typing — replies stream back"],
          systemPrompt:
            "This device supports voice input. When the user attaches a voice note, transcribe it carefully and respond to what they actually said.",
        },
      },
      {
        id: "gps",
        label: "Location / GPS",
        hint: "Share your location with the AI",
        available:
          typeof navigator !== "undefined" && "geolocation" in navigator && Boolean(navigator.geolocation),
        icon: <MapPin className="size-3.5" />,
        plugin: {
          name: "Location aware",
          description: "Gives the AI local context — weather, directions, nearby places.",
          capabilities: ["Geolocation"],
          features: ["Ask for weather or places near you, without typing a city"],
          systemPrompt:
            "This device can share its location. Use it for location-specific answers (weather, directions, local info) whenever the user asks.",
        },
      },
      {
        id: "share",
        label: "Share / Web Share",
        hint: "Share chats & files to other apps",
        available: typeof navigator !== "undefined" && "share" in navigator,
        icon: <Share2 className="size-3.5" />,
        plugin: {
          name: "System share",
          description: "Shares replies, images, and files through the device's share sheet.",
          capabilities: ["Native share sheet"],
          features: ["Send a reply to WhatsApp, Messenger, or email in one tap"],
          systemPrompt:
            "This device has a system share sheet. Offer it whenever the user wants to send a reply, image, or file to another app.",
        },
      },
      {
        id: "vibrate",
        label: "Haptics / vibration",
        hint: "Subtle buzz on replies & alerts",
        available: typeof navigator !== "undefined" && "vibrate" in navigator,
        icon: <Vibrate className="size-3.5" />,
        plugin: {
          name: "Haptic alerts",
          description: "Brings physical feedback — a small buzz when the AI finishes.",
          capabilities: ["Vibration"],
          features: ["Vibrate on long replies, errors, or update arrival"],
          systemPrompt:
            "This device supports haptics. Use a short vibration to signal when a long reply completes or an error occurs.",
        },
      },
      {
        id: "notifications",
        label: "Notifications",
        hint: "System alerts for replies & updates",
        available: typeof window !== "undefined" && "Notification" in window,
        icon: <Smartphone className="size-3.5" />,
        plugin: {
          name: "Push alerts",
          description: "Sends system notifications when your developer posts updates or announcements.",
          capabilities: ["System notifications"],
          features: ["Get notified the moment an update lands, even in another app"],
          systemPrompt:
            "This device supports system notifications. Mention updates and long-running work visibly so the user is never left waiting.",
        },
      },
      {
        id: "wifi",
        label: "Network status",
        hint: "Offline-aware replies",
        available: typeof navigator !== "undefined" && "onLine" in navigator,
        icon: <Wifi className="size-3.5" />,
        plugin: {
          name: "Offline assistant",
          description: "Queues your messages and auto-sends when the connection returns.",
          capabilities: ["Connection monitoring"],
          features: ["Never lose a prompt on a bad connection"],
          systemPrompt:
            "This device can detect connectivity. When offline, keep answers short and note that live search is unavailable until reconnected.",
        },
      },
      {
        id: "touch",
        label: "Touch gestures",
        hint: "Phone-first layouts & long-press",
        available:
          typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0),
        icon: <Cpu className="size-3.5" />,
        plugin: {
          name: "Mobile mode",
          description: "Optimizes the studio for a phone — bottom sheets, big targets.",
          capabilities: ["Touch UI"],
          features: ["Long-press actions and swipe-friendly layouts"],
          systemPrompt:
            "This is a touch device. Keep responses scannable for mobile — short paragraphs, clear headers, tappable next steps.",
        },
      },
    ];
    return caps;
  }, []);

  const detected = deviceCapabilities.filter((c) => c.available);
  const installedDevicePlugins = new Set(
    (plugins ?? []).filter((p) => p.source === "site" && p.siteUrl === "device://scan").map((p) => p.name),
  );

  const installDevicePlugin = async (cap: (typeof deviceCapabilities)[number]) => {
    try {
      await createPlugin({
        name: cap.plugin.name,
        description: cap.plugin.description,
        source: "site",
        siteUrl: "device://scan",
        capabilities: cap.plugin.capabilities,
        features: cap.plugin.features,
        systemPrompt: cap.plugin.systemPrompt,
      });
      toast.success(`“${cap.plugin.name}” installed — connected to this device.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not install the device plugin");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="size-4" />
            Plugins &amp; Skills
          </DialogTitle>
          <DialogDescription>
            Browse the curated marketplace, install skills from GitHub, or give a website URL — the
            AI analyzes it and proposes plugins for it. Enabled plugins extend every conversation.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-1">
          <TabsList className="grid w-full grid-cols-6 rounded-sm">
            <TabsTrigger value="installed" className="rounded-sm text-[11px]">
              Installed{plugins && plugins.length > 0 ? ` (${plugins.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="marketplace" className="rounded-sm text-[11px]">
              Marketplace
            </TabsTrigger>
            <TabsTrigger value="device" className="rounded-sm text-[11px]">
              Device
            </TabsTrigger>
            <TabsTrigger value="discover" className="rounded-sm text-[11px]">
              GitHub
            </TabsTrigger>
            <TabsTrigger value="skills" className="rounded-sm text-[11px]">
              Skills
            </TabsTrigger>
            <TabsTrigger value="website" className="rounded-sm text-[11px]">
              Site
            </TabsTrigger>
          </TabsList>

          {/* Marketplace — curated plugins, one-tap install */}
          <TabsContent value="marketplace" className="mt-3">
            <div className="flex items-center gap-2 rounded-sm border border-border/70 bg-neutral-50 px-3 py-2 dark:bg-neutral-900/50">
              <Store className="size-4 shrink-0 text-muted-foreground" />
              <p className="text-[12px] leading-5 text-muted-foreground">
                <b className="text-foreground">{MARKETPLACE_PLUGINS.length} curated plugins</b> — install
                what you need; each one adds its skills to every conversation when enabled.
              </p>
            </div>
            <div className="mt-3 max-h-[46vh] space-y-5 overflow-y-auto pr-1">
              {MARKETPLACE_CATEGORIES.map((cat) => {
                const items = MARKETPLACE_PLUGINS.filter((p) => p.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                      {cat}
                    </p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {items.map((p) => {
                        const Icon = p.icon;
                        const installed = installedMarketplace.has(marketplaceSiteUrl(p.slug));
                        const busy = marketplaceBusy === p.slug;
                        return (
                          <div
                            key={p.slug}
                            className="flex items-start gap-3 rounded-md border border-border/80 p-3"
                          >
                            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-border/70 text-muted-foreground">
                              <Icon className="size-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[13px] font-semibold">{p.name}</p>
                                <span className="text-[10px] text-muted-foreground/70">{p.vendor}</span>
                                {p.repoUrl && (
                                  <a
                                    href={p.repoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-0.5 text-[10px] text-muted-foreground underline decoration-foreground/30 underline-offset-2 transition-colors hover:text-foreground hover:decoration-foreground"
                                  >
                                    <Github className="size-2.5" />
                                    repo
                                  </a>
                                )}
                                {installed && (
                                  <Badge className="h-5 rounded-sm bg-foreground px-1.5 text-[9px] font-normal text-background">
                                    Installed
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                                {p.description}
                              </p>
                              {p.capabilities.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {p.capabilities.slice(0, 3).map((c) => (
                                    <span
                                      key={c}
                                      className="rounded-sm border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                    >
                                      {c}
                                    </span>
                                  ))}
                                  {p.capabilities.length > 3 && (
                                    <span className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                                      +{p.capabilities.length - 3}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={installed ? "outline" : "default"}
                              className="h-8 shrink-0 gap-1.5 text-xs"
                              onClick={() => void handleMarketplaceInstall(p)}
                              disabled={installed || marketplaceBusy !== null}
                            >
                              {busy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : installed ? (
                                <Check className="size-3.5" />
                              ) : (
                                <Puzzle className="size-3.5" />
                              )}
                              {busy ? "Installing…" : installed ? "Installed" : "Install"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>

          {/* Device — auto-scan this device's capabilities into plugins */}
          <TabsContent value="device" className="mt-3">
            <div className="flex items-center gap-2 rounded-sm border border-border/70 bg-neutral-50 px-3 py-2 dark:bg-neutral-900/50">
              <Smartphone className="size-4 shrink-0 text-muted-foreground" />
              <p className="text-[12px] leading-5 text-muted-foreground">
                Auto-scanned this device: <b className="text-foreground">{detected.length} capabilities</b> found.
                Install a plugin to connect each one to the AI.
              </p>
            </div>
            <div className="mt-3 max-h-[46vh] space-y-2 overflow-y-auto">
              {detected.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">
                  No scannable capabilities on this device or browser.
                </p>
              ) : (
                detected.map((cap) => {
                  const installed = installedDevicePlugins.has(cap.plugin.name);
                  return (
                    <div
                      key={cap.id}
                      className="flex items-start gap-3 rounded-md border border-border/80 p-3"
                    >
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-border/70 text-muted-foreground">
                        {cap.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold">{cap.label}</p>
                          {installed && (
                            <Badge className="h-5 rounded-sm bg-foreground px-1.5 text-[9px] font-normal text-background">
                              Installed
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{cap.hint}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={installed ? "outline" : "default"}
                        className="h-8 shrink-0 gap-1.5 text-xs"
                        onClick={() => void installDevicePlugin(cap)}
                        disabled={installed}
                      >
                        {installed ? <Check className="size-3.5" /> : <Puzzle className="size-3.5" />}
                        {installed ? "Connected" : "Connect"}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          {/* Installed */}
          <TabsContent value="installed" className="mt-3 max-h-[52vh] overflow-y-auto">
            {plugins === undefined ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : plugins.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No plugins yet — browse the Marketplace, discover one on GitHub, or analyze a website.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {plugins.map((p) => (
                  <div key={p._id} className="rounded-md border border-border/80 p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[13px] font-semibold">{p.name}</p>
                          <Badge variant="outline" className="h-5 rounded-sm px-1.5 text-[9px] font-normal">
                            {p.source === "github"
                              ? "GitHub"
                              : p.siteUrl?.startsWith("marketplace://")
                                ? "Marketplace"
                                : "Website"}
                          </Badge>
                          {p.enabled && (
                            <Badge className="h-5 rounded-sm bg-foreground px-1.5 text-[9px] font-normal text-background">
                              Active
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{p.description}</p>
                        {p.capabilities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {p.capabilities.map((c) => (
                              <span
                                key={c}
                                className="rounded-sm border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Switch
                          checked={p.enabled}
                          onCheckedChange={(checked) => void setEnabled({ pluginId: p._id, enabled: checked })}
                          aria-label={`Toggle ${p.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => void handleDelete(p._id, p.name)}
                          className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                          title="Remove plugin"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                  {enabledCount > 0
                    ? `${enabledCount} enabled — their instructions are added to every model call.`
                    : "Enable a plugin to add its skills to your conversations."}
                </p>
              </div>
            )}
          </TabsContent>

          {/* Discover — GitHub */}
          <TabsContent value="discover" className="mt-3">
            <div className="flex items-center gap-2">
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                placeholder="Search GitHub repos — e.g. awesome-chatgpt-prompts, zod, tailwindcss…"
                className="h-9 text-[13px]"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => void handleSearch()}
                disabled={searching || !query.trim()}
              >
                {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                Search
              </Button>
            </div>

            <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto">
              {results === null && !searching ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">
                  Search GitHub for a project, then analyze it into an installable plugin.
                </p>
              ) : searching ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : results && results.length === 0 ? (
                <p className="py-8 text-center text-[12px] text-muted-foreground">No repos found.</p>
              ) : (
                results?.map((r) => (
                  <div key={r.full_name} className="flex items-start gap-3 rounded-md border border-border/80 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold">{r.full_name}</p>
                        {r.language && (
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {r.language}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">★ {r.stargazers_count.toLocaleString()}</span>
                      </div>
                      {r.description && (
                        <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                      {r.topics.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.topics.map((t) => (
                            <span key={t} className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-[11px]"
                        onClick={() => void handleAnalyzeRepo(r.full_name)}
                        disabled={analyzingRepo !== null}
                      >
                        {analyzingRepo === r.full_name ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Sparkles className="size-3" />
                        )}
                        Analyze
                      </Button>
                      <a
                        href={r.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ExternalLink className="size-2.5" /> view repo
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Skills — curated searches for AI skills & plugin collections */}
          <TabsContent value="skills" className="mt-3">
            <p className="text-[12px] leading-5 text-muted-foreground">
              One-tap searches for popular AI skills and plugin collections on GitHub.
              Analyze any result to turn it into an installable plugin.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                "awesome-claude-skills",
                "awesome-chatgpt-prompts",
                "ai agents skills",
                "opencode skills",
                "llm tools",
                "mcp servers",
                "prompt engineering",
                "openrouter models",
                "freebuff skills",
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setQuery(chip);
                    setTab("discover");
                    void handleSearch(chip);
                  }}
                  disabled={searching}
                  className="rounded-sm border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
                >
                  <Wand2 className="mr-1 inline size-3" />
                  {chip}
                </button>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border/70" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or search your own</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Github className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSearch();
                }}
                placeholder="Search skills — e.g. claude skills, agent tools, prompts…"
                className="h-9 text-[13px]"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => void handleSearch()}
                disabled={searching || !query.trim()}
              >
                {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
                Search
              </Button>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
              Results appear in the GitHub tab — pick one and hit <b>Analyze</b> to propose a plugin.
              If GitHub rate-limits this shared network, add a free{" "}
              <span className="font-mono">GITHUB_TOKEN</span> in the project Keys tab.
            </p>
          </TabsContent>

          {/* From website */}
          <TabsContent value="website" className="mt-3">
            <div className="flex items-center gap-2">
              <Globe className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAnalyzeUrl();
                }}
                placeholder="Paste a website URL — e.g. https://stripe.com"
                className="h-9 text-[13px]"
              />
              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5 text-xs"
                onClick={() => void handleAnalyzeUrl()}
                disabled={analyzingSite === "url" || !url.trim()}
              >
                {analyzingSite === "url" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Analyze
              </Button>
            </div>

            <div className="my-3 flex items-center gap-3">
              <span className="h-px flex-1 bg-border/70" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or upload a site</span>
              <span className="h-px flex-1 bg-border/70" />
            </div>

            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/80 py-8 text-center transition-colors",
                "hover:border-foreground/40 hover:bg-neutral-50 dark:hover:bg-neutral-900/50",
                analyzingSite === "file" && "pointer-events-none opacity-60",
              )}
            >
              <input
                type="file"
                accept=".html,.htm,.txt,.md,.json,.csv,text/html,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAnalyzeFile(file);
                  e.target.value = "";
                }}
              />
              {analyzingSite === "file" ? (
                <>
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  <span className="text-[12px] text-muted-foreground">Analyzing the site…</span>
                </>
              ) : (
                <>
                  <Upload className="size-5 text-muted-foreground" />
                  <span className="text-[12px] font-medium">Upload an HTML page of the site</span>
                  <span className="text-[11px] text-muted-foreground">
                    The AI reads it and proposes a plugin with capabilities you can install
                  </span>
                </>
              )}
            </label>
          </TabsContent>
        </Tabs>

        {/* Proposal preview */}
        {proposal && (
          <div className="mt-3 border-t border-border/70 pt-3">
            <ProposalCard
              proposal={proposal}
              busy={installing}
              onEdit={(name) => setProposal((p) => (p ? { ...p, name } : p))}
              onInstall={() => void handleInstall()}
              onCancel={resetProposal}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
