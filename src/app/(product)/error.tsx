"use client";

import { useEffect } from "react";
import { WarningCircle } from "@phosphor-icons/react";

export default function ProductError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div className="content">
    <section className="panel product-error" role="alert">
      <WarningCircle size={27} weight="duotone" aria-hidden="true" />
      <div><h1>No pudimos cargar esta vista</h1><p>Los datos guardados no se modificaron. Intenta de nuevo; si continúa, revisa la conexión a la base y los registros del despliegue.</p></div>
      <button className="button button-primary" type="button" onClick={reset}>Reintentar</button>
    </section>
  </div>;
}
