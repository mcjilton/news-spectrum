import { runtimeConfig } from "../../lib/runtime-config.ts";

export function assertPrivateJobsEnabled(jobName: string) {
  if (runtimeConfig.disableLiveAnalysis) {
    throw new Error(
      `${jobName} blocked: DISABLE_LIVE_ANALYSIS is true. Keep this enabled until private job budgets and secrets are configured.`,
    );
  }

  if (runtimeConfig.dataMode === "seed") {
    throw new Error(
      `${jobName} blocked: DATA_MODE=seed. Use imported or live mode for private pipeline jobs.`,
    );
  }
}

export function printJobBudget() {
  console.log("Job budget caps:");
  console.log(`- max events per run: ${runtimeConfig.maxEventsPerRun}`);
  console.log(`- max articles per event: ${runtimeConfig.maxArticlesPerEvent}`);
  console.log(`- max LLM calls per run: ${runtimeConfig.maxLlmCallsPerRun}`);
  console.log(
    `- max estimated LLM cost per run: $${runtimeConfig.maxLlmEstimatedCostUsdPerRun}`,
  );
}
