import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { get, put } from "@vercel/blob";

export type JudicialDocumentStorageProvider = "VERCEL_BLOB" | "LOCAL" | "DATABASE_LEGACY";

export interface StoredJudicialDocument {
  provider: JudicialDocumentStorageProvider;
  key: string;
}

function safeLocalRoot(): string {
  return resolve(
    /* turbopackIgnore: true */
    process.env.JUDICIAL_DOCUMENTS_DIR?.trim() || resolve(process.cwd(), ".data", "judicial-documents"),
  );
}

function assertStorageKey(key: string): string {
  if (!/^judicial-documents\/[a-f0-9]{64}\.pdf$/.test(key)) throw new Error("DOCUMENT_STORAGE_KEY_INVALID");
  return key;
}

export async function storeJudicialDocument(input: { sha256: string; bytes: Buffer }): Promise<StoredJudicialDocument> {
  const key = assertStorageKey(`judicial-documents/${input.sha256}.pdf`);
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    await put(key, new Blob([new Uint8Array(input.bytes)], { type: "application/pdf" }), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/pdf",
      cacheControlMaxAge: 60 * 60 * 24 * 30,
    });
    return { provider: "VERCEL_BLOB", key };
  }
  if (process.env.NODE_ENV === "production") throw new Error("BLOB_READ_WRITE_TOKEN no está configurada para almacenar sentencias");
  const root = safeLocalRoot();
  const localPath = resolve(root, `${input.sha256}.pdf`);
  if (!localPath.startsWith(`${root}/`)) throw new Error("DOCUMENT_STORAGE_PATH_INVALID");
  await mkdir(root, { recursive: true });
  try { await writeFile(localPath, input.bytes, { flag: "wx" }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  return { provider: "LOCAL", key };
}

export async function retrieveJudicialDocument(input: { provider: JudicialDocumentStorageProvider; key?: string | null; legacyContent?: Buffer | Uint8Array | null }): Promise<{ body: BodyInit; contentLength?: number }> {
  if (input.provider === "DATABASE_LEGACY") {
    if (!input.legacyContent) throw new Error("DOCUMENT_NOT_FOUND");
    const bytes = new Uint8Array(input.legacyContent);
    return { body: bytes, contentLength: bytes.byteLength };
  }
  const key = assertStorageKey(input.key ?? "");
  if (input.provider === "VERCEL_BLOB") {
    const result = await get(key, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) throw new Error("DOCUMENT_NOT_FOUND");
    return { body: result.stream, contentLength: result.blob.size ?? undefined };
  }
  const root = safeLocalRoot();
  const localPath = resolve(root, key.replace(/^judicial-documents\//, ""));
  if (!localPath.startsWith(`${root}/`)) throw new Error("DOCUMENT_STORAGE_PATH_INVALID");
  await access(localPath, constants.R_OK);
  const bytes = await readFile(/* turbopackIgnore: true */ localPath);
  return { body: new Uint8Array(bytes), contentLength: bytes.byteLength };
}
