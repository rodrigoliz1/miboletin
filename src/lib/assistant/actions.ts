import "server-only";
import { createMonitoredCase, listFolders } from "@/lib/product/repository";
import { JaliscoProvider, type JaliscoCourtCatalogItem } from "@/lib/providers/jalisco/provider";
import { FederalProvider, supportsFederalCaseType, type FederalCircuit, type FederalCourt } from "@/lib/providers/federal/provider";
import { bestNamed, inferAssistantJurisdiction } from "@/lib/assistant/named-match";
import { StjJaliscoProvider } from "@/lib/providers/stj/provider";
import {
  JudicialOrganResolver,
  inferJudicialCourtSource,
  sourceVerifiedResolution,
  type CanonicalJudicialCourt,
  type CourtResolutionMethod,
  type JudicialCourtResolution,
  type JudicialCourtResolutionInput,
  type JudicialCourtSource,
} from "@/lib/judicial/court-resolver";

export interface AddCaseAction {
  folder_name: string;
  case_number: string;
  court_name: string;
  jurisdiction: "JALISCO" | "FEDERAL" | null;
  circuit: string | null;
  case_type: string | null;
  matter?: string | null;
  state?: string | null;
  organ_type?: string | null;
  source_hint?: JudicialCourtSource | null;
}

interface ResolvedCourt {
  court: CanonicalJudicialCourt;
  resolution: JudicialCourtResolution;
}

class CourtResolutionError extends Error {
  constructor(public readonly code: "AMBIGUOUS" | "NOT_FOUND" | "SOURCE_UNAVAILABLE", message: string) {
    super(message);
    this.name = "CourtResolutionError";
  }
}

function resolutionInput(action: AddCaseAction, sourceHint?: JudicialCourtSource): JudicialCourtResolutionInput {
  return {
    rawQuery: action.court_name,
    caseNumber: action.case_number,
    caseType: action.case_type,
    jurisdictionHint: action.jurisdiction,
    sourceHint: sourceHint ?? action.source_hint,
    stateHint: action.state,
    matterHint: action.matter ?? action.case_type,
    organTypeHint: action.organ_type,
  };
}

function resolutionError(result: JudicialCourtResolution, scope: string): CourtResolutionError {
  if (result.status === "SOURCE_UNAVAILABLE") {
    return new CourtResolutionError("SOURCE_UNAVAILABLE", `No pude verificar el órgano ${scope} porque la fuente oficial no respondió. Inténtalo nuevamente.`);
  }
  if (result.status === "AMBIGUOUS") {
    const alternatives = result.alternatives.slice(0, 4).map((candidate) => `“${candidate.court.name}”`).join(", ");
    return new CourtResolutionError("AMBIGUOUS", `Encontré varios órganos ${scope} que podrían corresponder. Indica cuál es: ${alternatives}.`);
  }
  return new CourtResolutionError("NOT_FOUND", `No localicé un órgano ${scope} razonable en el catálogo oficial con la descripción proporcionada.`);
}

function localCourt(item: JaliscoCourtCatalogItem): CanonicalJudicialCourt {
  return {
    externalId: item.externalId,
    name: item.name,
    jurisdiction: "JALISCO",
    source: "JALISCO_CJJ",
    matter: item.matter,
    group: item.group,
  };
}

function stjCourt(item: Awaited<ReturnType<StjJaliscoProvider["fetchCatalogs"]>>[number]): CanonicalJudicialCourt {
  return {
    externalId: item.externalId,
    name: item.name,
    jurisdiction: "JALISCO",
    source: "STJ_JALISCO",
    matter: item.matter,
    courtType: "STJ_CHAMBER",
  };
}

function federalCourt(item: FederalCourt, circuit: FederalCircuit): CanonicalJudicialCourt {
  return {
    externalId: item.externalId,
    name: item.name,
    jurisdiction: "FEDERAL",
    source: "FEDERAL_PJF",
    matter: item.matter,
    courtType: item.courtType,
    circuit: circuit.externalId,
    circuitName: circuit.name,
  };
}

async function verifyUniqueCandidate(
  resolution: JudicialCourtResolution,
  checker: (court: CanonicalJudicialCourt) => Promise<boolean>,
): Promise<JudicialCourtResolution> {
  if (resolution.status !== "AMBIGUOUS" || !resolution.alternatives.length) return resolution;
  const checks = await Promise.all(resolution.alternatives.slice(0, 4).map(async ({ court }) => {
    try { return { court, available: true, matched: await checker(court) }; }
    catch { return { court, available: false, matched: false }; }
  }));
  const matched = checks.filter((item) => item.matched);
  if (matched.length === 1) return sourceVerifiedResolution(resolution, matched[0].court);
  if (checks.every((item) => !item.available)) return { ...resolution, status: "SOURCE_UNAVAILABLE" };
  return resolution;
}

function resolvedOrThrow(result: JudicialCourtResolution, scope: string): ResolvedCourt {
  if (result.status !== "RESOLVED" || !result.court) throw resolutionError(result, scope);
  return { court: result.court, resolution: result };
}

async function resolveStjCourt(provider: StjJaliscoProvider, action: AddCaseAction): Promise<ResolvedCourt> {
  const catalog = (await provider.fetchCatalogs()).map(stjCourt);
  let resolution = new JudicialOrganResolver(catalog).resolve(resolutionInput(action, "STJ_JALISCO"));
  resolution = await verifyUniqueCandidate(resolution, async (court) => (await provider.searchCase(action.case_number, court.externalId)).records.length > 0);
  return resolvedOrThrow(resolution, "de Sala del STJ");
}

async function resolveLocalCourt(provider: JaliscoProvider, action: AddCaseAction): Promise<ResolvedCourt> {
  const catalog = (await provider.fetchCatalogs()).map(localCourt);
  let resolution = new JudicialOrganResolver(catalog).resolve(resolutionInput(action, "JALISCO_CJJ"));
  resolution = await verifyUniqueCandidate(resolution, async (court) => (await provider.searchCase(action.case_number, court.externalId)).records.length > 0);
  return resolvedOrThrow(resolution, "local");
}

async function resolveFederalCourt(
  provider: FederalProvider,
  circuits: FederalCircuit[],
  action: AddCaseAction,
): Promise<{ circuit: FederalCircuit; court: FederalCourt; resolution: JudicialCourtResolution }> {
  const preferred = action.circuit
    ? circuits.find((item) => item.externalId === action.circuit) ?? bestNamed(circuits, action.circuit)
    : null;
  const jaliscoCircuit = /\b(JALISCO|COLIMA)\b/i.test(action.court_name)
    ? circuits.find((item) => item.externalId === "3") ?? bestNamed(circuits, "TERCER CIRCUITO")
    : null;
  const priority = [preferred, jaliscoCircuit].filter((item, index, list): item is FederalCircuit => Boolean(item) && list.findIndex((candidate) => candidate?.externalId === item?.externalId) === index);

  const courtsByCircuit = new Map<string, FederalCourt[]>();
  const load = async (selected: FederalCircuit[]) => {
    const batches = await Promise.all(selected.map(async (circuit) => {
      const courts = await provider.getCourts(circuit.externalId);
      courtsByCircuit.set(circuit.externalId, courts);
      return courts.map((court) => federalCourt(court, circuit));
    }));
    return batches.flat();
  };

  const canonical = await load(priority);
  let resolution = canonical.length
    ? new JudicialOrganResolver(canonical).resolve(resolutionInput(action, "FEDERAL_PJF"))
    : null;

  if (resolution?.status === "AMBIGUOUS") {
    resolution = await verifyUniqueCandidate(
      resolution,
      async (court) => (await provider.fetchCase(action.case_number, court.externalId, action.case_type ?? undefined)).length > 0,
    );
  }
  if (resolution?.status === "SOURCE_UNAVAILABLE") throw resolutionError(resolution, "federal vigente");

  if (!resolution || resolution.status !== "RESOLVED") {
    const remaining = circuits.filter((circuit) => !priority.some((item) => item.externalId === circuit.externalId));
    for (let index = 0; index < remaining.length; index += 2) canonical.push(...await load(remaining.slice(index, index + 2)));
    resolution = new JudicialOrganResolver(canonical).resolve(resolutionInput(action, "FEDERAL_PJF"));
  }
  resolution = await verifyUniqueCandidate(resolution, async (court) => (await provider.fetchCase(action.case_number, court.externalId, action.case_type ?? undefined)).length > 0);
  const resolved = resolvedOrThrow(resolution, "federal vigente");
  const circuit = circuits.find((item) => item.externalId === resolved.court.circuit);
  const court = circuit ? courtsByCircuit.get(circuit.externalId)?.find((item) => item.externalId === resolved.court.externalId) : null;
  if (!circuit || !court) throw new CourtResolutionError("NOT_FOUND", "El órgano federal resuelto no pertenece a un circuito vigente.");
  return { circuit, court, resolution: resolved.resolution };
}

function resolutionAudit(action: AddCaseAction, resolved: ResolvedCourt | { court: CanonicalJudicialCourt; resolution: JudicialCourtResolution }) {
  return {
    rawCourtInput: action.court_name,
    canonicalCourtId: resolved.court.externalId,
    canonicalCourtName: resolved.court.name,
    resolutionConfidence: resolved.resolution.confidence,
    resolutionMethod: resolved.resolution.method as CourtResolutionMethod,
    resolutionScore: resolved.resolution.score,
  };
}

function selectFolder<T extends { name: string }>(folders: T[], requested: string): T | null {
  const cleaned = requested.replace(/^\s*(?:en\s+)?(?:la\s+)?carpeta\s+/i, "").trim();
  return bestNamed(folders, cleaned);
}

export async function executeAddCaseAction(input: { organizationId: string; userId: string; action: AddCaseAction }) {
  const folders = await listFolders(input.organizationId);
  const folder = selectFolder(folders, input.action.folder_name);
  if (!folder) throw new Error(`No encontré una carpeta inequívoca llamada “${input.action.folder_name}”.`);

  const inferredJurisdiction = inferAssistantJurisdiction(input.action.court_name, input.action.jurisdiction);
  const source = inferJudicialCourtSource(resolutionInput({ ...input.action, jurisdiction: inferredJurisdiction }));

  if (source === "STJ_JALISCO") {
    const provider = new StjJaliscoProvider();
    const resolved = await resolveStjCourt(provider, input.action);
    const id = await createMonitoredCase({
      organizationId: input.organizationId, userId: input.userId, jurisdiction: "JALISCO", provider: provider.id,
      authorityName: provider.name, sourceUrl: "https://consultas.stjjalisco.gob.mx/consultas/acuerdos",
      courtExternalId: resolved.court.externalId, courtName: resolved.court.name, courtType: "STJ_CHAMBER",
      caseNumber: input.action.case_number, caseType: "Toca", folderIds: [folder.id], monitorFrom: "1900-01-01",
      resolutionMetadata: resolutionAudit(input.action, resolved),
    });
    return { id, caseNumber: input.action.case_number, courtName: resolved.court.name, folderName: folder.name };
  }

  if (source === "JALISCO_CJJ") {
    const provider = new JaliscoProvider();
    const resolved = await resolveLocalCourt(provider, input.action);
    const caseType = input.action.case_type ?? resolved.court.matter ?? "Asunto local";
    const id = await createMonitoredCase({
      organizationId: input.organizationId, userId: input.userId, jurisdiction: "JALISCO", provider: provider.id,
      authorityName: "Poder Judicial del Estado de Jalisco", sourceUrl: "https://cjj.gob.mx/bulletin",
      courtExternalId: resolved.court.externalId, courtName: resolved.court.name,
      caseNumber: input.action.case_number, caseType, folderIds: [folder.id], monitorFrom: "1900-01-01",
      resolutionMetadata: resolutionAudit(input.action, resolved),
    });
    return { id, caseNumber: input.action.case_number, courtName: resolved.court.name, folderName: folder.name };
  }

  if (!input.action.case_type) throw new Error("Para agregar un asunto federal necesito el tipo de asunto.");
  if (!supportsFederalCaseType(input.action.case_type)) throw new Error(`El tipo federal “${input.action.case_type}” no corresponde a una consulta soportada.`);
  const provider = new FederalProvider();
  const resolved = await resolveFederalCourt(provider, await provider.getCircuits(), input.action);
  const year = input.action.case_number.match(/\/(\d{4})/)?.[1] ?? new Date().getFullYear();
  const canonical = federalCourt(resolved.court, resolved.circuit);
  const id = await createMonitoredCase({
    organizationId: input.organizationId, userId: input.userId, jurisdiction: "FEDERAL", provider: provider.id,
    authorityName: provider.name, sourceUrl: "https://www.dgej.cjf.gob.mx/SiseInternet",
    courtExternalId: resolved.court.externalId, courtName: resolved.court.name, courtType: resolved.court.courtType,
    circuitId: resolved.circuit.externalId, circuitName: resolved.circuit.name,
    caseNumber: input.action.case_number, caseType: input.action.case_type, folderIds: [folder.id], monitorFrom: `${year}-01-01`,
    resolutionMetadata: resolutionAudit(input.action, { court: canonical, resolution: resolved.resolution }),
  });
  return { id, caseNumber: input.action.case_number, courtName: resolved.court.name, folderName: folder.name };
}

export async function executeAddCaseActions(input: { organizationId: string; userId: string; actions: AddCaseAction[] }) {
  const results: Array<
    | { ok: true; id: string; caseNumber: string; courtName: string; folderName: string }
    | { ok: false; caseNumber: string; error: string; errorCode?: string }
  > = [];
  for (const action of input.actions.slice(0, 20)) {
    try {
      results.push({ ok: true, ...(await executeAddCaseAction({ ...input, action })) });
    } catch (error) {
      results.push({
        ok: false,
        caseNumber: action.case_number,
        error: error instanceof Error ? error.message : "No fue posible agregar el asunto.",
        ...(error instanceof CourtResolutionError ? { errorCode: error.code } : {}),
      });
    }
  }
  return results;
}
