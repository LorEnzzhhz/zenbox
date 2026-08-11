import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";
import { seal } from "./lib/keys";

// ---------------------------------------------------------------------------
// Public API (client-facing)
// ---------------------------------------------------------------------------

/** Client-facing settings. API keys are never returned — only booleans plus
 *  masked previews of the last few characters. */
export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return {
        hasKey: false,
        masked: null,
        hasOpenCodeKey: false,
        openCodeMasked: null,
        telegramUsername: null,
        telegramWebhook: false,
        discordWebhookSet: false,
        discordWebhookTail: null,
        hasApiKey: false,
        apiKeyMasked: null,
      };
    }
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    return {
      hasKey: Boolean(settings?.openrouterKey),
      masked: settings?.masked ?? null,
      hasOpenCodeKey: Boolean(settings?.opencodeKey),
      openCodeMasked: settings?.opencodeMasked ?? null,
      telegramUsername: settings?.telegramUsername ?? null,
      telegramWebhook: Boolean(settings?.telegramSecret),
      discordWebhookSet: Boolean(settings?.discordWebhook),
      discordWebhookTail: settings?.discordWebhook ? `…${settings.discordWebhook.slice(-24)}` : null,
      hasApiKey: Boolean(settings?.apiKey),
      apiKeyMasked: settings?.apiKeyMasked ?? null,
    };
  },
});

const randomToken = () => {
  const bytes = new Uint8Array(24);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** Create (once) and return the user's personal Zenbox API key. The full key
 *  is only ever handed back to its owner; everyone else sees the masked form.
 *  Regenerate replaces the old key, instantly revoking it. */
export const getMyApiKey = mutation({
  args: { regenerate: v.optional(v.boolean()) },
  handler: async (ctx, { regenerate }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const wantsNew = regenerate === true || !existing?.apiKey;
    if (!wantsNew) {
      return { apiKey: existing.apiKey, masked: existing.apiKeyMasked ?? null };
    }

    const apiKey = `zbx_${randomToken()}`;
    const masked = maskKey(apiKey);
    if (existing) {
      await ctx.db.patch(existing._id, { apiKey, apiKeyMasked: masked, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("settings", {
        userId: user._id,
        apiKey,
        apiKeyMasked: masked,
        updatedAt: Date.now(),
      });
    }
    return { apiKey, masked };
  },
});

const maskKey = (key: string) => `${key.slice(0, 7)}…${key.slice(-4)}`;

const validateKey = (key: string) => {
  const trimmed = key.trim();
  if (trimmed.length < 20) {
    throw new Error("That doesn't look like an API key — it should be at least 20 characters.");
  }
  return trimmed;
};

/** Save the user's OpenRouter API key. */
export const saveOpenrouterKey = action({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ masked: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const trimmed = validateKey(key);
    const masked = maskKey(trimmed);
    await ctx.runMutation(internal.settings.upsertKey, {
      userId,
      sealed: seal(trimmed),
      masked,
    });
    return { masked };
  },
});

/** Remove the user's saved OpenRouter API key. */
export const removeOpenrouterKey = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runMutation(internal.settings.removeKey, { userId, which: "openrouter" });
  },
});

/** Save the user's OpenCode Zen API key (free gateway to Big Pickle etc.). */
export const saveOpenCodeKey = action({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<{ masked: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const trimmed = validateKey(key);
    const masked = maskKey(trimmed);
    await ctx.runMutation(internal.settings.upsertKey, {
      userId,
      opencodeSealed: seal(trimmed),
      opencodeMasked: masked,
    });
    return { masked };
  },
});

/** Remove the user's saved OpenCode Zen API key. */
export const removeOpenCodeKey = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runMutation(internal.settings.removeKey, { userId, which: "opencode" });
  },
});

// ---------------------------------------------------------------------------
// Internal API (server-only)
// ---------------------------------------------------------------------------

export const upsertKey = internalMutation({
  args: {
    userId: v.id("users"),
    sealed: v.optional(v.string()),
    masked: v.optional(v.string()),
    opencodeSealed: v.optional(v.string()),
    opencodeMasked: v.optional(v.string()),
    telegramKey: v.optional(v.string()),
    telegramUsername: v.optional(v.string()),
    telegramSecret: v.optional(v.string()),
    discordWebhook: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { userId, sealed, masked, opencodeSealed, opencodeMasked, telegramKey, telegramUsername, telegramSecret, discordWebhook },
  ) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...(sealed !== undefined ? { openrouterKey: sealed, masked } : {}),
        ...(opencodeSealed !== undefined ? { opencodeKey: opencodeSealed, opencodeMasked } : {}),
        ...(telegramKey !== undefined ? { telegramKey, telegramUsername } : {}),
        ...(telegramSecret !== undefined ? { telegramSecret } : {}),
        ...(discordWebhook !== undefined ? { discordWebhook } : {}),
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("settings", {
        userId,
        openrouterKey: sealed,
        masked,
        opencodeKey: opencodeSealed,
        opencodeMasked,
        telegramKey,
        telegramUsername,
        telegramSecret,
        discordWebhook,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Remove one key kind; deletes the document once both are gone. */
export const removeKey = internalMutation({
  args: {
    userId: v.id("users"),
    which: v.union(
      v.literal("openrouter"),
      v.literal("opencode"),
      v.literal("telegram"),
      v.literal("discord"),
    ),
  },
  handler: async (ctx, { userId, which }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!existing) return;
    if (which === "openrouter") {
      await ctx.db.patch(existing._id, { openrouterKey: undefined, masked: undefined, updatedAt: Date.now() });
    } else if (which === "opencode") {
      await ctx.db.patch(existing._id, { opencodeKey: undefined, opencodeMasked: undefined, updatedAt: Date.now() });
    } else if (which === "telegram") {
      await ctx.db.patch(existing._id, {
        telegramKey: undefined,
        telegramUsername: undefined,
        telegramSecret: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(existing._id, { discordWebhook: undefined, updatedAt: Date.now() });
    }
    const after = await ctx.db.get(existing._id);
    if (after && !after.openrouterKey && !after.opencodeKey && !after.telegramKey && !after.discordWebhook) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Raw stored (sealed) keys for a user — for server-side use only. */
export const getKeyForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      openrouter: settings?.openrouterKey ?? null,
      opencode: settings?.opencodeKey ?? null,
      telegramKey: settings?.telegramKey ?? null,
      telegramUsername: settings?.telegramUsername ?? null,
      telegramSecret: settings?.telegramSecret ?? null,
      discordWebhook: settings?.discordWebhook ?? null,
      apiKey: settings?.apiKey ?? null,
    };
  },
});

/** Resolve a user id from a personal API key — for the HTTP API's
 *  `Authorization: Bearer` flow. Returns null when the key is unknown. */
export const findUserByApiKey = internalQuery({
  args: { apiKey: v.string() },
  handler: async (ctx, { apiKey }) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_api_key", (q) => q.eq("apiKey", apiKey))
      .first();
    return settings?.userId ?? null;
  },
});
