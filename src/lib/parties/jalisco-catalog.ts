import { db } from "@/lib/db/client";
import { JaliscoProvider, type JaliscoCourtCatalogItem, type JaliscoCourtFamily } from "@/lib/providers/jalisco/provider";
import { syncSourceCatalog } from "./coverage";

function fallbackFamily(externalId: string, name: string, family?: JaliscoCourtFamily): JaliscoCourtFamily {
  if (family) return family;
  if (/^(?:C|M|OM|F)\d/i.test(externalId)) return "METROPOLITAN";
  if (/LABOR/i.test(name)) return "LABOR";
  if (/^(?:\d{2}P)/i.test(externalId) || /JUZGADO.+PENAL$/i.test(name)) return "TRADITIONAL_CRIMINAL";
  if (/ORAL|CONTROL|ENJUICIAMIENTO/i.test(name)) return "ORAL_CRIMINAL";
  return "FOREIGN";
}

async function storedJaliscoCatalog(): Promise<JaliscoCourtCatalogItem[]> {
  const rows = await db()`
    SELECT external_id, name, matter, group_name, metadata
    FROM judicial_source_catalog
    WHERE provider = 'jalisco-cjj' AND active
    ORDER BY normalized_name
  `;
  return rows.map((row): JaliscoCourtCatalogItem => {
    const metadata = (row.metadata ?? {}) as { family?: JaliscoCourtFamily };
    const name = String(row.name);
    const externalId = String(row.external_id);
    return {
      externalId, name, jurisdiction: "JALISCO",
      matter: row.matter ? String(row.matter) : "Civil",
      family: fallbackFamily(externalId, name, metadata.family),
      group: row.group_name ? String(row.group_name) : "Catálogo almacenado",
      searchable: true,
    };
  });
}

export async function loadJaliscoCatalog(): Promise<{ courts: JaliscoCourtCatalogItem[]; live: boolean; complete: boolean }> {
  const liveProvider = new JaliscoProvider();
  try {
    const liveCourts = await liveProvider.fetchCatalogs();
    const complete = liveCourts.length >= 190;
    await syncSourceCatalog(liveProvider.id, liveCourts, complete);
    if (complete) return { courts: liveCourts, live: true, complete: true };
    const storedCourts = await storedJaliscoCatalog();
    const merged = new Map(storedCourts.map((court) => [court.externalId, court]));
    for (const court of liveCourts) merged.set(court.externalId, court);
    return { courts: [...merged.values()], live: true, complete: false };
  } catch (error) {
    const courts = await storedJaliscoCatalog();
    if (!courts.length) throw error;
    return { courts, live: false, complete: false };
  }
}

export async function createIndexingJaliscoProvider() {
  const catalog = await loadJaliscoCatalog();
  return { ...catalog, provider: new JaliscoProvider(catalog.courts) };
}
