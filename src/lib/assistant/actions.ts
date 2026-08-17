import "server-only";
import { normalizeName } from "@/lib/domain/normalization";
import { createMonitoredCase, listFolders } from "@/lib/product/repository";
import { JaliscoProvider } from "@/lib/providers/jalisco/provider";
import { FederalProvider } from "@/lib/providers/federal/provider";

interface AddCaseAction {
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
    const official = await provider.searchCase(input.action.case_number, court.externalId);
    if (!official.records.length) throw new Error("La fuente oficial no devolvió publicaciones para ese expediente y órgano; no lo agregué para evitar una vinculación incorrecta.");
    const caseType = input.action.case_type ?? official.records.find((record) => record.caseType)?.caseType ?? court.matter ?? "Asunto local";
    const id = await createMonitoredCase({ organizationId: input.organizationId, userId: input.userId, jurisdiction, provider: provider.id, authorityName: "Poder Judicial del Estado de Jalisco", sourceUrl: official.sourceUrl, courtExternalId: court.externalId, courtName: court.name, caseNumber: input.action.case_number, caseType, folderIds: [folder.id], monitorFrom: "1900-01-01" });
    return { id, caseNumber: official.caseNumber, courtName: court.name, folderName: folder.name };
  }
  if (!input.action.circuit) throw new Error("Para agregar un asunto federal necesito que indiques el circuito.");
  if (!input.action.case_type) throw new Error("Para agregar un asunto federal necesito el tipo de asunto.");
  const provider = new FederalProvider();
  const circuits = await provider.getCircuits();
  const circuit = circuits.find((item) => item.externalId === input.action.circuit) ?? bestNamed(circuits, input.action.circuit);
  if (!circuit) throw new Error("No encontré un circuito federal inequívoco con ese nombre.");
  const court = bestNamed(await provider.getCourts(circuit.externalId), input.action.court_name);
  if (!court) throw new Error("No encontré un único órgano federal que coincida dentro del circuito indicado.");
  const official = await provider.fetchCase(input.action.case_number, court.externalId, input.action.case_type);
  if (!official.length) throw new Error("La ficha federal no confirmó ese expediente, órgano y tipo; no lo agregué.");
  const year = input.action.case_number.match(/\/(\d{4})/)?.[1] ?? new Date().getFullYear();
  const id = await createMonitoredCase({ organizationId: input.organizationId, userId: input.userId, jurisdiction, provider: provider.id, authorityName: provider.name, sourceUrl: "https://www.dgej.cjf.gob.mx/SiseInternet", courtExternalId: court.externalId, courtName: court.name, courtType: court.courtType, circuitId: circuit.externalId, circuitName: circuit.name, caseNumber: input.action.case_number, caseType: input.action.case_type, folderIds: [folder.id], monitorFrom: `${year}-01-01` });
  return { id, caseNumber: input.action.case_number, courtName: court.name, folderName: folder.name };
}
