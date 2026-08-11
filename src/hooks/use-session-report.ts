// Reports this client's session (public IP + device) to the backend so the
// developer's live roster shows who is connected, from where, and on which
// device. Reports on mount, every minute while open, and when the tab becomes
// visible again — silently, never blocking the UI.
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useCallback, useEffect, useRef } from "react";
import { detectDevice, fetchPublicIp } from "@/lib/device";

export function useSessionReport() {
  const reportSession = useMutation(api.admin.reportSession);
  const ipRef = useRef<string | null>(null);

  const report = useCallback(async () => {
    try {
      if (ipRef.current === null) ipRef.current = await fetchPublicIp();
      await reportSession({
        ip: ipRef.current ?? undefined,
        device: detectDevice(),
      });
    } catch {
      /* telemetry must never break the app */
    }
  }, [reportSession]);

  useEffect(() => {
    void report();
    const tick = window.setInterval(() => void report(), 60_000);
    const onVisible = () => {
      if (!document.hidden) void report();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [report]);
}
