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
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /maximum-scale=1/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /user-scalable=no/);
  await expect(page.getByRole("heading", { name: "El boletín, bajo control." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Solicitar información por WhatsApp" })).toHaveAttribute("href", /wa\.me\/526692122543/);
  await page.goto("/register");
  await page.getByLabel("Nombre completo").fill("Auditoría Codex");
  await page.getByLabel("Despacho u organización").fill("Despacho de Prueba");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Auditoria!2026");
  await page.getByRole("button", { name: "Crear cuenta y verificar correo" }).click();
  await expect(page).toHaveURL(/\/verify-email\?sent=1$/);
  await page.getByLabel("Código de verificación").fill("123456");
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  await expect(page).toHaveURL(/\/dashboard\?verified=1$/);

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
  expect(Date.now() - saveStartedAt, "el alta debe terminar sin esperar el rastreo histórico").toBeLessThan(15_000);
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
  await page.getByRole("button", { name: "Ampliar Boletín de Resoluciones" }).click();
  await expect(page.getByRole("button", { name: "Cerrar vista ampliada de Boletín de Resoluciones" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Abrir asistente de Mi Boletín" }).click();
  await expect(page.getByRole("dialog", { name: "Asistente de Mi Boletín" })).toBeVisible();
  const mobileHistory = page.getByRole("button", { name: "Ver conversaciones" });
  if (await mobileHistory.isVisible()) await mobileHistory.click();
  await expect(page.getByText("Tus conversaciones aparecerán aquí.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Nuevo chat" }).last().click();
  await expect(page.getByRole("button", { name: /^Nueva conversación/ })).toBeVisible({ timeout: 15_000 });
  const deleteChat = page.getByRole("button", { name: "Eliminar Nueva conversación" });
  await deleteChat.click();
  await page.getByRole("button", { name: "Confirmar eliminación de Nueva conversación" }).click();
  await expect(page.getByText("Tus conversaciones aparecerán aquí.")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Cerrar asistente" }).last().click();

  await page.reload();
  const longConversationId = "11111111-1111-4111-8111-111111111111";
  const now = new Date().toISOString();
  const longMessages = Array.from({ length: 36 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: index === 17
      ? `Texto oficial extenso ${"EXPEDIENTE-SIN-ESPACIOS-".repeat(22)}`
      : `Mensaje ${index + 1}. Revisión del expediente y sus publicaciones oficiales.`,
    createdAt: now,
  }));
  await page.route("**/api/assistant/conversations**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && pathname === "/api/assistant/conversations") {
      await route.fulfill({ json: { ok: true, configured: true, conversations: [{ id: longConversationId, title: "Conversación extensa", createdAt: now, updatedAt: now }] } });
      return;
    }
    if (route.request().method() === "GET" && pathname === `/api/assistant/conversations/${longConversationId}`) {
      await route.fulfill({ json: { ok: true, messages: longMessages } });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Abrir asistente de Mi Boletín" }).click();
  const assistantDrawer = page.getByRole("dialog", { name: "Asistente de Mi Boletín" });
  const messageViewport = page.getByRole("log", { name: "Mensajes de la conversación" });
  await expect(page.getByText("Mensaje 36.")).toBeVisible({ timeout: 15_000 });
  const drawerBeforeScroll = await assistantDrawer.boundingBox();
  const overflow = await messageViewport.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY }));
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  expect(overflow.overflowY).toBe("auto");
  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.getByLabel("Mensaje para el asistente")).toHaveCSS("font-size", "16px");
  }
  await messageViewport.hover();
  await page.mouse.wheel(0, -900);
  const drawerAfterScroll = await assistantDrawer.boundingBox();
  expect(drawerAfterScroll).toEqual(drawerBeforeScroll);
  await expect(page.getByLabel("Mensaje para el asistente")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar asistente" }).last().click();
  await page.unroute("**/api/assistant/conversations**");

  for (const path of ["/dashboard", "/cases", "/search", "/courts", "/alerts", "/settings", "/admin", "/coverage", "/status"]) {
    const response = await page.goto(path);
    expect(response?.ok(), `${path} debe responder correctamente`).toBeTruthy();
    await expect(page.locator("body")).not.toContainText("Application error");
  }
  await page.goto("/search?scope=JALISCO&mode=CASE&q=1511%2F2025&court=M05");
  await page.getByRole("combobox", { name: "Órgano jurisdiccional" }).click();
  await page.getByRole("textbox", { name: /Buscar órgano jurisdiccional/i }).fill("quinto mercantil");
  await expect(page.getByRole("option", { name: /Juzgado Quinto de lo Mercantil/i }).first()).toBeVisible();
  await expect(page.locator("select")).toHaveCount(0);
  await page.goto("/courts");
  await expect(page.getByRole("link", { name: /Consultar expediente/i }).first()).toHaveAttribute("href", /scope=JALISCO&court=/);
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

test("recuperación de contraseña con OTP e invalidación segura", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const email = `recovery-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre completo").fill("Recuperación E2E");
  await page.getByLabel("Despacho u organización").fill("Cuenta de Recuperación");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Auditoria!2026");
  await page.getByRole("button", { name: "Crear cuenta y verificar correo" }).click();
  await page.getByLabel("Código de verificación").fill("123456");
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  await expect(page).toHaveURL(/\/dashboard\?verified=1$/);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();

  await page.getByRole("link", { name: "Olvidé mi contraseña" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel("Correo electrónico").fill(email);
  const [recoveryResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/auth/forgot-password")),
    page.getByRole("button", { name: "Enviar código" }).click(),
  ]);
  expect(recoveryResponse.status()).toBe(303);
  await expect(page).toHaveURL(/\/forgot-password\?sent=1$/);
  await page.getByLabel("Código de recuperación").fill("654321");
  await page.getByLabel("Nueva contraseña").fill("NuevaAuditoria!2026");
  await page.getByLabel("Confirmar contraseña").fill("NuevaAuditoria!2026");
  await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
  await expect(page).toHaveURL(/\/login\?reset=1$/);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("NuevaAuditoria!2026");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("alta federal muestra acuerdos, listado y resultado reales", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const email = `federal-${testInfo.project.name}-${Date.now()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Nombre completo").fill("Auditoría Federal");
  await page.getByLabel("Despacho u organización").fill("Despacho Federal");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Auditoria!2026");
  await page.getByRole("button", { name: "Crear cuenta y verificar correo" }).click();
  await expect(page).toHaveURL(/\/verify-email\?sent=1$/);
  await page.getByLabel("Código de verificación").fill("123456");
  await page.getByRole("button", { name: "Verificar y continuar" }).click();
  await expect(page).toHaveURL(/\/dashboard\?verified=1$/);
  await page.goto("/cases/new?jurisdiction=FEDERAL&circuit=3");
  await chooseOption(page, "Órgano jurisdiccional", "119", /Primer Tribunal Colegiado en Materia Civil/i);
  await page.getByLabel("Número de expediente").fill("461/2024");
  await chooseOption(page, "Tipo de asunto", "amparo directo", /^Amparo Directo$/i);
  const saveStartedAt = Date.now();
  await page.getByRole("button", { name: "Guardar y comenzar vigilancia" }).click();
  await expect(page).toHaveURL(/\/cases\/[0-9a-f-]+\?created=1$/);
  expect(Date.now() - saveStartedAt, "el alta federal no debe esperar el calendario completo").toBeLessThan(15_000);
  await expect(page.getByText("Resolución publicada").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Listados a sesión / sesiones" })).toBeVisible();
  await expect(page.getByText("Listado para sesión").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/14 de agosto de 2026/).first()).toBeVisible();
  await expect(page.getByText(/No ampara/i).first()).toBeVisible();
});
