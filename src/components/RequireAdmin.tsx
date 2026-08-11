import { BootScreen } from "@/components/BootScreen";
import { useAuth } from "@/hooks/use-auth";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

/** Protects the developer console — signed-in admins only. When `fallback` is
 *  provided (e.g. the Control app's claim screen), a non-admin sees that
 *  instead of being bounced to the studio's /dashboard route. */
export function RequireAdmin({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { isLoading, isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <BootScreen label="Checking access…" />;
  if (!isAuthenticated) {
    return (
      <Navigate
        to={`/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  if (user?.role !== "admin") {
    if (fallback) return <>{fallback}</>;
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
