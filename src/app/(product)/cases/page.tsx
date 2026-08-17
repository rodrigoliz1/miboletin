import Link from "next/link";
import { CasesWorkspace } from "@/components/cases-workspace";
import { getSession } from "@/lib/security/session";
import { listFolders, listMonitoredCases } from "@/lib/product/repository";
import { optionalUuid } from "@/lib/product/query";

export const dynamic = "force-dynamic";

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ folder?: string; q?: string; jurisdiction?: string; error?: string; removed?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const folderId = optionalUuid(params.folder);
  const [folders, records] = await Promise.all([listFolders(session.organizationId), listMonitoredCases(session.organizationId, folderId ?? undefined)]);
  const q = (params.q ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const cases = records.filter((item) => (!params.jurisdiction || item.jurisdiction === params.jurisdiction) && (!q || `${item.number} ${item.courtName} ${item.label ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(q)));
  const selectedFolder = folders.find((folder) => folder.id === folderId);

  return <div className="content">
    <div className="page-heading"><div><h1>{selectedFolder?.name ?? "Expedientes vigilados"}</h1><p>{cases.length} {cases.length === 1 ? "asunto activo" : "asuntos activos"} con datos persistidos.</p></div><div className="heading-actions"><Link className="button button-primary" href="/cases/new">Agregar asunto</Link></div></div>
    {params.removed === "1" && <div className="notice success-notice" role="status"><strong>Asunto eliminado.</strong> Ya no se vigila ni aparece en tus carpetas.</div>}
    {params.error && <p className="form-error">No fue posible crear la carpeta. Revisa el nombre o la conexión.</p>}
    <CasesWorkspace folders={folders} cases={cases} selectedFolderId={folderId ?? undefined} query={params.q} jurisdiction={params.jurisdiction} />
  </div>;
}
