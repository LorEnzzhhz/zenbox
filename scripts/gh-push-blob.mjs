#!/usr/bin/env node
// Push a single (possibly large) file to a GitHub repo using the Git Data API
// (blob -> tree -> commit -> update ref). The Contents API refuses files it
// deems "too large"; the blobs endpoint accepts up to 100 MB raw.
//
// Usage: GITHUB_TOKEN=ghp_xxx node scripts/gh-push-blob.mjs <owner/repo> <path> <commit-message>

import { readFileSync } from "node:fs";

const [repo, rel, message] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
if (!token || !repo || !rel || !message) {
  console.error("Usage: GITHUB_TOKEN=ghp_xxx node scripts/gh-push-blob.mjs <owner/repo> <path> <message>");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "zenbox-source-push",
};

async function api(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers, ...opts });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${opts.method ?? "GET"} ${path}: HTTP ${res.status} ${body.message ?? ""}`);
  }
  return body;
}

const content = readFileSync(rel).toString("base64");
console.log(`Blob payload: ${(content.length / 1048576).toFixed(1)} MB (base64) for ${rel}`);

// 1. Current main tip so the new commit sits on top of it.
const ref = await api("/git/refs/heads/main");
const headCommit = await api(`/git/commits/${ref.object.sha}`);
console.log("Base commit:", headCommit.sha.slice(0, 7), "tree:", headCommit.tree.sha.slice(0, 7));

// 2. Upload the file as a blob.
const blob = await api("/git/blobs", {
  method: "POST",
  body: JSON.stringify({ content, encoding: "base64" }),
});
console.log("Blob:", blob.sha.slice(0, 7));

// 3. New tree = parent tree + this file (replace if it already exists).
const tree = await api("/git/trees", {
  method: "POST",
  body: JSON.stringify({
    base_tree: headCommit.tree.sha,
    tree: [{ path: rel, mode: "100644", type: "blob", sha: blob.sha }],
  }),
});
console.log("Tree:", tree.sha.slice(0, 7));

// 4. Commit on top of main.
const commit = await api("/git/commits", {
  method: "POST",
  body: JSON.stringify({
    message,
    tree: tree.sha,
    parents: [headCommit.sha],
  }),
});
console.log("Commit:", commit.sha.slice(0, 7));

// 5. Fast-forward main.
await api("/git/refs/heads/main", {
  method: "PATCH",
  body: JSON.stringify({ sha: commit.sha, force: false }),
});
console.log(`Done: ${rel} pushed to main (${commit.sha}).`);
