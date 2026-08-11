import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Projects — named folders that group conversation threads. Deleting a project
// keeps its conversations but moves them to the general inbox (projectId unset).
// ---------------------------------------------------------------------------

/** All projects for the signed-in user, oldest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return [];

    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user_created", (q) => q.eq("userId", user._id))
      .order("asc")
      .take(100);

    // Attach live thread counts for the sidebar.
    const withCounts = await Promise.all(
      projects.map(async (p) => {
        const threads = await ctx.db
          .query("conversations")
          .withIndex("by_user_project_updated", (q) =>
            q.eq("userId", user._id).eq("projectId", p._id),
          )
          .collect();
        return { ...p, threadCount: threads.length };
      }),
    );
    return withCounts;
  },
});

/** Create a project. */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const clean = name.trim();
    if (!clean) throw new Error("Project name can't be empty");
    const now = Date.now();
    return await ctx.db.insert("projects", {
      userId: user._id,
      name: clean.slice(0, 60),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Rename a project. */
export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (project === null || project.userId !== user._id) {
      throw new Error("Project not found");
    }
    const clean = name.trim();
    if (!clean) throw new Error("Project name can't be empty");
    await ctx.db.patch(projectId, { name: clean.slice(0, 60), updatedAt: Date.now() });
  },
});

/** Delete a project — conversations move to the general inbox. */
export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    const project = await ctx.db.get(projectId);
    if (project === null || project.userId !== user._id) {
      throw new Error("Project not found");
    }
    const threads = await ctx.db
      .query("conversations")
      .withIndex("by_user_project_updated", (q) =>
        q.eq("userId", user._id).eq("projectId", projectId),
      )
      .collect();
    for (const t of threads) {
      await ctx.db.patch(t._id, { projectId: undefined });
    }
    await ctx.db.delete(projectId);
  },
});
