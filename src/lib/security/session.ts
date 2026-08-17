import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import type { UserRole } from "@/lib/domain/types";
import { db } from "@/lib/db/client";

const COOKIE_NAME = "mbj_session";
const fallbackSecret = "development-only-secret-change-before-production";

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  sessionVersion: number;
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET ?? fallbackSecret;
  if (process.env.NODE_ENV === "production" && (value === fallbackSecret || value.length < 32)) throw new Error("AUTH_SECRET es obligatorio y debe tener al menos 32 caracteres en producción");
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function secureCookie(): boolean {
  return process.env.NODE_ENV === "production" && process.env.E2E_TEST_MODE !== "1";
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new EncryptJWT({ ...payload })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setAudience("mi-boletin-judicial")
    .setIssuer("mi-boletin-judicial")
    .encrypt(secret());
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
    priority: "high",
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const result = await jwtDecrypt(token, secret(), {
      audience: "mi-boletin-judicial",
      issuer: "mi-boletin-judicial",
    });
    const payload = result.payload as unknown as SessionPayload;
    if (!Number.isInteger(payload.sessionVersion)) return null;
    const users = await db()`SELECT session_version FROM users WHERE id = ${payload.userId} AND deleted_at IS NULL LIMIT 1`;
    if (!users.length || Number(users[0].session_version) !== payload.sessionVersion) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function deleteSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

const roleWeight: Record<UserRole, number> = { OWNER: 5, ADMIN: 4, LAWYER: 3, ASSISTANT: 2, MEMBER: 1 };

export async function requireRole(minimum: UserRole): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || roleWeight[session.role] < roleWeight[minimum]) throw new Error("FORBIDDEN");
  return session;
}
