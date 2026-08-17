import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { hasActiveProductAccess } from "@/lib/billing/access";
import { getSession } from "@/lib/security/session";
import { retrieveJudicialDocument, type JudicialDocumentStorageProvider } from "@/lib/storage/judicial-documents";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sesión no válida" }, { status: 401 });
  if (!(await hasActiveProductAccess(session.organizationId, session.userId))) return NextResponse.json({ error: "Suscripción inactiva" }, { status: 402 });
  const parsed = z.string().uuid().safeParse((await context.params).id);
  if (!parsed.success) return NextResponse.json({ error: "Documento no válido" }, { status: 400 });
  const rows = await db()`
    SELECT jd.filename, jd.content_type, jd.byte_size, jd.sha256, jd.content, jd.storage_provider, jd.storage_key
    FROM judicial_documents jd
    WHERE jd.id = ${parsed.data}
      AND EXISTS (
        SELECT 1
        FROM monitored_cases mc
        WHERE mc.case_id = jd.judicial_case_id AND mc.organization_id = ${session.organizationId}
          AND mc.active AND mc.deleted_at IS NULL
      )
    LIMIT 1
  `;
  if (!rows.length) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  const row = rows[0];
  let stored;
  try {
    stored = await retrieveJudicialDocument({ provider: row.storage_provider as JudicialDocumentStorageProvider, key: row.storage_key, legacyContent: row.content });
  } catch {
    return NextResponse.json({ error: "El documento no está disponible en el almacenamiento privado" }, { status: 404 });
  }
  return new Response(stored.body, {
    headers: {
      "Content-Type": row.content_type,
      "Content-Length": String(stored.contentLength ?? row.byte_size),
      "Content-Disposition": `inline; filename="${String(row.filename).replace(/["\\\r\n]/g, "-")}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Document-SHA256": row.sha256,
    },
  });
}
