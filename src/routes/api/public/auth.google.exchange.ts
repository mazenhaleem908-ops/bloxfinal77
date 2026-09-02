// Google OAuth 2.0 / OIDC — step 3: the storefront swaps the single-use
// hand-off code from the callback redirect for the real Neon session token.
import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse, preflight, safeHandler } from "@/lib/http";

type LoginCodeRow = {
  token: string;
  email: string;
  admin: boolean;
  name: string | null;
  picture: string | null;
  expires_at: string;
};

export const Route = createFileRoute("/api/public/auth/google/exchange")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        safeHandler(request, "auth/google/exchange", async () => {
          const json = (body: unknown, status = 200) => jsonResponse(request, body, status);

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return json({ ok: false, error: "invalid" }, 400);
          }

          const code = String(body["code"] ?? "").trim();
          if (!code || code.length > 128) return json({ ok: false, error: "invalid" }, 400);
          if (!process.env["DATABASE_URL"]) return json({ ok: false, error: "not-configured" }, 500);

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();

          const rows = (await sql`
            SELECT token, email, admin, name, picture, expires_at
            FROM auth_login_codes WHERE code = ${code} LIMIT 1
          `) as LoginCodeRow[];
          const row = rows[0];
          // Single use.
          await sql`DELETE FROM auth_login_codes WHERE code = ${code}`;
          if (!row) return json({ ok: false, error: "expired" }, 400);
          if (new Date(row.expires_at).getTime() < Date.now()) {
            return json({ ok: false, error: "expired" }, 400);
          }

          return json({
            ok: true,
            token: row.token,
            email: row.email,
            admin: row.admin === true,
            name: row.name || row.email.split("@")[0],
            photo: row.picture || "",
          });
        }),
    },
  },
});
