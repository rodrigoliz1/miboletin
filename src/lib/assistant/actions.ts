import "server-only";
import { normalizeName } from "@/lib/domain/normalization";
import { createMonitoredCase, listFolders } from "@/lib/product/repository";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { FederalProvider, supportsFederalCaseType } from "@/lib/providers/federal/provider";

export interface AddCaseAction {
  folder_name: string;
  case_number: string;
  court_name: string;
  jurisdiction: "JALISCO" | "FEDERAL" | null;
  circuit: string | null;
  case_type: string | null;
}

function bestNamed<T extends { name: string }>(items: T[], requested: string): T | null {
  const target = normalizeName(requested);
  const exact = items.find((item) => normalizeName(item.name) === target);
  if (exact) return exact;
  const tokens = target.split(" ").filter((token) => token.length > 2);
  const scored = items.map((item) => ({ item, score: tokens.filter((token) => normalizeName(item.name).includes(token)).length / Math.max(tokens.length, 1) })).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 0.72 && (!scored[1] || scored[0].score > scored[1].score) ? scored[0].item : null;
}

export async function executeAddCaseAction(input: { organizationId: string; userId: string; action: AddCaseAction }) {
  const folders = await listFolders(input.organizationId);
  const folder = bestNamed(folders, input.action.folder_name);
  if (!folder) throw new Error(`No encontré una carpeta inequívoca llamada “${input.action.folder_name}”.`);
  const federalByName = /colegiado|distrito|federal|pleno regional|apelaci[oó]n/i.test(input.action.court_name);
  const jurisdiction = input.action.jurisdiction ?? (federalByName ? "FEDERAL" : "JALISCO");
  if (jurisdiction === "JALISCO") {
    const provider = new JaliscoProvider();
    const court = bestNamed(await provider.fetchCatalogs(), input.action.court_name);
    if (!court) throw new Error("No encontré un único órgano local que coincida con el nombre indicado.");
    const caseType = input.action.case_type ?? court.matter ?? "Asunto local";
    const id = await createMonitoredCase({ organizationId: input.organizationId, userId: input.userId, jurisdiction, provider: provider.id, authorityName: "Poder Judicial del Estado de Jalisco", sourceUrl: "https://cjj.gob.mx/bulletin", courtExternalId: court.externalId, courtName: court.name, caseNumber: input.action.case_number, caseType, folderIds: [folder.id], monitorFrom: "1900-01-01" });
    return { id, caseNumber: input.action.case_number, courtName: court.name, folderName: folder.name };
  }
  if (!input.action.circuit) throw new Error("Para agregar un asunto federal necesito que indiques el circuito.");
  if (!input.action.case_type) throw new Error("Para agregar un asunto federal necesito el tipo de asunto.");
  if (!supportsFederalCaseType(input.action.case_type)) throw new Error(`El tipo federal “${input.action.case_type}” no corresponde a una consulta soportada.`);
  const provider = new FederalProvider();
  const circuits = await provider.getCircuits();
  const circuit = circuits.find((item) => item.externalId === input.action.circuit) ?? bestNamed(circuits, input.action.circuit);
  if (!circuit) throw new Error("No encontré un circuito federal inequívoco con ese nombre.");
  const court = bestNamed(await provider.getCourts(circuit.externalId), input.action.court_name);
  if (!court) throw new Error("No encontré un único órgano federal que coincida dentro del circuito indicado.");
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
