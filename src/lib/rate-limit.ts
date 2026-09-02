/**
 * Small in-memory sliding-window rate limiter for public API routes.
 *
 * Best-effort abuse protection at the edge: each isolate keeps its own counters,
 * which is enough to stop a single client hammering an endpoint (email relays,
 * abandoned-cart reminders) without adding a database round-trip per request.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export function clientIp(request: Request): string {
  const h = request.headers;
  const forwarded = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for") || "";
  return (forwarded.split(",")[0] || "unknown").trim().slice(0, 64) || "unknown";
}

/**
 * Returns true when the caller is allowed. `limit` requests per `windowMs`.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) buckets.clear();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return true;
}

export const tooManyRequests = (retryAfterSeconds = 60) =>
  new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": String(retryAfterSeconds),
    },
  });
