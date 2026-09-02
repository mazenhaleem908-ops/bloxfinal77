// Shared auth helpers used by both the email-OTP and the Google OAuth routes,
// so every sign-in path creates exactly the same Neon `auth_sessions` row.

const DEFAULT_ADMINS =
  "mazenhaleem908@gmail.com,kareemahmedhalim@gmail.com,sagedhalim9@gmail.com";

/**
 * Read the env var per request: on Vercel, module-scope reads can run before the
 * function environment is fully populated.
 */
export function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] || DEFAULT_ADMINS)
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

/** 64 hex chars of CSPRNG randomness — same shape as the OTP session token. */
export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function randomUrlSafe(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const byte of view) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}

/**
 * The public origin this request was served from, honouring Vercel's proxy
 * headers. Used to build the Google redirect_uri when GOOGLE_REDIRECT_URI is
 * not pinned explicitly.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only same-origin relative paths may be used as a post-login landing page. */
export function safeReturnTo(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/** Decodes a JWT payload. The token itself is trusted because it was fetched
 * directly from Google's token endpoint over TLS; claims are still validated. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const decoded = new TextDecoder().decode(
      Uint8Array.from(json, (c) => c.charCodeAt(0)),
    );
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}
