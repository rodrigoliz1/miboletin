"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, CheckCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { readApiJson } from "@/lib/client/api-response";

export function BillingRecovery() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<"checking" | "idle" | "error">("checking");

  const reconcile = useCallback(async () => {
    setState("checking");
    try {
      const response = await fetch("/api/billing/reconcile", { method: "POST", headers: { Accept: "application/json" } });
      const result = await readApiJson<{ ok?: boolean; active?: boolean }>(response, "No fue posible comprobar el pago");
      if (result.ok && result.active) {
        router.replace("/dashboard?subscription=active");
        router.refresh();
        return;
      }
      setState("idle");
    } catch {
      setState("error");
    }
  }, [router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void reconcile();
  }, [reconcile]);

  if (state === "checking") return <p className="billing-recovery-status"><ArrowsClockwise size={14} className="spin" /> Comprobando si Stripe ya confirmó tu pago…</p>;
  return <button className="billing-recovery-button" type="button" onClick={() => void reconcile()}><CheckCircle size={15} /> {state === "error" ? "Volver a comprobar el pago" : "Ya pagué; comprobar ahora"}</button>;
}
