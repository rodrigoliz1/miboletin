"use client";

import Link from "next/link";
import React from "react";
import { ArrowRight, Buildings, MagnifyingGlass, MapPin } from "@phosphor-icons/react";

export interface CourtExplorerItem {
  externalId: string;
  name: string;
  matter?: string;
  group: string;
  address?: string;
}

const matterOrder = ["Civil", "Mercantil", "Familiar", "Laboral", "Penal", "Justicia para adolescentes"];

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function CourtDirectoryExplorer({ courts }: { courts: CourtExplorerItem[] }) {
  const [query, setQuery] = React.useState("");
  const [matter, setMatter] = React.useState("Todas");
  const matters = [...new Set(courts.map((court) => court.matter ?? "Otra"))]
    .sort((a, b) => {
      const left = matterOrder.indexOf(a);
      const right = matterOrder.indexOf(b);
      return (left < 0 ? 99 : left) - (right < 0 ? 99 : right) || a.localeCompare(b, "es");
    });
  const needle = normalize(query.trim());
  const visible = courts.filter((court) => {
    if (matter !== "Todas" && (court.matter ?? "Otra") !== matter) return false;
    return !needle || normalize(`${court.name} ${court.group} ${court.matter ?? ""} ${court.externalId} ${court.address ?? ""}`).includes(needle);
  });
  const groups = matters
    .map((name) => ({ name, courts: visible.filter((court) => (court.matter ?? "Otra") === name) }))
    .filter((group) => group.courts.length);

  return <section className="court-explorer">
    <div className="court-explorer-tools">
      <label className="court-live-search">
        <MagnifyingGlass size={19} aria-hidden="true" />
        <span className="sr-only">Buscar órgano jurisdiccional</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busca por nombre, materia, municipio o clave…" />
        {query && <button type="button" onClick={() => setQuery("")}>Limpiar</button>}
      </label>
      <p><strong>{visible.length}</strong> {visible.length === 1 ? "órgano encontrado" : "órganos encontrados"}</p>
    </div>
    <div className="matter-tabs" role="group" aria-label="Filtrar por materia">
      {["Todas", ...matters].map((name) => {
        const count = name === "Todas" ? courts.length : courts.filter((court) => (court.matter ?? "Otra") === name).length;
        return <button key={name} type="button" data-active={matter === name} onClick={() => setMatter(name)}><span>{name}</span><small>{count}</small></button>;
      })}
    </div>
    {!groups.length && <div className="court-empty"><Buildings size={28} /><h2>No encontramos ese órgano</h2><p>Prueba con el número de juzgado, la materia o el municipio.</p></div>}
    <div className="matter-sections">
      {groups.map((group) => <section key={group.name} className="matter-section">
        <header><div><span>{String(group.courts.length).padStart(2, "0")}</span><h2>{group.name}</h2></div><p>Órganos con consulta activa en el boletín judicial.</p></header>
        <div className="court-card-grid">
          {group.courts.map((court) => <article key={court.externalId} className="court-card">
            <div className="court-card-top"><span className="court-code">{court.externalId}</span><small>{court.group}</small></div>
            <h3>{court.name}</h3>
            {court.address && <p><MapPin size={14} />{court.address}</p>}
            <Link href={`/search?scope=JALISCO&court=${encodeURIComponent(court.externalId)}`}>Consultar expediente <ArrowRight size={14} /></Link>
          </article>)}
        </div>
      </section>)}
    </div>
  </section>;
}
