import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowSquareOut, Fingerprint, LinkSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { z } from "zod";
import { SearchResultAdd } from "@/components/search-result-add";
import { getIndexedCaseDetail } from "@/lib/parties/search";
import { listFolders } from "@/lib/product/repository";
import { encodeSearchResult } from "@/lib/product/search-payload";
import { getSession } from "@/lib/security/session";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

function date(value?: string) {
  return value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "No publicada";
}

const roleLabels: Record<string, string> = { plaintiff: "Actor", defendant: "Demandado", quejoso: "Quejoso", tercero_interesado: "Tercero interesado", autoridad_responsable: "Autoridad responsable", recurrente: "Recurrente", promovente: "Promovente" };

export default async function IndexedCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const parsed = idSchema.safeParse((await params).caseId);
  if (!parsed.success) notFound();
  const session = await getSession();
  if (!session) return null;
  const [detail, folders] = await Promise.all([getIndexedCaseDetail(session.organizationId, parsed.data), listFolders(session.organizationId)]);
  if (!detail) notFound();
  const signed = encodeSearchResult({
    jurisdiction: detail.jurisdiction, provider: detail.provider as "jalisco-cjj" | "jalisco-stj-chambers" | "federal-pjf-session-lists",
    courtExternalId: detail.courtExternalId, courtName: detail.courtName, courtType: detail.courtType,
    circuitId: detail.circuitId, circuitName: detail.circuitName, caseNumber: detail.number, caseType: detail.caseType,
  }, session.organizationId);
  const federal = detail.jurisdiction === "FEDERAL";
  return <div className="content indexed-case-page">
    <div className="page-heading"><div><p><Link href="/search/names"><ArrowLeft size={13} /> Volver a resultados</Link></p><h1>{detail.number}</h1><p>{detail.courtName}</p></div>{detail.monitoredCaseId ? <Link className="button button-secondary" href={`/cases/${detail.monitoredCaseId}`}>Abrir seguimiento</Link> : <SearchResultAdd {...signed} folders={folders} />}</div>
    <section className="case-header indexed-case-header"><div><span className="result-kicker">{detail.jurisdiction === "JALISCO" ? "PODER JUDICIAL DE JALISCO" : "PODER JUDICIAL DE LA FEDERACIÓN"}</span><h2>{detail.caseType}</h2><div className="case-meta"><span>{detail.number}</span><span>{detail.publications.length} resoluciones indexadas</span>{detail.circuitName && <span>{detail.circuitName}</span>}</div></div><ShieldCheck size={30} weight="duotone" /></section>

    <div className="indexed-case-grid">
      <main>
        <section className="panel"><header className="panel-header"><div><span className="result-kicker">IDENTIDADES PROCESALES</span><h2>Partes identificadas</h2></div><span>{detail.parties.length}</span></header>{detail.parties.length ? <div className="indexed-party-list">{detail.parties.map((party) => <article key={party.id}><div><strong>{party.nameRaw}</strong><span>{roleLabels[party.side] ?? party.side} · {party.partyType === "COMPANY" ? "Persona moral" : party.partyType === "PERSON" ? "Persona física" : party.partyType === "AUTHORITY" ? "Autoridad" : "Tipo no determinado"}</span></div>{party.confidence !== undefined && <small>{Math.round(party.confidence * 100)}% confianza de extracción</small>}</article>)}</div> : <div className="empty-panel"><p>La fuente indexada no publicó nombres identificables para este expediente.</p></div>}</section>
        <section className="panel"><header className="panel-header"><div><span className="result-kicker">HISTORIAL OFICIAL</span><h2>Resoluciones publicadas</h2></div><span>{detail.publications.length}</span></header><div className="indexed-publication-list">{detail.publications.map((publication) => <article key={publication.id}><div><time>Publicada {date(publication.publicationDate)}</time>{publication.agreementDate && <small>Fecha del acuerdo: {date(publication.agreementDate)}</small>}</div><p>{publication.officialText}</p>{federal && <a href={publication.sourceUrl} target="_blank" rel="noreferrer">Abrir síntesis oficial <ArrowSquareOut size={12} /></a>}</article>)}</div></section>
      </main>
      <aside>
        <section className="panel"><header className="panel-header"><h2>Trazabilidad</h2></header><div className="indexed-evidence-list">{detail.mentions.slice(0, 20).map((mention) => <article key={mention.id}><Fingerprint size={15} /><div><strong>{mention.nameRaw}</strong><span>{roleLabels[mention.side] ?? mention.side} · {mention.method.replaceAll("_", " ")}</span><small>{Math.round(mention.confidence * 100)}% · {date(mention.publicationDate)}</small></div></article>)}</div></section>
        {detail.relations.length > 0 && <section className="panel"><header className="panel-header"><h2>Asuntos relacionados</h2></header><div className="indexed-relation-list">{detail.relations.map((relation) => <Link href={`/search/names/${relation.caseId}`} key={relation.id}><LinkSimple size={15} /><span><strong>{relation.number} · {relation.caseType}</strong><small>{relation.direction === "ORIGIN" ? "Expediente de origen" : "Asunto derivado"} · {relation.courtName}</small></span></Link>)}</div></section>}
        <div className="notice">Los nombres se reproducen como fueron publicados. Una coincidencia aproximada orienta la consulta, pero no afirma por sí sola identidad jurídica.</div>
      </aside>
    </div>
  </div>;
}
