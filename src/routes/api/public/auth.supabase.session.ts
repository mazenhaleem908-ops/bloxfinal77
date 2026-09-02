// Supabase Google Sign-In — step 3: verify the Supabase access token server
// side and mint EXACTLY the same Neon `auth_sessions` row the email-OTP flow
// creates, so the rest of the storefront cannot tell the two apart.
import { createFileRoute } from "@tanstack/react-router";

import { isAdminEmail, newToken } from "@/lib/auth";
import { jsonResponse, preflight, safeHandler } from "@/lib/http";

function supabaseEnv(): { url: string; anonKey: string } {
  const url = String(process.env["SUPABASE_URL"] ?? "").trim().replace(/\/$/, "");
  const anonKey = String(
    process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "",
  ).trim();
  return { url, anonKey };
}

type SupabaseUser = {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
};

export const Route = createFileRoute("/api/public/auth/supabase/session")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      POST: async ({ request }) =>
        safeHandler(request, "auth/supabase/session", async () => {
          const json = (body: unknown, status = 200) => jsonResponse(request, body, status);

          let body: Record<string, unknown>;
          try {
            body = (await request.json()) as Record<string, unknown>;
          } catch {
            return json({ ok: false, error: "invalid" }, 400);
          }

          const accessToken = String(
            body["access_token"] ?? body["token"] ?? body["accessToken"] ?? "",
          ).trim();
          if (!accessToken) return json({ ok: false, error: "invalid" }, 400);

          const { url, anonKey } = supabaseEnv();
          if (!url || !anonKey) {
            console.error("[auth/supabase/session] SUPABASE_URL / SUPABASE_ANON_KEY missing");
            return json({ ok: false, error: "not-configured" }, 500);
          }
          if (!process.env["DATABASE_URL"]) {
            console.error("[auth/supabase/session] DATABASE_URL is not configured");
            return json({ ok: false, error: "not-configured" }, 500);
          }

          // Verify the token with Supabase Auth itself — never trust the client.
          let profile: SupabaseUser;
          try {
            const res = await fetch(`${url}/auth/v1/user`, {
              headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) {
              console.error(
                `[auth/supabase/session] token rejected [${res.status}]: ${await res.text()}`,
              );
              return json({ ok: false, error: "invalid-token" }, 401);
            }
            profile = (await res.json()) as SupabaseUser;
          } catch (error) {
            console.error("[auth/supabase/session] verification failed", error);
            return json({ ok: false, error: "invalid-token" }, 401);
          }

          const email = String(profile.email ?? "")
            .trim()
            .toLowerCase();
          if (!email) return json({ ok: false, error: "unverified-email" }, 400);
          if (!profile.email_confirmed_at && !profile.confirmed_at) {
            return json({ ok: false, error: "unverified-email" }, 400);
          }

          const meta = (profile.user_metadata ?? {}) as Record<string, unknown>;
          const name =
            String(meta["full_name"] ?? meta["name"] ?? "").trim() || email.split("@")[0]!;
          const picture = String(meta["avatar_url"] ?? meta["picture"] ?? "").trim() || null;

          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();

          const token = newToken();
          const admin = isAdminEmail(email);
          try {
            await sql`
              INSERT INTO auth_sessions (token, email, admin, expires_at)
              VALUES (${token}, ${email}, ${admin}, now() + interval '30 days')
            `;
          } catch (error) {
            console.error("[auth/supabase/session] session insert failed", error);
            return json({ ok: false, error: "invalid" }, 500);
          }

          return json({ ok: true, token, email, admin, name, photo: picture });
        }),
    },
  },
});
