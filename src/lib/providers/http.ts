import { ProviderError } from "@/lib/domain/types";

const defaultAgent = "MiBoletinJudicial/1.0 (source monitoring; low frequency)";

export async function respectfulFetch(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json,text/html;q=0.9,*/*;q=0.7",
          "User-Agent": process.env.SOURCE_USER_AGENT ?? defaultAgent,
          ...init.headers,
        },
      });
      clearTimeout(timeout);
      if (response.status === 429 || response.status >= 500) {
        if (attempt === attempts - 1) throw new ProviderError("SOURCE_UNAVAILABLE", `La fuente respondió HTTP ${response.status}`, true);
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt + Math.floor(Math.random() * 150)));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt + Math.floor(Math.random() * 150)));
    }
  }
  if (lastError instanceof ProviderError) throw lastError;
  const isAbort = lastError instanceof Error && lastError.name === "AbortError";
  throw new ProviderError(isAbort ? "TIMEOUT" : "SOURCE_UNAVAILABLE", isAbort ? "La fuente excedió 15 segundos" : "No fue posible conectar con la fuente", true);
}
