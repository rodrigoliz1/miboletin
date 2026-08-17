"use client";

import Link from "next/link";
import { ArrowUpRight, ArrowsOutCardinal, FolderPlus, Folders } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { FolderRecord, MonitoredCaseRecord } from "@/lib/product/repository";
import { SearchableSelect } from "@/components/searchable-select";
import { FolderPickerDialog } from "@/components/case-folder-picker";

function formatDate(value?: string) {
  if (!value) return "Aún sin publicaciones";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

export function CasesWorkspace({
  folders,
  cases,
  selectedFolderId,
  query,
  jurisdiction,
}: {
  folders: FolderRecord[];
  cases: MonitoredCaseRecord[];
  selectedFolderId?: string;
  query?: string;
  jurisdiction?: string;
}) {
  const [editing, setEditing] = useState<MonitoredCaseRecord | null>(null);
  const [suggestedFolderId, setSuggestedFolderId] = useState<string>();
  const [draggingId, setDraggingId] = useState<string>();
  const handledDrop = useRef(false);

  const openFolders = (item: MonitoredCaseRecord, suggested?: string) => {
    setEditing(item);
    setSuggestedFolderId(suggested);
  };

  const dragged = cases.find((item) => item.id === draggingId);

  return <div className="folder-layout">
    <aside className="folder-sidebar panel" data-dragging={Boolean(draggingId)}>
      <header><h2>Carpetas</h2><span>{folders.length}</span></header>
      <Link data-active={!selectedFolderId} href="/cases">Todos los asuntos</Link>
      {folders.map((folder) => <Link
        key={folder.id}
        data-active={selectedFolderId === folder.id}
        data-drop-target={Boolean(draggingId)}
        href={`/cases?folder=${folder.id}`}
        onDragOver={(event) => { if (draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => {
          event.preventDefault();
          handledDrop.current = true;
          if (dragged) openFolders(dragged, folder.id);
          setDraggingId(undefined);
        }}
      ><span>{folder.name}</span><small>{folder.caseCount}</small></Link>)}
      <div className="folder-drop-helper" data-visible={Boolean(draggingId)}><Folders size={16} /><span>Suelta sobre una carpeta o aquí para elegir varias.</span></div>
      <form action="/api/folders" method="post"><label htmlFor="folderName">Nueva carpeta</label><div><input id="folderName" name="name" placeholder="Nombre de carpeta" required maxLength={80} /><button type="submit" aria-label="Crear carpeta"><FolderPlus size={17} /></button></div></form>
    </aside>
    <section
      onDragOver={(event) => { if (draggingId) event.preventDefault(); }}
      onDrop={(event) => {
        if (!dragged || (event.target as Element).closest("[data-drop-target]")) return;
        event.preventDefault();
        handledDrop.current = true;
        openFolders(dragged);
        setDraggingId(undefined);
      }}
    >
      <form className="filters" action="/cases"><input className="filter-control search-wide" name="q" defaultValue={query} aria-label="Buscar expedientes" placeholder="Buscar por número, referencia u órgano" />{selectedFolderId && <input type="hidden" name="folder" value={selectedFolderId} />}<SearchableSelect name="jurisdiction" label="Jurisdicción" options={[{ value: "", label: "Toda jurisdicción", group: "Cobertura" }, { value: "JALISCO", label: "Jalisco", group: "Cobertura", description: "Juzgados y Salas del STJ" }, { value: "FEDERAL", label: "Federal", group: "Cobertura", description: "Acuerdos y sesiones federales" }]} defaultValue={jurisdiction ?? ""} compact searchPlaceholder="Buscar jurisdicción…" /><button className="button button-secondary" type="submit">Filtrar</button></form>
      {!cases.length ? <div className="empty-product panel"><h2>Aún no hay asuntos en esta vista.</h2><p>Agrega un expediente real o cambia los filtros. No mostramos expedientes simulados.</p><Link className="button button-primary" href="/cases/new">Agregar primer asunto</Link></div> : <div className="table-wrap"><table className="data-table cases-table"><thead><tr><th><span className="sr-only">Mover</span></th><th>Expediente</th><th>Órgano jurisdiccional</th><th>Carpetas</th><th>Jurisdicción</th><th>Última publicación</th><th>Fuente</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{cases.map((item) => <tr
        key={item.id}
        draggable
        data-dragging={draggingId === item.id}
        onDragStart={(event) => { handledDrop.current = false; setDraggingId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); }}
        onDragEnd={() => { if (!handledDrop.current) openFolders(item); setDraggingId(undefined); }}
      ><td><button className="case-drag-handle" type="button" onClick={() => openFolders(item)} aria-label={`Gestionar carpetas de ${item.number}`} title="Arrastra o presiona para gestionar carpetas"><ArrowsOutCardinal size={15} /></button></td><td><Link href={`/cases/${item.id}`}><span className="case-number">{item.number}</span>{item.newCount > 0 && <span className="tag tag-new">{item.newCount} nuevo</span>}<small>{item.caseType}</small></Link></td><td className="court-cell">{item.courtName}{item.circuitName && <small>{item.circuitName}</small>}</td><td><button className="folder-membership-button" type="button" onClick={() => openFolders(item)}>{item.folderNames.join(" · ") || "Sin carpeta"}</button></td><td>{item.provider === "jalisco-stj-chambers" ? "STJ Jalisco" : item.jurisdiction === "FEDERAL" ? "Federal" : "Jalisco"}</td><td className="muted">{formatDate(item.lastPublicationDate)}</td><td><span className={`status ${item.sourceStatus === "VERIFIED" ? "status-online" : item.sourceStatus === "FAILED" ? "status-failed" : "status-degraded"}`}>{item.sourceStatus === "VERIFIED" ? "Verificada" : item.sourceStatus === "FAILED" ? "Falló" : item.sourceStatus === "CHECKING" ? "Revisando" : item.sourceStatus === "DEGRADED" ? "Con incidencias" : "Pendiente"}</span></td><td><Link href={`/cases/${item.id}`} aria-label={`Abrir expediente ${item.number}`}><ArrowUpRight size={16} /></Link></td></tr>)}</tbody></table></div>}
    </section>
    {editing && <FolderPickerDialog open onClose={() => { setEditing(null); setSuggestedFolderId(undefined); }} caseId={editing.id} caseNumber={editing.number} folders={folders} currentFolderIds={editing.folderIds} suggestedFolderId={suggestedFolderId} />}
  </div>;
}
