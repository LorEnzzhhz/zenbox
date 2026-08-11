import type { CapacitorConfig } from "@capacitor/cli";

// Zenbox as a standalone Android app (see README-APK.md).
//
// Build mode:
//   The APK bundles the built web app and serves it from https://localhost
//   inside the WebView — a real standalone app, not a hosted shell. It works
//   fully offline except for features that need the network (chat, sandbox
//   downloads, updates). Login is in-app: email one-time code, email +
//   password, or guest code — no hosted origin or OAuth redirects required.
//
// Optional hosted mode: to make the WebView load your deployed Zenbox URL
// instead of the bundled app, set `server.url` to your deployment and remove
// the comment below.
const config: CapacitorConfig = {
  appId: "app.zenbox.studio",
  appName: "Zenbox",
  webDir: "dist",
  backgroundColor: "#0a0a0a",
  // server: {
  //   // Replace with your deployed Zenbox URL (HTTPS) for the hosted-APK mode.
  //   url: "https://zenbox.example.com",
  //   cleartext: false,
  // },
  android: {
    allowMixedContent: false,
  },
};

export default config;
