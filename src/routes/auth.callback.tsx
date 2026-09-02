// Supabase Google Sign-In — step 3 (client half): catch the OAuth response,
// exchange the code for a Supabase session, then hand that access token to
// /api/public/auth/supabase/session which issues the standard Neon session.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getSupabase, saveStorefrontSession } from "@/lib/supabase-browser";
import { AuthStatus } from "./auth.google.start";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Finishing sign-in — BloxStar" },
      { name: "description", content: "Completing your BloxStar Google sign-in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthCallbackPage,
});

function readReturn(): string {
  try {
    const stored = sessionStorage.getItem("bs_google_return");
    sessionStorage.removeItem("bs_google_return");
    if (stored && stored.startsWith("/") && !stored.startsWith("//")) return stored;
  } catch {
    /* ignore */
  }
  return "/";
}

function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const target = readReturn();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      if (url.searchParams.get("error") || hash.get("error")) {
        setError("Google sign-in was cancelled.");
        return;
      }

      const supabase = await getSupabase();
      if (cancelled) return;
      if (!supabase) {
        setError("Google sign-in is not switched on yet — please use your email instead.");
        return;
      }

      let accessToken: string | null = null;

      const code = url.searchParams.get("code");
      if (code) {
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError("That Google sign-in link expired — please try again.");
          return;
        }
        accessToken = data.session?.access_token ?? null;
      } else if (hash.get("access_token")) {
        // Implicit flow fallback.
        const { data, error: setError2 } = await supabase.auth.setSession({
          access_token: hash.get("access_token") as string,
          refresh_token: hash.get("refresh_token") ?? "",
        });
        if (setError2) {
          setError("That Google sign-in link expired — please try again.");
          return;
        }
        accessToken = data.session?.access_token ?? null;
      } else {
        const { data } = await supabase.auth.getSession();
        accessToken = data.session?.access_token ?? null;
      }

      if (cancelled) return;
      if (!accessToken) {
        setError("Google sign-in failed — please try again.");
        return;
      }

      try {
        const res = await fetch("/api/public/auth/supabase/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ access_token: accessToken }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          token?: string;
          email?: string;
          admin?: boolean;
          name?: string | null;
          photo?: string | null;
        };
        if (!json?.ok || !json.token || !json.email) {
          setError("Google sign-in failed — please try again.");
          return;
        }
        saveStorefrontSession({
          token: json.token,
          email: json.email,
          admin: json.admin === true,
          name: json.name ?? null,
          photo: json.photo ?? null,
        });
      } catch {
        setError("Google sign-in failed — please try again.");
        return;
      }

      window.location.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthStatus title="Finishing your sign-in…" message={error} />;
}
