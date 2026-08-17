"use client";

import { useEffect, useState } from "react";
import { ArrowsIn, ArrowsOut } from "@phosphor-icons/react";

export function ExpandablePanel({ className = "", header, label, children }: { className?: string; header: React.ReactNode; label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    document.body.classList.add("panel-expanded-open");
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("panel-expanded-open"); window.removeEventListener("keydown", onKey); };
  }, [expanded]);
  return <section className={`panel expandable-panel ${className}${expanded ? " is-expanded" : ""}`}><header className="panel-header">{header}<button className="expand-button" type="button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? `Cerrar vista ampliada de ${label}` : `Ampliar ${label}`} title={expanded ? "Cerrar vista ampliada" : "Ver en grande"}>{expanded ? <ArrowsIn size={18} /> : <ArrowsOut size={18} />}</button></header><div className="expandable-panel-body">{children}</div></section>;
}
