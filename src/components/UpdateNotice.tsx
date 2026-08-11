import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyAppUpdate, isNativePlatform, type UpdateStatus } from "@/lib/updater";
import { Check, Download, Loader2, Rocket, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export type UpdateDoc = Doc<"updates">;

const UPDATE_STATUS_LABEL: Record<UpdateStatus, string> = {
  downloading: "Downloading…",
  installing: "Installing…",
  restarting: "Restarting…",
};

/** State shared by banner + dialog: pressing Update downloads the files,
 *  installs the new shell and restarts the app. Failures are shown as a toast
 *  and the button resets — it never hangs on "Downloading…" silently. */
function useUpdateAction() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const busy = status !== null;
  const run = async (update: UpdateDoc) => {
    if (busy) return;
    try {
      const result = await applyAppUpdate(update, setStatus);
      if (!result.ok) {
        toast.error(result.error ?? "Update failed. Check your connection and try again.");
      } else if (result.skipped) {
        toast.info(result.error ?? "This APK targets the other Zenbox app — not installed here.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed. Check your connection and try again.");
    } finally {
      setStatus(null);
    }
  };
  return { status, busy, run };
}

const LS_KEY = "zenbox.lastSeenUpdate";

/** Latest shipped update + whether the user has seen it (localStorage). */
export function useUpdateNotice() {
  const latest = useQuery(api.updates.latestShipped);
  const [lastSeen, setLastSeen] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });

  const unseen = latest !== undefined && latest !== null && latest._id !== lastSeen;
  const markSeen = () => {
    if (!latest) return;
    setLastSeen(latest._id);
    try {
      localStorage.setItem(LS_KEY, latest._id);
    } catch {
      /* ignore */
    }
  };

  return { latest, unseen, markSeen };
}

function updateDate(u: UpdateDoc) {
  const ts = u.shippedAt ?? u.createdAt;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Top-of-workspace banner: a new update has arrived, with a concise summary
 *  of the changes (first few titles + "+N more") so users see what's new
 *  without opening the dialog. */
export function UpdateNoticeBanner({
  update,
  onWhatNew,
  onDismiss,
}: {
  update: UpdateDoc;
  onWhatNew: () => void;
  onDismiss: () => void;
}) {
  const { status, busy, run } = useUpdateAction();
  const preview = update.changes.slice(0, 3);
  const extra = update.changes.length - preview.length;
  return (
    <div className="flex items-center gap-3 border-b border-border/70 bg-neutral-50 px-4 py-2 dark:bg-neutral-900/50">
      <span className="flex shrink-0 items-center gap-1 rounded-sm bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background">
        <Rocket className="size-3" />
        v{update.version}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-xs font-medium">
          {update.title}
          {preview.length === 0 && update.verdict ? ` — ${update.verdict.split(".")[0]}.` : ""}
        </p>
        {preview.length > 0 && (
          <p className="truncate text-[11px] text-muted-foreground">
            {preview.map((c) => c.title).join(" · ")}
            {extra > 0 ? ` +${extra} more` : ""}
          </p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        className="h-7 shrink-0 gap-1 text-[11px]"
        disabled={busy}
        onClick={() => void run(update)}
        title="Download the update files, install, and restart"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        {busy ? UPDATE_STATUS_LABEL[status as UpdateStatus] : "Update"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 gap-1 text-[11px]"
        onClick={onWhatNew}
      >
        What's new
      </Button>
      <button
        type="button"
        onClick={onDismiss}
        className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss update notice"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Full release notes for a shipped update. */
export function UpdateNoticeDialog({
  open,
  onOpenChange,
  update,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  update: UpdateDoc | null | undefined;
  onDone: () => void;
}) {
  const { status, busy, run } = useUpdateAction();
  if (!update) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) onDone();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="size-4" />
            Zenbox v{update.version} — {update.title}
          </DialogTitle>
          <DialogDescription>Shipped {updateDate(update)} — here's what changed.</DialogDescription>
          {update.apkUrl && isNativePlatform() && (
            <p className="mt-1 rounded-sm border border-border/70 bg-muted/40 px-2.5 py-1.5 text-[11px] leading-5 text-muted-foreground">
              This update ships a new Android APK — Download &amp; install pulls it down and opens the
              package installer. Once installed, the app reopens on the new version automatically.
            </p>
          )}
        </DialogHeader>
        <div className="max-h-[52vh] overflow-y-auto pr-1">
          <p className="text-[13px] leading-6 text-muted-foreground">{update.verdict}</p>
          {update.releaseNotes ? (
            <pre className="mt-3 whitespace-pre-wrap rounded-sm border border-border/70 bg-neutral-50 p-3 font-sans text-[12px] leading-5 text-foreground/90 dark:bg-neutral-900/60">
              {update.releaseNotes}
            </pre>
          ) : (
            <ul className="mt-3 space-y-2">
              {update.changes.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-5">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                  <span>
                    <span className="font-medium text-foreground">{c.title}</span>
                    <span className="text-muted-foreground"> — {c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
              onDone();
            }}
          >
            <Check className="size-3.5" />
            Later
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={busy}
            onClick={() => void run(update)}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {busy
              ? UPDATE_STATUS_LABEL[status as UpdateStatus]
              : update.apkUrl && isNativePlatform()
                ? "Download & install"
                : "Update & restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
