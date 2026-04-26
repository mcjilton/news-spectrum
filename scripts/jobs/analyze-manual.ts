import { getRuntimeModelProvider } from "../../lib/ai/runtime-provider.ts";
import { assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

async function main() {
  assertPrivateJobsEnabled("analyze:manual");
  printJobBudget();

  const provider = getRuntimeModelProvider();
  const result = await provider.generateText({
    task: "summarizeEvent",
    prompt: "Private analysis scaffold smoke test.",
  });

  console.log(result.metadata);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
