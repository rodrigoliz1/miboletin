import { normalizeName } from "@/lib/domain/normalization";

type SessionMovement = {
  id: string;
  publicationKind: string;
  publicationDate: string;
  sessionDate?: string;
};

export function verifiedNotebookLabel(notebook: string | null | undefined, officialText: string): string | undefined {
  const declared = normalizeName(notebook ?? "").toLowerCase();
  const text = normalizeName(officialText).toLowerCase();
  const textConfirmsIncident = /incidente de suspension|cuaderno incidental/.test(text);
  const textConfirmsPrincipal = /cuaderno principal/.test(text);

  if (/inciden/.test(declared)) return textConfirmsIncident ? "Cuaderno incidental" : undefined;
  if (/principal/.test(declared)) return textConfirmsPrincipal && !textConfirmsIncident ? "Cuaderno principal" : undefined;
  return undefined;
}

function sessionMoment(movement: SessionMovement): string {
  return movement.sessionDate ?? movement.publicationDate;
}

export function selectCurrentSessionMovements<T extends SessionMovement>(movements: T[]): T[] {
  const unique = [...new Map(movements.map((movement) => [
    [movement.publicationKind, movement.publicationDate, movement.sessionDate].join("|"),
    movement,
  ])).values()];
  const listed = unique
    .filter((movement) => movement.publicationKind === "SESSION_LISTED")
    .sort((left, right) => sessionMoment(right).localeCompare(sessionMoment(left)) || right.publicationDate.localeCompare(left.publicationDate))[0];
  const results = unique
    .filter((movement) => movement.publicationKind === "SESSION_RESULT")
    .sort((left, right) => sessionMoment(right).localeCompare(sessionMoment(left)) || right.publicationDate.localeCompare(left.publicationDate));
  const result = listed
    ? results.find((movement) => sessionMoment(movement) === sessionMoment(listed))
    : results[0];
  const selected = new Set([listed?.id, result?.id].filter((id): id is string => Boolean(id)));
  return unique.filter((movement) => selected.has(movement.id));
}
