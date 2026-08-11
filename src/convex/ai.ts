import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { modeValidator, sourceValidator } from "./schema";
import { buildChatMessages, stripTelemetryMarkers, type ChatMessage, type CognitionProfile, type MemoryHit } from "./chatCore";
import { unseal } from "./lib/keys";

// ---------------------------------------------------------------------------
// Key resolution — env keys (Freebuff Keys tab) win, then the user's own key
// saved in Studio → Settings.
// ---------------------------------------------------------------------------

export async function resolveOpenrouterKey(ctx: ActionCtx, userId: Id<"users">) {
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) return envKey;
  const keys = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
  return keys.openrouter ? unseal(keys.openrouter) : null;
}

export async function resolveOpenCodeKey(ctx: ActionCtx, userId: Id<"users">) {
  const envKey = process.env.OPENCODE_API_KEY;
  if (envKey) return envKey;
  const keys = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
  return keys.opencode ? unseal(keys.opencode) : null;
}

/** Which gateway serves a given model id. `opencode/…` → OpenCode Zen, which
 *  hosts Big Pickle (free, 200K context); everything else → OpenRouter. */
export function resolveProvider(model: string): "openrouter" | "opencode" {
  return model.startsWith("opencode/") ? "opencode" : "openrouter";
}

// ---------------------------------------------------------------------------
// "Auto" model — the smart picker from the Hy3 Workbench (the developer's own
// APK). Picks the best free model for the job: code/files → Big Pickle (200K
// context), images and chat → DeepSeek V4 Flash on the Zen gateway; without a
// Zen key it falls back to GPT-OSS 20B on OpenRouter.
// ---------------------------------------------------------------------------

const CODE_RE =
  /code|debug|bug|function|class|api|script|python|javascript|java|c\+\+|sql|html|css|refactor|terminal|shell|test|build|install/;
const IMAGE_RE = /image|picture|draw|generate (an )?image|photo|art/;
const FILE_RE = /file|pdf|docx|xlsx|zip|csv|json|report|document/;

export function resolveApiModel(model: string, content: string, hasZenKey: boolean): string {
  if (model !== "auto") return model;
  const t = String(content || "").toLowerCase();
  if (!hasZenKey) return "openai/gpt-oss-20b:free";
  if (IMAGE_RE.test(t)) return "opencode/deepseek-v4-flash-free";
  if (CODE_RE.test(t) || FILE_RE.test(t)) return "opencode/big-pickle";
  return "opencode/deepseek-v4-flash-free";
}

/** The model id Zenbox itself falls back to after a failed turn — Big Pickle,
 *  exactly like the Hy3 Workbench's retry chain. */
export const RETRY_MODEL = "opencode/big-pickle";

const MAX_TOKENS = 8192;

const memoryHitValidator = v.object({
  q: v.string(),
  a: v.string(),
  title: v.string(),
});

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** Resolve attachment storage ids to public URLs via an internal query. */
async function getAttachmentUrl(ctx: ActionCtx, storageId: string) {
  const urls = await ctx.runQuery(api.files.getAttachmentUrls, { storageIds: [storageId] });
  return urls[storageId] ?? null;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

export type ModelInfo = { id: string; name: string };

const FALLBACK_MODELS: { free: ModelInfo[]; rest: ModelInfo[] } = {
  free: [
    { id: "deepseek/deepseek-v4-flash:free", name: "DeepSeek V4 Flash" },
    { id: "openai/gpt-oss-20b:free", name: "GPT-OSS 20B" },
    { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B" },
    { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B" },
    { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra 550B" },
    { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super 120B" },
    { id: "cohere/north-mini-code:free", name: "Cohere North Mini (code)" },
    { id: "nvidia/nemotron-nano-9b-v2:free", name: "Nemotron Nano 9B" },
    { id: "inclusionai/ling-3.0-tiny:free", name: "Ling 3.0 Tiny" },
    { id: "poolside/laguna-s-2.1:free", name: "Poolside Laguna S" },
  ],
  rest: [
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (pro)" },
    { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3" },
    { id: "tencent/hunyuan-3-250b", name: "Tencent Hunyuan 3 (250B)" },
  ],
};

// OpenCode Zen gateway — free models incl. Big Pickle (200K context) and the
// lineup from the Hy3 Workbench (the developer's own AI app): DeepSeek V4
// Flash, LongCat 2.0, MiMo 2.5, Nemotron 3 Ultra, North Mini Code, Laguna S
// 2.1 and Ling 3.0 Tiny.
const ZEN_MODELS: ModelInfo[] = [
  { id: "opencode/big-pickle", name: "Big Pickle — 200K context" },
  { id: "opencode/deepseek-v4-flash-free", name: "DeepSeek V4 Flash" },
  { id: "opencode/longcat-2.0-free", name: "LongCat 2.0" },
  { id: "opencode/mimo-v2.5-free", name: "MiMo 2.5" },
  { id: "opencode/nemotron-3-ultra-free", name: "Nemotron 3 Ultra" },
  { id: "opencode/north-mini-code-free", name: "North Mini Code" },
  { id: "opencode/laguna-s-2.1-free", name: "Laguna S 2.1" },
  { id: "opencode/ling-3.0-tiny-free", name: "Ling 3.0 Tiny" },
];

const PREFERRED_FREE_IDS = [
  "deepseek/deepseek-v4-flash:free",
  "openai/gpt-oss-20b:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "cohere/north-mini-code:free",
  "nvidia/nemotron-nano-9b-v2:free",
  "inclusionai/ling-3.0-tiny:free",
  "poolside/laguna-s-2.1:free",
];

/** Fetch the model catalog: free OpenRouter models first, the full catalog
 *  (incl. Tencent Hunyuan 3) next, plus the OpenCode Zen group. Falls back to
 *  a curated list when no API key is configured or the request fails. */
export const listModels = action({
  args: {},
  handler: async (ctx): Promise<{
    free: ModelInfo[];
    rest: ModelInfo[];
    zen: ModelInfo[];
    hasKey: boolean;
    hasZenKey: boolean;
  }> => {
    const userId = await getAuthUserId(ctx);
    const key = userId === null ? process.env.OPENROUTER_API_KEY : await resolveOpenrouterKey(ctx, userId);
    const zenKey = Boolean(
      userId === null ? process.env.OPENCODE_API_KEY : await resolveOpenCodeKey(ctx, userId),
    );

    if (!key) {
      return { ...FALLBACK_MODELS, zen: ZEN_MODELS, hasKey: false, hasZenKey: zenKey };
    }

    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        return { ...FALLBACK_MODELS, zen: ZEN_MODELS, hasKey: true, hasZenKey: zenKey };
      }
      const payload = (await res.json()) as {
        data: Array<{ id: string; name?: string; pricing?: { prompt?: string; completion?: string } }>;
      };

      const all = payload.data.map((m) => ({
        id: m.id,
        name: m.name && m.name.trim().length > 0 ? m.name : m.id,
      }));

      const isFree = (id: string) => {
        const m = payload.data.find((x) => x.id === id);
        if (!m?.pricing) return false;
        return Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0;
      };

      const freeAll = all.filter((m) => isFree(m.id));
      const pinned = PREFERRED_FREE_IDS
        .map((id) => freeAll.find((m) => m.id === id))
        .filter((m): m is ModelInfo => m !== undefined);
      const pinnedIds = new Set(pinned.map((m) => m.id));
      const freeRest = freeAll
        .filter((m) => !pinnedIds.has(m.id))
        .sort((a, b) => a.name.localeCompare(b.name));

      const free = [...pinned, ...freeRest];
      const rest = all
        .filter((m) => !isFree(m.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 300);

      return { free, rest, zen: ZEN_MODELS, hasKey: true, hasZenKey: zenKey };
    } catch {
      return { ...FALLBACK_MODELS, zen: ZEN_MODELS, hasKey: true, hasZenKey: zenKey };
    }
  },
});

// ---------------------------------------------------------------------------
// Non-streaming fallback for one assistant turn. Used only when the streaming
// HTTP endpoint is unavailable. The client persists the user message (with any
// attachments) before calling this action; the action appends only the
// assistant reply, on success only.
// ---------------------------------------------------------------------------

type CompleteResult = {
  content: string;
  error: string | null;
  usage?: { prompt: number; completion: number };
};

/** One non-streaming completion with the Hy3 Workbench free-chain retry: try
 *  the resolved model, then fall back to Big Pickle once on gateway errors or
 *  empty replies. Shared by `chat` (single pass) and `qualityChat` (two
 *  passes: draft → self-review). */
async function completeWithRetry(
  ctx: ActionCtx,
  userId: Id<"users">,
  initialModel: string,
  messages: ChatMessage[],
): Promise<CompleteResult> {
  let resolved = initialModel;
  const attempts = resolved === RETRY_MODEL ? 1 : 2;
  let lastError: string | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const provider = resolveProvider(resolved);
    const key =
      provider === "opencode"
        ? await resolveOpenCodeKey(ctx, userId)
        : await resolveOpenrouterKey(ctx, userId);
    if (!key) {
      return {
        content: "",
        error:
          provider === "opencode"
            ? "No OpenCode Zen key configured. Add your free Zen key in Studio → Settings to use Big Pickle."
            : "No OpenRouter API key configured. Add OPENROUTER_API_KEY in the project Keys tab, or paste your own key in Studio → Settings.",
      };
    }

    const endpoint =
      provider === "opencode"
        ? `${ZEN_BASE_URL}/chat/completions`
        : "https://openrouter.ai/api/v1/chat/completions";
    // OpenCode Zen's API takes the bare model id (big-pickle), not the
    // provider-prefixed config id (opencode/big-pickle).
    const upstreamModel = provider === "opencode" ? resolved.replace(/^opencode\//, "") : resolved;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: upstreamModel,
          messages,
          max_tokens: MAX_TOKENS,
        }),
      });

      if (!res.ok) {
        let detail = `${provider === "opencode" ? "OpenCode Zen" : "OpenRouter"} error ${res.status}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) detail = body.error.message;
        } catch {
          /* ignore */
        }
        lastError = detail;
        resolved = RETRY_MODEL;
        continue;
      }

      const payload = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const reply = payload.choices?.[0]?.message?.content?.trim() ?? "";
      const usage =
        payload.usage && (payload.usage.prompt_tokens ?? 0) + (payload.usage.completion_tokens ?? 0) > 0
          ? {
              prompt: payload.usage.prompt_tokens ?? 0,
              completion: payload.usage.completion_tokens ?? 0,
            }
          : undefined;

      if (!reply) {
        lastError = "The model returned an empty response. Try again.";
        resolved = RETRY_MODEL;
        continue;
      }

      return { content: reply, error: null, usage };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Request failed. Please try again.";
      resolved = RETRY_MODEL;
    }
  }

  return { content: "", error: lastError ?? "Request failed. Please try again." };
}

/** Assemble the message array + auth for a conversation turn (shared by the
 *  `chat` and `qualityChat` actions). */
async function buildTurn(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: {
    conversationId: Id<"conversations">;
    content: string;
    mode: string;
    research?: string;
    plan?: string;
    memory?: MemoryHit[];
    profile?: CognitionProfile;
    workspace?: string;
  },
): Promise<{ messages: ChatMessage[]; hasZenKey: boolean }> {
  const conversation = await ctx.runQuery(api.conversations.get, { conversationId: args.conversationId });
  if (conversation === null || conversation.userId !== userId) {
    throw new Error("Conversation not found");
  }
  const history = await ctx.runQuery(api.conversations.messages, { conversationId: args.conversationId });
  const plugins = await ctx.runQuery(api.plugins.enabled, {});
  const messages = await buildChatMessages({
    mode: args.mode as Parameters<typeof buildChatMessages>[0]["mode"],
    history,
    content: args.content,
    plugins,
    research: args.research,
    plan: args.plan,
    memory: args.memory,
    profile: args.profile,
    workspace: args.workspace,
    getAttachmentUrl: (storageId) => getAttachmentUrl(ctx, storageId),
  });
  const hasZenKey = Boolean(await resolveOpenCodeKey(ctx, userId));
  return { messages, hasZenKey };
}

export const chat = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    model: v.string(),
    mode: modeValidator,
    research: v.optional(v.string()),
    plan: v.optional(v.string()),
    memory: v.optional(v.array(memoryHitValidator)),
    sources: v.optional(v.array(sourceValidator)),
    profile: v.optional(
      v.object({
        contextWindow: v.optional(v.string()),
        reasoningEffort: v.optional(v.string()),
        primaryLanguage: v.optional(v.string()),
        systemPrompt: v.optional(v.string()),
        fewShotExamples: v.optional(v.string()),
      }),
    ),
    workspace: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { conversationId, content, model, mode, research, plan, memory, sources, profile, workspace },
  ): Promise<{
    content: string;
    error: string | null;
    usage?: { prompt: number; completion: number } | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const { messages, hasZenKey } = await buildTurn(ctx, userId, {
      conversationId,
      content,
      mode,
      research,
      plan,
      memory: memory as MemoryHit[] | undefined,
      profile: profile as CognitionProfile | undefined,
      workspace,
    });

    const result = await completeWithRetry(ctx, userId, resolveApiModel(model, content, hasZenKey), messages);
    if (result.error) return { content: "", error: result.error, usage: null };

    // Strip live-telemetry markers (`@run:` / `@search:` / `@note:` lines) so
    // the persisted reply never shows them — they only feed the Activity panel.
    const clean = stripTelemetryMarkers(result.content);
    await ctx.runMutation(api.conversations.addMessage, {
      conversationId,
      role: "assistant",
      kind: "text",
      content: clean,
      sources,
      usage: result.usage,
      model,
    });

    return { content: clean, error: null, usage: result.usage ?? null };
  },
});

const PLAN_SYSTEM = [
  "You are Zenbox's planning brain.",
  "The user is about to ask the assistant to build, write, or fix something. Produce a concise numbered implementation plan.",
  "Rules:",
  "- 3 to 6 steps, each on its own line starting with a number and a period.",
  "- Each step must be concrete and actionable: what to build, which file or part it belongs to, and how it should behave.",
  "- If files are involved, name them explicitly.",
  "- Keep it under 220 words. No markdown headers, no code blocks, no commentary outside the steps.",
].join("\n");

/** Plan-first brain: returns a short numbered plan the assistant then follows
 *  when generating the real reply. Shown live in the Activity panel. */
export const makePlan = action({
  args: {
    content: v.string(),
    model: v.string(),
    mode: modeValidator,
  },
  handler: async (ctx, { content, model, mode }): Promise<{ plan: string; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const hasZenKey = Boolean(await resolveOpenCodeKey(ctx, userId));
    const resolved = resolveApiModel(model, content, hasZenKey);
    const result = await completeWithRetry(
      ctx,
      userId,
      resolved,
      [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: content },
      ],
    );
    if (result.error) return { plan: "", error: result.error };
    return { plan: result.content, error: null };
  },
});

const REFINE_INSTRUCTION = [
  "Above is the first draft of your answer.",
  "Now act as a strict reviewer. Check it for factual errors, missing key details, unclear or wordy phrasing, and whether it fully answers the user's original question.",
  "Fix what needs fixing and keep what is good. Return ONLY the final improved answer, in the exact format the user asked for (markdown, code blocks, length, tone).",
  "Do not mention this review process in the reply.",
].join("\n");

/** Best-answer generation: two passes — write a draft, then self-review and
 *  improve it before saving. Slower but noticeably higher quality. The client
 *  shows stage progress while this runs. */
export const qualityChat = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    model: v.string(),
    mode: modeValidator,
    research: v.optional(v.string()),
    plan: v.optional(v.string()),
    memory: v.optional(v.array(memoryHitValidator)),
    sources: v.optional(v.array(sourceValidator)),
    profile: v.optional(
      v.object({
        contextWindow: v.optional(v.string()),
        reasoningEffort: v.optional(v.string()),
        primaryLanguage: v.optional(v.string()),
        systemPrompt: v.optional(v.string()),
        fewShotExamples: v.optional(v.string()),
      }),
    ),
    workspace: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { conversationId, content, model, mode, research, plan, memory, sources, profile, workspace },
  ): Promise<{
    content: string;
    error: string | null;
    usage?: { prompt: number; completion: number } | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const { messages, hasZenKey } = await buildTurn(ctx, userId, {
      conversationId,
      content,
      mode,
      research,
      plan,
      memory: memory as MemoryHit[] | undefined,
      profile: profile as CognitionProfile | undefined,
      workspace,
    });
    const resolved = resolveApiModel(model, content, hasZenKey);

    // Pass 1 — MULTI-AI draft: two models answer the same prompt in parallel
    // and the better draft wins. Primary is the resolved model; the second is
    // the other free workhorse (Big Pickle ↔ DeepSeek V4 Flash), so the user
    // gets the best of two models at once.
    const alternate =
      resolved === "opencode/big-pickle" ? "opencode/deepseek-v4-flash-free" : "opencode/big-pickle";
    const [draftA, draftB] = await Promise.all([
      completeWithRetry(ctx, userId, resolved, messages),
      completeWithRetry(ctx, userId, alternate, messages),
    ]);
    let draft = draftA;
    if (draftA.error || !draftA.content.trim()) {
      draft = draftB;
    } else if (!draftB.error && draftB.content.trim().length > draftA.content.length) {
      // Prefer the longer, more thorough draft when both succeed.
      draft = draftB;
    }
    if (draft.error) return { content: "", error: draft.error, usage: null };
    if (!draft.content.trim()) {
      return { content: "", error: "The models returned an empty response. Try again.", usage: null };
    }

    // Pass 2 — the model reviews and improves the winning draft.
    const refineMessages: ChatMessage[] = [
      ...messages,
      { role: "assistant", content: draft.content },
      { role: "user", content: REFINE_INSTRUCTION },
    ];
    const final = await completeWithRetry(ctx, userId, resolved, refineMessages);
    const reply = final.error || !final.content.trim() ? draft.content : final.content;
    const usage = final.error
      ? draft.usage
      : {
          prompt: (draftA.usage?.prompt ?? 0) + (draftB.usage?.prompt ?? 0) + (final.usage?.prompt ?? 0),
          completion: (draftA.usage?.completion ?? 0) + (draftB.usage?.completion ?? 0) + (final.usage?.completion ?? 0),
        };

    await ctx.runMutation(api.conversations.addMessage, {
      conversationId,
      role: "assistant",
      kind: "text",
      content: reply,
      sources,
      usage,
      model,
    });

    return { content: reply, error: null, usage: usage ?? null };
  },
});
