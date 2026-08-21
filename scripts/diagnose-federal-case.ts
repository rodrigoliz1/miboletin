import "./load-env";
import { closeDb, db } from "../src/lib/db/client";
import { normalizeCaseNumber } from "../src/lib/domain/normalization";
import { extractParties } from "../src/lib/parties/extractor";
import { FederalProvider } from "../src/lib/providers/federal/provider";

function option(args: string[], name: string): string | undefined {
  return args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const args = process.argv.slice(2);
  const caseId = option(args, "case-id");
  const caseNumber = option(args, "case");
  const court = option(args, "court");
  const caseType = option(args, "type");
  const live = args.includes("--live");
  if (!caseId && !caseNumber) throw new Error("Use --case-id=UUID o --case=123/2026 [--court=ID --type=TIPO] [--live]");
  const sql = db();
  const normalized = caseNumber ? normalizeCaseNumber(caseNumber).normalized : undefined;
  const rows = await sql`
    SELECT jc.id, jc.case_number_normalized, jc.case_type, c.external_id AS court_external_id,
           cir.external_id AS circuit_id
    FROM judicial_cases jc
    JOIN judicial_authorities ja ON ja.id = jc.authority_id AND ja.code = 'federal-pjf-session-lists'
    JOIN courts c ON c.id = jc.court_id
    LEFT JOIN judicial_circuits cir ON cir.id = c.circuit_id
    WHERE (${caseId ?? null}::uuid IS NULL OR jc.id = ${caseId ?? null}::uuid)
      AND (${normalized ?? null}::text IS NULL OR jc.case_number_normalized = ${normalized ?? null})
      AND (${court ?? null}::text IS NULL OR c.external_id = ${court ?? null})
      AND (${caseType ?? null}::text IS NULL OR jc.case_type = ${caseType ?? null})
    ORDER BY jc.created_at DESC LIMIT 5
  `;
  if (rows.length !== 1) throw new Error(rows.length ? "La consulta no identifica un único expediente; agrega --court y --type" : "Expediente federal no localizado en el índice");
  const selected = rows[0];
  const publications = await sql`
    SELECT jp.id, jp.snapshot_id, jp.official_text, jp.publication_date, jp.source_url, ss.raw_payload, ss.raw_text,
           ss.http_status, ss.content_type
    FROM judicial_publications jp
    JOIN source_snapshots ss ON ss.id = jp.snapshot_id
    WHERE jp.case_id = ${selected.id}
    ORDER BY jp.publication_date DESC
  `;
  let candidateCount = 0;
  let detailFetched = false;
  let historyFetched = false;
  let listFetched = false;
  for (const publication of publications) {
    const payload = publication.raw_payload && typeof publication.raw_payload === "object"
      ? publication.raw_payload as Record<string, unknown>
      : {};
    const rawText = typeof publication.raw_text === "string" ? publication.raw_text : null;
    detailFetched ||= Boolean(rawText && rawText.length > 100);
    historyFetched ||= typeof payload.historyUrl === "string";
    listFetched ||= Boolean(payload.record || payload.directCaseSession);
    candidateCount += extractParties({
      provider: "federal-pjf-session-lists",
      rawPayload: payload,
      rawText,
      officialText: String(publication.official_text),
    }).length;
  }
  const [stored] = await sql`
    SELECT count(*)::int AS accepted,
           count(*) FILTER (WHERE confidence < 0.7)::int AS low_confidence
    FROM case_parties WHERE case_id = ${selected.id} AND active
  `;
  let liveResult: { fetched: number; errors: string[]; candidates: number } | undefined;
  if (live) {
    const provider = new FederalProvider();
    const fetched = await provider.fetchCase(String(selected.case_number_normalized), String(selected.court_external_id), String(selected.case_type));
    liveResult = {
      fetched: fetched.length,
      errors: [],
      candidates: fetched.reduce((sum, item) => sum + extractParties({
        provider: provider.id,
        parties: item.parties,
        rawPayload: item.rawPayload && typeof item.rawPayload === "object" ? item.rawPayload as Record<string, unknown> : {},
        rawText: item.rawPayload && typeof item.rawPayload === "object" && typeof (item.rawPayload as Record<string, unknown>).rawHtml === "string" ? String((item.rawPayload as Record<string, unknown>).rawHtml) : null,
        officialText: item.officialText,
      }).length, 0),
    };
  }
  const accepted = Number(stored.accepted ?? 0);
  const status = accepted > 0 || candidateCount > 0
    ? "PARTIES_FOUND"
    : detailFetched || listFetched
      ? "NO_PUBLIC_PARTIES"
      : "DETAIL_NOT_FETCHED";
  console.log(JSON.stringify({
    caseLocated: true,
    caseId: selected.id,
    caseNumber: selected.case_number_normalized,
    courtExternalId: selected.court_external_id,
    caseType: selected.case_type,
    circuitId: selected.circuit_id,
    snapshots: new Set(publications.map((row) => String(row.snapshot_id))).size,
    publications: publications.length,
    listFetched,
    detailFetched,
    historyFetched,
    partyCandidates: candidateCount,
    acceptedParties: accepted,
    lowConfidenceParties: Number(stored.low_confidence ?? 0),
    status,
    live: liveResult,
  }, null, 2));
  await closeDb();
}

void main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  await closeDb();
  process.exitCode = 1;
});
