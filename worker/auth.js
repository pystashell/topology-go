/**
 * Who is calling: Better Auth (MIT, https://better-auth.com) on our own D1
 * database. Phase 1 has guests only: a browser becomes a guest the first
 * time it takes a seat in a room or saves a finished game, through an
 * HttpOnly session cookie scripts cannot read. Accounts and Google sign-in
 * come later (docs/design/accounts-and-game-records.md).
 *
 * Identity is optional infrastructure, like the rate limiters: without a
 * database binding or a secret (unit tests, plain local tools), or while
 * the database is unavailable, rooms keep working and games are simply
 * not saved.
 */
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";

// Browsers keep a cookie at most 400 days; each day of use renews it, so a
// guest who plays now and then keeps their games.
const SESSION_SECONDS = 400 * 24 * 60 * 60;
const SESSION_RENEW_SECONDS = 24 * 60 * 60;
// A signed copy of the session in a cookie spares the database a read on
// most requests.
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const MIN_SECRET_LENGTH = 32;

export const GUEST_NAME = "Guest";

// One auth instance per environment and origin (the site answers on more
// than one host name, and a session cookie belongs to one of them).
const instances = new WeakMap();

export function authConfigured(env) {
  return Boolean(env?.DB) &&
    typeof env?.BETTER_AUTH_SECRET === "string" &&
    env.BETTER_AUTH_SECRET.length >= MIN_SECRET_LENGTH;
}

/** The auth instance for this request's origin, or null when not configured. */
export function authFor(env, request) {
  if (!authConfigured(env)) return null;
  const origin = new URL(request.url).origin;
  let byOrigin = instances.get(env);
  if (!byOrigin) {
    byOrigin = new Map();
    instances.set(env, byOrigin);
  }
  let auth = byOrigin.get(origin);
  if (!auth) {
    auth = betterAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: origin,
      basePath: "/api/auth",
      trustedOrigins: [origin],
      session: {
        expiresIn: SESSION_SECONDS,
        updateAge: SESSION_RENEW_SECONDS,
        cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
      },
      plugins: [anonymous({
        emailDomainName: "guest.invalid",
        generateName: () => GUEST_NAME,
      })],
      advanced: { cookiePrefix: "topology-go" },
      // The Workers Rate Limiting binding guards /api/auth (wrangler.jsonc).
      rateLimit: { enabled: false },
      telemetry: { enabled: false },
    });
    byOrigin.set(origin, auth);
  }
  return auth;
}

/** The signed-in user (a guest for now), or null. Never throws. */
export async function sessionUser(env, request) {
  const auth = authFor(env, request);
  if (!auth) return null;
  try {
    const result = await auth.api.getSession({ headers: request.headers });
    return result?.user ?? null;
  } catch (error) {
    console.error("Session lookup failed", error);
    return null;
  }
}

/**
 * The caller's user, making this browser a guest if it has none yet.
 * Returns { user, setCookie } where setCookie lists the cookies the response
 * must carry; { user: null, setCookie: [] } when identity is unavailable.
 */
export async function userOrNewGuest(env, request) {
  const existing = await sessionUser(env, request);
  if (existing) return { user: existing, setCookie: [] };
  const auth = authFor(env, request);
  if (!auth) return { user: null, setCookie: [] };
  try {
    const { headers, response } = await auth.api.signInAnonymous({
      headers: request.headers,
      returnHeaders: true,
    });
    return {
      user: response?.user ?? null,
      setCookie: typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [],
    };
  } catch (error) {
    console.error("Guest sign-in failed", error);
    return { user: null, setCookie: [] };
  }
}

/** Add Set-Cookie headers to a response (a copy when its headers are immutable). */
export function withCookies(response, setCookie) {
  if (!setCookie?.length) return response;
  const copy = new Response(response.body, response);
  for (const cookie of setCookie) copy.headers.append("Set-Cookie", cookie);
  return copy;
}
