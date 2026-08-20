import { NextResponse } from "next/server";
import { providers, type ProviderId } from "@/lib/providers";
import { runIngestion } from "@/lib/ingestion/pipeline";
import { getSession } from "@/lib/security/session";
import { isCronRequestAuthorized } from "@/lib/security/cron";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (!(provider in providers)) return NextResponse.json({ error: "Proveedor desconocido" }, { status: 404 });
  const cronAuthorized = isCronRequestAuthorized(request);
  const session = await getSession();
  const adminAuthorized = session?.role === "ADMIN" || session?.role === "OWNER";
  if (!cronAuthorized && !adminAuthorized) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { date?: string; courtExternalId?: string; circuitId?: string; caseNumber?: string; caseType?: string; sourceMode?: "AGREEMENT" | "LISTED" | "SESSION"; dryRun?: boolean };
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  const courtExternalId = body.courtExternalId ?? (provider === "jalisco" ? "C01" : undefined);
  const result = await runIngestion(providers[provider as ProviderId], { date, courtExternalId, circuitId: body.circuitId, caseNumber: body.caseNumber, caseType: body.caseType, sourceMode: body.sourceMode }, Boolean(body.dryRun));
  return NextResponse.json(result, { status: result.errors.length ? 207 : 200 });
}
