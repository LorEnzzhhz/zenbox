import { v } from "convex/values";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";
import { resolveOpenrouterKey } from "./ai";

// ---------------------------------------------------------------------------
// Plugins & Skills — imported from a GitHub repo or derived from a website.
// Enabled plugins extend the system prompt of every conversation (see
// chatCore.withPlugins), so they work with streaming and fallback alike.
// ---------------------------------------------------------------------------

/** Analysis models — DeepSeek V4 Flash first (the same model class this
 *  assistant runs on), GPT-OSS 20B as a safe fallback. Both are free on
 *  OpenRouter when available. */
const ANALYSIS_MODELS = ["deepseek/deepseek-v4-flash:free", "openai/gpt-oss-20b:free"];
const MAX_CONTEXT_CHARS = 28_000;

/** Optional GitHub token from the project Keys tab — makes the search + readme
 *  API calls authenticated (5,000 req/hr instead of 10 req/min) and avoids
 *  the shared-IP rate limit that makes plugin discovery feel broken. */
function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  const base: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "zenbox" };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

export type PluginProposal = {
  name: string;
  description: string;
  capabilities: string[];
  features: string[];
  systemPrompt: string;
  source: "github" | "site";
  repoUrl?: string;
  siteUrl?: string;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** All plugins for the signed-in user, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];
    return await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

/** Enabled plugins for the current user — consumed by the chat paths. */
export const enabled = query({
  args: {},
  handler: async (ctx): Promise<Array<{ name: string; systemPrompt: string }>> => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];
    const plugins = await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return plugins
      .filter((p) => p.enabled)
      .map((p) => ({ name: p.name, systemPrompt: p.systemPrompt }));
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    source: v.union(v.literal("github"), v.literal("site")),
    repoUrl: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    capabilities: v.array(v.string()),
    features: v.array(v.string()),
    systemPrompt: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const name = args.name.trim();
    if (!name) throw new Error("Plugin name is required");
    if (name.length > 80) throw new Error("Plugin name is too long");

    // Prevent duplicate installs of the same source.
    const existing = await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (
      existing.some(
        (p) =>
          (args.repoUrl && p.repoUrl === args.repoUrl) ||
          (args.siteUrl && p.siteUrl === args.siteUrl),
      )
    ) {
      throw new Error("That plugin is already installed.");
    }

    await ctx.db.insert("plugins", {
      userId: user._id,
      name,
      description: args.description.slice(0, 500),
      source: args.source,
      repoUrl: args.repoUrl,
      siteUrl: args.siteUrl,
      capabilities: args.capabilities.slice(0, 12),
      features: args.features.slice(0, 12),
      systemPrompt: args.systemPrompt.slice(0, 3000),
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const setEnabled = mutation({
  args: { pluginId: v.id("plugins"), enabled: v.boolean() },
  handler: async (ctx, { pluginId, enabled }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const plugin = await ctx.db.get(pluginId);
    if (plugin === null || plugin.userId !== user._id) throw new Error("Plugin not found");
    await ctx.db.patch(pluginId, { enabled });
  },
});

export const remove = mutation({
  args: { pluginId: v.id("plugins") },
  handler: async (ctx, { pluginId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const plugin = await ctx.db.get(pluginId);
    if (plugin === null || plugin.userId !== user._id) throw new Error("Plugin not found");
    await ctx.db.delete(pluginId);
  },
});

// ---------------------------------------------------------------------------
// GitHub discovery
// ---------------------------------------------------------------------------

/** Search GitHub repos. Unauthenticated search is rate-limited (10/min) but
 *  plenty for browsing. */
export const searchGithub = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<
    Array<{
      full_name: string;
      description: string | null;
      html_url: string;
      stargazers_count: number;
      language: string | null;
      topics: string[];
    }>
  > => {
    const q = query.trim();
    if (!q) return [];
    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=12`,
      { headers: githubHeaders() },
    );
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        throw new Error(
          process.env.GITHUB_TOKEN
            ? "GitHub rate limit reached — wait a minute and try again."
            : "GitHub rate limit reached (shared network). Add a free GITHUB_TOKEN in the project Keys tab to lift it, then try again.",
        );
      }
      throw new Error(`GitHub search failed (${res.status})`);
    }
    const payload = (await res.json()) as {
      items?: Array<{
        full_name: string;
        description: string | null;
        html_url: string;
        stargazers_count: number;
        language: string | null;
        topics?: string[];
      }>;
    };
    return (payload.items ?? []).map((r) => ({
      full_name: r.full_name,
      description: r.description,
      html_url: r.html_url,
      stargazers_count: r.stargazers_count,
      language: r.language,
      topics: (r.topics ?? []).slice(0, 8),
    }));
  },
});

/** Analyze a GitHub repo (owner/name) into a plugin proposal from its README
 *  and metadata. Returns a proposal; nothing is stored until the client calls
 *  `create`. */
export const analyzeGithub = action({
  args: { repo: v.string() },
  handler: async (ctx, { repo }): Promise<PluginProposal> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const full = repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) {
      throw new Error("That doesn't look like an owner/repo (e.g. vercel/next.js).");
    }

    // Repo metadata
    const metaRes = await fetch(`https://api.github.com/repos/${full}`, {
      headers: githubHeaders(),
    });
    if (!metaRes.ok) {
      throw new Error(
        metaRes.status === 404 ? `Repo "${full}" not found.` : `GitHub request failed (${metaRes.status}).`,
      );
    }
    const meta = (await metaRes.json()) as {
      full_name: string;
      description: string | null;
      html_url: string;
      language: string | null;
      topics?: string[];
    };

    // README (raw)
    let readme = "";
    const readmeRes = await fetch(`https://api.github.com/repos/${full}/readme`, {
      headers: { ...githubHeaders(), Accept: "application/vnd.github.raw" },
    });
    if (readmeRes.ok) {
      readme = (await readmeRes.text()).slice(0, MAX_CONTEXT_CHARS);
    }

    const context = [
      `# ${meta.full_name}`,
      meta.description ? `Description: ${meta.description}` : "",
      meta.language ? `Language: ${meta.language}` : "",
      meta.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
      "---",
      readme || "(no README available)",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_CONTEXT_CHARS);

    const proposal = await analyzeWithModel(ctx, userId, context);
    return {
      ...proposal,
      name: proposal.name || meta.full_name.split("/").pop() || meta.full_name,
      description: proposal.description || meta.description || `Plugin derived from ${meta.full_name}.`,
      source: "github",
      repoUrl: meta.html_url,
    };
  },
});

// ---------------------------------------------------------------------------
// Website → plugin
// ---------------------------------------------------------------------------

/** Analyze a website into a plugin proposal. The site can be given as a URL to
 *  fetch, or as a file the user uploaded (storageId of an HTML/text document
 *  stored via api.files.generateUploadUrl). */
export const analyzeSite = action({
  args: {
    url: v.optional(v.string()),
    storageId: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, { url, storageId, fileName }): Promise<PluginProposal> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    let html = "";
    let seedName = "";

    if (storageId) {
      const urls = await ctx.runQuery(api.files.getAttachmentUrls, { storageIds: [storageId] });
      const fileUrl = urls[storageId] ?? null;
      if (!fileUrl) throw new Error("Could not read the uploaded file.");
      const res = await fetch(fileUrl);
      if (!res.ok) throw new Error("Could not read the uploaded file.");
      const text = await res.text();
      if (text.length === 0) throw new Error("The file is empty.");
      // Binary files (zip, pdf…) decode as garbage — only analyze text-like files.
      const binary = (text.match(/\u0000/g) ?? []).length / Math.max(1, text.length);
      if (binary > 0.05) {
        throw new Error("That file looks binary — upload an HTML, text, or markdown file instead.");
      }
      html = text;
      seedName = (fileName ?? "uploaded site").replace(/\.[^.]+$/, "");
    } else if (url) {
      let target = url.trim();
      if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
      const res = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Zenbox/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "That page doesn't exist (404)."
            : `Could not fetch the site (${res.status}) — it may block automated access. Try uploading the HTML file instead.`,
        );
      }
      html = await res.text();
      seedName = new URL(target).hostname.replace(/^www\./, "");
    } else {
      throw new Error("Paste a URL or upload a file to analyze.");
    }

    const context = extractSiteContext(html);
    if (!context.trim()) {
      throw new Error("Could not extract any readable content from that site.");
    }

    const proposal = await analyzeWithModel(ctx, userId, context);
    return {
      ...proposal,
      name: proposal.name || seedName || "Website plugin",
      description: proposal.description || `Plugin derived from ${seedName}.`,
      source: "site",
      siteUrl: url?.trim() || undefined,
    };
  },
});

// ---------------------------------------------------------------------------
// Shared analysis
// ---------------------------------------------------------------------------

const ANALYSIS_SYSTEM = `You are a product analyst for an AI plugin marketplace. Given a website or repository's content, produce a specification for an AI assistant plugin that encapsulates what that product does.

Respond with ONLY valid JSON (no markdown fences), exactly this shape:
{
  "name": "short, memorable plugin name (2-4 words)",
  "description": "one sentence about what the plugin adds",
  "capabilities": ["4-8 concise strings describing what the assistant can now do with this plugin"],
  "features": ["2-5 concrete features that could be added to make it an even better plugin"],
  "systemPrompt": "instructions for the AI assistant to act as this plugin (2-5 sentences, second person, actionable)"
}`;

/** Ask the model to distill the context into a plugin spec; falls back to a
 *  heuristic when no API key is configured or the model call fails. */
async function analyzeWithModel(
  ctx: ActionCtx,
  userId: Id<"users">,
  context: string,
): Promise<Omit<PluginProposal, "source" | "repoUrl" | "siteUrl">> {
  const key = await resolveOpenrouterKey(ctx, userId);
  if (key) {
    // Try each analysis model in turn (DeepSeek V4 Flash, then GPT-OSS 20B) so
    // a model that isn't live on the gateway never blocks plugin discovery.
    for (const model of ANALYSIS_MODELS) {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: ANALYSIS_SYSTEM },
              { role: "user", content: `Website / repository content:\n\n${context.slice(0, MAX_CONTEXT_CHARS)}` },
            ],
            max_tokens: 1200,
            temperature: 0.3,
          }),
        });
        if (!res.ok) continue;
        const payload = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = payload.choices?.[0]?.message?.content ?? "";
        const parsed = parsePluginJson(raw);
        if (parsed && parsed.name && parsed.systemPrompt) {
          return {
            name: parsed.name.trim().slice(0, 80),
            description: (parsed.description || "").trim().slice(0, 500),
            capabilities: (parsed.capabilities ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 12),
            features: (parsed.features ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 12),
            systemPrompt: parsed.systemPrompt.trim().slice(0, 3000),
          };
        }
      } catch {
        /* try the next model */
      }
    }
  }

  // Heuristic fallback — works with no API key at all.
  const firstLine = context.split("\n").find((l) => l.trim().length > 0) ?? "";
  const title = firstLine.replace(/^#+\s*/, "").trim().slice(0, 60) || "Website";
  return {
    name: title,
    description: `Plugin derived from "${title}". Enable it to give the assistant knowledge and skills from this source.`,
    capabilities: [`Answers questions grounded in ${title}`],
    features: [],
    systemPrompt: `You have knowledge derived from "${title}". Use it to answer questions accurately and clearly, and say when you're unsure.`,
  };
}

/** Parse the model's JSON, tolerating markdown fences and trailing text. */
function parsePluginJson(raw: string): {
  name?: string;
  description?: string;
  capabilities?: unknown[];
  features?: unknown[];
  systemPrompt?: string;
} | null {
  try {
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
      features: Array.isArray(parsed.features) ? parsed.features : [],
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : undefined,
    };
  } catch {
    return null;
  }
}

/** Rough HTML → readable text: title, meta description, headings, paragraphs. */
function extractSiteContext(html: string): string {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const description =
    (html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? "").trim();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const sections = [title && `# ${title}`, description && `Description: ${description}`, stripped]
    .filter(Boolean)
    .join("\n\n");
  return sections.slice(0, MAX_CONTEXT_CHARS);
}
