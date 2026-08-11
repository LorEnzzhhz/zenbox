import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// File storage for message attachments. The client asks for a single-use
// upload URL, PUTs the file bytes directly to it (with the auth token), then
// stores the returned storageId on the message. URLs are resolved on demand.
// ---------------------------------------------------------------------------

/** Get a single-use upload URL for the signed-in user. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (user === null) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Resolve storage ids to public, expiring URLs. Signed-in users only; the
 *  ids themselves come from messages the client already has access to. */
export const getAttachmentUrls = query({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, { storageIds }) => {
    const user = await getCurrentUser(ctx);
    if (user === null) return {};
    const out: Record<string, string | null> = {};
    for (const id of storageIds) {
      out[id] = await ctx.storage.getUrl(id as Id<"_storage">);
    }
    return out;
  },
});
