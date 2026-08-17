import Link from "next/link";
import { getSession } from "@/lib/security/session";
import { listFolders } from "@/lib/product/repository";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { FederalProvider } from "@/lib/providers/federal/provider";
import type { CourtCatalogItem } from "@/lib/domain/types";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";
import { SearchableMultiSelect } from "@/components/searchable-multi-select";
import { signSelectionOption } from "@/lib/security/selection-token";

export const dynamic = "force-dynamic";

function courtOptions(courts: Array<CourtCatalogItem & { group?: string; courtType?: string }>, scope: string): SearchableSelectOption[] {
  const federalGroups: Record<string, string> = {
    COLLEGIATE: "Tribunales colegiados",
    APPEAL: "Tribunales de apelación",
    REGIONAL: "Plenos regionales",
    DISTRICT: "Juzgados de distrito y órganos de primera instancia",
    OTHER: "Otros órganos federales",
  };
  return courts.map((court) => ({
    value: court.externalId,
    label: court.name,
    group: court.jurisdiction === "FEDERAL" ? federalGroups[court.courtType ?? "OTHER"] : court.matter ?? "Otra materia",
    description: `${court.group ?? (court.jurisdiction === "FEDERAL" ? (court.courtType === "DISTRICT" ? "Acuerdos federales" : "Acuerdos y sesiones") : "Boletín judicial")} · Clave ${court.externalId}`,
    keywords: `${court.matter ?? ""} ${court.circuit ?? ""}`,
    token: signSelectionOption(scope, court.externalId, court.name),
  }));
}

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ error?: string; jurisdiction?: string; circuit?: string }> }) {
  const params = await searchParams;
  const session = await getSession();
  if (!session) return null;
  const jurisdiction = params.jurisdiction === "FEDERAL" ? "FEDERAL" : "JALISCO";
  const federal = new FederalProvider();
  const circuits = jurisdiction === "FEDERAL" ? await federal.getCircuits() : [];
  const selectedCircuit = params.circuit ?? "3";
  const [folders, jaliscoCourts, federalCourts] = await Promise.all([
    listFolders(session.organizationId),
    jurisdiction === "JALISCO" ? new JaliscoProvider().fetchCatalogs() : Promise.resolve([]),
    jurisdiction === "FEDERAL" ? federal.getCourts(selectedCircuit) : Promise.resolve([]),
  ]);
  return <div className="content">
    <div className="page-heading"><div><h1>Agregar asunto real</h1><p>El alta se guarda en PostgreSQL y queda vinculada al identificador oficial del órgano.</p></div></div>
    <div className="jurisdiction-tabs"><Link data-active={jurisdiction === "JALISCO"} href="/cases/new?jurisdiction=JALISCO">Jalisco</Link><Link data-active={jurisdiction === "FEDERAL"} href="/cases/new?jurisdiction=FEDERAL&circuit=3">Federal · Acuerdos y sesiones</Link></div>
    {jurisdiction === "FEDERAL" && <form className="panel catalog-picker" action="/cases/new"><input type="hidden" name="jurisdiction" value="FEDERAL" /><SearchableSelect name="circuit" label="Circuito" options={circuits.map((circuit) => ({ value: circuit.externalId, label: circuit.name, group: "Circuitos federales", description: `Circuito ${circuit.externalId}` }))} defaultValue={selectedCircuit} required searchPlaceholder="Buscar circuito por nombre o número…" /><button className="button button-secondary" type="submit">Cargar tribunales</button></form>}
    <div style={{ maxWidth: 860 }}>
      {params.error && <p className="form-error">{params.error === "source" ? "No fue posible validar el órgano o guardar el asunto. La fuente no se marcará como verificada." : "Revisa los campos del expediente."}</p>}
      <form className="panel case-create-form" action="/api/cases" method="post">
        <input type="hidden" name="jurisdiction" value={jurisdiction} />
        {jurisdiction === "FEDERAL" && <><input type="hidden" name="circuit" value={selectedCircuit} /><input type="hidden" name="circuitLabel" value={circuits.find((circuit) => circuit.externalId === selectedCircuit)?.name ?? `Circuito ${selectedCircuit}`} /></>}
        <SearchableSelect name="court" label="Órgano jurisdiccional" options={courtOptions(jurisdiction === "FEDERAL" ? federalCourts : jaliscoCourts, jurisdiction === "FEDERAL" ? `FEDERAL:${selectedCircuit}:court` : "JALISCO:court")} required searchPlaceholder="Buscar por nombre, materia, municipio o clave…" hint={jurisdiction === "FEDERAL" ? "Incluye juzgados de distrito, tribunales colegiados, tribunales de apelación y plenos regionales. Las sesiones se vigilan cuando el órgano las publica." : "Órganos divididos por materia y conectados al boletín oficial."} />
        <div className="form-grid"><div className="field"><label htmlFor="number">Número de expediente</label><input id="number" name="number" placeholder="461/2024" required /></div>{jurisdiction === "FEDERAL" ? <SearchableSelect name="caseType" label="Tipo de asunto" options={["Amparo Indirecto", "Amparo Directo", "Amparo en revisión", "Queja", "Reclamación", "Inconformidad", "Conflicto competencial", "Procesos Civiles o Administrativos"].map((type) => ({ value: type, label: type, group: "Tipos de asunto federal" }))} defaultValue="Amparo Directo" required searchPlaceholder="Buscar tipo de asunto…" /> : <div className="field"><label htmlFor="caseType">Tipo de asunto</label><input id="caseType" name="caseType" placeholder="Civil ordinario" required /></div>}</div>
        <SearchableMultiSelect name="folders" label="Carpetas" options={folders.map((folder) => ({ value: folder.id, label: folder.name, group: "Carpetas del despacho", description: `${folder.caseCount} ${folder.caseCount === 1 ? "asunto" : "asuntos"}` }))} defaultValues={folders[0] ? [folders[0].id] : []} required searchPlaceholder="Buscar carpeta…" hint="Puedes guardar el mismo asunto en varias carpetas sin duplicar su vigilancia." />
        <div className="field"><label htmlFor="label">Referencia interna opcional</label><input id="label" name="label" placeholder="Cliente o nombre interno del asunto" /></div>
        <div className="source-scope"><strong>{jurisdiction === "FEDERAL" ? "Histórico federal automático" : "Historial completo del boletín"}</strong><p>{jurisdiction === "FEDERAL" ? "No necesitas indicar fechas. Primero recuperamos los acuerdos oficiales del expediente y, si corresponde a un órgano de sesión, revisamos cuándo se listó, la fecha programada y el sentido publicado." : "No necesitas indicar fechas. Consultaremos por órgano y expediente y conservaremos todos los extractos que entregue el boletín oficial."}</p></div>
        <div className="form-actions"><Link className="button button-secondary" href="/cases">Cancelar</Link><button className="button button-primary" type="submit">Guardar y comenzar vigilancia</button></div>
      </form>
    </div>
  </div>;
}
