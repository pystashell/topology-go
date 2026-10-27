/**
 * Account routes: who am I (/api/account), register, sign in, sign out and
 * Google sign-in. Each checks its input (src/multiplayer/accountRules.js),
 * calls Better Auth on the server (worker/auth.js) and answers with the
 * site's own error codes and Chinese messages (src/i18n/serverErrors.js).
 * Pages never call Better Auth's routes themselves; only Google's return
 * address and the session lookup pass through (worker/index.js).
 *
 * A guest that registers or signs in brings its games along (adoptGuest).
 */
import {
  PASSWORD_MAX_LENGTH,
  cleanEmail,
  cleanUsername,
  isMadeUpEmail,
  passwordAllowed,
} from "../src/multiplayer/accountRules.js";
import {
  authFor,
  googleConfigured,
  passwordsConfigured,
  sessionUser,
  withCookies,
} from "./auth.js";
import { jsonResponse, readJsonBody } from "./http.js";

const FAILURES = {
  unavailable: [503, "AUTH_UNAVAILABLE", "账号服务暂时不可用。"],
  badUsername: [400, "BAD_USERNAME", "用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。"],
  badPassword: [400, "BAD_PASSWORD", "密码要 8 到 128 个字符。"],
  badEmail: [400, "BAD_EMAIL", "邮箱格式不正确；不想填可以空着。"],
  usernameTaken: [409, "USERNAME_TAKEN", "这个用户名已经有人用了，换一个吧。"],
  emailTaken: [409, "EMAIL_TAKEN", "这个邮箱已经注册过了，可以直接用它登录。"],
  wrongLogin: [401, "WRONG_LOGIN", "用户名（或邮箱）或密码不对。"],
  googleUnavailable: [404, "GOOGLE_UNAVAILABLE", "暂时不能用 Google 登录。"],
};

// Better Auth's error codes, as the site explains them.
const BETTER_AUTH_FAILURES = {
  USERNAME_IS_ALREADY_TAKEN: "usernameTaken",
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  INVALID_USERNAME_OR_PASSWORD: "wrongLogin",
  INVALID_EMAIL_OR_PASSWORD: "wrongLogin",
  USERNAME_TOO_SHORT: "badUsername",
  USERNAME_TOO_LONG: "badUsername",
  INVALID_USERNAME: "badUsername",
  INVALID_EMAIL: "badEmail",
  PASSWORD_TOO_SHORT: "badPassword",
  PASSWORD_TOO_LONG: "badPassword",
};

// Where Google sign-in returns: a path of this site (the page it started on).
const RETURN_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/u;

function failure(key) {
  const [status, code, error] = FAILURES[key];
  return jsonResponse({ error, code }, status);
}

function authFailure(error) {
  const key = BETTER_AUTH_FAILURES[error?.body?.code];
  if (key) return failure(key);
  console.error("Account request failed", error);
  return failure("unavailable");
}

function cookiesOf(headers) {
  return typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [];
}

/** What a page may know about the signed-in user; null without a session. */
export function accountSummary(user) {
  if (!user?.id) return null;
  if (user.isAnonymous) return { guest: true, name: null, email: null };
  return {
    guest: false,
    name: user.displayUsername || user.username || user.name || null,
    email: typeof user.email === "string" && !isMadeUpEmail(user.email) ? user.email : null,
  };
}

/** An address for an account registered without an email (never shown or used). */
function madeUpEmail() {
  return `${crypto.randomUUID().replaceAll("-", "")}@account.invalid`;
}

async function whoAmI(request, env) {
  return jsonResponse({
    account: accountSummary(await sessionUser(env, request)),
    signIn: { passwords: passwordsConfigured(env), google: googleConfigured(env) },
  });
}

async function register(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env)) return failure("unavailable");
  const body = await readJsonBody(request);
  const name = cleanUsername(body?.username);
  if (!name) return failure("badUsername");
  if (!passwordAllowed(body?.password)) return failure("badPassword");
  const email = cleanEmail(body?.email);
  if (email === null) return failure("badEmail");
  try {
    const { headers, response } = await auth.api.signUpEmail({
      headers: request.headers,
      returnHeaders: true,
      body: { name, username: name, displayUsername: name, email: email || madeUpEmail(), password: body.password },
    });
    return withCookies(jsonResponse({ account: accountSummary(response?.user) }, 201), cookiesOf(headers));
  } catch (error) {
    return authFailure(error);
  }
}

async function signIn(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env)) return failure("unavailable");
  const body = await readJsonBody(request);
  const login = typeof body?.login === "string" ? body.login.trim() : "";
  const password = body?.password;
  if (!login || typeof password !== "string" || !password || password.length > PASSWORD_MAX_LENGTH) {
    return failure("wrongLogin");
  }
  try {
    let result;
    if (login.includes("@")) {
      const email = cleanEmail(login);
      if (!email) return failure("wrongLogin");
      result = await auth.api.signInEmail({ headers: request.headers, returnHeaders: true, body: { email, password } });
    } else {
      const name = cleanUsername(login);
      if (!name) return failure("wrongLogin");
      result = await auth.api.signInUsername({
        headers: request.headers, returnHeaders: true, body: { username: name, password },
      });
    }
    return withCookies(jsonResponse({ account: accountSummary(result.response?.user) }), cookiesOf(result.headers));
  } catch (error) {
    return authFailure(error);
  }
}

/** Sign out: this browser has no user until it needs one again (a new guest). */
async function signOut(request, env) {
  const auth = authFor(env, request);
  if (!auth) return failure("unavailable");
  try {
    const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    return withCookies(jsonResponse({ ok: true }), cookiesOf(headers));
  } catch (error) {
    return authFailure(error);
  }
}

/** The Google page to send the browser to; it returns to the page it left. */
async function startGoogle(request, env) {
  const auth = authFor(env, request);
  if (!auth || !googleConfigured(env)) return failure("googleUnavailable");
  const body = await readJsonBody(request);
  const back = typeof body?.returnTo === "string" && RETURN_PATH.test(body.returnTo) ? body.returnTo : "/";
  try {
    const { headers, response } = await auth.api.signInSocial({
      headers: request.headers,
      returnHeaders: true,
      body: {
        provider: "google",
        callbackURL: `${back}?signed-in=google`,
        errorCallbackURL: `${back}?sign-in-failed=google`,
        disableRedirect: true,
      },
    });
    if (typeof response?.url !== "string") return failure("unavailable");
    return withCookies(jsonResponse({ url: response.url }), cookiesOf(headers));
  } catch (error) {
    return authFailure(error);
  }
}

const ROUTES = {
  "/api/account": { GET: whoAmI },
  "/api/account/register": { POST: register },
  "/api/account/sign-in": { POST: signIn },
  "/api/account/sign-out": { POST: signOut },
  "/api/account/google": { POST: startGoogle },
};

export const SIGN_IN_PATHS = new Set(["/api/account/register", "/api/account/sign-in"]);

export function isAccountPath(pathname) {
  return Object.hasOwn(ROUTES, pathname);
}

/** Answer an account route (isAccountPath); the caller checked origin and rate limits. */
export async function accountRoute(request, env, pathname) {
  const handler = ROUTES[pathname]?.[request.method];
  if (!handler) {
    return new Response(null, { status: 405, headers: { Allow: Object.keys(ROUTES[pathname]).join(", ") } });
  }
  return handler(request, env);
}
