// Shared HTTP helpers for the public API routes.
//
// Every /api/public/* response is JSON (never an HTML error page) and carries
// permissive CORS headers, so the storefront keeps working when it is served
// from the bare apex (bloxistar.com) while the API answers on www, or from a
// Vercel preview domain.

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "content-type": "application/json",
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/**
 * Runs a handler and converts any thrown error into a JSON payload.
 * Without this an unexpected throw (missing env var, DB outage, ...) bubbles up
 * to the SSR error wrapper and the browser receives an HTML 500, which the
 * storefront cannot parse — the user just sees "we couldn't send the code".
 */
export async function safeHandler(
  request: Request,
  tag: string,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error(`[${tag}] unhandled error`, error);
    return jsonResponse(
      request,
      {
        ok: false,
        error: "server_error",
        detail: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
}
