import Link from "next/link";
import { PartySearchWorkspace } from "@/components/party-search-workspace";

export const dynamic = "force-dynamic";

export default async function PartySearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams;
  return <div className="content party-search-page">
    <div className="page-heading"><div><p className="eyebrow">ÍNDICE JUDICIAL PROPIO</p><h1>Búsqueda por nombre</h1><p>Localiza personas físicas y morales en las publicaciones oficiales que Mi Boletín ha indexado, incluidas sus menciones históricas y relaciones procesales verificables.</p></div><Link className="button button-secondary" href="/search">Buscar por expediente</Link></div>
    <div className="source-assurance party-index-note"><span><strong>Consulta trazable.</strong> Cada resultado conserva el nombre publicado, el expediente, la fuente y el método de identificación. Las coincidencias aproximadas se distinguen de una parte identificada.</span></div>
    <PartySearchWorkspace initialQuery={params.q?.slice(0, 180) ?? ""} />
  </div>;
}
