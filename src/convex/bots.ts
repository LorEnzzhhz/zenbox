import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Bots & integrations — Telegram (reply bot via webhook) and Discord (channel
// webhook, send-only). Keys/secrets are stored sealed in the per-user settings
// row and are never returned to the client — the Telegram webhook route looks
// the bot up by its secret token and replies from the server.
// ---------------------------------------------------------------------------

const TG_API = "https://api.telegram.org";

function randomSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function tgGet(token: string, method: string): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  try {
    const res = await fetch(`${TG_API}/bot${token}/${method}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { ok: false, description: `Telegram responded ${res.status}` };
    return (await res.json()) as { ok: boolean; description?: string; result?: unknown };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "Telegram unreachable" };
  }
}

/** Public status for the Settings → Bots panel (never exposes secrets). */
export const getBotStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return {
        telegramConnected: false,
        telegramUsername: null as string | null,
        telegramWebhook: false,
        discordWebhookSet: false,
        discordWebhookTail: null as string | null,
      };
    }
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    const hook = settings?.discordWebhook ?? null;
    return {
      telegramConnected: Boolean(settings?.telegramKey),
      telegramUsername: settings?.telegramUsername ?? null,
      telegramWebhook: Boolean(settings?.telegramSecret),
      discordWebhookSet: Boolean(hook),
      discordWebhookTail: hook ? `…${hook.slice(-24)}` : null,
    };
  },
});

/** Validate a Telegram bot token via getMe and store it (sealed). */
export const saveTelegramToken = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ username: string; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const trimmed = token.trim();
    if (trimmed.length < 30) {
      return { username: "", error: "That doesn't look like a Telegram bot token — it starts with a number, a colon, then a long secret (get one from @BotFather)." };
    }
    const check = await tgGet(trimmed, "getMe");
    if (!check.ok || !check.result) {
      return { username: "", error: check.description ?? "Could not reach Telegram with that token." };
    }
    const info = check.result as { username?: string; first_name?: string };
    const username = info.username ? `@${info.username}` : (info.first_name ?? "bot");
    await ctx.runMutation(internal.settings.upsertKey, {
      userId,
      telegramKey: trimmed,
      telegramUsername: username,
    });
    return { username, error: null };
  },
});

/** Remove the Telegram bot token + webhook secret. */
export const removeTelegramToken = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const settings = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
    if (settings.telegramKey) {
      // Best-effort: unregister the webhook so updates stop arriving.
      await tgGet(settings.telegramKey, "deleteWebhook");
    }
    await ctx.runMutation(internal.settings.removeKey, { userId, which: "telegram" });
  },
});

/** Register the Convex site's /telegramBot route as the bot's webhook. */
export const setupTelegramWebhook = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const settings = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
    if (!settings.telegramKey) {
      return { ok: false, error: "Save a Telegram bot token first." };
    }
    const site = process.env.CONVEX_SITE_URL;
    if (!site) {
      return { ok: false, error: "CONVEX_SITE_URL is not set on this deployment — can't register a public webhook." };
    }
    const secret = randomSecret();
    try {
      const res = await fetch(`${TG_API}/bot${settings.telegramKey}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `${site}/telegramBot`,
          secret_token: secret,
          drop_pending_updates: true,
          allowed_updates: ["message"],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const data = (await res.json()) as { ok?: boolean; description?: string };
      if (!data.ok) {
        return { ok: false, error: data.description ?? `setWebhook failed (${res.status})` };
      }
      await ctx.runMutation(internal.settings.upsertKey, { userId, telegramSecret: secret });
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Could not register the webhook" };
    }
  },
});

/** Webhook health: pending updates + last error, for the Settings panel. */
export const telegramStatus = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; info: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const settings = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
    if (!settings.telegramKey) return { ok: false, info: null };
    const check = await tgGet(settings.telegramKey, "getWebhookInfo");
    if (!check.ok || !check.result) return { ok: false, info: check.description ?? "No webhook info" };
    const info = check.result as { url?: string; pending_update_count?: number; last_error_message?: string };
    const pending = info.pending_update_count ?? 0;
    const lastError = info.last_error_message ? ` · last error: ${info.last_error_message}` : "";
    return {
      ok: Boolean(info.url) && !info.url?.endsWith("/"),
      info: `${info.url && !info.url.endsWith("/") ? "Webhook connected" : "Webhook not registered"} · ${pending} pending update${pending === 1 ? "" : "s"}${lastError}`,
    };
  },
});

const DISCORD_HOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/;

/** Store a Discord channel webhook URL (send-only bot). */
export const saveDiscordWebhook = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<{ error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const trimmed = url.trim();
    if (!DISCORD_HOOK_RE.test(trimmed)) {
      return { error: "That doesn't look like a Discord webhook URL — it should start with https://discord.com/api/webhooks/<id>/<token> (Server Settings → Integrations → Webhooks)." };
    }
    await ctx.runMutation(internal.settings.upsertKey, { userId, discordWebhook: trimmed });
    return { error: null };
  },
});

/** Remove the stored Discord webhook. */
export const removeDiscordWebhook = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    await ctx.runMutation(internal.settings.removeKey, { userId, which: "discord" });
  },
});

/** Send a message to the stored Discord channel webhook. */
export const discordSend = action({
  args: { content: v.string() },
  handler: async (ctx, { content }): Promise<{ ok: boolean; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");
    const settings = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
    if (!settings.discordWebhook) return { ok: false, error: "No Discord webhook configured." };
    try {
      const res = await fetch(settings.discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.slice(0, 1900) }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        return { ok: false, error: `Discord responded ${res.status}: ${detail}` };
      }
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Discord unreachable" };
    }
  },
});

// ---------------------------------------------------------------------------
// Internal API — used by the /telegramBot HTTP route and the Settings panel.
// ---------------------------------------------------------------------------

/** Find the bot whose webhook secret matches the incoming update. */
export const getBotBySecret = internalQuery({
  args: { secret: v.string() },
  handler: async (ctx, { secret }) => {
    return await ctx.db
      .query("settings")
      .withIndex("by_telegram_secret", (q) => q.eq("telegramSecret", secret))
      .first();
  },
});

/** Roster counts for the bot's /status reply. */
export const stats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const now = Date.now();
    const online = users.filter((u) => u.lastActiveAt && now - u.lastActiveAt < 5 * 60_000).length;
    return { total: users.length, online };
  },
});
