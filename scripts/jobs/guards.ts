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

export function assertManualPublishEnabled(jobName: string) {
  if (runtimeConfig.dataMode !== "imported") {
    throw new Error(
      `${jobName} blocked: DATA_MODE must be imported so published rows can be read through the Supabase public/RLS path.`,
    );
  }

  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    throw new Error(
      `${jobName} blocked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private publishing.`,
    );
  }
}

export function assertManualIngestionEnabled(jobName: string) {
  if (runtimeConfig.dataMode !== "imported") {
    throw new Error(
      `${jobName} blocked: DATA_MODE must be imported so discovered article metadata lands in the deployed database.`,
    );
  }

  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    throw new Error(
      `${jobName} blocked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private ingestion.`,
    );
  }
}

export function assertManualAnalysisEnabled(jobName: string) {
  if (runtimeConfig.dataMode !== "imported") {
    throw new Error(
      `${jobName} blocked: DATA_MODE must be imported so private candidate analysis writes to the deployed database.`,
    );
  }

  if (!runtimeConfig.supabaseUrl || !runtimeConfig.supabaseServiceRoleKey) {
    throw new Error(
      `${jobName} blocked: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for private analysis.`,
    );
  }
}

export function printJobBudget() {
  console.log("Job budget caps:");
  console.log(`- max events per run: ${runtimeConfig.maxEventsPerRun}`);
  console.log(`- max articles per event: ${runtimeConfig.maxArticlesPerEvent}`);
  console.log(`- max discovery queries per run: ${runtimeConfig.maxDiscoveryQueriesPerRun}`);
  console.log(`- max articles per discovery query: ${runtimeConfig.maxArticlesPerDiscoveryQuery}`);
  console.log(`- max articles per ingest run: ${runtimeConfig.maxArticlesPerIngestRun}`);
  console.log(`- min articles per cluster: ${runtimeConfig.minArticlesPerCluster}`);
  console.log(`- min sources per cluster: ${runtimeConfig.minSourcesPerCluster}`);
  console.log(`- cluster similarity threshold: ${runtimeConfig.clusterSimilarityThreshold}`);
  console.log(`- max LLM calls per run: ${runtimeConfig.maxLlmCallsPerRun}`);
  console.log(
    `- max estimated LLM cost per run: $${runtimeConfig.maxLlmEstimatedCostUsdPerRun}`,
  );
}
