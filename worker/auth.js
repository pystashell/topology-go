/**
 * Who is calling: Better Auth (MIT, https://better-auth.com) on our own D1
 * database. A browser becomes a guest the first time it takes a seat in a
 * room or saves a finished game, through an HttpOnly session cookie
 * scripts cannot read. A guest can register (username and password, email
 * optional) or sign in, with a password or with Google; either way its
 * games move to the account (adoptGuest). worker/accounts.js has the
 * routes; docs/design/accounts-and-game-records.md the design.
 *
 * Identity is optional infrastructure, like the rate limiters: without a
 * database binding or a secret (unit tests, plain local tools), or while
 * the database is unavailable, rooms keep working and games are simply
 * not saved. Passwords also need PASSWORD_PEPPER, Google sign-in its
 * client id and secret, codes by email the mail service (worker/email.js);
 * each is off until its secrets are set.
 */
import { betterAuth } from "better-auth";
import { anonymous, emailOTP, username } from "better-auth/plugins";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  cleanUsername,
  usernameCandidates,
  usernameFrom,
  usernameKey,
} from "../src/multiplayer/accountRules.js";
import { EMAIL_CODE_SECONDS, queueCodeEmail } from "./email.js";
import { MIN_PEPPER_LENGTH, hashPassword, verifyPassword } from "./passwords.js";

// Browsers keep a cookie at most 400 days; each day of use renews it, so a
// guest who plays now and then keeps their games.
const SESSION_SECONDS = 400 * 24 * 60 * 60;
const SESSION_RENEW_SECONDS = 24 * 60 * 60;
// A signed copy of the session in a cookie spares the database a read on
// most requests.
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;
const MIN_SECRET_LENGTH = 32;
// The guests a person was before, as rooms may still know them (newest first).
const MAX_FORMER_USER_IDS = 16;

export const GUEST_NAME = "Guest";

// One auth instance per environment and origin (the site answers on more
// than one host name, and a session cookie belongs to one of them).
const instances = new WeakMap();

export function authConfigured(env) {
  return Boolean(env?.DB) &&
    typeof env?.BETTER_AUTH_SECRET === "string" &&
    env.BETTER_AUTH_SECRET.length >= MIN_SECRET_LENGTH;
}

export function passwordsConfigured(env) {
  return authConfigured(env) &&
    typeof env?.PASSWORD_PEPPER === "string" &&
    env.PASSWORD_PEPPER.length >= MIN_PEPPER_LENGTH;
}

export function googleConfigured(env) {
  return authConfigured(env) &&
    typeof env?.GOOGLE_CLIENT_ID === "string" && env.GOOGLE_CLIENT_ID.length > 0 &&
    typeof env?.GOOGLE_CLIENT_SECRET === "string" && env.GOOGLE_CLIENT_SECRET.length > 0;
}

/**
 * A guest registered or signed in on its browser and is now `userId`: its
 * records move to the account, the guest id is remembered for the rooms
 * that still know the person by it (a seat taken as a guest, a game that
 * ends later), and the guest goes. One D1 batch, so all or nothing; a
 * failure leaves the guest and its games where they were.
 */
export async function adoptGuest(db, guestId, userId, now = Date.now()) {
  if (!db || !guestId || !userId || guestId === userId) return false;
  try {
    await db.batch([
      db.prepare(
        `INSERT OR REPLACE INTO user_alias (old_id, new_id, created_at) VALUES (?, ?, ?)`,
      ).bind(guestId, userId, now),
      // A game both of them played (two browsers of one person) stays once.
      db.prepare(`UPDATE OR IGNORE game_record_owner SET user_id = ? WHERE user_id = ?`)
        .bind(userId, guestId),
      // Its sessions and anything left go with it (foreign keys cascade).
      db.prepare(`DELETE FROM "user" WHERE id = ? AND "isAnonymous" = 1`).bind(guestId),
    ]);
    return true;
  } catch (error) {
    console.error("Moving a guest's games to its account failed", error);
    return false;
  }
}

/**
 * Delete an account (never a guest) for good. Its sessions, sign-ins,
 * former guest ids and places on game lists go with it (foreign keys
 * cascade); a game nobody else keeps goes too, while the other player of
 * a game keeps theirs. One D1 batch. Returns whether an account was deleted.
 */
export async function deleteAccount(db, userId) {
  const [, deleted] = await db.batch([
    db.prepare(
      `DELETE FROM game_record WHERE id IN (SELECT record_id FROM game_record_owner WHERE user_id = ?)
       AND NOT EXISTS (SELECT 1 FROM game_record_owner o WHERE o.record_id = game_record.id AND o.user_id <> ?)`,
    ).bind(userId, userId),
    db.prepare(`DELETE FROM "user" WHERE id = ? AND ("isAnonymous" IS NULL OR "isAnonymous" = 0)`).bind(userId),
  ]);
  return deleted.meta.changes > 0;
}

/**
 * A username nobody has for an account made without one (by signing in
 * with Google, owner's decision 2026-10-28): the first free one of
 * usernameCandidates, else the first with a random number after it.
 */
async function freeUsername(db, user) {
  const candidates = usernameCandidates({ name: user.name, email: user.email });
  const keys = candidates.map(usernameKey);
  const { results } = await db.prepare(
    `SELECT username FROM "user" WHERE username IN (${keys.map(() => "?").join(", ")})`,
  ).bind(...keys).all();
  const taken = new Set(results.map((row) => row.username));
  const free = candidates.find((candidate) => !taken.has(usernameKey(candidate)));
  if (free) return free;
  const number = String(Math.floor(Math.random() * 900_000) + 100_000);
  return `${usernameFrom(candidates[0], USERNAME_MAX_LENGTH - number.length) ?? candidates[0]}${number}`;
}

/**
 * An account made by signing in with Google before usernames were given
 * (0.3.0-rc.18) gets one now. Returns the user with it, or as it was when
 * someone else gave it one first.
 */
export async function giveUsername(db, user) {
  const name = await freeUsername(db, user);
  const { meta } = await db.prepare(
    `UPDATE "user" SET username = ?, "displayUsername" = ?
     WHERE id = ? AND username IS NULL AND ("isAnonymous" IS NULL OR "isAnonymous" = 0)`,
  ).bind(usernameKey(name), name, user.id).run();
  return meta.changes > 0 ? { ...user, username: usernameKey(name), displayUsername: name } : user;
}

/** The guests an account was before (none for a guest), newest first. */
export async function formerUserIds(db, user) {
  if (!db || !user?.id || user.isAnonymous) return [];
  try {
    const { results } = await db.prepare(
      `SELECT old_id FROM user_alias WHERE new_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).bind(user.id, MAX_FORMER_USER_IDS).all();
    return results.map((row) => row.old_id).filter((id) => typeof id === "string" && id);
  } catch (error) {
    console.error("Reading former guests failed", error);
    return [];
  }
}

function authOptions(env, origin) {
  const pepper = env.PASSWORD_PEPPER;
  return {
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
    emailAndPassword: {
      enabled: passwordsConfigured(env),
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Nothing sends email yet: a new account is signed in at once.
      autoSignIn: true,
      password: {
        hash: (password) => hashPassword(password, pepper),
        verify: ({ hash, password }) => verifyPassword(hash, password, pepper),
      },
    },
    socialProviders: googleConfigured(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            prompt: "select_account",
          },
        }
      : {},
    // A Google account joins an account by email only when that email was
    // confirmed with a code (Better Auth's default; spelled out so it
    // stays). Signed in, someone binds any Google account they choose
    // (account settings), whatever its address.
    account: { accountLinking: { requireLocalEmailVerified: true, allowDifferentEmails: true } },
    // An account made by signing in with Google gets a username nobody has,
    // made from its Google name ("Fu Rong" becomes FuRong, or FuRong2...);
    // it can be changed in account settings. Guests have none.
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.isAnonymous || user.username) return undefined;
            const name = await freeUsername(env.DB, user);
            return { data: { username: usernameKey(name), displayUsername: name } };
          },
        },
      },
    },
    plugins: [
      anonymous({
        emailDomainName: "guest.invalid",
        generateName: () => GUEST_NAME,
        // adoptGuest removes the guest itself, after its games moved.
        disableDeleteAnonymousUser: true,
        onLinkAccount: ({ anonymousUser, newUser }) =>
          adoptGuest(env.DB, anonymousUser?.user?.id, newUser?.user?.id),
      }),
      // Codes by email: signing in without a password (existing accounts
      // only; registering needs a username) and checking an address added
      // to an account. worker/email.js caps what is sent.
      emailOTP({
        otpLength: 6,
        expiresIn: EMAIL_CODE_SECONDS,
        allowedAttempts: 5,
        storeOTP: "hashed",
        disableSignUp: true,
        changeEmail: { enabled: true },
        sendVerificationOTP: ({ email, otp, type }) => queueCodeEmail(env, { email, otp, type }),
      }),
      username({
        // worker/accounts.js checks names first (accountRules.js); these
        // limits only keep the plugin from refusing what that allows.
        minUsernameLength: 2,
        maxUsernameLength: 64,
        usernameValidator: (name) => cleanUsername(name) !== null,
        usernameNormalization: usernameKey,
      }),
    ],
    advanced: { cookiePrefix: "topology-go" },
    // The Workers Rate Limiting bindings guard these routes (wrangler.jsonc).
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
  };
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
    auth = betterAuth(authOptions(env, origin));
    byOrigin.set(origin, auth);
  }
  return auth;
}

/** The session and its user (a guest or an account), or null. Never throws. */
export async function currentSession(env, request) {
  const auth = authFor(env, request);
  if (!auth) return null;
  try {
    const result = await auth.api.getSession({ headers: request.headers });
    return result?.user ? result : null;
  } catch (error) {
    console.error("Session lookup failed", error);
    return null;
  }
}

/** The signed-in user (a guest or an account), or null. Never throws. */
export async function sessionUser(env, request) {
  return (await currentSession(env, request))?.user ?? null;
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
