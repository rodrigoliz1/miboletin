import "./load-env";
import { dispatchSubscriptionLifecycleEmails } from "../src/lib/billing/retention";
import { closeDb } from "../src/lib/db/client";

void dispatchSubscriptionLifecycleEmails()
  .then((result) => console.log(JSON.stringify({ status: result.failed ? "partial" : "completed", ...result })))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
