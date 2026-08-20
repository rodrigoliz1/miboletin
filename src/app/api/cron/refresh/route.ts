import { runAutomaticRefreshBatch } from "@/lib/product/refresh";
import { isCronRequestAuthorized } from "@/lib/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequestAuthorized(request)) return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
  try {
    const result = await runAutomaticRefreshBatch();
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Automatic judicial refresh failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ ok: false, error: "No fue posible completar la actualización automática" }, { status: 500 });
  }
}
