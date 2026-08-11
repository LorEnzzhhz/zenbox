import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { auth } from "./auth";
import type { Mode } from "./schema";
import { buildChatMessages } from "./chatCore";
import { unseal } from "./lib/keys";
import { resolveApiModel, resolveProvider, RETRY_MODEL } from "./ai";

const http = httpRouter();

auth.addHttpRoutes(http);

const MODES = new Set(["chat", "code", "write", "image"]);

const ZEN_BASE_URL = "https://opencode.ai/zen/v1";

const MAX_TOKENS = 8192;

/** CORS for cross-origin calls from the app preview to the Convex site.
 *  Credentials (auth cookie) are included, so the request origin is echoed
 *  instead of using a wildcard. */
function corsHeaders(request: Request): Headers {
  const origin = request.headers.get("Origin");
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  return headers;
}

function jsonResponse(headers: Headers, status: number, body: unknown) {
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

http.route({
  path: "/chatStream",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }),
});

/** Stream one assistant turn from the model gateway to the client as SSE.
 *  The client persists the user message (with attachments) before calling;
 *  the final assistant reply is persisted by the client when the stream
 *  completes. */
http.route({
  path: "/chatStream",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = corsHeaders(request);

    // Cookie auth first, then personal API key (`Authorization: Bearer zbx_…`)
    // so the key users copy from Settings works against the HTTP API too.
    let userId = await getAuthUserId(ctx);
    if (userId === null) {
      const bearer = request.headers.get("Authorization");
      const apiKey = bearer?.startsWith("Bearer ") ? bearer.slice(7).trim() : null;
      if (apiKey && apiKey.startsWith("zbx_")) {
        try {
          userId = await ctx.runQuery(internal.settings.findUserByApiKey, { apiKey });
        } catch {
          userId = null;
        }
      }
    }
    if (userId === null) {
      return jsonResponse(headers, 401, { error: "Not authenticated — add your Zenbox API key as a Bearer token, or sign in." });
    }

    let body: {
      conversationId?: string;
      content?: string;
      model?: string;
      mode?: string;
      research?: string;
      memory?: Array<{ q: string; a: string; title: string }>;
      profile?: Record<string, string | undefined>;
      workspace?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse(headers, 400, { error: "Invalid JSON body" });
    }
    const { conversationId, content, model, mode, research, memory, profile, workspace } = body;
    if (
      !conversationId ||
      typeof content !== "string" ||
      content.trim().length === 0 ||
      typeof model !== "string" ||
      typeof mode !== "string" ||
      !MODES.has(mode)
    ) {
      return jsonResponse(headers, 400, { error: "Missing or invalid fields" });
    }

    let conversation;
    try {
      conversation = await ctx.runQuery(api.conversations.get, {
        conversationId: conversationId as Id<"conversations">,
      });
    } catch {
      return jsonResponse(headers, 400, { error: "Invalid conversation id" });
    }
    if (conversation === null || conversation.userId !== userId) {
      return jsonResponse(headers, 404, { error: "Conversation not found" });
    }

    const storedKeys = await ctx.runQuery(internal.settings.getKeyForUser, { userId });
    const hasZenKey = Boolean(process.env.OPENCODE_API_KEY ?? (storedKeys.opencode ? unseal(storedKeys.opencode) : null));
    const hasRouterKey = Boolean(
      process.env.OPENROUTER_API_KEY ?? (storedKeys.openrouter ? unseal(storedKeys.openrouter) : null),
    );
    // The "auto" picker resolves to a concrete model here; without any key it
    // can't route, so tell the user which key to add.
    let resolved = resolveApiModel(model, content, hasZenKey);
    if (resolved === "openai/gpt-oss-20b:free" && !hasZenKey && !hasRouterKey) {
      return jsonResponse(headers, 503, {
        error:
          "No API key configured. Add an OpenCode Zen key (free, opens Settings → OpenCode Zen) or an OPENROUTER_API_KEY in the project Keys tab to use Auto model.",
      });
    }

    let history;
    try {
      history = await ctx.runQuery(api.conversations.messages, {
        conversationId: conversationId as Id<"conversations">,
      });
    } catch {
      return jsonResponse(headers, 400, { error: "Invalid conversation id" });
    }
    const plugins = await ctx.runQuery(api.plugins.enabled, {});
    const messages = await buildChatMessages({
      mode: mode as Mode,
      history,
      content,
      plugins,
      research,
      memory: memory as Parameters<typeof buildChatMessages>[0]["memory"],
      profile: profile as Parameters<typeof buildChatMessages>[0]["profile"],
      workspace,
      getAttachmentUrl: async (storageId) => {
        const urls = await ctx.runQuery(api.files.getAttachmentUrls, { storageIds: [storageId] });
        return urls[storageId] ?? null;
      },
    });

    // Try the resolved model first, then fall back to Big Pickle (the Hy3
    // Workbench free-chain) exactly once when the gateway errors.
    const attempts = resolved === RETRY_MODEL ? 1 : 2;
    let lastDetail = "";
    for (let attempt = 0; attempt < attempts; attempt++) {
      const provider = resolveProvider(resolved);
      const key =
        provider === "opencode"
          ? process.env.OPENCODE_API_KEY ?? (storedKeys.opencode ? unseal(storedKeys.opencode) : null)
          : process.env.OPENROUTER_API_KEY ?? (storedKeys.openrouter ? unseal(storedKeys.openrouter) : null);
      if (!key) {
        return jsonResponse(headers, 503, {
          error:
            provider === "opencode"
              ? "No OpenCode Zen key configured. Add your free Zen key in Studio → Settings to use Big Pickle."
              : "No OpenRouter API key configured. Add OPENROUTER_API_KEY in the project Keys tab, or paste your own key in Studio → Settings.",
        });
      }

      const endpoint =
        provider === "opencode"
          ? `${ZEN_BASE_URL}/chat/completions`
          : "https://openrouter.ai/api/v1/chat/completions";
      // OpenCode Zen's API takes the bare model id (big-pickle), not the
      // provider-prefixed config id (opencode/big-pickle).
      const upstreamModel = provider === "opencode" ? resolved.replace(/^opencode\//, "") : resolved;

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Zenbox",
        },
        body: JSON.stringify({
          model: upstreamModel,
          messages,
          stream: true,
          max_tokens: MAX_TOKENS,
          // Ask the gateway to send a final chunk with token usage so the UI
          // can show per-reply token counts (config: show_token_usage).
          stream_options: { include_usage: true },
        }),
      });

      if (!upstream.ok) {
        let detail = `${provider === "opencode" ? "OpenCode Zen" : "OpenRouter"} error ${upstream.status}`;
        try {
          const errBody = (await upstream.json()) as { error?: { message?: string } };
          if (errBody.error?.message) detail = errBody.error.message;
        } catch {
          /* ignore */
        }
        lastDetail = detail;
        resolved = RETRY_MODEL;
        continue;
      }

      if (!upstream.body) {
        lastDetail = "Empty upstream response";
        resolved = RETRY_MODEL;
        continue;
      }

      // Pipe the upstream SSE stream straight through to the client.
      headers.set("Content-Type", "text/event-stream");
      headers.set("Cache-Control", "no-cache, no-transform");
      return new Response(upstream.body, { status: 200, headers });
    }

    return jsonResponse(headers, 502, { error: lastDetail || "Request failed" });
  }),
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Reply from the Telegram bot to a chat via the Bot API. */
async function tgReply(token: string, chatId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    /* best-effort reply */
  }
}

/** Telegram bot webhook — Telegram pushes a user's message here; the bot
 *  answers with a few commands (help/status/version) about the AI app.
 *  The `secret_token` registered at setWebhook identifies which bot this is. */
http.route({
  path: "/telegramBot",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!secret) {
      return new Response("missing secret", { status: 200 });
    }

    let body: { message?: { chat?: { id?: number }; from?: { first_name?: string; username?: string }; text?: string } };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("ok", { status: 200 });
    }

    const msg = body?.message;
    const chatId = msg?.chat?.id;
    if (!chatId || typeof chatId !== "number") {
      return new Response("ok", { status: 200 });
    }

    const settings = await ctx.runQuery(internal.bots.getBotBySecret, { secret });
    if (!settings?.telegramKey) {
      return new Response("ok", { status: 200 });
    }

    const text = (msg?.text ?? "").trim();
    const who = esc(msg?.from?.username ?? msg?.from?.first_name ?? "friend");
    const command = text.split(/\s+/)[0]?.toLowerCase() ?? "";

    if (command === "/start" || command === "/help") {
      await tgReply(
        settings.telegramKey,
        chatId,
        `Hi ${who}! I'm the <b>Zenbox</b> assistant bot.\n\nI watch over the AI app. Try:\n• <code>/status</code> — app version, users, who's online\n• <code>/version</code> — just the version\n• Anything else — I'll point you back here.`,
      );
    } else if (command === "/version") {
      const latest = await ctx.runQuery(api.updates.latestShipped);
      await tgReply(settings.telegramKey, chatId, `Zenbox v${latest?.version ?? 1} — ${esc(latest?.title ?? "no release notes yet")}`);
    } else if (command === "/status") {
      const latest = await ctx.runQuery(api.updates.latestShipped);
      const stats = await ctx.runQuery(internal.bots.stats, {});
      await tgReply(
        settings.telegramKey,
        chatId,
        `<b>Zenbox status</b>\n• Version: <b>v${latest?.version ?? 1}</b>\n• Users: ${stats.total}\n• Online now: ${stats.online}\n• Model: Auto — DeepSeek V4 Flash / Big Pickle`,
      );
    } else if (text.length > 0) {
      await tgReply(
        settings.telegramKey,
        chatId,
        `Got it, ${who} — but I only speak a few commands. Try <code>/status</code> or <code>/help</code>.`,
      );
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
