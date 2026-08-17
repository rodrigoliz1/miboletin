const SENTENCE_WORD = /(^|[^a-záéíóúüñ])sentencia(?:s)?([^a-záéíóúüñ]|$)/i;

export function isImportantJudicialEvent(publicationKind: string, officialText: string): boolean {
  return publicationKind === "SESSION_LISTED"
    || publicationKind === "SESSION_RESULT"
    || publicationKind === "STJ_JUDGMENT"
    || SENTENCE_WORD.test(officialText);
}

export function importantJudicialEventTitle(publicationKind: string, officialText: string): string {
  if (publicationKind === "SESSION_LISTED") return "Tu asunto fue listado para sesión";
  if (publicationKind === "SESSION_RESULT") return "Se publicó el resultado de sesión";
  if (publicationKind === "STJ_JUDGMENT") return "La sentencia del STJ ya está disponible";
  if (SENTENCE_WORD.test(officialText)) return "Se publicó una resolución relacionada con sentencia";
  return "Notificación procesal importante";
}
