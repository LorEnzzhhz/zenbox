import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { existsSync, renameSync, rmSync } from "fs";
import { defineConfig } from "vite";

// Standalone build for the Zenbox Control updater app (its own APK).
// Builds control.html → src/control-main.tsx into dist-control/, which the
// android-control/ Capacitor project bundles (see README-APK.md).
// Deliberately excludes the Vly toolbar/integration plugin — the Control app
// is a lean developer tool, not the studio.
export default defineConfig({
  // The Control app doesn't use the studio's sandbox assets (v86 kernel,
  // Alpine/Debian rootfs ≈ 60 MB) — serve only its own sw.js + manifest so the
  // Control APK stays lean.
  publicDir: "control-public",
  plugins: [
    react(),
    tailwindcss(),
    {
      // Vite names the emitted HTML after the input file (control.html), but
      // Capacitor's sync requires the web dir to contain index.html. Rename it
      // after the bundle is written so cap sync + the APK work out of the box.
      name: "control-html-to-index",
      writeBundle() {
        const out = path.resolve(__dirname, "dist-control");
        const src = path.join(out, "control.html");
        const dst = path.join(out, "index.html");
        if (existsSync(src)) {
          if (existsSync(dst)) rmSync(dst);
          renameSync(src, dst);
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single copy of React across all packages to avoid "Invalid hook
    // call" runtime errors (same as the main vite.config.ts).
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    outDir: "dist-control",
    sourcemap: false,
    target: "esnext",
    minify: "esbuild",
    rollupOptions: {
      // The Control app's own HTML entry — without this, Vite would build the
      // studio's index.html and the Control APK would ship the wrong app.
      input: path.resolve(__dirname, "control.html"),
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
