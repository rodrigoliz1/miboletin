import snapshot from "./directory-snapshot.json";

export interface JaliscoDirectoryGroup {
  name: string;
  entries: string[];
}

export const jaliscoDirectory = snapshot as {
  sourceUrl: string;
  verifiedAt: string;
  groups: JaliscoDirectoryGroup[];
  entryCount: number;
  sourceAssetSha256: string;
};

// El directorio interactivo conserva una versión anterior de estas adscripciones.
// Se complementa con el directorio institucional publicado en febrero de 2026.
export const jaliscoDirectoryAddendum = {
  sourceUrl: "https://cjj.gob.mx/files/transparencia/articulo8/fraccion1/ART08_FRACI_INCISOJ.pdf",
  verifiedAt: "2026-08-14",
  group: {
    name: "Juzgados familiares especializados y en línea (directorio institucional 2026)",
    entries: [
      "Juzgado Familiar Especializado en Violencia contra las Mujeres y Juicio en Línea del Trigésimo Primer Partido Judicial con sede en el Centro de Justicia para las Mujeres del Municipio de Tlajomulco de Zúñiga",
      "Juzgado Primero Familiar en Línea",
      "Juzgado Segundo Familiar en Línea",
    ],
  },
} as const;

export const jaliscoDirectoryGroups: JaliscoDirectoryGroup[] = [
  ...jaliscoDirectory.groups,
  { name: jaliscoDirectoryAddendum.group.name, entries: [...jaliscoDirectoryAddendum.group.entries] },
];

export const jaliscoDirectoryListingCount = jaliscoDirectory.entryCount + jaliscoDirectoryAddendum.group.entries.length;
