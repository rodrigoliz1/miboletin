"use client";

import { useMemo, useState } from "react";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";

type CoverageRow = {
  provider: string; courtExternalId: string; courtName: string; groupName?: string; matter?: string;
  coveredDays: number; completeDays: number; incompleteDays: number; publications: number; cases: number; names: number;
  firstDate?: string; lastDate?: string; lastProcessedAt?: string; lastError?: string;
};

export function IndexCoverageAdmin({ rows }: { rows: CoverageRow[] }) {
  const [query, setQuery] = useState("");
  const [court, setCourt] = useState("");
  const [action, setAction] = useState<"BACKFILL" | "RETRY_PERIOD" | "REINDEX_COURT">("BACKFILL");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const filtered = useMemo(() => {
    const needle = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    return rows.filter((row) => !needle || `${row.courtName} ${row.courtExternalId} ${row.groupName ?? ""} ${row.matter ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(needle));
  }, [query, rows]);

  async function schedule() {
    setState("saving");
    const response = await fetch("/api/admin/index", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, provider: "jalisco-cjj", courtExternalId: court || undefined, from, to }) });
    setState(response.ok ? "saved" : "error");
  }

  const jaliscoCourts = rows.filter((row) => row.provider === "jalisco-cjj");
  return <section className="panel index-coverage-admin">
    <header className="panel-header"><div><span className="result-kicker">COBERTURA DEL ÍNDICE JUDICIAL</span><h2>Órganos y periodos procesados</h2><p className="muted">Una unidad equivale a una fuente, órgano, fecha y tipo de publicación. Los días sin publicaciones también quedan registrados.</p></div></header>
    <div className="index-backfill-controls"><label>Acción<select value={action} onChange={(event) => setAction(event.target.value as typeof action)}><option value="BACKFILL">Continuar backfill</option><option value="RETRY_PERIOD">Reintentar periodo incompleto</option><option value="REINDEX_COURT">Reprocesar e indexar órgano</option></select></label><label>Órgano<select value={court} onChange={(event) => setCourt(event.target.value)}><option value="">Todos los órganos de Jalisco</option>{jaliscoCourts.map((item) => <option key={item.courtExternalId} value={item.courtExternalId}>{item.courtName}</option>)}</select></label><label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-secondary button-small" type="button" onClick={() => void schedule()} disabled={state === "saving"}>{state === "saving" ? "Programando…" : state === "saved" ? "Trabajo programado" : "Programar trabajo"}</button></div>
    {state === "error" && <p className="form-error">No fue posible programar el periodo.</p>}
    <div className="index-coverage-search"><MagnifyingGlass size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar órgano, materia o clave…" /><span>{filtered.length} órganos</span></div>
    <div className="index-coverage-table"><table><thead><tr><th>Órgano</th><th>Estado</th><th>Periodo comprobado</th><th>Publicaciones</th><th>Asuntos</th><th>Nombres</th></tr></thead><tbody>{filtered.map((row) => <tr key={`${row.provider}:${row.courtExternalId}`}><td><strong>{row.courtName}</strong><small>{row.groupName ?? row.provider} · {row.courtExternalId}</small></td><td><span className={`status ${row.incompleteDays ? "status-degraded" : row.completeDays ? "status-online" : "status-pending"}`}>{row.completeDays} completas · {row.incompleteDays} pendientes</span>{row.lastError && <small>{row.lastError}</small>}</td><td>{row.firstDate && row.lastDate ? `${row.firstDate} → ${row.lastDate}` : "Sin unidades procesadas"}<small>{row.coveredDays} días registrados</small></td><td>{row.publications}</td><td>{row.cases}</td><td>{row.names}</td></tr>)}</tbody></table></div>
    {!filtered.length && <div className="empty-state"><ArrowClockwise size={24} /><p>No hay órganos que coincidan con el filtro.</p></div>}
  </section>;
}
