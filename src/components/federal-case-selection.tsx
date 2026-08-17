"use client";

import { useMemo, useState } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/searchable-select";

export type FederalCourtType = "COLLEGIATE" | "DISTRICT" | "APPEAL" | "REGIONAL" | "LABOR" | "OTHER";

const types: Record<FederalCourtType, string[]> = {
  COLLEGIATE: [
    "Amparo contra leyes", "Amparo Directo", "Amparo en revisión", "Conflictos Competenciales", "Conflictos de Acumulación", "Impedimento", "Incidentes de Inejecución", "Inconformidades", "Queja", "Reclamaciones", "Reconocimiento de Inocencia", "Repetición del Acto Reclamado", "Revisión Contenciosa Administrativa", "Revisión Fiscal",
  ],
  DISTRICT: [
    "Amparo Indirecto", "Causa Penal", "Concursos Mercantiles", "Denuncia por Incumplimiento de la Declaratoria General de Inconstitucionalidad", "Ejecución de Penas", "Extinción de Dominio", "Juicio Oral Mercantil", "Medidas Precautorias", "Procedimientos de Extradición", "Procesos Civiles o Administrativos",
  ],
  APPEAL: [
    "Amp Ind, Proc Fed Penales en 2a Instancia y Proc Fed Adm y Civ en 2a Instancia", "Amparo indirecto", "Comunicaciones Oficiales Recibidas de las Áreas Administrativas", "Procedimientos federales administrativos y civiles en segunda instancia", "Procedimientos federales penales en segunda instancia", "Reconocimiento de Inocencia y Anulación de Sentencia",
  ],
  REGIONAL: ["Conflictos Competenciales", "Contradicción de Criterios", "Solicitud de Declaratoria General de Inconstitucionalidad"],
  LABOR: [
    "Conflictos Colectivos de Naturaleza Económica", "Conflictos Individuales de Seguridad Social", "Procedimiento de Ejecución", "Procedimiento de Huelga", "Procedimiento especial colectivo", "Procedimiento especial individual", "Busca", "Procedimiento ordinario", "Procedimientos Paraprocesales o Voluntarios",
  ],
  OTHER: ["Amparo Indirecto", "Amparo Directo", "Amparo en revisión", "Queja", "Conflictos Competenciales", "Procesos Civiles o Administrativos"],
};

const groupNames: Record<FederalCourtType, string> = {
  COLLEGIATE: "Asuntos de tribunal colegiado", DISTRICT: "Asuntos de juzgado de distrito", APPEAL: "Asuntos de tribunal colegiado de apelación", REGIONAL: "Asuntos de pleno regional", LABOR: "Asuntos de tribunal laboral federal", OTHER: "Asuntos federales",
};

export function FederalCaseSelection({ courts, initialCourt, initialType }: { courts: Array<SearchableSelectOption & { courtType: FederalCourtType }>; initialCourt?: string; initialType?: string }) {
  const [courtId, setCourtId] = useState(initialCourt && courts.some((court) => court.value === initialCourt) ? initialCourt : courts[0]?.value ?? "");
  const courtType = courts.find((court) => court.value === courtId)?.courtType ?? "OTHER";
  const caseTypes = useMemo(() => types[courtType].map((type) => ({ value: type, label: type, group: groupNames[courtType] })), [courtType]);
  return <>
    <SearchableSelect name="court" label="Órgano jurisdiccional" options={courts} defaultValue={courtId} required searchPlaceholder="Buscar por nombre, materia, ciudad o clave…" hint="El tipo de asunto se ajustará automáticamente al órgano seleccionado." onValueChange={setCourtId} />
    <SearchableSelect key={courtType} name="caseType" label="Tipo de asunto" options={caseTypes} defaultValue={initialType && caseTypes.some((type) => type.value === initialType) ? initialType : caseTypes[0]?.value} required searchPlaceholder="Buscar tipo de asunto…" />
  </>;
}
