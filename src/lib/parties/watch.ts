import "server-only";
import { db } from "@/lib/db/client";
import { normalizePartyName } from "./normalization";

export async function listNameWatchRules(userId: string) {
  const rows = await db()`
    SELECT id, kind, value_raw, match_mode, active, created_at
    FROM watch_rules
    WHERE user_id = ${userId} AND kind IN ('PERSON', 'COMPANY')
    ORDER BY active DESC, created_at DESC
  `;
  return rows.map((row) => ({ id: String(row.id), kind: String(row.kind), value: String(row.value_raw), matchMode: String(row.match_mode), active: Boolean(row.active), createdAt: new Date(row.created_at).toISOString() }));
}

export async function createNameWatchRule(input: { userId: string; kind: "PERSON" | "COMPANY"; value: string; matchMode: "EXACT" | "FLEXIBLE" }) {
  const valueRaw = input.value.replace(/\s+/g, " ").trim();
  const valueNormalized = normalizePartyName(valueRaw);
  const existing = await db()`
    SELECT id FROM watch_rules
    WHERE user_id = ${input.userId} AND kind = ${input.kind} AND value_normalized = ${valueNormalized}
      AND match_mode = ${input.matchMode}
    LIMIT 1
  `;
  if (existing.length) {
    await db()`UPDATE watch_rules SET active = true, value_raw = ${valueRaw} WHERE id = ${existing[0].id} AND user_id = ${input.userId}`;
    return String(existing[0].id);
  }
  const rows = await db()`
    INSERT INTO watch_rules (user_id, organization_id, kind, value_raw, value_normalized, match_mode)
    VALUES (${input.userId}, NULL, ${input.kind}, ${valueRaw}, ${valueNormalized}, ${input.matchMode})
    RETURNING id
  `;
  return String(rows[0].id);
}

export async function deleteNameWatchRule(userId: string, id: string): Promise<boolean> {
  const rows = await db()`DELETE FROM watch_rules WHERE id = ${id} AND user_id = ${userId} AND kind IN ('PERSON','COMPANY') RETURNING id`;
  return rows.length > 0;
}
