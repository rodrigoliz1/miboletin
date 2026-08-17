export type Jurisdiction = "JALISCO" | "FEDERAL";
export type SourceHealth = "ONLINE" | "DEGRADED" | "FAILED" | "STALE" | "UNAVAILABLE";
export type MatchResult = "EXACT" | "PROBABLE" | "AMBIGUOUS" | "NO_MATCH";
export type UserRole = "OWNER" | "ADMIN" | "LAWYER" | "ASSISTANT" | "MEMBER";

export interface CourtCatalogItem {
  externalId: string;
  name: string;
  jurisdiction: Jurisdiction;
  matter?: string;
  circuit?: string;
}

export interface RawPublication {
  externalId?: string;
  courtExternalId: string;
  courtName?: string;
  caseNumberRaw: string;
  caseType?: string;
  officialText: string;
  parties?: { plaintiff?: string; defendant?: string };
  publicationDate: string;
  agreementDate?: string;
  promotionDate?: string;
  sourceUrl: string;
  rawPayload: unknown;
}

export interface NormalizedPublication extends RawPublication {
  caseNumberNormalized: string;
  number: number;
  year: number;
  canonicalCaseKey: string;
  contentHash: string;
  snapshotHash: string;
  retrievedAt: string;
  parserVersion: string;
  providerVersion: string;
}

export interface ProviderHealth {
  provider: string;
  status: SourceHealth;
  checkedAt: string;
  latencyMs: number;
  recordsFetched: number;
  message: string;
  lastPublicationDate?: string;
  details?: Record<string, unknown>;
}

export interface PublicationQuery {
  date: string;
  courtExternalId?: string;
  caseNumber?: string;
  caseType?: string;
  circuitId?: string;
  sourceMode?: "AGREEMENT" | "LISTED" | "SESSION";
}

export interface JudicialSourceProvider {
  readonly id: string;
  readonly name: string;
  readonly providerVersion: string;
  readonly parserVersion: string;
  discover(): Promise<{ sourceUrl: string; capabilities: string[] }>;
  healthCheck(): Promise<ProviderHealth>;
  fetchCatalogs(): Promise<CourtCatalogItem[]>;
  fetchPublications(query: PublicationQuery): Promise<RawPublication[]>;
  fetchCase?(caseNumber: string, courtExternalId: string, caseType?: string, circuitId?: string): Promise<RawPublication[]>;
  fetchByDate(query: PublicationQuery): Promise<RawPublication[]>;
  normalize(record: RawPublication): Promise<NormalizedPublication>;
  validate(record: RawPublication): void;
}

export class ProviderError extends Error {
  constructor(
    public readonly code:
      | "SOURCE_UNAVAILABLE"
      | "SOURCE_ACCESS_RESTRICTED"
      | "SCHEMA_DRIFT"
      | "INVALID_RESPONSE"
      | "TIMEOUT",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
