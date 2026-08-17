import { after, NextResponse } from "next/server";
import { z } from "zod";
import { buildAssistantContext } from "@/lib/assistant/context";
import { addAssistantReply, addUserAssistantMessage, getAssistantConversation } from "@/lib/assistant/repository";
import { answerWithAi } from "@/lib/assistant/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { classifyAiError } from "@/lib/ai/service";
import { getSession } from "@/lib/security/session";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { executeAddCaseActions } from "@/lib/assistant/actions";
import { refreshMonitoredCase } from "@/lib/product/refresh";
import { tryMarkMonitoredCaseChecking } from "@/lib/product/repository";

export const maxDuration = 300;

const idSchema = z.string().uuid();
const bodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ ok: false, error: "Suscripción inactiva" }, { status: 402 });
  if (!sameOrigin(request)) return NextResponse.json({ ok: false, error: "Origen no permitido" }, { status: 403 });
  if (!isAiConfigured()) {
    return NextResponse.json({ ok: false, error: "El Asistente no está disponible temporalmente." }, { status: 503 });
  }

  const [parsedId, parsedBody] = await Promise.all([
    idSchema.safeParseAsync((await params).id),
    request.json().then((body) => bodySchema.safeParse(body)).catch(() => bodySchema.safeParse(null)),
  ]);
  if (!parsedId.success || !parsedBody.success) return NextResponse.json({ ok: false, error: "Mensaje no válido" }, { status: 400 });

  try {
    const existing = await getAssistantConversation(session.organizationId, session.userId, parsedId.data);
    if (!existing) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });
    const userMessage = await addUserAssistantMessage(
      session.organizationId,
      session.userId,
      parsedId.data,
      parsedBody.data.message,
    );
    if (!userMessage) return NextResponse.json({ ok: false, error: "Conversación no encontrada" }, { status: 404 });

    const context = await buildAssistantContext(session.organizationId, session.userId, parsedBody.data.message, existing.messages);
    const generated = await answerWithAi({
      organizationId: session.organizationId,
      userId: session.userId,
      conversationId: parsedId.data,
      question: parsedBody.data.message,
      history: existing.messages,
      context,
    });
    const { actions, ...answer } = generated;
    if (actions?.length) {
      const added = await executeAddCaseActions({ organizationId: session.organizationId, userId: session.userId, actions });
      const successes = added.filter((item) => item.ok);
      const failures = added.filter((item) => !item.ok);
      const lines = successes.map((item) => `- [**${item.caseNumber}** — ${item.courtName}](/cases/${item.id}) · carpeta **${item.folderName}**`);
      const failedLines = failures.map((item) => `- **${item.caseNumber}:** ${item.error}`);
      answer.content = [
        successes.length ? `Agregué ${successes.length} ${successes.length === 1 ? "expediente" : "expedientes"}. La consulta oficial continuará en segundo plano:` : "No pude agregar los expedientes solicitados.",
        ...lines,
        ...(failedLines.length ? ["No se agregaron:", ...failedLines] : []),
      ].join("\n");
      if (successes.length) after(async () => {
        let cursor = 0;
        const worker = async () => {
          while (cursor < successes.length) {
            const item = successes[cursor++];
            const acquired = await tryMarkMonitoredCaseChecking(session.organizationId, item.id, true);
            if (acquired) await refreshMonitoredCase(session.organizationId, item.id, true);
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, successes.length) }, () => worker()));
      });
    }
    const assistantMessage = await addAssistantReply({
      organizationId: session.organizationId,
      userId: session.userId,
      conversationId: parsedId.data,
      ...answer,
    });
    if (!assistantMessage) return NextResponse.json({ ok: false, error: "La conversación dejó de estar disponible" }, { status: 409 });
    const updated = await getAssistantConversation(session.organizationId, session.userId, parsedId.data);
    return NextResponse.json({ ok: true, userMessage, assistantMessage, conversation: updated?.conversation });
  } catch (error) {
    if (error instanceof Error && error.message === "ASSISTANT_RATE_LIMIT") {
      return NextResponse.json({ ok: false, error: "Demasiados mensajes seguidos. Espera un minuto e inténtalo de nuevo." }, { status: 429 });
    }
    console.error("Assistant response failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      errorType: classifyAiError(error).type,
    });
    return NextResponse.json({ ok: false, error: "No fue posible obtener una respuesta del Asistente. Tu conversación permanece guardada." }, { status: 502 });
  }
}
