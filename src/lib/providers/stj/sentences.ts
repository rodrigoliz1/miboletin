import { z } from "zod";
import { db } from "@/lib/db/client";
import { normalizeCaseNumber, sha256 } from "@/lib/domain/normalization";
import { respectfulFetch } from "@/lib/providers/http";
import { STJ_JUDGMENTS_URL } from "@/lib/providers/stj/provider";
import { storeJudicialDocument } from "@/lib/storage/judicial-documents";

const API = "https://publica-sentencias-backend.stjjalisco.gob.mx";
const MAX_PDF_BYTES = 25 * 1024 * 1024;

const candidateSchema = z.object({
  id: z.union([z.string(), z.number()]),
  sala_id: z.union([z.string(), z.number()]),
  numero: z.union([z.string(), z.number()]),
  periodo: z.union([z.string(), z.number()]),
  derivado: z.union([z.string(), z.number()]).nullish(),
  fecha_publicacion: z.string().nullish(),
}).passthrough();

export type StjJudgmentCandidate = z.infer<typeof candidateSchema>;

function normalizedText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase()
    : "";
}

export function classifyStjDocument(candidate: StjJudgmentCandidate, sequence: number, total: number) {
  const metadataText = Object.entries(candidate)
    .filter(([key]) => /derivado|tipo|descripcion|observacion|archivo|documento/i.test(key))
    .map(([, value]) => normalizedText(value))
    .join(" ");
  if (/\baclaraci(?:o|ó)n\b|\baclara(?:ci[oó]n)?\b/.test(metadataText)) {
    return { kind: "CLARIFICATION" as const, label: "Aclaración de sentencia" };
  }
  if (/\bsentencia\b/.test(metadataText)) return { kind: "JUDGMENT" as const, label: "Sentencia" };
  return {
    kind: sequence === 1 ? "JUDGMENT" as const : "RELATED" as const,
    label: total === 1 ? "Documento oficial" : `Documento oficial ${sequence} de ${total}`,
  };
}

export function parseStjJudgmentCandidates(input: unknown, chamberExternalId: string, caseNumber: string): StjJudgmentCandidate[] {
  const parsedCase = normalizeCaseNumber(caseNumber);
  const parsed = z.array(candidateSchema).safeParse(input);
  if (!parsed.success) throw new Error("STJ_JUDGMENT_CONTRACT_CHANGED");
  return [...new Map(parsed.data
    .filter((candidate) => String(candidate.sala_id) === String(chamberExternalId)
      && Number(candidate.numero) === parsedCase.number
      && Number(candidate.periodo) === parsedCase.year)
    .map((candidate) => [String(candidate.id), candidate])).values()];
}

export function validatePdfBytes(input: { bytes: Buffer; contentType?: string | null; contentLength?: string | null }) {
  const declared = Number(input.contentLength ?? input.bytes.length);
  if (!Number.isFinite(declared) || declared < 5 || declared > MAX_PDF_BYTES || input.bytes.length > MAX_PDF_BYTES) throw new Error("INVALID_DOCUMENT_SIZE");
  if (input.contentType && !/application\/pdf|application\/octet-stream/i.test(input.contentType)) throw new Error("INVALID_DOCUMENT_CONTENT_TYPE");
  if (input.bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("INVALID_DOCUMENT_SIGNATURE");
  return { byteSize: input.bytes.length, sha256: sha256(input.bytes) };
}

async function recordAttempt(caseId: string, status: "AVAILABLE" | "NOT_FOUND" | "UNAVAILABLE" | "ERROR" | "INVALID_DOCUMENT", message: string, httpStatus?: number) {
  await db().begin(async (tx) => {
    await tx`INSERT INTO document_retrieval_attempts (judicial_case_id, provider, status, http_status, message) VALUES (${caseId}, 'jalisco-stj-chambers', ${status}, ${httpStatus ?? null}, ${message})`;
    await tx`
      UPDATE stj_case_details
      SET sentence_state = ${status === "INVALID_DOCUMENT" ? "ERROR" : status}, unavailable_reason = ${message},
          last_attempt_at = now(), retry_count = retry_count + 1,
          next_retry_at = CASE
            WHEN ${status} = 'AVAILABLE' THEN NULL
            ELSE now() + make_interval(hours => LEAST(168, (6 * power(2, LEAST(retry_count, 5)))::int))
          END,
          updated_at = now()
      WHERE judicial_case_id = ${caseId}
    `;
  });
}

async function persistJudgment(input: { caseId: string; externalId: string; sourceUrl: string; bytes: Buffer; publishedAt?: string; sequence: number; total: number; candidate: StjJudgmentCandidate }) {
  const validation = validatePdfBytes({ bytes: input.bytes, contentType: "application/pdf" });
  const stored = await storeJudicialDocument({ sha256: validation.sha256, bytes: input.bytes });
  const classification = classifyStjDocument(input.candidate, input.sequence, input.total);
  await db().begin(async (tx) => {
    const [judicialCase] = await tx`SELECT jc.id, jc.court_id, jc.case_number_raw, jc.case_number_normalized, jc.case_type FROM judicial_cases jc WHERE jc.id = ${input.caseId}`;
    if (!judicialCase) throw new Error("STJ_CASE_NOT_FOUND");
    const [document] = await tx`
      INSERT INTO judicial_documents (
        judicial_case_id, provider, kind, official_external_id, filename, content_type,
        byte_size, sha256, content, storage_provider, storage_key, source_url, published_at,
        document_label, official_toca, document_sequence, official_metadata
      ) VALUES (
        ${input.caseId}, 'jalisco-stj-chambers', ${classification.kind}, ${input.externalId},
        ${`stj-${judicialCase.case_number_normalized.replace("/", "-")}-${input.externalId}.pdf`}, 'application/pdf',
        ${validation.byteSize}, ${validation.sha256}, NULL, ${stored.provider}, ${stored.key}, ${input.sourceUrl}, ${input.publishedAt ?? null},
        ${classification.label}, ${judicialCase.case_number_normalized}, ${input.sequence}, ${JSON.stringify(input.candidate)}::jsonb
      )
      ON CONFLICT (provider, official_external_id, sha256) DO UPDATE SET
        retrieved_at = now(), document_label = EXCLUDED.document_label,
        document_sequence = EXCLUDED.document_sequence, official_metadata = EXCLUDED.official_metadata
      RETURNING id
    `;
    const publishedDate = input.publishedAt?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const snapshotHash = sha256(`stj-judgment:${input.externalId}:${validation.sha256}`);
    const [snapshot] = await tx`
      INSERT INTO source_snapshots (
        provider, external_id, court_external_id, publication_date, source_url, raw_payload,
        retrieved_at, sha256, parser_version, provider_version, response_headers, content_type, request_method, http_status
      ) SELECT 'jalisco-stj-chambers', ${`judgment:${input.externalId}`}, c.external_id, ${publishedDate}, ${input.sourceUrl},
        ${tx.json({ documentId: document.id, officialExternalId: input.externalId, sha256: validation.sha256 })}, now(),
        ${snapshotHash}, 'stj-public-judgment-1', '1.0.0', ${tx.json({})}, 'application/pdf', 'GET', 200
      FROM courts c WHERE c.id = ${judicialCase.court_id}
      ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
      RETURNING id
    `;
    const contentHash = sha256(`stj-judgment-publication:${input.caseId}:${validation.sha256}`);
    const [publication] = await tx`
      INSERT INTO judicial_publications (
        case_id, court_id, snapshot_id, external_id, case_number_raw, case_number_normalized,
        case_type, official_text, publication_date, agreement_date, publication_kind,
        retrieved_at, content_hash, source_url
      ) VALUES (
        ${input.caseId}, ${judicialCase.court_id}, ${snapshot.id}, ${`judgment:${input.externalId}`},
        ${judicialCase.case_number_raw}, ${judicialCase.case_number_normalized}, ${judicialCase.case_type},
        ${`${classification.label} disponible en el portal oficial del Supremo Tribunal de Justicia del Estado de Jalisco.`},
        ${publishedDate}, ${publishedDate}, 'STJ_JUDGMENT', now(), ${contentHash}, ${input.sourceUrl}
      )
      ON CONFLICT (court_id, content_hash) DO UPDATE SET retrieved_at = EXCLUDED.retrieved_at
      RETURNING id
    `;
    const movements = await tx`
      INSERT INTO case_movements (monitored_case_id, publication_id, match_result, detected_at)
      SELECT mc.id, ${publication.id}, 'EXACT', now()
      FROM monitored_cases mc
      WHERE mc.case_id = ${input.caseId} AND mc.active AND mc.deleted_at IS NULL
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    if (movements.length) {
      await tx`
        INSERT INTO notifications (user_id, movement_id, channel, subject, payload)
        SELECT memberships.user_id, cm.id, delivery.channel,
               ${classification.label} || ' del STJ disponible: ' || jc.case_number_normalized,
               jsonb_build_object('publicationId', ${publication.id}, 'documentId', ${document.id}, 'documentLabel', ${classification.label}, 'publicationKind', 'STJ_JUDGMENT', 'publicationDate', ${publishedDate})
        FROM case_movements cm
        JOIN monitored_cases mc ON mc.id = cm.monitored_case_id
        JOIN judicial_cases jc ON jc.id = mc.case_id
        JOIN memberships ON memberships.organization_id = mc.organization_id
        CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS delivery(channel)
        WHERE cm.id = ANY(${movements.map((item) => String(item.id))}::uuid[])
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

async function finishBatch(caseId: string, input: { expected: number; available: number; firstExternalId?: string; message?: string; blockedByRecaptcha?: boolean }) {
  const [stored] = await db()`SELECT count(*)::int AS count FROM judicial_documents WHERE judicial_case_id = ${caseId} AND provider = 'jalisco-stj-chambers'`;
  const available = Math.min(input.expected, Number(stored?.count ?? input.available));
  const complete = input.expected > 0 && available === input.expected;
  const state = complete ? "AVAILABLE" : available > 0 ? "PARTIAL" : input.blockedByRecaptcha ? "UNAVAILABLE" : "ERROR";
  const detail = input.message ? ` ${input.message}` : "";
  const message = complete
    ? `${available} documento(s) oficial(es) validado(s) y almacenado(s)`
    : `${available} de ${input.expected} documento(s) oficial(es) disponible(s); se reintentará el resto.${detail}`.slice(0, 900);
  await db().begin(async (tx) => {
    await tx`
      UPDATE stj_case_details SET sentence_state = ${state}, judgment_external_id = ${input.firstExternalId ?? null},
        official_document_count = ${input.expected}, available_document_count = ${available},
        unavailable_reason = ${complete ? null : message}, last_attempt_at = now(),
        next_retry_at = ${complete ? null : new Date(Date.now() + 6 * 60 * 60 * 1000)}, updated_at = now()
      WHERE judicial_case_id = ${caseId}
    `;
    await tx`
      INSERT INTO document_retrieval_attempts (judicial_case_id, provider, status, http_status, message)
      VALUES (${caseId}, 'jalisco-stj-chambers', ${available > 0 ? "AVAILABLE" : input.blockedByRecaptcha ? "UNAVAILABLE" : "ERROR"}, ${available > 0 ? 200 : input.blockedByRecaptcha ? 403 : null}, ${message})
    `;
  });
  return state;
}

export async function refreshStjSentenceAvailability(caseId: string): Promise<string> {
  const [row] = await db()`
    SELECT scd.judicial_case_id, scd.chamber_external_id, scd.retry_count,
           jc.case_number_normalized
    FROM stj_case_details scd
    JOIN judicial_cases jc ON jc.id = scd.judicial_case_id
    WHERE scd.judicial_case_id = ${caseId}
  `;
  if (!row) return "NOT_EXPECTED";
  const parsed = normalizeCaseNumber(row.case_number_normalized);
  const query = new URLSearchParams({ page: "1", paginador: "20", sala_id: row.chamber_external_id, numero: String(parsed.number), periodo: String(parsed.year), recaptcha_token: "" });
  const response = await respectfulFetch(`${API}/tocas?${query}`, { headers: { Accept: "application/json", Origin: "https://publicacionsentencias.stjjalisco.gob.mx", Referer: STJ_JUDGMENTS_URL } }, 1);
  if (response.status === 403) {
    await recordAttempt(caseId, "UNAVAILABLE", "El portal oficial protege la búsqueda con reCAPTCHA; no se intentó evadir la verificación.", 403);
    return "UNAVAILABLE";
  }
  if (!response.ok) {
    await recordAttempt(caseId, "ERROR", `Portal de sentencias HTTP ${response.status}`, response.status);
    return "ERROR";
  }
  const body = await response.json() as { data?: { tocas?: { data?: unknown[] } } };
  let exact: StjJudgmentCandidate[];
  try {
    exact = parseStjJudgmentCandidates(body.data?.tocas?.data ?? [], String(row.chamber_external_id), parsed.normalized);
  } catch {
    await recordAttempt(caseId, "ERROR", "El contrato de búsqueda de sentencias cambió");
    return "ERROR";
  }
  if (!exact.length) {
    await recordAttempt(caseId, "NOT_FOUND", "La sentencia aún no aparece publicada en la búsqueda oficial");
    return "NOT_FOUND";
  }
  let available = 0;
  const failures: string[] = [];
  let blockedByRecaptcha = false;
  for (const [index, candidate] of exact.entries()) {
    try {
      const fileResponse = await respectfulFetch(`${API}/toca/${candidate.id}/file?modo=visualizar&recaptcha_token=`, { headers: { Accept: "application/json", Origin: "https://publicacionsentencias.stjjalisco.gob.mx", Referer: STJ_JUDGMENTS_URL } }, 1);
      if (fileResponse.status === 403) {
        blockedByRecaptcha = true;
        throw new Error("El documento oficial exige verificación interactiva reCAPTCHA.");
      }
      const fileBody = await fileResponse.json() as { data?: { url?: string } };
      const fileUrl = fileBody.data?.url;
      if (!fileResponse.ok || !fileUrl || !fileUrl.startsWith("https://")) throw new Error("La fuente no devolvió una URL HTTPS de documento válida");
      const pdfResponse = await respectfulFetch(fileUrl, { headers: { Accept: "application/pdf" } }, 1);
      if (!pdfResponse.ok) throw new Error(`Descarga de documento HTTP ${pdfResponse.status}`);
      const bytes = Buffer.from(await pdfResponse.arrayBuffer());
      validatePdfBytes({ bytes, contentType: pdfResponse.headers.get("content-type"), contentLength: pdfResponse.headers.get("content-length") });
      await persistJudgment({ caseId, externalId: String(candidate.id), sourceUrl: fileUrl, bytes, publishedAt: candidate.fecha_publicacion ?? undefined, sequence: index + 1, total: exact.length, candidate });
      available += 1;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : `No fue posible recuperar el documento ${candidate.id}`);
    }
  }
  return finishBatch(caseId, { expected: exact.length, available, firstExternalId: String(exact[0].id), message: failures.length ? failures.join(" · ").slice(0, 700) : undefined, blockedByRecaptcha });
}

export async function refreshDueStjSentences(limit = 20): Promise<number> {
  const rows = await db()`
    SELECT judicial_case_id
    FROM stj_case_details
    WHERE sentence_state IN ('PENDING_PUBLICATION', 'PARTIAL', 'NOT_FOUND', 'UNAVAILABLE', 'ERROR')
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY COALESCE(next_retry_at, possible_sentence_at, updated_at)
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `;
  for (const row of rows) {
    const caseId = String(row.judicial_case_id);
    try { await refreshStjSentenceAvailability(caseId); }
    catch (error) { await recordAttempt(caseId, "ERROR", error instanceof Error ? error.message : "No fue posible consultar el portal de sentencias"); }
  }
  return rows.length;
}
