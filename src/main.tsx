import '@vly-ai/integrations';
import { startBackgroundUpdater } from "@/lib/updater";
import { Toaster } from "@/components/ui/sonner";
import { BootScreen } from "@/components/BootScreen";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ThemeProvider } from "@/lib/theme";
import React, { StrictMode, useEffect, lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import "./index.css";

// The service worker powers the update flow: it downloads new app shells in
// the background, applies them on restart, and keeps the app current while it
// runs. It's network-first, so updates always ship live — no stale shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[Zenbox] Service worker unavailable:", err);
    });
  });
}
startBackgroundUpdater();

// Lazy load route components for better code splitting
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const Updater = lazy(() => import("./pages/Updater.tsx"));

// Branded loading fallback for route transitions
function RouteLoading() {
  return <BootScreen />;
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// The loading screen is a full startup sequence (mark draw-in, staged download
// checklist, percent counter, tip ticker). It runs in full on the first load
// of each session — every cold start of the APK, since a fresh WebView has
// empty session storage — then fast on later loads (reloads / revisits).
const BOOT_ONCE_KEY = "zenbox.boot.once";

function BootGate({ children }: { children: React.ReactNode }) {
  const [seen, setSeen] = useState(() => {
    try {
      return sessionStorage.getItem(BOOT_ONCE_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (seen) return <>{children}</>;
  return (
    <BootScreen
      phaseMs={3200}
      onDone={() => {
        try {
          sessionStorage.setItem(BOOT_ONCE_KEY, "1");
        } catch {
          /* ignore */
        }
        setSeen(true);
      }}
    />
  );
}

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <BootGate>
        <ToolbarErrorBoundary>
          <VlyToolbar />
        </ToolbarErrorBoundary>
        <ConvexAuthProvider client={convex}>
        <ThemeProvider>
          <BrowserRouter>
            <RouteSyncer />
            <Suspense fallback={<RouteLoading />}>
              <Routes>
                {/* No landing screen — open straight into the studio. Signed-out
                    visitors are bounced to /auth by RequireAuth and return to
                    /dashboard after signing in. */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route
                  path="/auth"
                  element={<AuthPage redirectAfterAuth="/dashboard" />}
                />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin"
                element={
                  <RequireAdmin>
                    <Admin />
                  </RequireAdmin>
                }
              />
              <Route
                path="/updater"
                element={
                  <RequireAdmin>
                    <Updater />
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster />
          </ThemeProvider>
        </ConvexAuthProvider>
      </BootGate>
    </RootErrorBoundary>
  </StrictMode>,
);
