import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// Workspace modes: how the model should behave in a conversation
export const modeValidator = v.union(
  v.literal("chat"),
  v.literal("code"),
  v.literal("image"),
  v.literal("write"),
  v.literal("deep"),
);
export type Mode = Infer<typeof modeValidator>;

export const roleInMessageValidator = v.union(
  v.literal("user"),
  v.literal("assistant"),
);

export const messageKindValidator = v.union(
  v.literal("text"),
  v.literal("image"),
);

// A file attached to a message. The bytes live in Convex storage (storageId);
// only metadata is stored on the document. Images and text files are also fed
// to the model; everything else is described by name/type/size.
export const attachmentValidator = v.object({
  name: v.string(),
  type: v.string(),
  size: v.optional(v.number()),
  storageId: v.optional(v.string()),
});
export type Attachment = Infer<typeof attachmentValidator>;

// Sources cited by a deep-research reply. Stored with the assistant message so
// the thread can render them as clickable source cards under the answer.
export const sourceValidator = v.object({
  title: v.string(),
  url: v.string(),
  snippet: v.string(),
  platform: v.optional(v.string()),
});
export type Source = Infer<typeof sourceValidator>;

// Token usage reported by the model for one assistant reply (prompt + output).
export const messageUsageValidator = v.object({
  prompt: v.number(),
  completion: v.number(),
});
export type MessageUsage = Infer<typeof messageUsageValidator>;

// One item of an update's proposed change list (title + rationale).
export const updateChangeValidator = v.object({
  title: v.string(),
  detail: v.string(),
});
export type UpdateChange = Infer<typeof updateChangeValidator>;

// The Verify phase's verdict on one proposed change, persisted with the draft
// so the developer can revisit per-change statuses from the History tab.
export const updateVerifyItemValidator = v.object({
  title: v.string(),
  status: v.string(),
  note: v.string(),
});
export type UpdateVerifyItem = Infer<typeof updateVerifyItemValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // Guest access: anonymous users redeem a developer-issued access token.
      accessTokenId: v.optional(v.id("accessTokens")),
      guestName: v.optional(v.string()),
      lastActiveAt: v.optional(v.number()),
      // Session telemetry reported by the client so the developer can see who
      // is connected, from where, and on which device.
      lastIp: v.optional(v.string()),
      lastDevice: v.optional(v.string()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // Access requests — guests ask the developer for access. Approving a
    // request mints a token and grants that guest immediately.
    accessRequests: defineTable({
      userId: v.id("users"),
      name: v.optional(v.string()),
      message: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      createdAt: v.number(),
      decidedAt: v.optional(v.number()),
      tokenId: v.optional(v.id("accessTokens")),
    })
      .index("by_created", ["createdAt"])
      .index("by_user", ["userId"]),

    // Guest access tokens issued by the developer (admin). Guests redeem a
    // code to use the studio; the developer can monitor usage.
    accessTokens: defineTable({
      code: v.string(),
      label: v.string(),
      maxUses: v.number(),
      usedCount: v.number(),
      enabled: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_code", ["code"]).index("by_created", ["createdAt"]),

    // Projects — named folders that group conversation threads.
    projects: defineTable({
      userId: v.id("users"),
      name: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user_created", ["userId", "createdAt"]),

    // AI workspace conversations (one per thread). A conversation may belong
    // to a project (projectId) or live in the general inbox.
    conversations: defineTable({
      userId: v.id("users"),
      projectId: v.optional(v.id("projects")),
      title: v.string(),
      mode: modeValidator,
      model: v.string(),
      updatedAt: v.number(),
      createdAt: v.number(),
    }).index("by_user_updated", ["userId", "updatedAt"]).index("by_user_project_updated", ["userId", "projectId", "updatedAt"]),

    // Messages inside a conversation. kind "image" carries a generated imageUrl.
    messages: defineTable({
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
      createdAt: v.number(),
    }).index("by_conversation", ["conversationId", "createdAt"]).index("by_created", ["createdAt"]),

    // Plugins & Skills — either imported from a GitHub repo or derived from a
    // website. Enabled plugins extend the system prompt of every conversation.
    plugins: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.string(),
      source: v.union(v.literal("github"), v.literal("site")),
      repoUrl: v.optional(v.string()),
      siteUrl: v.optional(v.string()),
      capabilities: v.array(v.string()),
      features: v.array(v.string()),
      systemPrompt: v.string(),
      enabled: v.boolean(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Developer announcements broadcast from the Control app to every studio
    // user — a dismissible banner below the studio header.
    announcements: defineTable({
      text: v.string(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    // App updates produced by the developer's Control app. The AI pipeline
    // (plan → revise → review) fills the artifacts; the developer ships the
    // update and every user of the studio sees the release notice.
    updates: defineTable({
      version: v.number(),
      title: v.string(),
      command: v.string(),
      plan: v.string(),
      revised: v.string(),
      review: v.string(),
      verdict: v.string(),
      changes: v.array(updateChangeValidator),
      // Verify-phase output — per-change statuses against the real codebase.
      verifyOverall: v.optional(v.union(v.literal("pass"), v.literal("review"))),
      verifyPerChange: v.optional(v.array(updateVerifyItemValidator)),
      verifyGaps: v.optional(v.array(v.string())),
      // Hosted APK for the Android apps — when set, native users' Update button
      // downloads and installs this real .apk instead of the web flow. apkFor
      // says which app that APK belongs to ("studio" | "control") so the two
      // apps sharing this feed never install each other's binary.
      apkUrl: v.optional(v.string()),
      apkFor: v.optional(v.union(v.literal("studio"), v.literal("control"))),
      releaseNotes: v.optional(v.string()),
      status: v.union(v.literal("draft"), v.literal("reviewed"), v.literal("shipped")),
      shippedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_created", ["createdAt"]),

    // Per-user settings. Keys are sealed server-side (see lib/keys.ts) and are
    // NEVER returned to clients — only masked previews are.
    settings: defineTable({
      userId: v.id("users"),
      openrouterKey: v.optional(v.string()),
      masked: v.optional(v.string()),
      opencodeKey: v.optional(v.string()),
      opencodeMasked: v.optional(v.string()),
      // Telegram bot: sealed bot token + the random webhook secret token.
      telegramKey: v.optional(v.string()),
      telegramUsername: v.optional(v.string()),
      telegramSecret: v.optional(v.string()),
      // Discord bot: a channel webhook URL (send-only, no token storage).
      discordWebhook: v.optional(v.string()),
      // Personal Zenbox API key — auto-generated per user, used to call the
      // HTTP API with `Authorization: Bearer <key>`.
      apiKey: v.optional(v.string()),
      apiKeyMasked: v.optional(v.string()),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_telegram_secret", ["telegramSecret"])
      .index("by_api_key", ["apiKey"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
