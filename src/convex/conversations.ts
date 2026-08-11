import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";
import { api } from "./_generated/api";
import { attachmentValidator, messageKindValidator, messageUsageValidator, modeValidator, roleInMessageValidator, sourceValidator } from "./schema";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** All conversations for the signed-in user, most recently active first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);

    return conversations;
  },
});

/** One conversation, ownership-checked. Returns null if missing or not owned. */
export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    const conversation = await ctx.db.get(conversationId);
    if (conversation === null || conversation.userId !== user._id) return null;
    return conversation;
  },
});

/** Internal memory scan — query so the action can run it via ctx.runQuery. */
export const recallMemoryScan = query({
  args: { prompt: v.string() },
  handler: async (ctx, { prompt }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];

    const terms = (prompt.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).slice(0, 10);
    if (terms.length < 2) return [];

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updated", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(40);

    type Hit = { q: string; a: string; title: string; score: number };
    const hits: Hit[] = [];
    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id))
        .order("asc")
        .take(200);
      // Walk pairs (user → assistant) and score keyword overlap.
      for (let i = 0; i < messages.length - 1; i++) {
        const m = messages[i];
        const next = messages[i + 1];
        if (m.role !== "user" || next.role !== "assistant") continue;
        if (m.kind !== "text" || next.kind !== "text") continue;
        const combined = `${m.content} ${next.content}`.toLowerCase();
        let score = 0;
        for (const t of terms) if (combined.includes(t)) score += 1;
        if (score < 2) continue;
        hits.push({
          q: m.content.slice(0, 500),
          a: next.content.slice(0, 900),
          title: conversation.title,
          score,
        });
      }
      if (hits.length >= 4) break;
    }
    return hits
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ q, a, title }) => ({ q, a, title }));
  },
});

/** Memory recall: scan past conversations for similar Q/A pairs, called right
 *  before each send so the model builds on what it already told the user. */
export const recallMemory = action({
  args: { prompt: v.string() },
  handler: async (
    ctx,
    { prompt },
  ): Promise<Array<{ q: string; a: string; title: string }>> => {
    return await ctx.runQuery(api.conversations.recallMemoryScan, { prompt });
  },
});

/** Messages for one conversation (ownership-checked). */
export const messages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];

    const conversation = await ctx.db.get(conversationId);
    if (conversation === null || conversation.userId !== user._id) return [];

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(500);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new conversation. Optionally attach it to a project (or leave it
 *  in the general inbox by omitting projectId). */
export const create = mutation({
  args: {
    title: v.string(),
    mode: modeValidator,
    model: v.string(),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, { title, mode, model, projectId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    if (projectId) {
      const project = await ctx.db.get(projectId);
      if (project === null || project.userId !== user._id) {
        throw new Error("Project not found");
      }
    }

    const now = Date.now();
    const id = await ctx.db.insert("conversations", {
      userId: user._id,
      projectId,
      title: title.trim() || "New conversation",
      mode,
      model,
      updatedAt: now,
      createdAt: now,
    });
    return id;
  },
});

/** Delete a conversation and all of its messages. */
export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const conversation = await ctx.db.get(conversationId);
    if (conversation === null || conversation.userId !== user._id) {
      throw new Error("Conversation not found");
    }

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
    await ctx.db.delete(conversationId);
  },
});

/** Edit a user message: update its content and remove every message after it,
 *  so the thread is re-generated from that point. Only the message's owner
 *  can edit, and only user messages are editable. */
export const editMessage = mutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, { messageId, content }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const message = await ctx.db.get(messageId);
    if (message === null) throw new Error("Message not found");
    const conversation = await ctx.db.get(message.conversationId);
    if (conversation === null || conversation.userId !== user._id) {
      throw new Error("Conversation not found");
    }
    if (message.role !== "user") throw new Error("Only user messages can be edited");

    const trimmed = content.trim();
    if (!trimmed) throw new Error("Message can't be empty");

    // Remove everything from this point onward, then rewrite the message.
    const later = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", message.conversationId))
      .filter((q) => q.gte(q.field("createdAt"), message.createdAt))
      .collect();
    for (const m of later) {
      if (m._id !== messageId) await ctx.db.delete(m._id);
    }

    await ctx.db.patch(messageId, { content: trimmed });
    await ctx.db.patch(message.conversationId, { updatedAt: Date.now() });
  },
});

/** Append a message to a conversation. Pass a title to name a brand-new
 *  conversation from its first user message. */
export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: roleInMessageValidator,
    kind: messageKindValidator,
    content: v.string(),
    imageUrl: v.optional(v.string()),
    attachments: v.optional(v.array(attachmentValidator)),
    sources: v.optional(v.array(sourceValidator)),
    reasoning: v.optional(v.string()),
    usage: v.optional(messageUsageValidator),
    model: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");

    const conversation = await ctx.db.get(args.conversationId);
    if (conversation === null || conversation.userId !== user._id) {
      throw new Error("Conversation not found");
    }

    const id = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      kind: args.kind,
      content: args.content,
      imageUrl: args.imageUrl,
      attachments: args.attachments,
      sources: args.sources,
      reasoning: args.reasoning,
      usage: args.usage,
      model: args.model,
      createdAt: Date.now(),
    });

    if (args.title && conversation.title === "New conversation") {
      await ctx.db.patch(conversation._id, {
        title: args.title,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(conversation._id, { updatedAt: Date.now() });
    }

    // Keep the developer's monitoring up to date.
    await ctx.db.patch(user._id, { lastActiveAt: Date.now() });
    return id;
  },
});
