import { describe, expect, it } from "vitest";
import { readApiJson } from "@/lib/client/api-response";

describe("readApiJson", () => {
  it("lee una respuesta JSON válida", async () => {
    const response = Response.json({ ok: true });
    await expect(readApiJson<{ ok: boolean }>(response, "Falla")).resolves.toEqual({ ok: true });
  });

  it("conserva los errores públicos enviados por nuestras rutas", async () => {
    const response = Response.json({ error: "Revisa el nombre y el periodo" }, { status: 400 });
    await expect(readApiJson(response, "Falla")).rejects.toThrow("Revisa el nombre y el periodo");
  });

  it("no expone texto de error ni HTML devuelto por la plataforma", async () => {
    const response = new Response("An error occurred with this Function", { status: 500, headers: { "Content-Type": "text/plain" } });
    await expect(readApiJson(response, "Falla")).rejects.toThrow("El servicio no pudo completar la consulta");
    await expect(readApiJson(new Response("<html>Internal Server Error</html>", { status: 500 }), "Falla"))
      .rejects.not.toThrow(/Internal Server Error|Unexpected token/);
  });

  it("traduce un timeout sin perder el trabajo iniciado", async () => {
    const response = new Response("Gateway Timeout", { status: 504 });
    await expect(readApiJson(response, "Falla")).rejects.toThrow("El trabajo se conserva");
  });
});
