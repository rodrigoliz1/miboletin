import "server-only";
import { createMonitoredCase, listFolders } from "@/lib/product/repository";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { FederalProvider, supportsFederalCaseType, type FederalCircuit, type FederalCourt } from "@/lib/providers/federal/provider";
import { bestNamed, inferAssistantJurisdiction, matchNamed } from "@/lib/assistant/named-match";

export interface AddCaseAction {
  folder_name: string;
  case_number: string;
  court_name: string;
  jurisdiction: "JALISCO" | "FEDERAL" | null;
  circuit: string | null;
  case_type: string | null;
}

async function resolveFederalCourt(
  provider: FederalProvider,
  circuits: FederalCircuit[],
  requestedCourt: string,
  requestedCircuit: string | null,
): Promise<{ circuit: FederalCircuit; court: FederalCourt } | null> {
  const preferred = requestedCircuit
    ? circuits.find((item) => item.externalId === requestedCircuit) ?? bestNamed(circuits, requestedCircuit)
    : null;
  const jaliscoCircuit = /\b(JALISCO|COLIMA)\b/i.test(requestedCourt)
    ? circuits.find((item) => item.externalId === "3") ?? bestNamed(circuits, "TERCER CIRCUITO")
    : null;
  const priority = [preferred, jaliscoCircuit].filter((item, index, list): item is FederalCircuit => Boolean(item) && list.findIndex((candidate) => candidate?.externalId === item?.externalId) === index);

  for (const circuit of priority) {
    const matched = matchNamed(await provider.getCourts(circuit.externalId), requestedCourt);
    if (matched) return { circuit, court: matched.item };
  }

  // El modelo puede omitir o inferir mal el circuito. La fuente oficial sigue siendo
  // la autoridad: sólo aceptamos una coincidencia inequívoca en el catálogo completo.
  const remaining = circuits.filter((circuit) => !priority.some((item) => item.externalId === circuit.externalId));
  const candidates: Array<{ circuit: FederalCircuit; court: FederalCourt; score: number }> = [];
  for (let index = 0; index < remaining.length; index += 2) {
    const batch = remaining.slice(index, index + 2);
    const courtsByCircuit = await Promise.all(batch.map((circuit) => provider.getCourts(circuit.externalId)));
    courtsByCircuit.forEach((courts, batchIndex) => {
      const matched = matchNamed(courts, requestedCourt);
      if (matched) candidates.push({ circuit: batch[batchIndex], court: matched.item, score: matched.score });
    });
  }
  candidates.sort((left, right) => right.score - left.score);
  if (!candidates[0] || (candidates[1] && candidates[0].score - candidates[1].score < 0.035)) return null;
  return candidates[0];
}

export async function executeAddCaseAction(input: { organizationId: string; userId: string; action: AddCaseAction }) {
  const folders = await listFolders(input.organizationId);
  const folder = bestNamed(folders, input.action.folder_name);
  if (!folder) throw new Error(`No encontré una carpeta inequívoca llamada “${input.action.folder_name}”.`);
  const jurisdiction = inferAssistantJurisdiction(input.action.court_name, input.action.jurisdiction);
  if (jurisdiction === "JALISCO") {
    const provider = new JaliscoProvider();
    const court = bestNamed(await provider.fetchCatalogs(), input.action.court_name);
    if (!court) throw new Error("No encontré un único órgano local que coincida con el nombre indicado.");
    const caseType = input.action.case_type ?? court.matter ?? "Asunto local";
    const id = await createMonitoredCase({ organizationId: input.organizationId, userId: input.userId, jurisdiction, provider: provider.id, authorityName: "Poder Judicial del Estado de Jalisco", sourceUrl: "https://cjj.gob.mx/bulletin", courtExternalId: court.externalId, courtName: court.name, caseNumber: input.action.case_number, caseType, folderIds: [folder.id], monitorFrom: "1900-01-01" });
    return { id, caseNumber: input.action.case_number, courtName: court.name, folderName: folder.name };
  }
  if (!input.action.case_type) throw new Error("Para agregar un asunto federal necesito el tipo de asunto.");
  if (!supportsFederalCaseType(input.action.case_type)) throw new Error(`El tipo federal “${input.action.case_type}” no corresponde a una consulta soportada.`);
  const provider = new FederalProvider();
  const circuits = await provider.getCircuits();
  const resolved = await resolveFederalCourt(provider, circuits, input.action.court_name, input.action.circuit);
  if (!resolved) throw new Error("No encontré un único órgano federal vigente que coincida con el nombre indicado.");
  const { circuit, court } = resolved;
  const year = input.action.case_number.match(/\/(\d{4})/)?.[1] ?? new Date().getFullYear();
  const id = await createMonitoredCase({ organizationId: input.organizationId, userId: input.userId, jurisdiction, provider: provider.id, authorityName: provider.name, sourceUrl: "https://www.dgej.cjf.gob.mx/SiseInternet", courtExternalId: court.externalId, courtName: court.name, courtType: court.courtType, circuitId: circuit.externalId, circuitName: circuit.name, caseNumber: input.action.case_number, caseType: input.action.case_type, folderIds: [folder.id], monitorFrom: `${year}-01-01` });
  return { id, caseNumber: input.action.case_number, courtName: court.name, folderName: folder.name };
}

export async function executeAddCaseActions(input: { organizationId: string; userId: string; actions: AddCaseAction[] }) {
  const results: Array<
    | { ok: true; id: string; caseNumber: string; courtName: string; folderName: string }
    | { ok: false; caseNumber: string; error: string }
  > = [];
  for (const action of input.actions.slice(0, 20)) {
    try {
      results.push({ ok: true, ...(await executeAddCaseAction({ ...input, action })) });
    } catch (error) {
      results.push({ ok: false, caseNumber: action.case_number, error: error instanceof Error ? error.message : "No fue posible agregar el asunto." });
    }
  }
  return results;
}
