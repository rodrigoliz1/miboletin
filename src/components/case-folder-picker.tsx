"use client";

import { Check, FolderOpen, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { resilientFetch } from "@/lib/client/resilient-fetch";

export type FolderPickerFolder = { id: string; name: string; caseCount: number };

export function FolderPickerDialog({
  open,
  onClose,
  caseId,
  caseNumber,
  folders,
  currentFolderIds,
  suggestedFolderId,
}: {
  open: boolean;
  onClose: () => void;
  caseId: string;
  caseNumber: string;
  folders: FolderPickerFolder[];
  currentFolderIds: string[];
  suggestedFolderId?: string;
}) {
  const firstControl = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>(() => [...new Set([...currentFolderIds, ...(suggestedFolderId ? [suggestedFolderId] : [])])]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => firstControl.current?.focus(), 20);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener("keydown", escape); };
  }, [onClose, open]);

  if (!open) return null;

  const save = async () => {
    if (!selected.length) { setError("El asunto debe permanecer al menos en una carpeta."); return; }
    setPending(true);
    setError(null);
    try {
      const response = await resilientFetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ folderIds: selected }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No fue posible guardar las carpetas");
      onClose();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar las carpetas");
    } finally {
      setPending(false);
    }
  };

  return <div className="folder-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
    <section className="folder-dialog" role="dialog" aria-modal="true" aria-labelledby={`folder-dialog-${caseId}`}>
      <header>
        <div><span className="result-kicker">ORGANIZACIÓN DEL ASUNTO</span><h2 id={`folder-dialog-${caseId}`}>¿En qué carpetas quieres mostrar {caseNumber}?</h2><p>Marca todas las carpetas donde debe aparecer. La vigilancia y su historial siguen siendo únicos.</p></div>
        <button className="icon-button" type="button" onClick={onClose} disabled={pending} aria-label="Cerrar"><X size={18} /></button>
      </header>
      <div className="folder-dialog-options">
        {folders.map((folder, index) => {
          const checked = selected.includes(folder.id);
          return <label key={folder.id} data-checked={checked}>
            <input ref={index === 0 ? firstControl : undefined} type="checkbox" checked={checked} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== folder.id) : [...current, folder.id])} />
            <span className="folder-check" aria-hidden="true">{checked && <Check size={14} weight="bold" />}</span>
            <span><strong>{folder.name}</strong><small>{folder.caseCount} {folder.caseCount === 1 ? "asunto" : "asuntos"}</small></span>
          </label>;
        })}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button className="button button-secondary" type="button" onClick={onClose} disabled={pending}>Cancelar</button><button className="button button-primary" type="button" onClick={() => void save()} disabled={pending || !selected.length}>{pending ? "Guardando…" : "Guardar carpetas"}</button></footer>
    </section>
  </div>;
}

export function CaseFolderButton({ caseId, caseNumber, folders, currentFolderIds }: { caseId: string; caseNumber: string; folders: FolderPickerFolder[]; currentFolderIds: string[] }) {
  const [open, setOpen] = useState(false);
  return <><button className="button button-secondary" type="button" onClick={() => setOpen(true)}><FolderOpen size={15} /> Gestionar carpetas</button>{open && <FolderPickerDialog open onClose={() => setOpen(false)} caseId={caseId} caseNumber={caseNumber} folders={folders} currentFolderIds={currentFolderIds} />}</>;
}
