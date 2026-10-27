/**
 * What a username, password and email look like, shared by the sign-in
 * dialog (to explain before sending) and the Worker (which decides).
 * Owner's decision (2026-10-26): a username of 2-20 characters in Chinese,
 * English or digits and a password are required, an email is optional.
 */

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

// Letters of any script, digits and the underscore (combining marks after
// the first character, for scripts that need them).
const USERNAME_PATTERN = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u;
// Names that would read as the site itself or as a guest.
const RESERVED_USERNAMES = new Set([
  "guest", "游客", "admin", "administrator", "管理员", "system", "系统", "topologygo",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;
// The site makes up addresses under .invalid for guests and for accounts
// registered without an email; nobody types one.
const MADE_UP_EMAIL = /\.invalid$/iu;

/** What makes two usernames the same one: "Mia", "mia" and "ｍｉａ" are. */
export function usernameKey(value) {
  return String(value).normalize("NFKC").toLowerCase();
}

/** The username as it will be shown, or null when it is not a valid one. */
export function cleanUsername(value) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  const length = [...name].length;
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) return null;
  if (!USERNAME_PATTERN.test(name) || RESERVED_USERNAMES.has(usernameKey(name))) return null;
  return name;
}

/** "" for no email, the address in lower case, or null when it is not one. */
export function cleanEmail(value) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return "";
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email) || MADE_UP_EMAIL.test(email)) {
    return null;
  }
  return email;
}

/** An address the site made up, which is never shown. */
export function isMadeUpEmail(email) {
  return typeof email === "string" && MADE_UP_EMAIL.test(email);
}

/** Whether a password can be used: long enough, not absurdly long. */
export function passwordAllowed(value) {
  return typeof value === "string" &&
    value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}
