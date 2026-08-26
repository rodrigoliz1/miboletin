"use client";

import { Trash, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readApiJson } from "@/lib/client/api-response";

export function CaseDeleteButton({ caseId, caseNumber }: { caseId: string; caseNumber: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setPending(true);
    setError(null);
    window.dispatchEvent(new CustomEvent("mi-boletin:case-removing", { detail: { caseId } }));
    try {
      const response = await fetch(`/api/cases/${caseId}`, { method: "DELETE", headers: { Accept: "application/json" } });
      const payload = await readApiJson<{ ok?: boolean }>(response, "No fue posible eliminar el asunto");
      if (!payload.ok) throw new Error("No fue posible eliminar el asunto");
      router.push("/cases?removed=1");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible eliminar el asunto");
      setPending(false);
    }
  };

  if (!confirming) return <button className="button button-danger" type="button" onClick={() => setConfirming(true)}><Trash size={15} /> Eliminar asunto</button>;
  return <div className="delete-case-confirm" role="alert">
    <div><strong>¿Eliminar {caseNumber}?</strong><small>Dejará de vigilarse y desaparecerá de tus carpetas. La evidencia histórica se conserva de forma segura.</small>{error && <span>{error}</span>}</div>
    <button className="button button-danger button-small" type="button" disabled={pending} onClick={() => void remove()}>{pending ? "Eliminando…" : "Sí, eliminar"}</button>
    <button className="icon-button" type="button" disabled={pending} onClick={() => setConfirming(false)} aria-label="Cancelar eliminación"><X size={16} /></button>
  </div>;
}
