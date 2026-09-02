// Browser-only Supabase client used exclusively for "Continue with Google".
// The publishable keys are fetched at runtime from /api/public/auth/supabase/config
// so nothing has to be baked into the static storefront bundle.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseConfig = { url: string; anonKey: string };

let cached: SupabaseClient | null = null;

export async function loadSupabaseConfig(): Promise<SupabaseConfig | null> {
  try {
    const res = await fetch("/api/public/auth/supabase/config", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; url?: string; anonKey?: string };
    if (!json?.ok || !json.url || !json.anonKey) return null;
    return { url: json.url, anonKey: json.anonKey };
  } catch {
    return null;
  }
}

export async function getSupabase(): Promise<SupabaseClient | null> {
  if (cached) return cached;
  const config = await loadSupabaseConfig();
  if (!config) return null;
  cached = createClient(config.url, config.anonKey, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/** Mirror the storefront's own localStorage session shape (bs_session / bs_user). */
export function saveStorefrontSession(data: {
  token: string;
  email: string;
  admin?: boolean;
  name?: string | null;
  photo?: string | null;
}): void {
  const email = (data.email || "").toLowerCase();
  try {
    localStorage.setItem(
      "bs_session",
      JSON.stringify({ token: data.token, email, admin: data.admin === true }),
    );
    localStorage.setItem(
      "bs_user",
      JSON.stringify({
        name: data.name || email.split("@")[0] || "Player",
        email,
        uid: "google-" + email,
        photo: data.photo || "",
      }),
    );
  } catch {
    /* storage unavailable — the session token still lives in Neon */
  }
}
