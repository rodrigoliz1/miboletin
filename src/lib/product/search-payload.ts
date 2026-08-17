import "server-only";
import { z } from "zod";
import { signSelectionOption, verifySelectionOption } from "@/lib/security/selection-token";

export const searchResultPayloadSchema = z.object({
  jurisdiction: z.enum(["JALISCO", "FEDERAL"]),
  provider: z.enum(["jalisco-cjj", "jalisco-stj-chambers", "federal-pjf-session-lists"]),
  courtExternalId: z.string().min(1).max(60),
  courtName: z.string().min(3).max(240),
  courtType: z.string().max(30).optional(),
  circuitId: z.string().max(20).optional(),
  circuitName: z.string().max(180).optional(),
  caseNumber: z.string().min(3).max(40),
  caseType: z.string().min(2).max(140),
});

export type SearchResultPayload = z.infer<typeof searchResultPayloadSchema>;

export function encodeSearchResult(payload: SearchResultPayload, organizationId: string) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { payload: encoded, token: signSelectionOption("SEARCH_RESULT", encoded, organizationId) };
}

export function decodeSearchResult(payload: string, token: string, organizationId: string): SearchResultPayload | null {
  if (!verifySelectionOption("SEARCH_RESULT", payload, organizationId, token)) return null;
  try { return searchResultPayloadSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); } catch { return null; }
}
