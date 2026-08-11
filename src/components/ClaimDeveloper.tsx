import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Lock, Shield, ShieldCheck, Terminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Shown by the Control app when a signed-in user is not the developer. The
 *  first account ever can claim the role right here; afterwards the console is
 *  locked to that developer. Replaces the broken redirect-to-/dashboard loop. */
export function ClaimDeveloper() {
  const { user, signOut } = useAuth();
  const adminExists = useQuery(api.admin.adminExists);
  const ensureAdmin = useMutation(api.admin.ensureAdmin);
  const [claiming, setClaiming] = useState(false);

  const isGuest = Boolean(user?.isAnonymous);
  const taken = adminExists === true;

  const claim = async () => {
    setClaiming(true);
    try {
      await ensureAdmin();
      toast.success("You are now the developer — welcome to Control.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not claim the developer role");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-md border border-border/80 p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-sm bg-foreground">
          <Terminal className="size-6 text-background" />
        </span>
        <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.35em] text-muted-foreground">
          Zenbox · Control
        </p>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">
          {taken ? "This console has an owner" : "Claim the developer role"}
        </h1>

        {adminExists === undefined ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : taken ? (
          <>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              The developer console is already claimed. Control is developer-only —
              guests and other accounts can't open it.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
              <Lock className="size-3.5" />
              {user?.email ?? user?.name ?? "This account"} can't access it
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              No developer exists yet. The first account to claim becomes the owner of the
              console — full control over updates, monitoring, sessions, and broadcasts.
            </p>
            {isGuest && (
              <p className="mt-3 rounded-sm border border-border/70 bg-muted/50 px-3 py-2 text-[12px] leading-5 text-muted-foreground">
                Guest sessions can't claim the developer role — sign in with your email first,
                then come back here.
              </p>
            )}
            <Button type="button" className="mt-5 w-full gap-2" onClick={() => void claim()} disabled={claiming || isGuest}>
              {claiming ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {claiming ? "Claiming…" : "Claim developer role"}
            </Button>
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4 h-8 gap-1.5 text-[11px] text-muted-foreground"
          onClick={() => void signOut()}
        >
          <Shield className="size-3" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
