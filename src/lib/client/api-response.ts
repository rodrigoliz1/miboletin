type ErrorPayload = { error?: unknown };

function statusMessage(status: number, fallback: string): string {
  if (status === 401) return "Tu sesión terminó. Inicia sesión nuevamente para continuar.";
  if (status === 402 || status === 403) return "Tu cuenta no tiene acceso a esta función.";
  if (status === 408 || status === 504) return "La consulta tardó más de lo esperado. El trabajo se conserva y puedes volver a revisarlo en unos momentos.";
  if (status === 429) return "Hay varias consultas en curso. Espera un momento antes de intentarlo nuevamente.";
  if (status >= 500) return "El servicio no pudo completar la consulta en este momento. Inténtalo nuevamente en unos instantes.";
  return fallback;
}

/**
 * Lee respuestas de la API sin exponer HTML, texto de plataforma ni errores de
 * JSON.parse en la interfaz. Los mensajes JSON creados por nuestras rutas sí se
 * conservan porque ya son textos públicos y localizados.
 */
export async function readApiJson<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(statusMessage(response.status, fallback));
    }
  }

  if (!response.ok) {
    const error = payload && typeof payload === "object" && typeof (payload as ErrorPayload).error === "string"
      ? String((payload as ErrorPayload).error).trim()
      : "";
    throw new Error(error || statusMessage(response.status, fallback));
  }
  if (payload === undefined) throw new Error(fallback);
  return payload as T;
}
