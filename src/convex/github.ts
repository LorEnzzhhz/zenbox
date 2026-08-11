// GitHub integration — real GitHub API calls wired to the app's GitHub plugin.
// The AI requests operations with `@github: …` telemetry markers; the client
// executes these actions and surfaces the result in the Activity panel.
//
// All actions use the project's GITHUB_TOKEN (set in the project Keys tab).
// Guest/anonymous accounts are blocked — only signed-in users can push to the
// developer's GitHub.

import { v } from "convex/values";
import { action, query, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";

type GhResult = { ok: boolean; error?: string; [key: string]: unknown };

function ghToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t || !t.trim()) {
    throw new Error(
      "GitHub is not connected — add a GITHUB_TOKEN in the project Keys tab (Settings → GitHub), then try again.",
    );
  }
  return t.trim();
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "zenbox",
  };
}

/** Parse a GitHub error response into a readable message. */
async function ghError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; errors?: Array<{ message?: string }> };
    if (body.message) {
      const detail = (body.errors ?? []).map((e) => e.message).filter(Boolean).join("; ");
      return detail ? `${body.message} (${detail})` : body.message;
    }
  } catch {
    /* ignore */
  }
  return `${fallback} (HTTP ${res.status})`;
}

/** Whether the signed-in user is allowed to use GitHub (not a guest). */
export const canUseGithub = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user !== null && !user.isAnonymous;
  },
});

/** Require a signed-in, non-guest user. Actions can't read the DB directly,
 *  so the guest check rides through a query (same pattern as api.updates.isAdmin). */
async function requireUser(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const allowed = await ctx.runQuery(api.github.canUseGithub, {});
  if (!allowed) throw new Error("Guests can't use GitHub — sign in with an account first.");
  return userId;
}

/** Whether GitHub is connected and who it belongs to. Safe to call from the UI. */
export const status = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; username: string | null; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { configured: false, username: null, error: null };
    if (!process.env.GITHUB_TOKEN) return { configured: false, username: null, error: null };
    try {
      const res = await fetch("https://api.github.com/user", { headers: ghHeaders(process.env.GITHUB_TOKEN) });
      if (!res.ok) return { configured: true, username: null, error: null };
      const data = (await res.json()) as { login?: string };
      return { configured: true, username: data.login ?? null, error: null };
    } catch {
      return { configured: true, username: null, error: null };
    }
  },
});

/** Create a GitHub repository under the token's account. */
export const createRepo = action({
  args: { name: v.string(), description: v.optional(v.string()), isPrivate: v.optional(v.boolean()) },
  handler: async (ctx, { name, description, isPrivate }): Promise<GhResult> => {
    await requireUser(ctx);
    const token = ghToken();
    const repoName = name.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\s+/g, "-");
    if (!/^[\w.-]{1,100}$/.test(repoName)) return { ok: false, error: "Invalid repo name." };
    try {
      const res = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({
          name: repoName,
          description: (description ?? "").trim().slice(0, 200) || undefined,
          private: Boolean(isPrivate),
          auto_init: true,
        }),
      });
      if (!res.ok) return { ok: false, error: await ghError(res, "Could not create the repo") };
      const data = (await res.json()) as { full_name?: string; html_url?: string };
      return { ok: true, fullName: data.full_name ?? repoName, url: data.html_url ?? `https://github.com/${repoName}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "GitHub request failed" };
    }
  },
});

/** Push files to a repo (create or update each via the Contents API). */
export const pushFiles = action({
  args: {
    repo: v.string(),
    branch: v.optional(v.string()),
    message: v.string(),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
  },
  handler: async (ctx, { repo, branch, message, files }): Promise<GhResult> => {
    await requireUser(ctx);
    const token = ghToken();
    const full = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return { ok: false, error: "Repo must be owner/name (e.g. you/my-app)." };
    if (files.length === 0) return { ok: false, error: "No files to push." };

    // Resolve the branch (defaults to the repo's default branch).
    let ref = branch?.trim() || "";
    if (!ref) {
      try {
        const metaRes = await fetch(`https://api.github.com/repos/${full}`, { headers: ghHeaders(token) });
        if (metaRes.ok) {
          const meta = (await metaRes.json()) as { default_branch?: string };
          ref = meta.default_branch ?? "main";
        } else {
          return { ok: false, error: await ghError(metaRes, `Repo "${full}" not accessible`) };
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Could not resolve the repo branch" };
      }
    }

    const commitMsg = message.trim() || `Update from Zenbox (${new Date().toISOString()})`;
    const pushed: string[] = [];

    try {
      for (const file of files) {
        const path = file.path.replace(/^\/+/, "");
        if (!path || path.length > 255) {
          return { ok: false, error: `Invalid file path "${file.path}".` };
        }
        // Existing file? Need its current sha to update it.
        let sha: string | null = null;
        const headRes = await fetch(
          `https://api.github.com/repos/${full}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
          { headers: ghHeaders(token) },
        );
        if (headRes.ok) {
          const existing = (await headRes.json()) as { sha?: string };
          sha = existing.sha ?? null;
        }
        const body: Record<string, unknown> = {
          message: commitMsg,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: ref,
        };
        if (sha) body.sha = sha;
        const putRes = await fetch(`https://api.github.com/repos/${full}/contents/${encodeURIComponent(path)}`, {
          method: "PUT",
          headers: ghHeaders(token),
          body: JSON.stringify(body),
        });
        if (!putRes.ok) return { ok: false, error: await ghError(putRes, `Could not write ${path}`) };
        pushed.push(path);
      }
      return {
        ok: true,
        pushed: pushed.length,
        files: pushed,
        repo: full,
        branch: ref,
        url: `https://github.com/${full}/commits/${encodeURIComponent(ref)}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Push failed" };
    }
  },
});

/** Create a GitHub release, optionally uploading an asset (e.g. the built APK). */
export const createRelease = action({
  args: {
    repo: v.string(),
    tag: v.string(),
    name: v.optional(v.string()),
    notes: v.optional(v.string()),
    assetUrl: v.optional(v.string()),
  },
  handler: async (ctx, { repo, tag, name, notes, assetUrl }): Promise<GhResult> => {
    await requireUser(ctx);
    const token = ghToken();
    const full = repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) return { ok: false, error: "Repo must be owner/name." };
    const tagName = tag.trim();
    if (!tagName) return { ok: false, error: "A tag is required (e.g. v3.0)." };

    try {
      const res = await fetch(`https://api.github.com/repos/${full}/releases`, {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({
          tag_name: tagName,
          name: (name ?? tagName).trim().slice(0, 100),
          body: (notes ?? "").trim().slice(0, 8000),
          draft: false,
          prerelease: false,
        }),
      });
      if (!res.ok) return { ok: false, error: await ghError(res, "Could not create the release") };
      const release = (await res.json()) as { id: number; html_url?: string; upload_url?: string };

      // Attach the APK/asset if a URL was provided.
      let assetUrlResult: string | null = null;
      if (assetUrl && assetUrl.trim() && release.id) {
        const asset = assetUrl.trim();
        const fileName =
          (asset.split("/").pop()?.split("?")[0]) || "asset.apk";
        try {
          const dl = await fetch(asset, { redirect: "follow" });
          if (!dl.ok) {
            return { ok: false, error: `Release created, but the asset download failed (HTTP ${dl.status}).` };
          }
          const data = await dl.arrayBuffer();
          const up = await fetch(
            `https://api.github.com/repos/${full}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`,
            {
              method: "POST",
              headers: {
                ...ghHeaders(token),
                "Content-Type": "application/octet-stream",
              },
              body: data,
            },
          );
          if (up.ok) {
            const uploaded = (await up.json()) as { browser_download_url?: string };
            assetUrlResult = uploaded.browser_download_url ?? null;
          } else {
            return { ok: false, error: `Release created, but the asset upload failed (HTTP ${up.status}).` };
          }
        } catch (err) {
          return {
            ok: false,
            error: `Release created, but the asset upload failed: ${err instanceof Error ? err.message : "network error"}`,
          };
        }
      }

      return {
        ok: true,
        url: release.html_url ?? `https://github.com/${full}/releases/tag/${tagName}`,
        assetUrl: assetUrlResult,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "GitHub request failed" };
    }
  },
});
