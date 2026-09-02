import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight, safeHandler } from "@/lib/http";

export const Route = createFileRoute("/api/public/auth/session")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        safeHandler(request, "auth/session", async () => {
          const json = (body: unknown, status = 200) => jsonResponse(request, body, status);

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return json({ ok: false });
          }

          const token = String(body["token"] ?? "").trim();
          if (!token) return json({ ok: false });
          if (!process.env["DATABASE_URL"]) return json({ ok: false });

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();
          const rows = (await sql`
            SELECT email, admin, expires_at FROM auth_sessions WHERE token = ${token} LIMIT 1
          `) as Array<{ email: string; admin: boolean; expires_at: string }>;

          const row = rows[0];
          if (!row) return json({ ok: false });
          if (new Date(row.expires_at).getTime() < Date.now()) {
            await sql`DELETE FROM auth_sessions WHERE token = ${token}`;
            return json({ ok: false });
          }

          return json({ ok: true, email: row.email, admin: row.admin });
        }),
    },
  },
});
