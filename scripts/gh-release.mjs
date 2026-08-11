#!/usr/bin/env node
// Publish the built Zenbox APKs to a GitHub release.
//
// Usage:
//   GITHUB_TOKEN=ghp_xxx node scripts/gh-release.mjs <owner/repo> <tag> [--name "Release name"] [--notes "Notes"]
//
// Examples:
//   GITHUB_TOKEN=ghp_xxx node scripts/gh-release.mjs you/zenbox v3.0
//   GITHUB_TOKEN=ghp_xxx node scripts/gh-release.mjs you/zenbox v3.0 --name "Zenbox v3.0" --notes "Faster boot + GitHub integration"
//
// Creates (or reuses) the release, uploads both APKs as assets, and prints the
// release + asset URLs — paste the asset URL into the Control app's
// "APK download URL" field to wire in-app updates to this release.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const APKS = [
  { path: "apk/zenbox-debug.apk", label: "zenbox.apk" },
  { path: "apk/zenbox-control-debug.apk", label: "zenbox-control.apk" },
];

const [repo, tag, ...rest] = process.argv.slice(2);
const name = rest.includes("--name") ? rest[rest.indexOf("--name") + 1] : undefined;
const notes = rest.includes("--notes") ? rest[rest.indexOf("--notes") + 1] : undefined;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Missing GITHUB_TOKEN — set it in your environment first (e.g. GITHUB_TOKEN=ghp_xxx).");
  process.exit(1);
}
if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
  console.error("Usage: GITHUB_TOKEN=ghp_xxx node scripts/gh-release.mjs <owner/repo> <tag> [--name …] [--notes …]");
  process.exit(1);
}
if (!tag) {
  console.error("Missing tag — e.g. v3.0");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "zenbox-release",
};

async function gh(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers ?? {}) } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(`${opts.method ?? "GET"} ${url} → ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

// 1 — check the APK files exist.
for (const apk of APKS) {
  const full = resolve(apk.path);
  try {
    if (statSync(full).size === 0) throw new Error("empty file");
  } catch {
    console.error(`APK not found or empty: ${apk.path} — run \`npm run apk:build\` first.`);
    process.exit(1);
  }
}

// 2 — create the release (reuse an existing release with the same tag if present).
let release;
try {
  release = await gh(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  console.log(`ℹ Release ${tag} already exists — uploading assets to it.`);
} catch {
  release = await gh(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: (name ?? tag).slice(0, 100),
      body: (notes ?? `Zenbox ${tag} — signed Android APKs for the studio and the Control app.`).slice(0, 8000),
      draft: false,
      prerelease: false,
    }),
  });
  console.log(`✓ Release created: ${release.html_url}`);
}

// 3 — upload each APK as a release asset.
const uploadBase = release.upload_url.replace(/\{[^}]*\}$/, "");
for (const apk of APKS) {
  const data = readFileSync(resolve(apk.path));
  const url = `${uploadBase}?name=${encodeURIComponent(apk.label)}`;
  console.log(`↑ Uploading ${apk.label} (${(data.length / 1024 / 1024).toFixed(1)} MB)…`);
  const asset = await gh(url, {
    method: "POST",
    headers: { "Content-Type": "application/vnd.android.package-archive", "Content-Length": String(data.length) },
    body: data,
  });
  console.log(`  ✓ ${asset.browser_download_url ?? asset.url}`);
}

console.log("\nDone! Use these URLs:");
console.log(`  Release: ${release.html_url}`);
for (const apk of APKS) {
  console.log(`  Asset:   https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(apk.label)}`);
}
console.log("\nPaste the studio/control asset URL into the Control app's \"APK download URL\" field to wire in-app updates.");
