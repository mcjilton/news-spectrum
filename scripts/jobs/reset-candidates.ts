import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled } from "./guards.ts";

type CandidateRow = {
  id: string;
  slug: string;
};

async function main() {
  assertManualAnalysisEnabled("candidates:reset");

  const supabase = createServiceSupabaseClient();
  const { data: candidates, error: readError } = await supabase
    .from("events")
    .select("id,slug")
    .eq("is_published", false)
    .eq("metadata->>candidate", "true");

  if (readError) {
    throw new Error(`Candidate read failed: ${readError.message}`);
  }

  const rows = (candidates as CandidateRow[] | null) ?? [];

  if (rows.length === 0) {
    console.log("No unpublished candidate events to reset.");
    return;
  }

  const { error: deleteError } = await supabase
    .from("events")
    .delete()
    .eq("is_published", false)
    .eq("metadata->>candidate", "true");

  if (deleteError) {
    throw new Error(`Candidate reset failed: ${deleteError.message}`);
  }

  console.log(`Deleted unpublished candidate events: ${rows.length}`);
  console.log("Published events were not touched.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
