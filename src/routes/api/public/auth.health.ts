import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight, safeHandler } from "@/lib/http";

/**
 * Deployment check for OTP login. Reports whether the required environment
 * variables are present and whether the database is reachable. It never
 * returns any secret value.
 *
 *   GET https://<your-domain>/api/public/auth/health
 */
export const Route = createFileRoute("/api/public/auth/health")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      GET: async ({ request }) =>
        safeHandler(request, "auth/health", async () => {
          const env = {
            DATABASE_URL: Boolean(process.env["DATABASE_URL"]),
            RESEND_API_KEY: Boolean(process.env["RESEND_API_KEY"]),
            RESEND_FROM_EMAIL: Boolean(process.env["RESEND_FROM_EMAIL"]),
            AUTH_SECRET: Boolean(process.env["AUTH_SECRET"]),
          };

          let database: { ok: boolean; error?: string } = { ok: false, error: "no_database_url" };
          if (env.DATABASE_URL) {
            try {
              const { db, ensureAuthSchema } = await import("@/lib/db");
              await ensureAuthSchema();
              await db()`SELECT 1`;
              database = { ok: true };
            } catch (error) {
              database = { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          }

          const ok = env.DATABASE_URL && env.RESEND_API_KEY && database.ok;
          return jsonResponse(request, { ok, env, database }, ok ? 200 : 503);
        }),
    },
  },
});
