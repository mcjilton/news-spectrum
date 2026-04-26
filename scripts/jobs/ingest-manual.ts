import { assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

async function main() {
  assertPrivateJobsEnabled("ingest:manual");
  printJobBudget();
  console.log("Manual ingestion scaffold ready. No providers are wired yet.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
