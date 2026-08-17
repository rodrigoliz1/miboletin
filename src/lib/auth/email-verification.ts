import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { sendTransactionalEmail } from "@/lib/email/brevo";

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

function otpSecret() {
  const value = process.env.EMAIL_OTP_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (!value || (process.env.NODE_ENV === "production" && value.length < 32)) throw new Error("EMAIL_OTP_SECRET_NOT_CONFIGURED");
  return value;
}

function digest(userId: string, code: string) {
  return createHmac("sha256", otpSecret()).update(`${userId}:${code}`).digest("hex");
}

function generatedCode() {
  if (process.env.E2E_TEST_MODE === "1") return "123456";
  return String(randomInt(100_000, 1_000_000));
}

export async function isEmailVerified(userId: string): Promise<boolean> {
  const rows = await db()`SELECT email_verified_at IS NOT NULL AS verified FROM users WHERE id = ${userId} AND deleted_at IS NULL LIMIT 1`;
  return Boolean(rows[0]?.verified);
}

export async function requestEmailVerification(userId: string): Promise<void> {
  const code = generatedCode();
  const codeHash = digest(userId, code);
  const issued = await db().begin(async (tx) => {
    const rows = await tx`
      SELECT u.email, u.name, u.email_verified_at, ev.last_sent_at, ev.send_count, ev.window_started_at
      FROM users u
      LEFT JOIN email_verification_codes ev ON ev.user_id = u.id
      WHERE u.id = ${userId} AND u.deleted_at IS NULL
      FOR UPDATE OF u
    `;
    const row = rows[0];
    if (!row) throw new Error("OTP_USER_NOT_FOUND");
    if (row.email_verified_at) return null;
    const now = Date.now();
    const lastSentAt = row.last_sent_at ? new Date(row.last_sent_at).valueOf() : 0;
    if (lastSentAt && now - lastSentAt < OTP_RESEND_SECONDS * 1000) throw new Error("OTP_COOLDOWN");
    const windowStart = row.window_started_at ? new Date(row.window_started_at).valueOf() : 0;
    const sameWindow = windowStart && now - windowStart < 60 * 60 * 1000;
    const sendCount = sameWindow ? Number(row.send_count ?? 0) + 1 : 1;
    if (sendCount > OTP_MAX_SENDS_PER_HOUR) throw new Error("OTP_RATE_LIMIT");
    const [organization] = await tx`
      SELECT o.name FROM memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${userId} ORDER BY m.created_at LIMIT 1
    `;
    const expiresAt = new Date(now + OTP_TTL_MINUTES * 60 * 1000);
    await tx`
      INSERT INTO email_verification_codes (
        user_id, code_hash, expires_at, attempts, send_count, window_started_at,
        last_sent_at, consumed_at, updated_at
      ) VALUES (
        ${userId}, ${codeHash}, ${expiresAt}, 0, ${sendCount},
        ${sameWindow ? new Date(windowStart) : new Date(now)}, now(), NULL, now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0,
        send_count = EXCLUDED.send_count, window_started_at = EXCLUDED.window_started_at,
        last_sent_at = now(), consumed_at = NULL, updated_at = now()
    `;
    return { email: String(row.email), name: String(row.name), organizationName: String(organization?.name ?? "Mi organización"), expiresAt };
  });
  if (!issued) return;
  if (process.env.E2E_TEST_MODE === "1" || (process.env.NODE_ENV !== "production" && !process.env.BREVO_API_KEY?.trim())) return;
  try {
    const status = await sendTransactionalEmail({
      dedupeKey: `email-verification:${userId}:${codeHash.slice(0, 16)}`,
      organizationId: (await db()`SELECT organization_id FROM memberships WHERE user_id = ${userId} ORDER BY created_at LIMIT 1`)[0].organization_id,
      userId,
      recipient: issued.email,
      recipientName: issued.name,
      organizationName: issued.organizationName,
      kind: "EMAIL_VERIFICATION",
      verificationCode: code,
      verificationExpiresInMinutes: OTP_TTL_MINUTES,
    });
    if (status !== "SENT") throw new Error("OTP_DELIVERY_NOT_CONFIGURED");
  } catch (error) {
    await db()`UPDATE email_verification_codes SET last_sent_at = now() - interval '61 seconds' WHERE user_id = ${userId} AND code_hash = ${codeHash}`;
    throw error;
  }
}

export type VerifyEmailResult = "VERIFIED" | "INVALID" | "EXPIRED" | "LOCKED" | "NOT_FOUND" | "ALREADY_VERIFIED";

export async function verifyEmailCode(userId: string, code: string): Promise<VerifyEmailResult> {
  const candidate = digest(userId, code);
  return db().begin(async (tx) => {
    const rows = await tx`
      SELECT u.email_verified_at, ev.code_hash, ev.expires_at, ev.attempts, ev.consumed_at
      FROM users u
      LEFT JOIN email_verification_codes ev ON ev.user_id = u.id
      WHERE u.id = ${userId} AND u.deleted_at IS NULL
      FOR UPDATE OF u
    `;
    const row = rows[0];
    if (!row) return "NOT_FOUND";
    if (row.email_verified_at) return "ALREADY_VERIFIED";
    if (!row.code_hash || row.consumed_at) return "NOT_FOUND";
    if (new Date(row.expires_at).valueOf() <= Date.now()) return "EXPIRED";
    if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) return "LOCKED";
    const expected = Buffer.from(String(row.code_hash), "hex");
    const received = Buffer.from(candidate, "hex");
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await tx`UPDATE email_verification_codes SET attempts = attempts + 1, updated_at = now() WHERE user_id = ${userId}`;
      return Number(row.attempts) + 1 >= OTP_MAX_ATTEMPTS ? "LOCKED" : "INVALID";
    }
    await tx`UPDATE users SET email_verified_at = now() WHERE id = ${userId}`;
    await tx`UPDATE email_verification_codes SET consumed_at = now(), updated_at = now() WHERE user_id = ${userId}`;
    return "VERIFIED";
  });
}
