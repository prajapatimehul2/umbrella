import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { query } from "./db";

// ── Password hashing (scrypt, built into Node — no native deps) ──────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const hashBuf = Buffer.from(hash, "hex");
  return hashBuf.length === derived.length && timingSafeEqual(hashBuf, derived);
}

// ── Session token (HMAC-signed, JWT-like, no jsonwebtoken dep) ────────────────
const COOKIE = "session";
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set. Add it to your .env file.");
  return s;
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: object): string {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token: string): { userId: number; exp: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof payload.userId !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(userId: number): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const token = sign({ userId, exp });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    // Only mark the cookie Secure when the app is actually served over HTTPS —
    // browsers drop Secure cookies on plain-HTTP connections, which silently
    // breaks login. Set COOKIE_SECURE=true once TLS is in front of the app.
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// Returns the signed-in user's id, or null. Use to guard API routes.
export async function getUserId(): Promise<number | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return verify(token)?.userId ?? null;
}

export async function getCurrentUser(): Promise<{ id: number; email: string } | null> {
  const id = await getUserId();
  if (!id) return null;
  const [user] = await query<{ id: number; email: string }>(
    "SELECT id, email FROM users WHERE id = $1",
    [id]
  );
  return user ?? null;
}
