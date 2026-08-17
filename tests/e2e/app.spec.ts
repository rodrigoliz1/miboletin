import { expect, test, type Page } from "@playwright/test";

async function chooseOption(page: Page, label: string, query: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("textbox", { name: new RegExp(`Buscar ${label}`, "i") }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

test("registro, carpetas y alta persistente de asunto de Jalisco", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  const email = `audit-${testInfo.project.name}-${Date.now()}@example.test`;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tus asuntos. Revisados a diario." })).toBeVisible();
  await page.goto("/register");
  await page.getByLabel("Nombre completo").fill("Auditoría Codex");
  await page.getByLabel("Despacho u organización").fill("Despacho de Prueba");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Auditoria!2026");
  await page.getByRole("button", { name: "Continuar al pago seguro" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto("/cases");
  await page.getByLabel("Nueva carpeta").fill("Amparos estratégicos");
  await page.getByRole("button", { name: "Crear carpeta" }).click();
  await expect(page.getByRole("heading", { name: "Amparos estratégicos" })).toBeVisible();

  await page.goto("/cases/new?jurisdiction=JALISCO");
  await chooseOption(page, "Órgano jurisdiccional", "quinto mercantil", /Juzgado Quinto de lo Mercantil/i);
  await page.getByLabel("Número de expediente").fill("1511/2025");
  await page.getByLabel("Tipo de asunto").fill("Mercantil");
  await chooseOption(page, "Carpetas", "amparos", /Amparos estratégicos/i);
  await page.getByRole("button", { name: "Listo" }).click();
  await page.getByLabel("Referencia interna opcional").fill("Auditoría E2E");
  const saveStartedAt = Date.now();
  await page.getByRole("button", { name: "Guardar y comenzar vigilancia" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]+\?created=1$/);
  const localCaseUrl = page.url();
  expect(Date.now() - saveStartedAt, "el alta debe terminar sin esperar el rastreo histórico").toBeLessThan(10_000);
  await expect(page.getByRole("heading", { name: /1511\/2025/ })).toBeVisible();
  await expect(page.getByText("Resolución publicada").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/20 publicaciones/)).toBeVisible();
  await expect(page.getByText("General · Amparos estratégicos")).toBeVisible();
  await expect(page.getByRole("link", { name: /Contrastar en la fuente oficial/i })).toHaveCount(0);

  const emptyFolderResponse = await page.goto("/dashboard?from=2025-01-01&to=2026-12-31&folder=");
  expect(emptyFolderResponse?.ok(), "el filtro sin carpeta no debe intentar convertir una cadena vacía a UUID").toBeTruthy();
  await expect(page.locator("body")).not.toContainText("invalid input syntax for type uuid");
  await page.goto("/dashboard?from=fecha-invalida&to=2026-08-01&folder=no-es-uuid");
  await expect(page.getByText("Periodo ajustado.")).toBeVisible();
  await page.getByRole("button", { name: "Ampliar Autos y acuerdos" }).click();
  await expect(page.getByRole("button", { name: "Cerrar vista ampliada de Autos y acuerdos" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Abrir asistente de Mi Boletín" }).click();
  await expect(page.getByRole("dialog", { name: "Asistente de Mi Boletín" })).toBeVisible();
  const mobileHistory = page.getByRole("button", { name: "Ver conversaciones" });
  if (await mobileHistory.isVisible()) await mobileHistory.click();
  await page.getByRole("button", { name: "Nuevo chat" }).last().click();
  await expect(page.getByRole("button", { name: /^Nueva conversación/ })).toBeVisible();
  const deleteChat = page.getByRole("button", { name: "Eliminar Nueva conversación" });
  await deleteChat.click();
  await page.getByRole("button", { name: "Confirmar eliminación de Nueva conversación" }).click();
  await expect(page.getByText("Tus conversaciones aparecerán aquí.")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar asistente" }).last().click();

  for (const path of ["/dashboard", "/cases", "/search", "/courts", "/alerts", "/settings", "/admin", "/coverage", "/status"]) {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} debe responder correctamente`).toBeTruthy();
    await expect(page.locator("body")).not.toContainText("Application error");
  }
  await page.goto("/search?expediente=1511%2F2025&court=M05");
  await page.getByRole("combobox", { name: "Órgano jurisdiccional" }).click();
  await page.getByRole("textbox", { name: /Buscar órgano jurisdiccional/i }).fill("quinto mercantil");
  await expect(page.getByRole("option", { name: /Juzgado Quinto de lo Mercantil/i }).first()).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await page.goto(localCaseUrl);
  await page.getByRole("button", { name: "Eliminar asunto" }).click();
  await page.getByRole("button", { name: "Sí, eliminar" }).click();
  await expect(page).toHaveURL(/\/cases\?removed=1$/);
  await expect(page.getByText("Asunto eliminado.")).toBeVisible();
  expect(browserErrors).toEqual([]);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("alta federal muestra acuerdos, listado y resultado reales", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `federal-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre completo").fill("Auditoría Federal");
  await page.getByLabel("Despacho u organización").fill("Despacho Federal");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Auditoria!2026");
  await page.getByRole("button", { name: "Continuar al pago seguro" }).click();
  await page.goto("/cases/new?jurisdiction=FEDERAL&circuit=3");
  await chooseOption(page, "Órgano jurisdiccional", "119", /Primer Tribunal Colegiado en Materia Civil/i);
  await page.getByLabel("Número de expediente").fill("461/2024");
  await chooseOption(page, "Tipo de asunto", "amparo directo", /^Amparo Directo$/i);
  const saveStartedAt = Date.now();
  await page.getByRole("button", { name: "Guardar y comenzar vigilancia" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]+\?created=1$/);
  expect(Date.now() - saveStartedAt, "el alta federal no debe esperar el calendario completo").toBeLessThan(10_000);
  await expect(page.getByText("Resolución publicada").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Listados a sesión / sesiones" })).toBeVisible();
  await expect(page.getByText("Listado para sesión").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/14 de agosto de 2026/).first()).toBeVisible();
  await expect(page.getByText(/No ampara/i).first()).toBeVisible();
});
