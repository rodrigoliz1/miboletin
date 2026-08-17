import { getSession, type SessionPayload } from "@/lib/security/session";
import { getBillingSummary, type BillingSummary } from "@/lib/billing/repository";
import { isEmailVerified } from "@/lib/auth/email-verification";

export interface ProductAccess {
  session: SessionPayload;
  billing: BillingSummary;
}

export async function getProductAccess(): Promise<ProductAccess | null> {
  const session = await getSession();
  if (!session) return null;
  return { session, billing: await getBillingSummary(session.organizationId) };
}

export async function hasActiveProductAccess(organizationId: string, userId: string): Promise<boolean> {
  const [billing, verified] = await Promise.all([getBillingSummary(organizationId), isEmailVerified(userId)]);
  return billing.accessAllowed && verified;
}
