"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type RefreshPhase = "starting" | "checking" | "continuing" | "done" | "error";

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function SourceAutoRefresh({ caseId, force = false }: { caseId?: string; force?: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const lastMovementCount = useRef<number | null>(null);
  const [phase, setPhase] = useState<RefreshPhase>("starting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const controller = new AbortController();
    const stopForRemoval = (event: Event) => {
      const removing = event as CustomEvent<{ caseId?: string }>;
      if (!caseId || removing.detail?.caseId === caseId) controller.abort();
    };
    window.addEventListener("mi-boletin:case-removing", stopForRemoval);

    const run = async () => {
      const storageKey = `mi-boletin:last-refresh:${caseId ?? "organization"}`;
      const lastRequested = Number(window.sessionStorage.getItem(storageKey) ?? 0);
      const shouldRequest = force || !lastRequested || Date.now() - lastRequested > 60_000;

      if (shouldRequest) {
        window.sessionStorage.setItem(storageKey, String(Date.now()));
        const response = await fetch("/api/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ caseId, force }),
          signal: controller.signal,
        });
        const payload = await response.json() as { ok?: boolean; error?: string };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No fue posible actualizar las fuentes");
      }

      if (!caseId) {
        setPhase("done");
        return;
      }

      setPhase("checking");
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await wait(attempt === 0 ? 250 : 2_000, controller.signal);
        const response = await fetch(`/api/cases/${caseId}/status`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as { ok?: boolean; error?: string; sourceStatus?: string; movementCount?: number };
        if (!response.ok || !payload.ok) throw new Error(payload.error ?? "No fue posible conocer el avance de la revisión");
        if (typeof payload.movementCount === "number") {
          if ((lastMovementCount.current === null && payload.movementCount > 0) || (lastMovementCount.current !== null && payload.movementCount > lastMovementCount.current)) router.refresh();
          lastMovementCount.current = payload.movementCount;
        }
        if (payload.sourceStatus !== "CHECKING" && payload.sourceStatus !== "PENDING") {
          setPhase("done");
          router.refresh();
          return;
        }
        if (attempt === 44) setPhase("continuing");
      }
      setPhase("continuing");
    };

    void run().catch((reason: unknown) => {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "No fue posible actualizar las fuentes");
    });
    return () => { controller.abort(); window.removeEventListener("mi-boletin:case-removing", stopForRemoval); };
  }, [caseId, force, router]);

  if (phase === "done") return null;
  if (phase === "error") return <div className="notice danger-notice" style={{ marginBottom: 20 }}><strong>Actualización parcial.</strong> {error}. Los datos previos permanecen visibles.</div>;
  if (!caseId) return null;
  return <div className="source-refreshing" role="status">
    <span aria-hidden="true" />
    <div>
      <strong>{phase === "continuing" ? "La revisión histórica continúa en segundo plano" : "Expediente listo; verificando la fuente oficial"}</strong>
      <small>{phase === "continuing" ? "Puedes cerrar esta vista o seguir navegando. Los resultados aparecerán aquí en cuanto termine." : "El alta ya terminó. Puedes seguir usando el programa mientras vinculamos sus publicaciones."}</small>
    </div>
  </div>;
}
