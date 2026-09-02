// Supabase Google Sign-In — step 1: hand the *publishable* client keys to the
// storefront. Only SUPABASE_URL and SUPABASE_ANON_KEY are exposed; the anon key
// is designed to be public and is protected by Supabase RLS.
import { createFileRoute } from "@tanstack/react-router";

import { jsonResponse, preflight, safeHandler } from "@/lib/http";

export function supabaseEnv(): { url: string; anonKey: string } {
  const url = String(process.env["SUPABASE_URL"] ?? "").trim().replace(/\/$/, "");
  const anonKey = String(
    process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "",
  ).trim();
  return { url, anonKey };
}

export const Route = createFileRoute("/api/public/auth/supabase/config")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      GET: async ({ request }) =>
        safeHandler(request, "auth/supabase/config", async () => {
          const { url, anonKey } = supabaseEnv();
          if (!url || !anonKey) {
            return jsonResponse(request, { ok: false, error: "not-configured" }, 200);
          }
          return jsonResponse(
            request,
            { ok: true, url, anonKey, redirectPath: "/auth/callback" },
            200,
          );
        }),
    },
  },
});
