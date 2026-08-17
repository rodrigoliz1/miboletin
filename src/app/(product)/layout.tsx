import { AppShell } from "@/components/app-shell";
import { SubscriptionGate } from "@/components/subscription-gate";
import { redirect } from "next/navigation";
import { getProductAccess } from "@/lib/billing/access";
import { isEmailVerified } from "@/lib/auth/email-verification";

export default async function ProductLayout({ children }: { children: React.ReactNode }) {
  const access = await getProductAccess();
  if (!access) redirect("/login");
  if (!(await isEmailVerified(access.session.userId))) redirect("/verify-email");
  return <AppShell session={access.session}>{children}{!access.billing.accessAllowed && <SubscriptionGate billing={access.billing} canManage={access.session.role === "OWNER" || access.session.role === "ADMIN"} />}</AppShell>;
}
