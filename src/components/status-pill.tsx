import type { SourceHealth } from "@/lib/domain/types";

const labels: Record<SourceHealth, string> = {
  ONLINE: "Operativo",
  DEGRADED: "Degradado",
  FAILED: "Falla",
  STALE: "Sin actualizar",
  UNAVAILABLE: "No automatizable",
};

export function StatusPill({ status }: { status: SourceHealth }) {
  return <span className={`status status-${status.toLowerCase()}`}>{labels[status]}</span>;
}
