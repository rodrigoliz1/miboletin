import { NextResponse } from "next/server";
import { getSession } from "@/lib/security/session";
import { createAssistantConversation, listAssistantConversations } from "@/lib/assistant/repository";
import { hasActiveProductAccess } from "@/lib/billing/access";

export const dynamic = "force-dynamic";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  try {
    const conversations = await listAssistantConversations(session.organizationId, session.userId);
    return NextResponse.json({ ok: true, conversations, configured: Boolean(process.env.OPENAI_API_KEY?.trim()) });
  } catch (error) {
    console.error("Assistant conversations could not be listed", error);
    return NextResponse.json({ ok: false, error: "No fue posible cargar las conversaciones." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  try {
    const conversation = await createAssistantConversation(session.organizationId, session.userId);
    return NextResponse.json({ ok: true, conversation }, { status: 201 });
  } catch (error) {
    console.error("Assistant conversation could not be created", error);
    return NextResponse.json({ ok: false, error: "No fue posible crear la conversación." }, { status: 500 });
  }
}
