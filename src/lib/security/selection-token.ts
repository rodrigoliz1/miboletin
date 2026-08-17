import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const fallbackSecret = "development-only-secret-change-before-production";

function secret() {
  const value = process.env.AUTH_SECRET ?? fallbackSecret;
  if (process.env.NODE_ENV === "production" && value === fallbackSecret) throw new Error("AUTH_SECRET es obligatorio en producción");
  return value;
}

function signature(scope: string, value: string, label: string) {
  return createHmac("sha256", secret()).update(`${scope}\0${value}\0${label}`).digest("base64url");
}

export function signSelectionOption(scope: string, value: string, label: string) {
  return signature(scope, value, label);
}

export function verifySelectionOption(scope: string, value: string, label: string, token: string) {
  const expected = Buffer.from(signature(scope, value, label));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
