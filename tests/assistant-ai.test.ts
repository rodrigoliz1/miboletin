import { describe, expect, it } from "vitest";
import { enforceGroundedSessionAnswer, parseAssistantCompletion } from "@/lib/assistant/ai";

describe("assistant tool calling", () => {
  it("preserves validated add_monitored_cases calls", () => {
    const parsed = parseAssistantCompletion({ choices: [{ message: { content: null, tool_calls: [{
      id: "call-1", type: "function", function: { name: "add_monitored_cases", arguments: JSON.stringify({ cases: [{ folder_name: "General", case_number: "210/2026", court_name: "Novena Sala Civil del Supremo Tribunal de Justicia del Estado de Jalisco", jurisdiction: "JALISCO", circuit: null, case_type: "Toca", matter: "Civil", state: "Jalisco", organ_type: "Sala", source_hint: "STJ_JALISCO" }] }) },
    }] } }] });
    expect(parsed.actions).toEqual([{ folder_name: "General", case_number: "210/2026", court_name: "Novena Sala Civil del Supremo Tribunal de Justicia del Estado de Jalisco", jurisdiction: "JALISCO", circuit: null, case_type: "Toca", matter: "Civil", state: "Jalisco", organ_type: "Sala", source_hint: "STJ_JALISCO" }]);
  });

  it("rejects malformed provider tool arguments", () => {
    expect(() => parseAssistantCompletion({ choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "add_monitored_cases", arguments: "{}" } }] } }] })).toThrow("AI_INVALID_TOOL_ARGUMENTS");
  });

  it("rejects a claim that an action ran when no tool call exists", () => {
    expect(() => parseAssistantCompletion({ choices: [{ message: { content: "Ya agregué el expediente a General." } }] })).toThrow("AI_UNVERIFIED_ACTION_CLAIM");
  });

  it("preserves rich Markdown while hiding internal context labels", () => {
    const parsed = parseAssistantCompletion({ choices: [{ message: { content: "**20 resoluciones** en CONTEXTO_JUDICIAL.\n\n| Expediente | Órgano |\n| --- | --- |\n| 93/2026 | Tercera Sala |" } }] });
    expect(parsed.content).toContain("**20 resoluciones**");
    expect(parsed.content).toContain("| Expediente | Órgano |");
    expect(parsed.content).not.toContain("CONTEXTO_JUDICIAL");
  });

  it("replaces a false no-sessions answer with the verified listed matters", () => {
    const corrected = enforceGroundedSessionAnswer("No hay sesiones programadas.", {
      requestedPeriod: { from: "2026-08-17", to: "2026-08-21" },
      sessions: [
        { caseNumber: "29/2026", caseType: "Queja", court: "Tercer Tribunal Colegiado en Materia Civil del Tercer Circuito", listedDate: "2026-07-31", sessionDate: "2026-08-20" },
        { caseNumber: "214/2026", caseType: "Amparo en Revisión", court: "Segundo Tribunal Colegiado en Materia Civil del Primer Circuito", listedDate: "2026-08-14", sessionDate: "2026-08-20" },
      ],
    }, "session_lookup");
    expect(corrected).toContain("**2 asuntos listados a sesión**");
    expect(corrected).toContain("**29/2026**");
    expect(corrected).toContain("**214/2026**");
    expect(corrected).not.toContain("No hay sesiones");
  });

  it("does not expose an internal sessions array", () => {
    const parsed = parseAssistantCompletion({ choices: [{ message: { content: "Revisé (\"sessions\":[]) y no encontré coincidencias." } }] });
    expect(parsed.content).not.toContain("sessions");
  });
});
