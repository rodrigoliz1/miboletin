import { db } from "@/lib/db/client";
import type { AssistantConversation, AssistantMessage } from "@/lib/assistant/types";

function timestamp(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function conversation(row: Record<string, unknown>): AssistantConversation {
  return { id: String(row.id), title: String(row.title), createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) };
}

function message(row: Record<string, unknown>): AssistantMessage {
  return { id: String(row.id), role: row.role as AssistantMessage["role"], content: String(row.content), createdAt: timestamp(row.created_at) };
}

export async function listAssistantConversations(organizationId: string, userId: string): Promise<AssistantConversation[]> {
  const rows = await db()`
    SELECT id, title, created_at, updated_at
    FROM assistant_conversations
    WHERE organization_id = ${organizationId} AND user_id = ${userId} AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 100
  `;
  return rows.map(conversation);
}

export async function createAssistantConversation(organizationId: string, userId: string): Promise<AssistantConversation> {
  const [row] = await db()`
    INSERT INTO assistant_conversations (organization_id, user_id)
    VALUES (${organizationId}, ${userId})
    RETURNING id, title, created_at, updated_at
  `;
  return conversation(row);
}

export async function getAssistantConversation(
  organizationId: string,
  userId: string,
  conversationId: string,
): Promise<{ conversation: AssistantConversation; messages: AssistantMessage[] } | null> {
  const rows = await db()`
    SELECT id, title, created_at, updated_at
    FROM assistant_conversations
    WHERE id = ${conversationId} AND organization_id = ${organizationId}
      AND user_id = ${userId} AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) return null;
  const messages = await db()`
    SELECT id, role, content, created_at
    FROM assistant_messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC, id ASC
    LIMIT 200
  `;
  return { conversation: conversation(rows[0]), messages: messages.map(message) };
}

export async function deleteAssistantConversation(organizationId: string, userId: string, conversationId: string): Promise<boolean> {
  const rows = await db()`
    UPDATE assistant_conversations SET deleted_at = now(), updated_at = now()
    WHERE id = ${conversationId} AND organization_id = ${organizationId}
      AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

export async function addUserAssistantMessage(
  organizationId: string,
  userId: string,
  conversationId: string,
  content: string,
): Promise<AssistantMessage | null> {
  return db().begin(async (tx) => {
    const conversations = await tx`
      SELECT id, title FROM assistant_conversations
      WHERE id = ${conversationId} AND organization_id = ${organizationId}
        AND user_id = ${userId} AND deleted_at IS NULL
      FOR UPDATE
    `;
    if (!conversations.length) return null;
    const recent = await tx`
      SELECT count(*)::int AS count
      FROM assistant_messages am
      JOIN assistant_conversations ac ON ac.id = am.conversation_id
      WHERE ac.organization_id = ${organizationId} AND ac.user_id = ${userId}
        AND am.role = 'user' AND am.created_at > now() - interval '1 minute'
    `;
    if (Number(recent[0]?.count ?? 0) >= 12) throw new Error("ASSISTANT_RATE_LIMIT");
    const [row] = await tx`
      INSERT INTO assistant_messages (conversation_id, role, content)
      VALUES (${conversationId}, 'user', ${content})
      RETURNING id, role, content, created_at
    `;
    const firstTitle = conversations[0].title === "Nueva conversación";
    const title = content.replace(/\s+/g, " ").trim().slice(0, 72) || "Nueva conversación";
    await tx`
      UPDATE assistant_conversations
      SET updated_at = now(), title = CASE WHEN ${firstTitle} THEN ${title} ELSE title END
      WHERE id = ${conversationId}
    `;
    return message(row);
  });
}

export async function addAssistantReply(input: {
  organizationId: string;
  userId: string;
  conversationId: string;
  content: string;
  model: string;
  responseId: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<AssistantMessage | null> {
  const [row] = await db()`
    INSERT INTO assistant_messages (conversation_id, role, content, model, openai_response_id, input_tokens, output_tokens)
    SELECT ac.id, 'assistant', ${input.content}, ${input.model}, ${input.responseId}, ${input.inputTokens ?? null}, ${input.outputTokens ?? null}
    FROM assistant_conversations ac
    WHERE ac.id = ${input.conversationId} AND ac.organization_id = ${input.organizationId}
      AND ac.user_id = ${input.userId} AND ac.deleted_at IS NULL
    RETURNING id, role, content, created_at
  `;
  if (!row) return null;
  await db()`UPDATE assistant_conversations SET updated_at = now() WHERE id = ${input.conversationId}`;
  return message(row);
}
