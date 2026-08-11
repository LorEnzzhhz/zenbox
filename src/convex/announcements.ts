import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Announcements — the developer (via the Control app) broadcasts a short
// message that every studio user sees as a dismissible banner. Complements the
// release-notice system: updates say "what changed", announcements say "look
// here / heads-up / maintenance".
// ---------------------------------------------------------------------------

/** Send an announcement to every studio user. Admins only. */
export const sendAnnouncement = mutation({
  args: { text: v.string() },
  handler: async (ctx, { text }) => {
    const user = await getCurrentUser(ctx);
    if (user === null || user.role !== "admin") throw new Error("Admins only");
    const trimmed = text.trim().slice(0, 300);
    if (!trimmed) throw new Error("Announcement is empty");
    await ctx.db.insert("announcements", {
      text: trimmed,
      createdBy: user._id,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** The newest announcement — shown to any signed-in studio user. */
export const latestAnnouncement = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return null;
    const list = await ctx.db
      .query("announcements")
      .withIndex("by_created")
      .order("desc")
      .take(1);
    return list[0] ?? null;
  },
});

/** Recent announcements for the Control app's broadcast panel. Admins only. */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null || user.role !== "admin") return [];
    return await ctx.db
      .query("announcements")
      .withIndex("by_created")
      .order("desc")
      .take(20);
  },
});
