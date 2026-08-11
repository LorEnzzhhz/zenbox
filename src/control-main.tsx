// Standalone entry for the Zenbox Control app — the developer's updater,
// built as its own application with its own APK (see android-control/ and
// README-APK.md). It shares the studio's Convex backend and design system but
// runs from control.html → dist-control with only Control routes.
import { startBackgroundUpdater } from "@/lib/updater";
import { Toaster } from "@/components/ui/sonner";
import { BootScreen } from "@/components/BootScreen";
import { ClaimDeveloper } from "@/components/ClaimDeveloper";
import { RequireAdmin } from "@/components/RequireAdmin";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ThemeProvider } from "@/lib/theme";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "./index.css";

// Mark this build as the standalone Control app so shared components (like the
// Updater header) can hide studio-only links.
document.documentElement.dataset.app = "control";

const Updater = lazy(() => import("./pages/Updater.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function RouteLoading() {
  return <BootScreen word="ZENBOX · CONTROL" label="Opening the updater…" />;
}

// The Control app receives its own updates too: the service worker downloads
// new shells in the background so the updater is always current.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* webview without SW support — the app still works */
    });
  });
}
startBackgroundUpdater();

createRoot(document.getElementById("root")!).render(
  <ConvexAuthProvider client={convex}>
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route
              path="/"
              element={
                <RequireAdmin fallback={<ClaimDeveloper />}>
                  <Updater />
                </RequireAdmin>
              }
            />
            <Route
              path="/admin"
              element={
                <RequireAdmin fallback={<ClaimDeveloper />}>
                  <Admin />
                </RequireAdmin>
              }
            />
            <Route path="/auth" element={<AuthPage redirectAfterAuth="/" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
    </ThemeProvider>
  </ConvexAuthProvider>,
);
