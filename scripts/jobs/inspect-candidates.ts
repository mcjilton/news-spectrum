import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled } from "./guards.ts";

type SpectrumBucket = "left" | "lean_left" | "center" | "lean_right" | "right" | "unknown";

type CandidateMetadata = {
  analysisStage?: string;
  articleCount?: number;
  sourceCount?: number;
  sourceNames?: string[];
  spectrumCounts?: Partial<Record<SpectrumBucket, number>>;
};

type SourceRow = {
  name: string;
  spectrum: SpectrumBucket;
  source_type: string;
};

type ArticleRow = {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  fetched_at: string | null;
  sources: SourceRow | SourceRow[] | null;
};

type CandidateRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  confidence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  metadata: CandidateMetadata | null;
  event_articles: Array<{
    relevance_score: number;
    articles: ArticleRow | ArticleRow[] | null;
  }>;
};

function getSource(article: ArticleRow) {
  return Array.isArray(article.sources) ? article.sources[0] : article.sources;
}

function getArticle(link: CandidateRow["event_articles"][number]) {
  return Array.isArray(link.articles) ? link.articles[0] : link.articles;
}

function formatDate(value: string | null) {
  if (!value) {
    return "unknown";
  }

  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatSpectrumCounts(counts: CandidateMetadata["spectrumCounts"]) {
  const values: Array<[string, number]> = [
    ["Left", (counts?.left ?? 0) + (counts?.lean_left ?? 0)],
    ["Center", counts?.center ?? 0],
    ["Right", (counts?.right ?? 0) + (counts?.lean_right ?? 0)],
    ["Unknown", counts?.unknown ?? 0],
  ];

  return values
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}: ${count}`)
    .join(" | ");
}

async function main() {
  assertManualAnalysisEnabled("inspect:candidates");

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,status,confidence,first_seen_at,last_seen_at,metadata,event_articles(relevance_score,articles(id,title,url,published_at,fetched_at,sources(name,spectrum,source_type)))",
    )
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(runtimeConfig.maxEventsPerRun);

  if (error) {
    throw new Error(`Candidate event read failed: ${error.message}`);
  }

  const candidates = (data as CandidateRow[] | null) ?? [];

  if (candidates.length === 0) {
    console.log("No unpublished candidate events found.");
    return;
  }

  console.log(`Unpublished candidate events: ${candidates.length}`);

  for (const [index, candidate] of candidates.entries()) {
    const metadata = candidate.metadata ?? {};
    const links = candidate.event_articles ?? [];
    const articles = links.map(getArticle).filter((article): article is ArticleRow => Boolean(article));
    const sourceNames = metadata.sourceNames?.join(", ") || "unknown";

    console.log("");
    console.log(`${index + 1}. ${candidate.title}`);
    console.log(`   slug: ${candidate.slug}`);
    console.log(`   status: ${candidate.status}; stage: ${metadata.analysisStage ?? "unknown"}`);
    console.log(
      `   articles: ${metadata.articleCount ?? articles.length}; sources: ${
        metadata.sourceCount ?? new Set(articles.map((article) => article.sources).filter(Boolean)).size
      }; confidence: ${candidate.confidence}`,
    );
    console.log(`   spectrum: ${formatSpectrumCounts(metadata.spectrumCounts) || "unknown"}`);
    console.log(`   first seen: ${formatDate(candidate.first_seen_at)}`);
    console.log(`   last seen: ${formatDate(candidate.last_seen_at)}`);
    console.log(`   source names: ${sourceNames}`);

    for (const article of articles.slice(0, runtimeConfig.maxArticlesPerEvent)) {
      const source = getSource(article);
      console.log(
        `   - [${source?.spectrum ?? "unknown"}] ${source?.name ?? "Unknown source"}: ${article.title}`,
      );
      console.log(`     ${article.url}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
