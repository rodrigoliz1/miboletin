import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "@/lib/domain/normalization";
import { retrieveJudicialDocument, storeJudicialDocument } from "@/lib/storage/judicial-documents";

let temporaryDirectory: string | undefined;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => { delete process.env.BLOB_READ_WRITE_TOKEN; });

afterEach(async () => {
  delete process.env.JUDICIAL_DOCUMENTS_DIR;
  if (originalBlobToken) process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  else delete process.env.BLOB_READ_WRITE_TOKEN;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("private judicial document storage", () => {
  it("stores one deterministic local object and reads it through the abstraction", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "mi-boletin-documents-"));
    process.env.JUDICIAL_DOCUMENTS_DIR = temporaryDirectory;
    const bytes = Buffer.from("%PDF-1.7\nverified");
    const stored = await storeJudicialDocument({ sha256: sha256(bytes), bytes });
    expect(stored).toMatchObject({ provider: "LOCAL", key: expect.stringMatching(/^judicial-documents\/[a-f0-9]{64}\.pdf$/) });
    const retrieved = await retrieveJudicialDocument({ provider: stored.provider, key: stored.key });
    expect(Buffer.from(await new Response(retrieved.body).arrayBuffer())).toEqual(bytes);
  });

  it("rejects arbitrary storage paths", async () => {
    await expect(retrieveJudicialDocument({ provider: "LOCAL", key: "../../secret" })).rejects.toThrow("DOCUMENT_STORAGE_KEY_INVALID");
  });
});
