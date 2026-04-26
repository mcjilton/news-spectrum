import { assertPrivateJobsEnabled } from "./guards.ts";

async function main() {
  assertPrivateJobsEnabled("publish:manual");
  console.log("Manual publish scaffold ready. No database writes are wired yet.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
