import { ProviderError } from "@/lib/domain/types";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { DetailedPeerCertificate, TLSSocket } from "node:tls";

const defaultAgent = "MiBoletinJudicial/1.0 (source monitoring; low frequency)";
const dgejHost = "www.dgej.cjf.gob.mx";
const dgejExpiredCertificateFingerprint = "82:B6:FC:21:E4:68:6A:C4:FC:98:AF:B8:D7:CD:E9:0F:1D:40:51:BA:17:02:06:5C:9F:57:F4:4A:FE:FC:19:61";
const dgejExpiredCertificateGraceMs = 7 * 24 * 60 * 60 * 1000;
// TLS session resumption can omit the peer certificate in Node. Disabling the
// session cache ensures every exceptional request revalidates the pinned leaf.
const dgejPinnedAgent = new HttpsAgent({ keepAlive: false, maxCachedSessions: 0 });

type NetworkError = Error & { code?: string; cause?: unknown };

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const direct = (error as NetworkError).code;
  if (direct) return direct;
  const cause = (error as NetworkError).cause;
  return cause instanceof Error ? (cause as NetworkError).code : undefined;
}

function isExpiredCertificateError(error: unknown): boolean {
  return errorCode(error) === "CERT_HAS_EXPIRED";
}

function certificateAllowsTemporaryDgejAccess(certificate: DetailedPeerCertificate): boolean {
  const fingerprintMatches = certificate.fingerprint256?.toUpperCase() === dgejExpiredCertificateFingerprint;
  const dnsMatches = certificate.subjectaltname?.split(",").some((entry) => entry.trim().toLowerCase() === `dns:${dgejHost}`) === true;
  const expiresAt = Date.parse(certificate.valid_to);
  const now = Date.now();
  return fingerprintMatches && dnsMatches && Number.isFinite(expiresAt) && now >= expiresAt && now <= expiresAt + dgejExpiredCertificateGraceMs;
}

function requestBody(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  throw new ProviderError("SOURCE_UNAVAILABLE", "La solicitud oficial usa un cuerpo no compatible con la conexión verificada", true);
}

/**
 * Temporary, narrowly scoped bridge for the DGEJ certificate that expired on
 * 2026-08-23. TLS remains encrypted and the exact leaf certificate, DNS name
 * and short grace period are all verified before any response is accepted.
 * A renewed certificate goes through the regular fetch path and this branch
 * becomes unreachable automatically.
 */
async function fetchDgejWithPinnedExpiredCertificate(url: URL, init: RequestInit): Promise<Response> {
  if (url.protocol !== "https:" || url.hostname !== dgejHost) {
    throw new ProviderError("SOURCE_UNAVAILABLE", "La excepción temporal de certificado no aplica a esta fuente", false);
  }
  const body = requestBody(init.body);
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = httpsRequest(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      rejectUnauthorized: false,
      servername: dgejHost,
      agent: dgejPinnedAgent,
    }, (response) => {
      const socket = response.socket as TLSSocket;
      const certificate = socket.getPeerCertificate(true);
      if (!certificateAllowsTemporaryDgejAccess(certificate)) {
        response.resume();
        finishReject(new ProviderError(
          "SOURCE_UNAVAILABLE",
          "El certificado temporal de la fuente federal no coincide con la identidad verificada",
          false,
        ));
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("error", finishReject);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(key, entry));
          else if (value !== undefined) headers.set(key, String(value));
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502, statusText: response.statusMessage, headers }));
      });
    });
    request.on("error", finishReject);
    const abort = () => request.destroy(new DOMException("Aborted", "AbortError"));
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
    if (body !== undefined) request.write(body);
    request.end();
  });
}

async function secureSourceFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const parsed = new URL(url);
    if (parsed.hostname === dgejHost && isExpiredCertificateError(error)) {
      return fetchDgejWithPinnedExpiredCertificate(parsed, init);
    }
    throw error;
  }
}

export async function respectfulFetch(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await secureSourceFetch(url, {
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
  const code = errorCode(lastError);
  const message = isAbort
    ? "La fuente excedió 15 segundos"
    : code === "CERT_HAS_EXPIRED"
      ? "La fuente federal presenta un certificado HTTPS vencido"
      : "No fue posible conectar con la fuente";
  throw new ProviderError(isAbort ? "TIMEOUT" : "SOURCE_UNAVAILABLE", message, true);
}
