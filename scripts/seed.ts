import "./load-env";
import { createAccount } from "../src/lib/product/repository";
import { closeDb } from "../src/lib/db/client";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Administrador";
  const organization = process.env.SEED_ORGANIZATION_NAME ?? "Mi organización";
  if (!email || !password) throw new Error("Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD; no existen credenciales predeterminadas.");
  await createAccount({ email: email.toLowerCase().trim(), password, name, organization });
  await closeDb();
  console.log(`Cuenta inicial creada para ${email}.`);
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
