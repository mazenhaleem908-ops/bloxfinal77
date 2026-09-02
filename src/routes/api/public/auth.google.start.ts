// Google OAuth 2.0 / OIDC — step 1: build the authorization URL and send the
// browser to Google. State + PKCE verifier are stored in Neon so the callback
// can run on a different serverless instance.
import { createFileRoute } from "@tanstack/react-router";

import {
  pkceChallenge,
  randomUrlSafe,
  requestOrigin,
  safeReturnTo,
} from "@/lib/auth";
import { preflight } from "@/lib/http";

export function googleRedirectUri(request: Request): string {
  const pinned = process.env["GOOGLE_REDIRECT_URI"];
  if (pinned) return pinned;
  return `${requestOrigin(request)}/api/public/auth/google/callback`;
}

export const Route = createFileRoute("/api/public/auth/google/start")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const returnTo = safeReturnTo(url.searchParams.get("return"));
        const fail = (reason: string) =>
          new Response(null, {
            status: 302,
            headers: { location: `${returnTo}?bs_google_error=${reason}` },
          });

        const clientId = process.env["GOOGLE_CLIENT_ID"];
        const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
        if (!clientId || !clientSecret) {
          console.error("[auth/google/start] GOOGLE_CLIENT_ID/SECRET are not configured");
          return fail("not-configured");
        }
        if (!process.env["DATABASE_URL"]) {
          console.error("[auth/google/start] DATABASE_URL is not configured");
          return fail("not-configured");
        }

        try {
          const { db, ensureAuthSchema } = await import("@/lib/db");
          await ensureAuthSchema();
          const sql = db();

          const state = randomUrlSafe(32);
          const verifier = randomUrlSafe(32);
          const challenge = await pkceChallenge(verifier);
          const redirectUri = googleRedirectUri(request);

          await sql`DELETE FROM auth_oauth_states WHERE expires_at < now()`;
          await sql`
            INSERT INTO auth_oauth_states (state, code_verifier, redirect_uri, return_to, expires_at)
            VALUES (${state}, ${verifier}, ${redirectUri}, ${returnTo}, now() + interval '10 minutes')
          `;

          // Endpoint is overridable only via a server env var (used by the
          // self-hosted / integration-test issuer); it defaults to Google.
          const authorize = new URL(
            process.env["GOOGLE_AUTH_ENDPOINT"] || "https://accounts.google.com/o/oauth2/v2/auth",
          );
          authorize.searchParams.set("client_id", clientId);
          authorize.searchParams.set("redirect_uri", redirectUri);
          authorize.searchParams.set("response_type", "code");
          authorize.searchParams.set("scope", "openid email profile");
          authorize.searchParams.set("state", state);
          authorize.searchParams.set("code_challenge", challenge);
          authorize.searchParams.set("code_challenge_method", "S256");
          authorize.searchParams.set("prompt", "select_account");
          authorize.searchParams.set("access_type", "online");

          return new Response(null, {
            status: 302,
            headers: { location: authorize.toString(), "cache-control": "no-store" },
          });
        } catch (error) {
          console.error("[auth/google/start] failed", error);
          return fail("start-failed");
        }
      },
    },
  },
});
