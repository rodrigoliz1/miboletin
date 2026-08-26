"use client";

import { PencilSimple, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readApiJson } from "@/lib/client/api-response";
import { resilientFetch } from "@/lib/client/resilient-fetch";

export function CasePartiesEditor({
  caseId,
  plaintiff,
  defendant,
  manualPlaintiff,
  manualDefendant,
  officialPartiesAvailable,
}: {
  caseId: string;
  plaintiff?: string;
  defendant?: string;
  manualPlaintiff?: string;
  manualDefendant?: string;
  officialPartiesAvailable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (formData: FormData) => {
    setSaving(true);
    setError(undefined);
    try {
      const response = await resilientFetch(`/api/cases/${caseId}/parties`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plaintiff: String(formData.get("plaintiff") ?? ""),
          defendant: String(formData.get("defendant") ?? ""),
        }),
      });
      const payload = await readApiJson<{ ok?: boolean }>(response, "No fue posible guardar las partes");
      if (!payload.ok) throw new Error("No fue posible guardar las partes");
      setEditing(false);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible guardar las partes");
    } finally {
      setSaving(false);
    }
  };

  return <section className="panel case-parties-panel">
    <header className="panel-header">
      <div><h2>Partes del asunto</h2><small>{manualPlaintiff || manualDefendant ? "Captura privada para tu espacio de trabajo" : officialPartiesAvailable ? "Datos publicados por la fuente oficial" : "La fuente no publica estos nombres; puedes capturarlos aquí"}</small></div>
      <button className="button button-secondary button-small" type="button" onClick={() => { setEditing((value) => !value); setError(undefined); }}>
        {editing ? <><X size={14} /> Cerrar</> : <><PencilSimple size={14} /> {plaintiff || defendant ? "Editar partes" : "Agregar partes"}</>}
      </button>
    </header>
    <div className="party-grid case-party-grid"><div><span>Parte actora / quejosa</span><strong>{plaintiff ?? "No publicada por el órgano"}</strong></div><div><span>Parte demandada / tercero / autoridad</span><strong>{defendant ?? "No publicada por el órgano"}</strong></div></div>
    {editing && <form action={save} className="case-parties-form">
      <div className="form-grid"><div className="field"><label htmlFor="manual-plaintiff">Parte actora / quejosa</label><textarea id="manual-plaintiff" name="plaintiff" defaultValue={manualPlaintiff ?? ""} maxLength={500} rows={3} placeholder="Nombre o denominación" /></div><div className="field"><label htmlFor="manual-defendant">Parte demandada / tercero / autoridad</label><textarea id="manual-defendant" name="defendant" defaultValue={manualDefendant ?? ""} maxLength={500} rows={3} placeholder="Nombre o denominación" /></div></div>
      <p className="muted">Estos datos sólo se guardan en este asunto de tu organización y no modifican la fuente judicial.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar partes"}</button></div>
    </form>}
  </section>;
}
