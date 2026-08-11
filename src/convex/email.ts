import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Custom code sender — emails generated code to the user's inbox via the
// Resend API (free tier, no SMTP setup). Requires RESEND_API_KEY in the
// project Keys tab; the from-address defaults to the Resend test sender and
// can be overridden with EMAIL_FROM once a domain is verified.
// ---------------------------------------------------------------------------

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export const sendCodeEmail = action({
  args: {
    to: v.string(),
    subject: v.string(),
    body: v.string(),
    filename: v.optional(v.string()),
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { to, subject, body, filename, language },
  ): Promise<{ ok: boolean; error: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error:
          "No RESEND_API_KEY configured. Add a free Resend key in the project Keys tab, then try again.",
      };
    }

    const from = process.env.EMAIL_FROM ?? "Zenbox <onboarding@resend.dev>";
    const langTag = language ? language.trim().toLowerCase() : "text";
    const fileLabel = (filename ?? "code").trim();

    const text = [
      body.trim() ? body.trim() : "Your requested code is below.",
      "",
      "```" + langTag,
      body,
      "```",
      "",
      "— sent from Zenbox",
    ].join("\n");

    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to,
          subject: subject.trim() || `Zenbox code — ${fileLabel}`,
          text,
        }),
      });
      if (!res.ok) {
        let detail = `Resend error ${res.status}`;
        try {
          const payload = (await res.json()) as { message?: string };
          if (payload.message) detail = payload.message;
        } catch {
          /* ignore */
        }
        return { ok: false, error: detail };
      }
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Email send failed" };
    }
  },
});
