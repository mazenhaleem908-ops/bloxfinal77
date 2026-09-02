import { createFileRoute } from "@tanstack/react-router";
import {
  EMAIL_RE,
  emailSender,
  sanitizeHtml,
  sanitizeSubject,
  sanitizeText,
} from "@/lib/email-guard";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/rate-limit";

/**
 * Transactional email relay (Resend).
 *
 * The caller may only pick the recipient, subject and body copy. Sender
 * identity (from / from name / reply-to) is server controlled, HTML is
 * sanitised, and the endpoint is rate limited per IP and per recipient.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const Route = createFileRoute("/api/public/email/send")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = clientIp(request);
        if (!rateLimit(`email:ip:${ip}`, 10, 60_000)) return tooManyRequests(60);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ ok: false, error: "invalid_payload" }, 400);
        }

        const toRaw = body["to"] ?? body["email"];
        const to = (Array.isArray(toRaw) ? toRaw : [toRaw])
          .map((v) =>
            String(v ?? "")
              .trim()
              .toLowerCase(),
          )
          .filter((v) => EMAIL_RE.test(v))
          .slice(0, 5);
        if (to.length === 0) return json({ ok: false, error: "invalid_email" }, 400);

        for (const address of to) {
          if (!rateLimit(`email:to:${address}`, 5, 300_000)) return tooManyRequests(300);
        }

        const apiKey = process.env["RESEND_API_KEY"];
        if (!apiKey) {
          console.error("[email/send] RESEND_API_KEY is not configured");
          return json({ ok: false, error: "email_send_failed" }, 500);
        }

        // Sender identity is never taken from the request body.
        const sender = emailSender();
        const subject = sanitizeSubject(body["subject"], "BloxStar");
        const html = sanitizeHtml(body["html"]);
        const text = sanitizeText(body["text"]);
        if (!html && !text) return json({ ok: false, error: "invalid_payload" }, 400);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: sender.header,
            to,
            reply_to: sender.replyTo,
            subject,
            ...(html ? { html } : {}),
            ...(text ? { text } : {}),
          }),
        });

        if (!res.ok) {
          const detail = await res.text();
          console.error("[email/send] resend failed", res.status, detail);
          return json({ ok: false, error: "email_send_failed" }, 502);
        }

        return json({ ok: true });
      },
    },
  },
});
