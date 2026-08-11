import { v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Guest access + developer monitoring.
//
// The developer (admin, role "admin") issues access tokens. Guests sign in
// anonymously and redeem a code to unlock the studio. The admin can monitor
// every guest: login sessions, conversations, and everything they search.
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const user = await getCurrentUser(ctx);
  if (user === null) throw new Error("Not authenticated");
  if (user.role !== "admin") throw new Error("Admins only");
  return user;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `ZB-${s.slice(0, 4)}-${s.slice(4)}`;
}

function maskCode(code: string): string {
  const last = code.slice(-4);
  return `ZB-••••-${last}`;
}

// ---------------------------------------------------------------------------
// Client-facing (guest + admin status)
// ---------------------------------------------------------------------------

/** The signed-in user's access state — used by the dashboard gate. */
export const myStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) {
      return { isAuthed: false, isAdmin: false, isGuest: false, needsToken: false, guestName: null };
    }
    return {
      isAuthed: true,
      isAdmin: user.role === "admin",
      isGuest: Boolean(user.isAnonymous),
      needsToken: Boolean(user.isAnonymous && !user.accessTokenId),
      guestName: user.guestName ?? null,
    };
  },
});

/** Redeem a guest access code. The guest must be signed in (anonymously). */
export const redeemGuest = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const normalized = code.trim().toUpperCase();
    if (!normalized) throw new Error("Enter the access code you were given.");

    const token = await ctx.db
      .query("accessTokens")
      .withIndex("by_code", (q) => q.eq("code", normalized))
      .first();
    if (!token || !token.enabled) {
      throw new Error("That access code isn't valid. Ask the developer for a new one.");
    }
    if (token.usedCount >= token.maxUses) {
      throw new Error("That access code has reached its limit of uses.");
    }
    if (user.accessTokenId && user.accessTokenId === token._id) {
      // Already redeemed with this token — no-op.
      return { ok: true, guestName: user.guestName ?? null };
    }

    await ctx.db.patch(user._id, {
      accessTokenId: token._id,
      guestName: `Guest #${String(token.usedCount + 1).padStart(3, "0")}`,
      lastActiveAt: Date.now(),
    });
    await ctx.db.patch(token._id, { usedCount: token.usedCount + 1 });
    return { ok: true, guestName: null };
  },
});

/** Whether any developer (admin) has been claimed yet — drives the Control
 *  app's claim screen so the first sign-in can become the developer. */
export const adminExists = query({
  args: {},
  handler: async (ctx) => {
    const admin = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();
    return admin !== null;
  },
});

/** The first account to call this becomes the developer (admin). Subsequent
 *  calls fail — only one admin can exist. */
export const ensureAdmin = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    if (user.isAnonymous) throw new Error("Sign in with your email first.");
    const admins = await ctx.db.query("users").filter((q) => q.eq(q.field("role"), "admin")).take(2);
    if (admins.length > 0) throw new Error("An admin already exists.");
    await ctx.db.patch(user._id, { role: "admin" });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Access requests — guests ask the developer for a token. Approving mints a
// code AND grants that guest access immediately (their next query sees
// accessTokenId set), so the developer can also just say "done".
// ---------------------------------------------------------------------------

/** The signed-in guest's latest access request (if any). */
export const myAccessRequest = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    const req = await ctx.db
      .query("accessRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .first();
    return req ?? null;
  },
});

/** A guest asks the developer for access. One pending request per guest. */
export const requestAccess = mutation({
  args: { name: v.optional(v.string()), message: v.optional(v.string()) },
  handler: async (ctx, { name, message }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    if (!user.isAnonymous) throw new Error("You already have access");
    if (user.accessTokenId) throw new Error("You already have access");

    const pending = await ctx.db
      .query("accessRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .first();
    if (pending) throw new Error("You already have a pending request — the developer has been notified.");

    await ctx.db.insert("accessRequests", {
      userId: user._id,
      name: (name ?? "").trim().slice(0, 60) || undefined,
      message: (message ?? "").trim().slice(0, 300) || undefined,
      status: "pending",
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Every access request with the requester's info — the admin's inbox. */
export const requests = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [reqs, users, tokens] = await Promise.all([
      ctx.db.query("accessRequests").withIndex("by_created").order("desc").take(100),
      ctx.db.query("users").collect(),
      ctx.db.query("accessTokens").collect(),
    ]);
    const userMap = new Map(users.map((u) => [u._id, u]));
    const tokenMap = new Map(tokens.map((t) => [t._id, t]));
    return reqs.map((r) => {
      const u = userMap.get(r.userId);
      const t = r.tokenId ? tokenMap.get(r.tokenId) : undefined;
      return {
        _id: r._id,
        name: r.name ?? null,
        message: r.message ?? null,
        status: r.status,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt ?? undefined,
        requesterName: u?.guestName ?? u?.email ?? u?.name ?? "Anonymous",
        isGuest: Boolean(u?.isAnonymous),
        hasAccess: Boolean(u?.accessTokenId),
        masked: t ? maskCode(t.code) : null,
      };
    });
  },
});

/** Approve a guest's request: mint a token, grant the guest, return the code
 *  (shown once) so the developer can share it by other channels too. */
export const approveRequest = mutation({
  args: { requestId: v.id("accessRequests"), maxUses: v.optional(v.number()) },
  handler: async (ctx, { requestId, maxUses }) => {
    const admin = await requireAdmin(ctx);
    const req = await ctx.db.get(requestId);
    if (req === null) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("That request was already decided");

    const code = generateCode();
    const tokenId = await ctx.db.insert("accessTokens", {
      code,
      label: req.name ? `Request: ${req.name}` : "Access request",
      maxUses: Math.max(1, Math.min(500, maxUses || 25)),
      usedCount: 0,
      enabled: true,
      createdBy: admin._id,
      createdAt: Date.now(),
    });

    // Grant the guest immediately — no code redemption needed.
    const guest = await ctx.db.get(req.userId);
    if (guest) {
      await ctx.db.patch(req.userId, {
        accessTokenId: tokenId,
        guestName: guest.guestName ?? `Guest #${String(tokenId).slice(-4).toUpperCase()}`,
        lastActiveAt: Date.now(),
      });
    }

    await ctx.db.patch(requestId, {
      status: "approved",
      decidedAt: Date.now(),
      tokenId,
    });
    return { code };
  },
});

/** Deny a guest's request. */
export const denyRequest = mutation({
  args: { requestId: v.id("accessRequests") },
  handler: async (ctx, { requestId }) => {
    await requireAdmin(ctx);
    const req = await ctx.db.get(requestId);
    if (req === null) throw new Error("Request not found");
    if (req.status !== "pending") throw new Error("That request was already decided");
    await ctx.db.patch(requestId, { status: "denied", decidedAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// Session telemetry
//
// Every signed-in client (studio and Control) reports its IP + device on load
// and periodically while it is open, so the developer sees live login
// sessions: who is connected, from where, and on which device.
// ---------------------------------------------------------------------------

export const reportSession = mutation({
  args: { ip: v.optional(v.string()), device: v.optional(v.string()) },
  handler: async (ctx, { ip, device }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const patch: { lastActiveAt: number; lastIp?: string; lastDevice?: string } = { lastActiveAt: Date.now() };
    if (ip) patch.lastIp = ip.slice(0, 64);
    if (device) patch.lastDevice = device.slice(0, 120);
    await ctx.db.patch(user._id, patch);
  },
});

// ---------------------------------------------------------------------------
// Admin: monitoring
// ---------------------------------------------------------------------------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [users, conversations, messages, tokens, sessions] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("conversations").collect(),
      ctx.db.query("messages").collect(),
      ctx.db.query("accessTokens").collect(),
      ctx.db.query("authSessions").collect(),
    ]);
    return {
      users: users.length,
      guests: users.filter((u) => u.isAnonymous).length,
      conversations: conversations.length,
      messages: messages.length,
      messagesToday: messages.filter((m) => Date.now() - m.createdAt < 86_400_000).length,
      activeSessions: sessions.filter((s) => s.expirationTime > Date.now()).length,
      tokens: tokens.length,
    };
  },
});

export type AdminUserRow = {
  _id: string;
  name: string | null;
  email: string | null;
  isAnonymous: boolean;
  role: string | null;
  guestName: string | null;
  createdAt?: number;
  lastActiveAt?: number;
  lastIp?: string;
  lastDevice?: string;
  conversationCount: number;
  messageCount: number;
  sessionCount: number;
  hasAccessToken: boolean;
};

/** Every user with activity counts — the developer's roster. */
export const users = query({
  args: {},
  handler: async (ctx): Promise<AdminUserRow[]> => {
    await requireAdmin(ctx);
    const [allUsers, conversations, messages, sessions, tokens] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("conversations").collect(),
      ctx.db.query("messages").collect(),
      ctx.db.query("authSessions").collect(),
      ctx.db.query("accessTokens").collect(),
    ]);

    const convByUser = new Map<string, number>();
    for (const c of conversations) convByUser.set(c.userId, (convByUser.get(c.userId) ?? 0) + 1);
    const msgByUser = new Map<string, number>();
    for (const m of messages) msgByUser.set(m.conversationId, (msgByUser.get(m.conversationId) ?? 0) + 1);
    const sessByUser = new Map<string, number>();
    for (const s of sessions) sessByUser.set(s.userId, (sessByUser.get(s.userId) ?? 0) + 1);

    return allUsers
      .map((u) => {
        const convCount = convByUser.get(u._id) ?? 0;
        let messageCount = 0;
        for (const [convId, count] of msgByUser) {
          if (conversations.some((c) => c._id === convId && c.userId === u._id)) messageCount += count;
        }
        return {
          _id: u._id,
          name: u.name ?? null,
          email: u.email ?? null,
          isAnonymous: Boolean(u.isAnonymous),
          role: u.role ?? null,
          guestName: u.guestName ?? null,
          lastActiveAt: u.lastActiveAt ?? undefined,
          lastIp: u.lastIp ?? undefined,
          lastDevice: u.lastDevice ?? undefined,
          conversationCount: convCount,
          messageCount,
          sessionCount: sessByUser.get(u._id) ?? 0,
          hasAccessToken: Boolean(u.accessTokenId),
        };
      })
      .sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
  },
});

/** One user's conversations (admin). */
export const userConversations = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("conversations")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

/** One conversation's full transcript (admin). */
export const conversationMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(500);
  },
});

/** The "what are they searching" feed — every user prompt, newest first. */
export const activity = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [msgs, usersById, convsById] = await Promise.all([
      ctx.db.query("messages").withIndex("by_created").order("desc").take(150),
      ctx.db.query("users").collect(),
      ctx.db.query("conversations").collect(),
    ]);
    const userMap = new Map(usersById.map((u) => [u._id, u]));
    const convMap = new Map(convsById.map((c) => [c._id, c]));

    return msgs
      .filter((m) => m.role === "user" && m.kind === "text")
      .map((m) => {
        const conv = convMap.get(m.conversationId);
        const user = conv ? userMap.get(conv.userId) : undefined;
        return {
          _id: m._id,
          content: m.content,
          model: m.model ?? null,
          createdAt: m.createdAt,
          conversationTitle: conv?.title ?? "Deleted conversation",
          userName: user?.guestName ?? user?.email ?? user?.name ?? "Unknown",
          isGuest: Boolean(user?.isAnonymous),
          ip: user?.lastIp ?? undefined,
          device: user?.lastDevice ?? undefined,
        };
      });
  },
});

// ---------------------------------------------------------------------------
// Admin: access tokens
// ---------------------------------------------------------------------------

export const tokens = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("accessTokens").withIndex("by_created").order("desc").take(200);
    return all.map((t) => ({
      _id: t._id,
      masked: maskCode(t.code),
      label: t.label,
      maxUses: t.maxUses,
      usedCount: t.usedCount,
      enabled: t.enabled,
      createdAt: t.createdAt,
    }));
  },
});

/** Create a token; returns the plaintext code exactly once. */
export const createToken = mutation({
  args: { label: v.string(), maxUses: v.number() },
  handler: async (ctx, { label, maxUses }) => {
    const admin = await requireAdmin(ctx);
    const code = generateCode();
    await ctx.db.insert("accessTokens", {
      code,
      label: label.trim().slice(0, 60) || "Untitled guest code",
      maxUses: Math.max(1, Math.min(500, maxUses || 25)),
      usedCount: 0,
      enabled: true,
      createdBy: admin._id,
      createdAt: Date.now(),
    });
    return { code };
  },
});

export const toggleToken = mutation({
  args: { tokenId: v.id("accessTokens"), enabled: v.boolean() },
  handler: async (ctx, { tokenId, enabled }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(tokenId, { enabled });
  },
});

export const deleteToken = mutation({
  args: { tokenId: v.id("accessTokens") },
  handler: async (ctx, { tokenId }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(tokenId);
  },
});
