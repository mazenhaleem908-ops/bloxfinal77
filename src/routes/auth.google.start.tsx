// Supabase Google Sign-In — step 2: kick off the OAuth redirect.
// The static storefront button lands here; this page owns the
// @supabase/supabase-js PKCE handshake and leaves for Google's consent screen.
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getSupabase } from "@/lib/supabase-browser";

export const Route = createFileRoute("/auth/google/start")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Signing in with Google — BloxStar" },
      { name: "description", content: "Redirecting you to Google to finish signing in to BloxStar." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GoogleStartPage,
});

function safeReturn(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function GoogleStartPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const ret = safeReturn(params.get("return"));
      try {
        sessionStorage.setItem("bs_google_return", ret);
      } catch {
        /* ignore */
      }

      const supabase = await getSupabase();
      if (cancelled) return;

      if (!supabase) {
        // Supabase not configured — fall back to the existing server-side flow.
        window.location.replace(
          "/api/public/auth/google/start?return=" + encodeURIComponent(ret),
        );
        return;
      }

      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });

      if (cancelled) return;
      if (oauthError || !data?.url) {
        setError("We could not open Google sign-in. Please try again.");
        return;
      }
      window.location.assign(data.url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <AuthStatus title="Taking you to Google…" message={error} />;
}

export function AuthStatus({ title, message }: { title: string; message?: string | null }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "Fredoka, system-ui, sans-serif",
        background: "#0b1120",
        color: "#f8fafc",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>{message ? "Sign-in failed" : title}</h1>
        <p style={{ marginTop: "12px", opacity: 0.75 }}>
          {message ?? "Hang tight, this only takes a second."}
        </p>
        <p style={{ marginTop: "20px" }}>
          <a href="/" style={{ color: "#60a5fa" }}>
            Back to BloxStar
          </a>
        </p>
      </div>
    </main>
  );
}
