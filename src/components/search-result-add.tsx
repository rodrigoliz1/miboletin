"use client";

import { SearchableMultiSelect } from "@/components/searchable-multi-select";
import type { FolderRecord } from "@/lib/product/repository";

export function SearchResultAdd({ payload, token, folders }: { payload: string; token: string; folders: FolderRecord[] }) {
  return <form action="/api/search/add" method="post" className="search-result-add">
    <input type="hidden" name="payload" value={payload} />
    <input type="hidden" name="token" value={token} />
    <SearchableMultiSelect name="folders" label="Agregar a carpetas" options={folders.map((folder) => ({ value: folder.id, label: folder.name, group: "Carpetas", description: `${folder.caseCount} asuntos` }))} defaultValues={folders[0] ? [folders[0].id] : []} required searchPlaceholder="Buscar carpeta…" />
    <button className="button button-primary button-small" type="submit">Agregar a seguimiento</button>
  </form>;
}
