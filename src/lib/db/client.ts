import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  if (process.env.NODE_ENV === "production") {
    const parsed = new URL(url);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !["require", "verify-ca", "verify-full"].includes(parsed.searchParams.get("sslmode") ?? "")) {
      throw new Error("DATABASE_URL debe usar PostgreSQL con TLS en producción");
    }
  }
  client ??= postgres(url, {
    max: Number(process.env.DB_POOL_SIZE ?? (process.env.NODE_ENV === "production" ? 2 : 10)),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    transform: { undefined: null },
  });
  return client;
}

export async function closeDb() {
  if (client) await client.end({ timeout: 5 });
  client = null;
}
