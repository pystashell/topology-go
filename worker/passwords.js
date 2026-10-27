/**
 * Account passwords: PBKDF2-SHA256 from Web Crypto, built into Workers (the
 * free plan allows about 10 ms of CPU per request, too little for scrypt),
 * over an HMAC of the password with a server-side pepper. The pepper is a
 * Worker secret (PASSWORD_PEPPER), so a copy of the database alone gives
 * nothing to guess passwords against offline. It must never change: every
 * stored password depends on it.
 *
 * Stored form: pbkdf2-sha256$<iterations>$<salt>$<key>, base64url. The
 * iteration count travels with each password, so a plan with more CPU can
 * raise it for new passwords without breaking the old ones.
 */

export const PASSWORD_ITERATIONS = 20_000;
const MAX_ITERATIONS = 1_000_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const SCHEME = "pbkdf2-sha256";
export const MIN_PEPPER_LENGTH = 32;

const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new TypeError("Not base64url");
  const binary = atob(text.replace(/-/gu, "+").replace(/_/gu, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requirePepper(pepper) {
  if (typeof pepper !== "string" || pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error("PASSWORD_PEPPER is not set");
  }
}

async function deriveKey(password, pepper, salt, iterations) {
  const hmac = await crypto.subtle.importKey(
    "raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  // The same password typed on another device may arrive composed
  // differently; NFC makes them one.
  const peppered = await crypto.subtle.sign("HMAC", hmac, encoder.encode(password.normalize("NFC")));
  const material = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, KEY_BYTES * 8);
  return new Uint8Array(bits);
}

export async function hashPassword(password, pepper, iterations = PASSWORD_ITERATIONS) {
  requirePepper(pepper);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(String(password), pepper, salt, iterations);
  return `${SCHEME}$${iterations}$${toBase64Url(salt)}$${toBase64Url(key)}`;
}

export async function verifyPassword(stored, password, pepper) {
  requirePepper(pepper);
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 4 || parts[0] !== SCHEME) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  let salt;
  let expected;
  try {
    salt = fromBase64Url(parts[2]);
    expected = fromBase64Url(parts[3]);
  } catch {
    return false;
  }
  if (expected.length !== KEY_BYTES) return false;
  const actual = await deriveKey(String(password), pepper, salt, iterations);
  let difference = 0;
  for (let index = 0; index < KEY_BYTES; index += 1) difference |= actual[index] ^ expected[index];
  return difference === 0;
}
