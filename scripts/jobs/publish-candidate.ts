import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualPublishEnabled } from "./guards.ts";

type CandidateMetadata = {
  candidate?: boolean;
  analysisStage?: string;
  [key: string]: unknown;
};

type CandidateRow = {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  metadata: CandidateMetadata | null;
  event_articles: Array<{ article_id: string }>;
  claims: Array<{ id: string }>;
  frames: Array<{ id: string }>;
};

function slugArg() {
  const slug = process.argv[2]?.trim();

  if (!slug) {
    throw new Error("Usage: npm run publish:candidate -- <candidate-slug>");
  }

  return slug;
}

function assertPublishable(candidate: CandidateRow) {
  if (candidate.is_published) {
    throw new Error(`${candidate.slug} is already published.`);
  }

  if (candidate.metadata?.candidate !== true) {
    throw new Error(`${candidate.slug} is not marked as a candidate event.`);
  }

  if (candidate.metadata?.analysisStage !== "enriched") {
    throw new Error(
      `${candidate.slug} is not enriched. Current stage: ${candidate.metadata?.analysisStage ?? "unknown"}.`,
    );
  }

  if (candidate.event_articles.length === 0) {
    throw new Error(`${candidate.slug} has no linked articles.`);
  }

  if (candidate.claims.length === 0) {
    throw new Error(`${candidate.slug} has no claims.`);
  }

  if (candidate.frames.length === 0) {
    throw new Error(`${candidate.slug} has no frames.`);
  }
}

async function main() {
  assertManualPublishEnabled("publish:candidate");

  const slug = slugArg();
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select("id,slug,title,is_published,metadata,event_articles(article_id),claims(id),frames(id)")
    .eq("slug", slug)
    .single();

  if (error) {
    throw new Error(`Candidate lookup failed for ${slug}: ${error.message}`);
  }

  const candidate = data as CandidateRow;
  assertPublishable(candidate);

  const publishedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("events")
    .update({
      is_published: true,
      published_at: publishedAt,
      metadata: {
        ...(candidate.metadata ?? {}),
        analysisStage: "published",
        publishedBy: "manual-script",
        publishedAt,
      },
    })
    .eq("id", candidate.id)
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .eq("metadata->>analysisStage", "enriched");

  if (updateError) {
    throw new Error(`Candidate publish failed for ${slug}: ${updateError.message}`);
  }

  console.log(`Published candidate: ${candidate.slug}`);
  console.log(`Title: ${candidate.title}`);
  console.log(`Linked articles: ${candidate.event_articles.length}`);
  console.log(`Claims: ${candidate.claims.length}`);
  console.log(`Frames: ${candidate.frames.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
