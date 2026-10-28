/**
 * HTTPS on every address the Worker answers.
 *
 * The custom domain redirects plain http at Cloudflare's edge (Always Use
 * HTTPS is a setting of the owner's zone), but the workers.dev address
 * belongs to Cloudflare's own zone, which has no such setting and serves
 * http as well. So the Worker sends any http request to the same address
 * over https, and every https response carries HSTS: a browser that has
 * seen the site once uses only https afterwards. Local development
 * (wrangler dev, tests) stays on http.
 *
 * Page navigations reach the Worker first (wrangler.jsonc routes every path
 * except the static asset folders through it), so a page it hands on from
 * the assets binding gets the document security headers here as well, in
 * case the binding's response lacks the rules of public/_headers.
 */

export const HSTS = "max-age=31536000";

/** The "/*" rule of public/_headers (a test keeps the two identical). */
export const DOCUMENT_SECURITY_HEADERS = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": HSTS,
});

/** Hosts served over plain http on purpose: local development. */
export function isLocalHost(hostname) {
  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]";
}

/**
 * The redirect for a request that arrived over plain http, or null: 301 for
 * reads, 308 (method and body kept) for anything else.
 */
export function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || isLocalHost(url.hostname)) return null;
  url.protocol = "https:";
  const read = request.method === "GET" || request.method === "HEAD";
  return new Response(null, { status: read ? 301 : 308, headers: { Location: url.href } });
}

/**
 * Add HSTS to an https response, and to an HTML page any document security
 * header it lacks. WebSocket upgrades pass through untouched.
 */
export function secureResponse(request, response) {
  if (response.status === 101 || response.webSocket) return response;
  const https = new URL(request.url).protocol === "https:";
  const page = /^text\/html/iu.test(response.headers.get("Content-Type") ?? "");
  const wanted = page ? DOCUMENT_SECURITY_HEADERS : { "Strict-Transport-Security": HSTS };
  const missing = Object.entries(wanted).filter(([name]) =>
    !response.headers.has(name) && (https || name !== "Strict-Transport-Security"));
  if (missing.length === 0) return response;
  const secured = new Response(response.body, response);
  for (const [name, value] of missing) secured.headers.set(name, value);
  return secured;
}
