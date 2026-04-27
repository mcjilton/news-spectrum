import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualPublishEnabled } from "./guards.ts";

type MockEventMetadata = {
  candidate?: boolean;
  enrichmentMethod?: string;
  publishedBy?: string;
};

type MockEventRow = {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  metadata: MockEventMetadata | null;
  analysis_runs: Array<{
    provider: string;
    prompt_version: string;
  }>;
};

function isMockResetTarget(event: MockEventRow) {
  const hasMockAnalysisRun = event.analysis_runs.some(
    (run) => run.provider === "mock" && run.prompt_version === "event-enrichment-v1",
  );

  return (
    event.metadata?.candidate === true &&
    event.metadata.enrichmentMethod === "event-enrichment-v1" &&
    event.metadata.publishedBy === "manual-script" &&
    event.title.startsWith("Mock enriched") &&
    hasMockAnalysisRun
  );
}

async function main() {
  assertManualPublishEnabled("mock:reset");

  const supabase = createServiceSupabaseClient();
  const { data, error: readError } = await supabase
    .from("events")
    .select("id,slug,title,is_published,metadata,analysis_runs(provider,prompt_version)")
    .eq("metadata->>candidate", "true")
    .eq("metadata->>enrichmentMethod", "event-enrichment-v1")
    .eq("metadata->>publishedBy", "manual-script");

  if (readError) {
    throw new Error(`Mock event read failed: ${readError.message}`);
  }

  const events = ((data as MockEventRow[] | null) ?? []).filter(isMockResetTarget);

  if (events.length === 0) {
    console.log("No mock-published candidate events to reset.");
    return;
  }

  const ids = events.map((event) => event.id);
  const { error: deleteError } = await supabase.from("events").delete().in("id", ids);

  if (deleteError) {
    throw new Error(`Mock reset failed: ${deleteError.message}`);
  }

  for (const event of events) {
    console.log(`Deleted mock event: ${event.slug}`);
  }

  console.log(`Deleted mock-published candidate events: ${events.length}`);
  console.log("Seed events and non-mock events were not touched.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
