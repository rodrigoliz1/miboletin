export type PartyType = "PERSON" | "COMPANY" | "AUTHORITY" | "UNKNOWN";

export type PartySide =
  | "plaintiff"
  | "defendant"
  | "quejoso"
  | "tercero_interesado"
  | "autoridad_responsable"
  | "recurrente"
  | "apelante"
  | "apelado"
  | "incidentista"
  | "promovente"
  | "imputado"
  | "victima"
  | "ofendido"
  | "ministerio_publico"
  | "unknown";

export interface PartyCandidate {
  nameRaw: string;
  nameNormalized: string;
  searchName: string;
  tokenSignature: string;
  canonicalName: string;
  partyType: PartyType;
  side: PartySide;
  roleRaw?: string;
  confidence: number;
  extractionMethod: string;
  sourceFragment?: string;
  metadata: Record<string, unknown>;
}

export interface PartyExtractionInput {
  provider: string;
  parties?: { plaintiff?: string; defendant?: string };
  rawPayload?: Record<string, unknown> | null;
  rawText?: string | null;
  officialText: string;
}
