import { NextResponse } from "next/server";
import { createCustomerPortal } from "@/lib/billing/stripe";
import { getSession } from "@/lib/security/session";
import { isSameOrigin } from "@/lib/security/request";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url), 303);
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") return NextResponse.json({ error: "Acceso restringido" }, { status: 403 });
  try {
    return NextResponse.redirect(await createCustomerPortal(session.organizationId), 303);
  } catch (error) {
    console.error("Stripe portal could not be created", error);
    return NextResponse.redirect(new URL("/settings?billing=unavailable#billing", request.url), 303);
  }
}

