export async function resilientFetch(input: RequestInfo | URL, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt < attempts - 1) await new Promise((resolve) => window.setTimeout(resolve, 350 * 2 ** attempt));
    }
  }
  throw new Error(lastError instanceof TypeError ? "La conexión cambió durante la consulta. Revisa tu red e inténtalo nuevamente." : "No fue posible conectar con el servidor.");
}
