import "./load-env";
import { providers } from "../src/lib/providers";

async function main() {
  for (const provider of Object.values(providers)) {
    const health = await provider.healthCheck();
    console.log(JSON.stringify(health));
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
