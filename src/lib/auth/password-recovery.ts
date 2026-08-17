import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { hash } from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { sendTransactionalEmail } from "@/lib/email/brevo";

const TTL_MINUTES = 10;
const RESEND_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const RESET_COOKIE = "mbj_password_reset";

function secret() {
  const value = process.env.PASSWORD_RESET_SECRET?.trim() || process.env.EMAIL_OTP_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) throw new Error("PASSWORD_RESET_SECRET_NOT_CONFIGURED");
  return value;
}

function digest(userId: string, code: string) {
  return createHmac("sha256", secret()).update(`password-reset:${userId}:${code}`).digest("hex");
}

function flowSignature(email: string) {
  return createHmac("sha256", secret()).update(`password-reset-flow:${email}`).digest("base64url");
}

export async function setPasswordResetFlow(email: string) {
  const normalized = email.trim().toLowerCase();
  const value = `${Buffer.from(normalized).toString("base64url")}.${flowSignature(normalized)}`;
  (await cookies()).set(RESET_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "1",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MINUTES * 60,
    priority: "high",
  });
}

export async function getPasswordResetFlow(): Promise<string | null> {
  const value = (await cookies()).get(RESET_COOKIE)?.value;
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  try {
    const email = Buffer.from(encoded, "base64url").toString("utf8");
    const expected = Buffer.from(flowSignature(email));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received) ? email : null;
  } catch {
    return null;
  }
}

export async function clearPasswordResetFlow() {
  (await cookies()).delete(RESET_COOKIE);
}

function code() {
  if (process.env.E2E_TEST_MODE === "1") return "654321";
  return String(randomInt(100_000, 1_000_000));
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const users = await db()`
    SELECT u.id, u.email, u.name, o.id AS organization_id, o.name AS organization_name,
           pr.last_sent_at, pr.send_count, pr.window_started_at
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.organization_id
    LEFT JOIN password_reset_codes pr ON pr.user_id = u.id
    WHERE u.email = ${normalizedEmail} AND u.deleted_at IS NULL
    ORDER BY m.created_at LIMIT 1
  `;
  const user = users[0];
  if (!user) {
    createHmac("sha256", secret()).update(`missing:${normalizedEmail}`).digest();
    return;
  }
  const now = Date.now();
  const lastSent = user.last_sent_at ? new Date(user.last_sent_at).valueOf() : 0;
  if (lastSent && now - lastSent < RESEND_SECONDS * 1000) throw new Error("RESET_COOLDOWN");
  const windowStart = user.window_started_at ? new Date(user.window_started_at).valueOf() : 0;
  const sameWindow = Boolean(windowStart && now - windowStart < 60 * 60 * 1000);
  const sendCount = sameWindow ? Number(user.send_count ?? 0) + 1 : 1;
  if (sendCount > MAX_SENDS_PER_HOUR) throw new Error("RESET_RATE_LIMIT");
  const verificationCode = code();
  const codeHash = digest(String(user.id), verificationCode);
  await db()`
    INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, send_count, window_started_at, last_sent_at, consumed_at, updated_at)
    VALUES (${user.id}, ${codeHash}, ${new Date(now + TTL_MINUTES * 60 * 1000)}, 0, ${sendCount}, ${sameWindow ? new Date(windowStart) : new Date(now)}, now(), NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
      attempts = 0, send_count = EXCLUDED.send_count, window_started_at = EXCLUDED.window_started_at,
      last_sent_at = now(), consumed_at = NULL, updated_at = now()
  `;
  if (process.env.E2E_TEST_MODE === "1" || (process.env.NODE_ENV !== "production" && !process.env.BREVO_API_KEY?.trim())) return;
  try {
    const sent = await sendTransactionalEmail({
      dedupeKey: `password-reset:${user.id}:${codeHash.slice(0, 16)}`,
      organizationId: String(user.organization_id),
      userId: String(user.id),
      recipient: String(user.email),
      recipientName: String(user.name),
      organizationName: String(user.organization_name),
      kind: "PASSWORD_RESET",
      verificationCode,
      verificationExpiresInMinutes: TTL_MINUTES,
    });
    if (sent !== "SENT") throw new Error("RESET_DELIVERY_NOT_CONFIGURED");
  } catch (error) {
    await db()`UPDATE password_reset_codes SET last_sent_at = now() - interval '61 seconds' WHERE user_id = ${user.id} AND code_hash = ${codeHash}`;
    throw error;
  }
}

export type PasswordResetResult = "RESET" | "INVALID" | "EXPIRED" | "LOCKED" | "NOT_FOUND";

export async function resetPassword(email: string, verificationCode: string, password: string): Promise<PasswordResetResult> {
  const candidateEmail = email.trim().toLowerCase();
  const passwordHash = await hash(password, 12);
  return db().begin(async (tx) => {
    const rows = await tx`
      SELECT u.id, pr.code_hash, pr.expires_at, pr.attempts, pr.consumed_at
      FROM users u LEFT JOIN password_reset_codes pr ON pr.user_id = u.id
      WHERE u.email = ${candidateEmail} AND u.deleted_at IS NULL
      FOR UPDATE OF u
    `;
    const row = rows[0];
    if (!row?.code_hash || row.consumed_at) return "NOT_FOUND";
    if (new Date(row.expires_at).valueOf() <= Date.now()) return "EXPIRED";
    if (Number(row.attempts) >= MAX_ATTEMPTS) return "LOCKED";
    const expected = Buffer.from(String(row.code_hash), "hex");
    const received = Buffer.from(digest(String(row.id), verificationCode), "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await tx`UPDATE password_reset_codes SET attempts = attempts + 1, updated_at = now() WHERE user_id = ${row.id}`;
      return Number(row.attempts) + 1 >= MAX_ATTEMPTS ? "LOCKED" : "INVALID";
    }
    await tx`UPDATE users SET password_hash = ${passwordHash}, session_version = session_version + 1 WHERE id = ${row.id}`;
    await tx`UPDATE password_reset_codes SET consumed_at = now(), updated_at = now() WHERE user_id = ${row.id}`;
    return "RESET";
  });
}
