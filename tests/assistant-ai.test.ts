import { describe, expect, it } from "vitest";
import { parseAssistantCompletion } from "@/lib/assistant/ai";

describe("assistant tool calling", () => {
  it("preserves validated add_monitored_cases calls", () => {
    const parsed = parseAssistantCompletion({ choices: [{ message: { content: null, tool_calls: [{
      id: "call-1", type: "function", function: { name: "add_monitored_cases", arguments: JSON.stringify({ cases: [{ folder_name: "General", case_number: "93/2026", court_name: "Tercera Sala Especializada en Materia Civil", jurisdiction: "JALISCO", circuit: null, case_type: "Toca" }] }) },
    }] } }] });
    expect(parsed.actions).toEqual([{ folder_name: "General", case_number: "93/2026", court_name: "Tercera Sala Especializada en Materia Civil", jurisdiction: "JALISCO", circuit: null, case_type: "Toca" }]);
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
});
