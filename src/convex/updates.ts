import { v } from "convex/values";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";
import { resolveOpenCodeKey, resolveOpenrouterKey } from "./ai";
import { updateChangeValidator } from "./schema";

// ---------------------------------------------------------------------------
// The developer's Control app — an updater companion to the Zenbox studio.
//
// When the developer issues a command ("make the app better", "fix the error:
// …"), the AI runs a three-phase pipeline:
//   1. PLAN    — a concrete implementation plan
//   2. REVISE  — the plan refined into a final specification
//   3. REVIEW  — a critical review with a verdict + a structured change list
// The developer reviews the artifacts and ships the update with one click;
// every studio user then sees a release notice.
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: ActionCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Not authenticated");
  const isAdminUser = await ctx.runQuery(api.updates.isAdmin, {});
  if (!isAdminUser) throw new Error("Admins only");
  return userId;
}

/** Role check used by the phase actions (actions can't read the DB directly). */
export const isAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user?.role === "admin";
  },
});

// ---- model calls -----------------------------------------------------------

type PhaseResult = { text: string; error: string | null };

/** Preferred model for the pipeline: strong enough to plan, revise, and
 *  review without hallucinating JSON. The Zen gateway takes the bare model id
 *  (no `opencode/` prefix) — see ai.ts / http.ts. */
function pickModel(provider: string): string {
  if (provider === "opencode") return "deepseek-v4-flash-free";
  return "openai/gpt-4o-mini:free";
}

async function runPhase(ctx: ActionCtx, userId: Id<"users">, system: string, user: string): Promise<PhaseResult> {
  const zenKey = await resolveOpenCodeKey(ctx, userId);
  const orKey = await resolveOpenrouterKey(ctx, userId);
  const provider = zenKey ? "opencode" : orKey ? "openrouter" : null;
  if (!provider) {
    return {
      text: "",
      error:
        "No API key configured. Add a free OpenCode Zen key (Settings → OpenCode Zen) or an OpenRouter key to run the analysis.",
    };
  }

  const model = pickModel(provider);
  const endpoint =
    provider === "opencode"
      ? "https://opencode.ai/zen/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";
  const key = provider === "opencode" ? zenKey : orKey;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 6000,
      }),
    });
    if (!res.ok) {
      let detail = `Model error ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body.error?.message) detail = body.error.message;
      } catch {
        /* ignore */
      }
      return { text: "", error: detail };
    }
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) return { text: "", error: "The model returned an empty response. Try again." };
    return { text, error: null };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : "Request failed. Try again." };
  }
}

const APP_CONTEXT = [
  "Zenbox is a minimal AI studio (React + Vite + Convex): one unified mode that auto-routes chat / code /",
  "image / writing / deep-research, live AI activity panel with plan-first execution and visible reasoning,",
  "token streaming, a built-in sandbox with a virtual Linux shell + file system (downloadable files), plugins",
  "& skills (installable from GitHub or any website), free models via OpenRouter and the OpenCode Zen gateway",
  "(Big Pickle, 200K context, DeepSeek V4 Flash), guest access with admin monitoring, and a monochrome minimal UI.",
].join(" ");

/** Extra scope instructions for "Mega update" mode — a complete overhaul rather
 *  than an incremental fix. */
function megaScope(mega: boolean): string {
  if (!mega) return "";
  return [
    "The developer wants a MEGA overhaul — not incremental tweaks.",
    "- Treat this as a full rebuild: rethink layouts, animations, settings, and flows.",
    "- Propose bold, visible changes: new animations, redesigned screens, extra settings, better sandbox, faster pipeline.",
    "- Every area of the app that the command touches should get a substantive improvement.",
    "- Prefer larger, structural changes over small wording edits.",
  ].join("\n");
}

// ---- phase prompts ----------------------------------------------------------

const PLAN_SYSTEM = [
  "You are the lead engineer of Zenbox (see app context).",
  "The developer gave you a command. Produce a concrete, ambitious implementation plan.",
  "Rules:",
  "- Numbered steps, grouped by area (UI, backend, settings, animations, pipeline, sandbox, etc.).",
  "- Be SPECIFIC: name exact components, files, and UI changes — not just 'improve X'.",
  "- Every step must be a real, visible change — not 'add better error handling' but 'add toast on failed save with retry button'.",
  "- Flag risks or dependencies per step.",
  "- Target 6-15 steps. Under 600 words, markdown.",
].join("\n");

const REVISE_SYSTEM = [
  "You are the lead engineer of Zenbox, refining a plan into the final specification.",
  "Rules:",
  "- Rewrite the given plan as a final, actionable specification — make every change concrete.",
  "- State the exact changes per area, what each change does and why, and any pitfalls to avoid.",
  "- For each change: name the file, the component, and the behavior change.",
  "- Under 700 words, markdown.",
].join("\n");

/** String-aware balanced-brace scan: find the `}` that closes the object that
 *  opens at `openIdx`, ignoring braces inside quoted strings. */
function findJsonObjectEnd(text: string, openIdx: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Collect every parseable JSON object from model text: the whole reply first,
 *  then each balanced `{…}` pair (string-aware scan). Nested arrays/objects
 *  and prose wrappers can't hide the payload, because every candidate is
 *  returned and the callers pick the first one with the shape they need. */
function tryParseJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const key = raw.trim();
        if (!seen.has(key)) {
          seen.add(key);
          results.push(parsed);
        }
      }
    } catch {
      /* skip unparseable candidates */
    }
  };
  // Models often return bare JSON — try the whole reply first.
  add(text);
  // Then every balanced `{…}` pair, scanning backwards from the last `{`.
  // NOTE: lastIndexOf clamps a negative fromIndex to 0, so guard the
  // decrement to avoid re-processing the first `{` forever.
  let start = text.lastIndexOf("{");
  while (start >= 0) {
    const end = findJsonObjectEnd(text, start);
    if (end !== -1) add(text.slice(start, end + 1));
    const next = text.lastIndexOf("{", start - 1);
    if (next === start) break;
    start = next;
  }
  return results;
}

function extractJson(text: string): { verdict: string; changes: Array<{ title: string; detail: string }> } | null {
  // Strip markdown code fences, then pull the JSON object out of the reply.
  const cleaned = text.replace(/```(?:json)?\s*/gi, "");
  for (const candidate of tryParseJsonObjects(cleaned)) {
    const parsed = candidate as {
      verdict?: string;
      changes?: Array<{ title?: string; detail?: string }>;
    };
    const changes = (parsed.changes ?? [])
      .map((c) => ({ title: String(c.title ?? "").trim(), detail: String(c.detail ?? "").trim() }))
      .filter((c) => c.title.length > 0);
    if (changes.length > 0 || (parsed.verdict ?? "").trim().length > 0) {
      return { verdict: String(parsed.verdict ?? "").trim(), changes };
    }
  }

  // Fallback: no valid JSON at all — extract a pseudo-verdict from the raw text.
  const first300 = text.replace(/```.*/g, "").trim().slice(0, 400);
  if (first300.length > 40) {
    return {
      verdict: first300,
      changes: [
        {
          title: "Review completed",
          detail: first300.slice(0, 600),
        },
      ],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The most recent shipped update — drives the release notice for all users. */
export const latestShipped = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    const shipped = await ctx.db
      .query("updates")
      .withIndex("by_created")
      .order("desc")
      .take(20);
    return shipped.find((u) => u.status === "shipped") ?? null;
  },
});

/** Every update, newest first — the Control app's history. Admins only. */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null || user.role !== "admin") return [];
    return await ctx.db.query("updates").withIndex("by_created").order("desc").take(100);
  },
});

// ---------------------------------------------------------------------------
// Phase actions (admin)
// ---------------------------------------------------------------------------

export const planUpdate = action({
  args: { command: v.string(), mega: v.optional(v.boolean()) },
  handler: async (ctx, { command, mega }): Promise<{ plan: string; error: string | null }> => {
    const userId = await requireAdmin(ctx);
    const c = command.trim();
    if (!c) return { plan: "", error: "Empty command" };
    const result = await runPhase(
      ctx,
      userId,
      PLAN_SYSTEM,
      `Developer command: "${c}"\n\nApp context: ${APP_CONTEXT}\n\n${megaScope(Boolean(mega))}`,
    );
    return { plan: result.text, error: result.error };
  },
});

export const reviseUpdate = action({
  args: { command: v.string(), plan: v.string(), mega: v.optional(v.boolean()) },
  handler: async (ctx, { command, plan, mega }): Promise<{ revised: string; error: string | null }> => {
    const userId = await requireAdmin(ctx);
    const result = await runPhase(
      ctx,
      userId,
      REVISE_SYSTEM,
      `Developer command: "${command.trim()}"\n\nCurrent plan:\n${plan}\n\nApp context: ${APP_CONTEXT}\n\n${megaScope(Boolean(mega))}`,
    );
    return { revised: result.text, error: result.error };
  },
});

export const reviewUpdate = action({
  args: { command: v.string(), revised: v.string(), mega: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { command, revised, mega },
  ): Promise<{ review: string; verdict: string; changes: Array<{ title: string; detail: string }>; error: string | null }> => {
    const userId = await requireAdmin(ctx);
    const reviewSystem = [
      "You are a senior reviewer performing a final critical review of a proposed update to Zenbox.",
      "Evaluate EVERY proposed change for: correctness, missing pieces, risks, UX, and whether it's a visible/real improvement.",
      "If a change is vague or trivial (e.g. 'improve error handling' without specifics), flag it and demand a concrete alternative.",
      megaScope(Boolean(mega)).length > 0
        ? "This is a MEGA overhaul — demand 12-25 concrete changes. Every area the command touches must have a visible, substantive change."
        : "Include 8-15 concrete changes — every one must be a visible, specific improvement to the user (not 'improve X' but 'add X button that does Y').",
      "Then return ONLY a JSON object with exactly this shape:",
      '{"verdict": "<2-4 sentence summary covering scope, risk, and whether the changes are big enough>", "changes": [{"title": "<short, specific change title>", "detail": "<exactly what changes and why — must be 10+ words>"}]}',
      "No markdown fences, no extra text.",
    ].join("\n");
    const result = await runPhase(
      ctx,
      userId,
      reviewSystem,
      `Developer command: "${command.trim()}"\n\nProposed specification:\n${revised}`,
    );
    if (result.error) return { review: "", verdict: "", changes: [], error: result.error };

    const parsed = extractJson(result.text);
    if (!parsed || parsed.changes.length === 0) {
      return {
        review: result.text,
        verdict: result.text.slice(0, 400),
        changes: [{ title: "Review completed", detail: result.text.slice(0, 600) }],
        error: null,
      };
    }
    return { review: result.text, verdict: parsed.verdict, changes: parsed.changes, error: null };
  },
});

/** Parse the Verify phase's JSON: overall verdict + per-change statuses. */
function extractVerifyJson(text: string): {
  overall: string;
  perChange: Array<{ title: string; status: string; note: string }>;
  gaps: string[];
} | null {
  const cleaned = text.replace(/```(?:json)?\s*/gi, "");
  for (const candidate of tryParseJsonObjects(cleaned)) {
    const parsed = candidate as {
      overall?: string;
      perChange?: Array<{ title?: string; status?: string; note?: string }>;
      gaps?: string[];
    };
    const perChange = (parsed.perChange ?? [])
      .map((c) => ({
        title: String(c.title ?? "").trim(),
        status: String(c.status ?? "warn").trim(),
        note: String(c.note ?? "").trim(),
      }))
      .filter((c) => c.title.length > 0);
    if (perChange.length > 0 || (parsed.overall ?? "").trim().length > 0) {
      return {
        overall: String(parsed.overall ?? "review").trim(),
        perChange,
        gaps: (parsed.gaps ?? []).map((g) => String(g).trim()).filter(Boolean),
      };
    }
  }
  return null;
}

const VERIFY_SYSTEM = [
  "You are a release verification engineer for Zenbox. The developer's review produced a list of proposed changes; you are given the app's ACTUAL codebase map.",
  "For EVERY proposed change, verify it against the codebase map:",
  "- status \"ok\": the change targets a real file/component/backend function from the map, is concrete, and would be a visible user-facing improvement.",
  "- status \"warn\": plausible but vague, risky, or would be barely visible to users (e.g. 'improve error handling' without a concrete location).",
  "- status \"missing\": references a file/component/feature that does NOT exist in the map, or the change is impossible/contradictory.",
  "Also list the biggest gaps: missing pieces, files the change forgot to touch, or conflicts between changes.",
  "Return ONLY a JSON object with exactly this shape:",
  '{"overall": "pass|review", "perChange": [{"title": "<change title>", "status": "ok|warn|missing", "note": "<2-3 sentence check: what exists, what is missing, concrete fix>"}], "gaps": ["<gap 1>", "<gap 2>"]}',
  "overall is \"pass\" only when every change is \"ok\". No markdown fences, no extra text.",
].join("\n");

/** Phase 4 — Verify. Checks the reviewed changes against the real codebase
 *  map before the developer ships, so vague or hallucinated changes get
 *  caught instead of being published as an update that 'does nothing'. */
export const verifyUpdate = action({
  args: {
    command: v.string(),
    revised: v.string(),
    changes: v.array(updateChangeValidator),
    codebaseMap: v.string(),
  },
  handler: async (
    ctx,
    { command, revised, changes, codebaseMap },
  ): Promise<{
    review: string;
    overall: "pass" | "review";
    perChange: Array<{ title: string; status: string; note: string }>;
    gaps: string[];
    error: string | null;
  }> => {
    const userId = await requireAdmin(ctx);
    const changeList = changes.map((c) => `- ${c.title}${c.detail ? `: ${c.detail}` : ""}`).join("\n");
    const result = await runPhase(
      ctx,
      userId,
      VERIFY_SYSTEM,
      `Developer command: "${command.trim()}"\n\nProposed specification:\n${revised}\n\nReviewed changes to verify:\n${changeList || "(none listed)"}\n\nActual codebase map:\n${codebaseMap}`,
    );
    if (result.error) return { review: "", overall: "review", perChange: [], gaps: [], error: result.error };

    const parsed = extractVerifyJson(result.text);
    if (!parsed || parsed.perChange.length === 0) {
      return {
        review: result.text,
        overall: "review",
        perChange: changes.map((c) => ({
          title: c.title,
          status: "warn",
          note: "Could not parse a per-change verdict — manually confirm this change exists in the app.",
        })),
        gaps: [],
        error: null,
      };
    }
    return {
      review: result.text,
      overall: parsed.overall === "pass" ? "pass" : "review",
      perChange: parsed.perChange,
      gaps: parsed.gaps,
      error: null,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations (admin)
// ---------------------------------------------------------------------------

/** Persist a reviewed pipeline as a draft, ready to ship. The Verify-phase
 *  results ride along so per-change statuses survive into the History tab. */
export const createDraft = mutation({
  args: {
    title: v.string(),
    command: v.string(),
    plan: v.string(),
    revised: v.string(),
    review: v.string(),
    verdict: v.string(),
    changes: v.array(updateChangeValidator),
    verifyOverall: v.optional(v.union(v.literal("pass"), v.literal("review"))),
    verifyPerChange: v.optional(
      v.array(v.object({ title: v.string(), status: v.string(), note: v.string() })),
    ),
    verifyGaps: v.optional(v.array(v.string())),
    apkUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (user === null || user.role !== "admin") throw new Error("Admins only");
    const latest = await ctx.db.query("updates").withIndex("by_created").order("desc").take(1);
    const version = (latest[0]?.version ?? 0) + 1;
    return await ctx.db.insert("updates", {
      version,
      title: args.title.trim().slice(0, 80) || `Update v${version}`,
      command: args.command,
      plan: args.plan,
      revised: args.revised,
      review: args.review,
      verdict: args.verdict,
      changes: args.changes,
      verifyOverall: args.verifyOverall,
      verifyPerChange: args.verifyPerChange,
      verifyGaps: args.verifyGaps,
      apkUrl: args.apkUrl?.trim().slice(0, 500) || undefined,
      status: "reviewed",
      createdAt: Date.now(),
    });
  },
});

/** Ship a reviewed update — bumps it to "shipped", stamps the time, and every
 *  studio user's next load shows the release notice. When includeNotes is on
 *  (default), a rendered change list is stored as the release notes. An
 *  optional apkUrl (hosted .apk) rides along so the Control Android app can
 *  download and install a real APK. */
export const shipUpdate = mutation({
  args: {
    updateId: v.id("updates"),
    includeNotes: v.optional(v.boolean()),
    apkUrl: v.optional(v.string()),
    apkFor: v.optional(v.union(v.literal("studio"), v.literal("control"))),
  },
  handler: async (ctx, { updateId, includeNotes, apkUrl, apkFor }) => {
    const user = await getCurrentUser(ctx);
    if (user === null || user.role !== "admin") throw new Error("Admins only");
    const update = await ctx.db.get(updateId);
    if (update === null) throw new Error("Update not found");
    if (update.status === "shipped") return;
    if (update.status !== "reviewed") throw new Error("Only reviewed updates can ship");
    const patch: {
      status: "shipped";
      shippedAt: number;
      releaseNotes?: string;
      apkUrl?: string;
      apkFor?: "studio" | "control";
    } = {
      status: "shipped",
      shippedAt: Date.now(),
    };
    if (includeNotes !== false) {
      patch.releaseNotes = update.changes
        .map((c) => `• ${c.title}${c.detail ? ` — ${c.detail}` : ""}`)
        .join("\n");
    }
    if (apkUrl !== undefined) {
      patch.apkUrl = apkUrl.trim().slice(0, 500) || undefined;
      // An APK URL without a stated target defaults to the studio — that's the
      // app this pipeline improves most of the time, and it protects the
      // Control app from installing the studio binary over itself.
      patch.apkFor = apkFor ?? (patch.apkUrl ? "studio" : undefined);
    }
    await ctx.db.patch(updateId, patch);
  },
});
