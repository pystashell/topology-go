/**
 * Account routes: who am I (/api/account), register, sign in, sign out and
 * Google sign-in. Each checks its input (src/multiplayer/accountRules.js),
 * calls Better Auth on the server (worker/auth.js) and answers with the
 * site's own error codes and Chinese messages (src/i18n/serverErrors.js).
 * Pages never call Better Auth's routes themselves; only Google's return
 * address and the session lookup pass through (worker/index.js).
 *
 * A guest that registers or signs in brings its games along (adoptGuest).
 * Someone who forgot their password signs in with a code sent to their
 * email (worker/email.js) and sets a new one: within FRESH_SIGN_IN_MS of
 * signing in no current password is asked for.
 *
 * An email belongs to an account only once confirmed with a code (owner's
 * decision, 2026-10-28): registering takes a username and a password, the
 * email is added in account settings, and Google's addresses come
 * confirmed. Only confirmed emails sign in or receive sign-in codes.
 *
 * Someone may delete their own account (its username typed to confirm),
 * with the same guard as a new password: just signed in, or the current
 * password.
 */
import {
  PASSWORD_MAX_LENGTH,
  cleanEmail,
  cleanUsername,
  isMadeUpEmail,
  passwordAllowed,
  usernameKey,
} from "../src/multiplayer/accountRules.js";
import {
  authFor,
  currentSession,
  deleteAccount,
  giveUsername,
  googleConfigured,
  passwordsConfigured,
  withCookies,
} from "./auth.js";
import {
  EmailLimitError,
  checkCodeAllowed,
  collectingCodes,
  emailCodesConfigured,
  sendCodeEmail,
} from "./email.js";
import { jsonResponse, readJsonBody } from "./http.js";

// Just after signing in (a code from one's email, Google or the password),
// a new password needs no current one: how a forgotten password is replaced.
const FRESH_SIGN_IN_MS = 10 * 60 * 1_000;
// How soon a page may ask for another code (the same as worker/email.js).
const CODE_RESEND_SECONDS = 60;

const FAILURES = {
  unavailable: [503, "AUTH_UNAVAILABLE", "账号服务暂时不可用。"],
  badUsername: [400, "BAD_USERNAME", "用户名要 2 到 20 个字，只能用中文、英文字母、数字和下划线。"],
  badPassword: [400, "BAD_PASSWORD", "密码要 8 到 128 个字符。"],
  badEmail: [400, "BAD_EMAIL", "邮箱格式不正确；不想填可以空着。"],
  usernameTaken: [409, "USERNAME_TAKEN", "这个用户名已经有人用了，换一个吧。"],
  emailTaken: [409, "EMAIL_TAKEN", "这个邮箱已经注册过了，可以直接用它登录。"],
  wrongLogin: [401, "WRONG_LOGIN", "用户名（或邮箱）或密码不对。"],
  googleUnavailable: [404, "GOOGLE_UNAVAILABLE", "暂时不能用 Google 登录。"],
  codesUnavailable: [404, "EMAIL_CODES_UNAVAILABLE", "暂时不能用邮箱验证码。"],
  wrongCode: [400, "WRONG_CODE", "验证码不对，或者已经用过了。"],
  codeExpired: [400, "CODE_EXPIRED", "验证码已经过期，请重新获取。"],
  tooManyTries: [429, "TOO_MANY_TRIES", "验证码试错太多次，请重新获取。"],
  notSignedIn: [401, "NOT_SIGNED_IN", "请先登录账号。"],
  needCurrentPassword: [400, "NEED_CURRENT_PASSWORD", "请输入当前密码（刚登录的 10 分钟内可以不填）。"],
  wrongPassword: [401, "WRONG_PASSWORD", "当前密码不对。"],
  emailVerified: [409, "EMAIL_ALREADY_VERIFIED", "这个邮箱已经验证过了。"],
  googleNotLinked: [404, "GOOGLE_NOT_LINKED", "没有找到这个 Google 账号。"],
  lastSignInMethod: [409, "LAST_SIGN_IN_METHOD", "这是你现在唯一的登录方式。先设置密码或绑定邮箱，再解绑它。"],
  usernameMismatch: [400, "USERNAME_MISMATCH", "输入的用户名和这个账号的不一样。"],
  signInAgain: [403, "SIGN_IN_AGAIN", "为了安全，请先退出再重新登录，登录后 10 分钟内可以删除账号。"],
};

// Codes that were not sent, as worker/email.js names them.
const EMAIL_FAILURES = {
  EMAIL_COOLDOWN: [429, "请等一分钟再获取验证码。"],
  EMAIL_ADDRESS_LIMIT: [429, "这个邮箱这一小时收到的验证码太多了，请稍后再试。"],
  EMAIL_DAILY_LIMIT: [429, "今天的验证码已经发完了，请明天再试，或者用密码、Google 登录。"],
  EMAIL_SEND_FAILED: [503, "邮件暂时发不出去，请稍后再试。"],
  EMAIL_CODES_UNAVAILABLE: [404, "暂时不能用邮箱验证码。"],
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
  INVALID_OTP: "wrongCode",
  OTP_EXPIRED: "codeExpired",
  TOO_MANY_ATTEMPTS: "tooManyTries",
};

// Where Google sign-in returns: a path of this site (the page it started on).
const RETURN_PATH = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/u;

function failure(key) {
  const [status, code, error] = FAILURES[key];
  return jsonResponse({ error, code }, status);
}

function authFailure(error) {
  // A code not sent (thrown from inside Better Auth, possibly wrapped).
  const limited = [error, error?.cause].find((value) => value instanceof EmailLimitError);
  if (limited) {
    const [status, message] = EMAIL_FAILURES[limited.code] ?? EMAIL_FAILURES.EMAIL_SEND_FAILED;
    return jsonResponse(
      { error: message, code: limited.code, ...(limited.retryAfterSeconds ? { retryAfter: limited.retryAfterSeconds } : {}) },
      status,
      limited.retryAfterSeconds ? { "Retry-After": String(limited.retryAfterSeconds) } : {},
    );
  }
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

/**
 * The account dialog's details: whether the email is confirmed, whether
 * there is a password, and until when a new one needs no current one.
 */
async function accountDetails(auth, found) {
  const summary = accountSummary(found?.user);
  if (!summary || summary.guest) return summary;
  const context = await auth.$context;
  const accounts = await context.internalAdapter.findAccounts(found.user.id);
  return {
    ...summary,
    emailVerified: Boolean(summary.email && found.user.emailVerified),
    hasPassword: accounts.some((account) => account.providerId === "credential" && account.password),
    freshUntil: new Date(found.session.createdAt).getTime() + FRESH_SIGN_IN_MS,
    google: accounts.filter((account) => account.providerId === "google")
      .map((account) => ({ id: account.id, email: googleAddress(account) })),
  };
}

/** The Gmail address a bound Google account signed in with, from its ID token. */
function googleAddress(account) {
  try {
    const payload = JSON.parse(atob(account.idToken.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/")));
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * The stored user, with a username: an account made by signing in with
 * Google before 0.3.0-rc.18 had none and gets one now (giveUsername).
 */
async function withUsername(auth, env, user) {
  const context = await auth.$context;
  // The stored user, not the session's copy (cached for minutes).
  const stored = await context.internalAdapter.findUserById(user.id);
  if (!stored) return user;
  return stored.username ? stored : giveUsername(env.DB, stored);
}

async function whoAmI(request, env) {
  const auth = authFor(env, request);
  let found = auth ? await currentSession(env, request) : null;
  let account = accountSummary(found?.user);
  if (account && !account.guest) {
    try {
      if (!found.user.username) found = { ...found, user: await withUsername(auth, env, found.user) };
      account = await accountDetails(auth, found);
    } catch (error) {
      console.error("Reading account details failed", error);
    }
  }
  return jsonResponse({
    account,
    signIn: {
      passwords: passwordsConfigured(env),
      google: googleConfigured(env),
      emailCodes: passwordsConfigured(env) && emailCodesConfigured(env),
    },
  });
}

/** Whether this session began within FRESH_SIGN_IN_MS (no current password asked). */
function freshlySignedIn(found) {
  return Date.now() <= new Date(found.session.createdAt).getTime() + FRESH_SIGN_IN_MS;
}

/** The current password, when it is asked for: null when right, else the failure. */
async function currentPasswordFailure(context, credential, given) {
  const current = typeof given === "string" ? given : "";
  if (!current) return "needCurrentPassword";
  if (current.length > PASSWORD_MAX_LENGTH ||
      !(await context.password.verify({ hash: credential.password, password: current }))) {
    return "wrongPassword";
  }
  return null;
}

/** Signed in to an account (not a guest): { auth, found }, or a failure Response. */
async function signedInAccount(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env)) return failure("unavailable");
  const found = await currentSession(env, request);
  if (!found?.user || found.user.isAnonymous) return failure("notSignedIn");
  return { auth, found };
}

/**
 * A sign-in code for a registered email. The answer is the same whether
 * or not the address belongs to an account (nothing is sent if not).
 */
async function sendSignInCode(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env) || !emailCodesConfigured(env)) return failure("codesUnavailable");
  const body = await readJsonBody(request);
  const email = cleanEmail(body?.email);
  if (!email) return failure("badEmail");
  try {
    const context = await auth.$context;
    if ((await context.internalAdapter.findUserByEmail(email))?.user?.emailVerified) {
      await mailCodes(env, () =>
        auth.api.sendVerificationOTP({ headers: request.headers, body: { email, type: "sign-in" } }), email);
    }
    return jsonResponse({ ok: true, resendAfter: CODE_RESEND_SECONDS });
  } catch (error) {
    return authFailure(error);
  }
}

/**
 * Ask Better Auth for a code and mail it: the caps are checked first, so a
 * refused request leaves the code someone already has working.
 */
async function mailCodes(env, makeCode, address) {
  await checkCodeAllowed(env, address);
  const { codes } = await collectingCodes(makeCode);
  for (const code of codes) await sendCodeEmail(env, code);
}

async function signInWithCode(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env) || !emailCodesConfigured(env)) return failure("codesUnavailable");
  const body = await readJsonBody(request);
  const email = cleanEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/u.test(code)) return failure("wrongCode");
  try {
    const { headers, response } = await auth.api.signInEmailOTP({
      headers: request.headers, returnHeaders: true, body: { email, otp: code },
    });
    return withCookies(jsonResponse({ account: accountSummary(response?.user) }), cookiesOf(headers));
  } catch (error) {
    return authFailure(error);
  }
}

/**
 * Set a new password while signed in. Just after signing in none of the
 * current one is asked for (how a forgotten password is replaced: sign in
 * with a code first); later it is, so a session left open on a shared
 * computer cannot take the account. Every other sign-in is then ended.
 */
async function setNewPassword(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  if (!passwordAllowed(body?.password)) return failure("badPassword");
  try {
    const context = await auth.$context;
    const userId = found.user.id;
    const credential = await context.internalAdapter.findCredentialAccount(userId);
    if (credential?.password && !freshlySignedIn(found)) {
      const wrong = await currentPasswordFailure(context, credential, body?.currentPassword);
      if (wrong) return failure(wrong);
    }
    const hash = await context.password.hash(body.password);
    if (credential) {
      await context.internalAdapter.updatePassword(userId, hash);
    } else {
      await context.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
    }
    for (const other of await context.internalAdapter.listSessions(userId)) {
      if (other.token !== found.session.token) await context.internalAdapter.deleteSession(other.token);
    }
    return jsonResponse({ ok: true, account: await accountDetails(auth, found) });
  } catch (error) {
    return authFailure(error);
  }
}

/**
 * A code to confirm an email for the signed-in account: the one it has
 * (not yet confirmed), or a new one to add or change to.
 */
async function sendEmailCode(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  if (!emailCodesConfigured(env)) return failure("codesUnavailable");
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  const email = cleanEmail(body?.email);
  if (!email) return failure("badEmail");
  try {
    if (email === found.user.email) {
      if (found.user.emailVerified) return failure("emailVerified");
      await mailCodes(env, () =>
        auth.api.sendVerificationOTP({ headers: request.headers, body: { email, type: "email-verification" } }), email);
    } else {
      // Better Auth says nothing when the address is taken; the page should.
      const context = await auth.$context;
      if (await context.internalAdapter.findUserByEmail(email)) return failure("emailTaken");
      await mailCodes(env, () =>
        auth.api.requestEmailChangeEmailOTP({ headers: request.headers, body: { newEmail: email } }), email);
    }
    return jsonResponse({ ok: true, resendAfter: CODE_RESEND_SECONDS });
  } catch (error) {
    return authFailure(error);
  }
}

async function confirmEmail(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  if (!emailCodesConfigured(env)) return failure("codesUnavailable");
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  const email = cleanEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/u.test(code)) return failure("wrongCode");
  try {
    const { headers } = email === found.user.email
      ? await auth.api.verifyEmailOTP({ headers: request.headers, returnHeaders: true, body: { email, otp: code } })
      : await auth.api.changeEmailEmailOTP({ headers: request.headers, returnHeaders: true, body: { newEmail: email, otp: code } });
    const user = { ...found.user, email, emailVerified: true };
    return withCookies(
      jsonResponse({ ok: true, account: await accountDetails(auth, { ...found, user }) }),
      cookiesOf(headers),
    );
  } catch (error) {
    return authFailure(error);
  }
}

async function register(request, env) {
  const auth = authFor(env, request);
  if (!auth || !passwordsConfigured(env)) return failure("unavailable");
  const body = await readJsonBody(request);
  const name = cleanUsername(body?.username);
  if (!name) return failure("badUsername");
  if (!passwordAllowed(body?.password)) return failure("badPassword");
  try {
    // An email comes later, confirmed with a code (account settings).
    const { headers, response } = await auth.api.signUpEmail({
      headers: request.headers,
      returnHeaders: true,
      body: { name, username: name, displayUsername: name, email: madeUpEmail(), password: body.password },
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
      const context = await auth.$context;
      if (!(await context.internalAdapter.findUserByEmail(email))?.user?.emailVerified) {
        // An address nobody confirmed reads like a wrong password (and
        // takes as long).
        await context.password.hash(password);
        return failure("wrongLogin");
      }
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

/**
 * The Google page to send the browser to; it returns to the page it left
 * (saying so, and whether the account is new: the page names its username).
 */
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
        newUserCallbackURL: `${back}?signed-in=google-new`,
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

/** A new username (also the name shown): 2-20 characters, not taken. */
async function changeUsername(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  const name = cleanUsername(body?.username);
  if (!name) return failure("badUsername");
  try {
    const { headers } = await auth.api.updateUser({
      headers: request.headers,
      returnHeaders: true,
      body: { name, username: name, displayUsername: name },
    });
    const user = { ...found.user, name, username: usernameKey(name), displayUsername: name };
    return withCookies(
      jsonResponse({ ok: true, account: await accountDetails(auth, { ...found, user }) }),
      cookiesOf(headers),
    );
  } catch (error) {
    return authFailure(error);
  }
}

/** Bind a Google account (any address) to the signed-in account: Google's page. */
async function linkGoogle(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  if (!googleConfigured(env)) return failure("googleUnavailable");
  const { auth } = signedIn;
  try {
    const { headers, response } = await auth.api.linkSocialAccount({
      headers: request.headers,
      returnHeaders: true,
      body: {
        provider: "google",
        callbackURL: "/settings?google=linked",
        errorCallbackURL: "/settings?google=link-failed",
        disableRedirect: true,
      },
    });
    if (typeof response?.url !== "string") return failure("unavailable");
    return withCookies(jsonResponse({ url: response.url }), cookiesOf(headers));
  } catch (error) {
    return authFailure(error);
  }
}

/** Unbind a Google account; some way to sign in always stays. */
async function unlinkGoogle(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  try {
    const context = await auth.$context;
    const accounts = await context.internalAdapter.findAccounts(found.user.id);
    const target = accounts.find((account) => account.providerId === "google" && account.id === body?.id);
    if (!target) return failure("googleNotLinked");
    const others = accounts.filter((account) => account !== target);
    // The stored user, not the session's copy (cached for minutes).
    const user = await context.internalAdapter.findUserById(found.user.id);
    const stillSignsIn = others.some((account) => account.providerId === "google") ||
      others.some((account) => account.providerId === "credential" && account.password) ||
      (Boolean(user?.emailVerified) && !isMadeUpEmail(user?.email) && emailCodesConfigured(env));
    if (!stillSignsIn) return failure("lastSignInMethod");
    await context.internalAdapter.deleteAccount(target.id);
    return jsonResponse({ ok: true, account: await accountDetails(auth, found) });
  } catch (error) {
    return authFailure(error);
  }
}

/**
 * Whether `typed` is the account's name as the page shows it (case and
 * width aside): its username, or the name Google gave an account made by
 * signing in with Google, which has none until changed.
 */
function namesAccount(user, typed) {
  const shown = accountSummary(user)?.name;
  return typeof typed === "string" && Boolean(shown) && usernameKey(typed.trim()) === usernameKey(shown);
}

/**
 * Delete the signed-in account for good, its username typed to confirm.
 * Unless just signed in, the current password is asked for, or (an account
 * without one) signing in again: a session left open on a shared computer
 * cannot delete the account. This browser is signed out.
 */
async function deleteOwnAccount(request, env) {
  const signedIn = await signedInAccount(request, env);
  if (signedIn instanceof Response) return signedIn;
  const { auth, found } = signedIn;
  const body = await readJsonBody(request);
  try {
    const context = await auth.$context;
    // The stored user, not the session's copy (cached for minutes).
    const user = await context.internalAdapter.findUserById(found.user.id);
    if (!user || !namesAccount(user, body?.username)) return failure("usernameMismatch");
    if (!freshlySignedIn(found)) {
      const credential = await context.internalAdapter.findCredentialAccount(user.id);
      if (!credential?.password) return failure("signInAgain");
      const wrong = await currentPasswordFailure(context, credential, body?.currentPassword);
      if (wrong) return failure(wrong);
    }
    await deleteAccount(env.DB, user.id);
    // Its session is gone already; this clears the cookies.
    const { headers } = await auth.api.signOut({ headers: request.headers, returnHeaders: true });
    return withCookies(jsonResponse({ ok: true }), cookiesOf(headers));
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
  "/api/account/email-code": { POST: sendSignInCode },
  "/api/account/email-sign-in": { POST: signInWithCode },
  "/api/account/password": { POST: setNewPassword },
  "/api/account/email": { POST: sendEmailCode },
  "/api/account/email/confirm": { POST: confirmEmail },
  "/api/account/username": { POST: changeUsername },
  "/api/account/google/link": { POST: linkGoogle },
  "/api/account/google/unlink": { POST: unlinkGoogle },
  "/api/account/delete": { POST: deleteOwnAccount },
};

// Routes that guess at secrets (passwords, codes) or send mail: their own,
// tighter budget per address.
export const SIGN_IN_PATHS = new Set([
  "/api/account/register",
  "/api/account/sign-in",
  "/api/account/email-code",
  "/api/account/email-sign-in",
  "/api/account/password",
  "/api/account/email",
  "/api/account/email/confirm",
  "/api/account/delete",
]);

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
