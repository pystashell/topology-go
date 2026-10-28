/**
 * Codes by email: signing in without a password, and checking an address
 * someone adds to their account. The owner pays for no email (2026-10-27),
 * so mail goes through Resend's free plan (3,000 a month, 100 a day) from
 * the owner's domain, and the site caps itself well below that: an address
 * gets a code at most once a minute and five times an hour, the whole site
 * DAILY_LIMIT a day. A cap reached only stops codes until it passes;
 * passwords, Google and guests keep working.
 *
 * Off until RESEND_API_KEY (a Worker secret) and EMAIL_FROM are set. Local
 * development sets EMAIL_DEV_OUTBOX=1 instead: nothing is sent, the mail
 * waits in memory for the browser checks (GET /api/dev/outbox).
 *
 * Better Auth makes the codes but swallows any error from sending them, so
 * the account routes check the caps before asking it for a code (a refused
 * request leaves the code someone already has untouched), collect the code
 * it makes (collectingCodes) and send it themselves.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const EMAIL_CODE_SECONDS = 10 * 60;
const ADDRESS_COOLDOWN_MS = 60 * 1_000;
const ADDRESS_HOURLY_LIMIT = 5;
const DEFAULT_DAILY_LIMIT = 80;
const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const KEEP_LOG_MS = 2 * DAY_MS;
const RESEND_URL = "https://api.resend.com/emails";
const MAX_OUTBOX = 50;

/** A code that was not sent: too soon, too many, or the mail service failed. */
export class EmailLimitError extends Error {
  constructor(code, retryAfterSeconds = null) {
    super(code);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function devOutboxOn(env) {
  return env?.EMAIL_DEV_OUTBOX === "1";
}

export function emailCodesConfigured(env) {
  if (!env?.DB) return false;
  if (devOutboxOn(env)) return true;
  return typeof env?.RESEND_API_KEY === "string" && env.RESEND_API_KEY.length > 0 &&
    typeof env?.EMAIL_FROM === "string" && env.EMAIL_FROM.length > 0;
}

function dailyLimit(env) {
  const value = Number(env?.EMAIL_DAILY_LIMIT);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_LIMIT;
}

// Local development only: the mail this isolate "sent", newest last.
const outbox = [];

/** The newest code sent to an address in local development, or null. */
export function devOutboxFor(env, address) {
  if (!devOutboxOn(env)) return null;
  for (let index = outbox.length - 1; index >= 0; index -= 1) {
    if (outbox[index].to === address) return outbox[index];
  }
  return null;
}

/** Refuse an email the caps do not allow (EmailLimitError); nothing is counted. */
export async function checkCodeAllowed(env, address, now = Date.now()) {
  if (!emailCodesConfigured(env)) throw new EmailLimitError("EMAIL_CODES_UNAVAILABLE");
  await checkLimits(env.DB, address, now, dailyLimit(env));
}

async function checkLimits(db, address, now, limit) {
  const dayStart = now - (now % DAY_MS);
  const counts = await db.prepare(
    `SELECT
       (SELECT MAX(sent_at) FROM email_send WHERE address = ?) AS last,
       (SELECT COUNT(*) FROM email_send WHERE address = ? AND sent_at > ?) AS hour,
       (SELECT COUNT(*) FROM email_send WHERE sent_at >= ?) AS today`,
  ).bind(address, address, now - HOUR_MS, dayStart).first();
  const last = Number(counts?.last) || 0;
  if (last && now - last < ADDRESS_COOLDOWN_MS) {
    throw new EmailLimitError("EMAIL_COOLDOWN", Math.ceil((last + ADDRESS_COOLDOWN_MS - now) / 1_000));
  }
  if (Number(counts?.hour) >= ADDRESS_HOURLY_LIMIT) {
    throw new EmailLimitError("EMAIL_ADDRESS_LIMIT", Math.ceil(HOUR_MS / 1_000));
  }
  if (Number(counts?.today) >= limit) {
    throw new EmailLimitError("EMAIL_DAILY_LIMIT", Math.ceil((dayStart + DAY_MS - now) / 1_000));
  }
}

/** Count this email against the caps, or refuse it. */
async function reserveSend(db, address, now, limit) {
  await checkLimits(db, address, now, limit);
  await db.batch([
    db.prepare("INSERT INTO email_send (address, sent_at) VALUES (?, ?)").bind(address, now),
    db.prepare("DELETE FROM email_send WHERE sent_at < ?").bind(now - KEEP_LOG_MS),
  ]);
}

/** The mail for a code, in Chinese and English. */
export function codeMessage(type, code) {
  const minutes = EMAIL_CODE_SECONDS / 60;
  const signIn = type === "sign-in";
  const subject = signIn
    ? `Topology Go 登录验证码：${code}`
    : `Topology Go 邮箱验证码：${code}`;
  const chinese = signIn
    ? `你的登录验证码是 ${code}，${minutes} 分钟内有效。如果不是你本人在登录，请忽略这封邮件。`
    : `你正在 Topology Go 验证这个邮箱，验证码是 ${code}，${minutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。`;
  const english = signIn
    ? `Your Topology Go sign-in code is ${code}. It is valid for ${minutes} minutes. If you did not ask for it, ignore this email.`
    : `Your code to confirm this address on Topology Go is ${code}. It is valid for ${minutes} minutes. If you did not ask for it, ignore this email.`;
  return {
    subject,
    text: `${chinese}\n\n${english}\n`,
    // The code is six digits; nothing here comes from the reader.
    html: `<p>${chinese}</p><p style="font-size:24px;letter-spacing:4px"><strong>${code}</strong></p><p>${english}</p>`,
  };
}

const pendingCodes = new AsyncLocalStorage();

/** Run fn (a Better Auth call): the codes it makes are collected, not sent. */
export async function collectingCodes(fn) {
  const codes = [];
  const result = await pendingCodes.run(codes, fn);
  return { result, codes };
}

/** Better Auth's email-OTP plugin hands each code it makes here. */
export async function queueCodeEmail(env, code) {
  const codes = pendingCodes.getStore();
  if (codes) {
    codes.push(code);
    return;
  }
  // Not through an account route (nothing else asks for codes).
  await sendCodeEmail(env, code);
}

/**
 * Send a code. Throws EmailLimitError when a cap is reached or the mail
 * service refuses.
 */
export async function sendCodeEmail(env, { email, otp, type }, now = Date.now()) {
  if (!emailCodesConfigured(env)) throw new EmailLimitError("EMAIL_CODES_UNAVAILABLE");
  await reserveSend(env.DB, email, now, dailyLimit(env));
  const mail = codeMessage(type, otp);
  if (devOutboxOn(env)) {
    outbox.push({ to: email, code: otp, type, subject: mail.subject, at: now });
    if (outbox.length > MAX_OUTBOX) outbox.splice(0, outbox.length - MAX_OUTBOX);
    console.log(`[dev outbox] ${type} code for ${email}: ${otp}`);
    return;
  }
  let response;
  try {
    response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], ...mail }),
    });
  } catch (error) {
    console.error("The mail service could not be reached", error);
    throw new EmailLimitError("EMAIL_SEND_FAILED");
  }
  if (response.ok) return;
  console.error("The mail service refused an email", response.status, await response.text().catch(() => ""));
  // Its own free-plan limits: the same as our daily cap, for the reader.
  throw new EmailLimitError(response.status === 429 ? "EMAIL_DAILY_LIMIT" : "EMAIL_SEND_FAILED");
}
