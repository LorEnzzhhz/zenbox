import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send the OTP via the configured provider. Checks these env vars in order:
 *   1. RESEND_API_KEY + EMAIL_FROM  → Resend (same as the code sender)
 *   2. SMTP_HOST / SMTP_USER / SMTP_PASS → SMTP via the provider's HTTP bridge
 *   3. Fallback → the freebuff OTP relay (default, no config needed)
 */
async function sendOtp({
  to,
  token,
}: {
  to: string;
  token: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  const smtpHost = process.env.SMTP_HOST;

  // 1. Resend (preferred — clean API, free tier, works as a custom Gmail)
  if (resendKey) {
    const from = process.env.EMAIL_FROM ?? "Zenbox <onboarding@resend.dev>";
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: "Your Zenbox verification code",
        text: [
          "Your one-time verification code is:",
          "",
          token,
          "",
          "It expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
          "",
          "— Zenbox",
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      let detail = `Resend error ${res.status}`;
      try {
        const p = (await res.json()) as { message?: string };
        if (p.message) detail = p.message;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return;
  }

  // 2. SMTP via HTTP bridge (Mailgun, SendGrid, Mailtrap — or any provider
  //    that exposes an HTTP API). Configure:
  //    SMTP_HOST   = your domain / API endpoint host
  //    SMTP_USER   = API key or username
  //    SMTP_PASS   = secret
  //    SMTP_API_URL = full API endpoint (defaults to Mailgun style)
  //    EMAIL_FROM  = sender address
  if (smtpHost) {
    const smtpUser = process.env.SMTP_USER ?? "";
    const smtpPass = process.env.SMTP_PASS ?? "";
    const from = process.env.EMAIL_FROM ?? `noreply@${smtpHost}`;
    const smtpApiUrl =
      process.env.SMTP_API_URL ||
      `https://api.mailgun.net/v3/${smtpHost}/messages`;
    const form = new URLSearchParams();
    form.set("from", from);
    form.set("to", to);
    form.set("subject", "Your Zenbox verification code");
    form.set(
      "text",
      [
        "Your one-time verification code is:",
        "",
        token,
        "",
        "It expires in 15 minutes. If you didn't request this, you can safely ignore this email.",
        "",
        "— Zenbox",
      ].join("\n"),
    );
    const auth = Buffer.from(`${smtpUser}:${smtpPass}`).toString("base64");
    const res = await fetch(smtpApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    if (!res.ok) {
      let detail = `SMTP error ${res.status}`;
      try {
        const p = (await res.json()) as { message?: string };
        if (p.message) detail = p.message;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return;
  }

  // 3. Freebuff OTP relay (no config needed — works out of the box)
  try {
    await axios.post(
      "https://auth.freebuff.app/send_otp",
      {
        to,
        otp: token,
        appName: process.env.VLY_APP_NAME || "a freebuff.com application",
      },
      {
        headers: {
          "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
        },
      },
    );
  } catch (error) {
    throw new Error(JSON.stringify(error));
  }
}

export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await sendOtp({ to: email, token });
  },
});