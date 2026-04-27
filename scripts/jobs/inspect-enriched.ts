import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled } from "./guards.ts";

type SourceSpectrum = "left" | "lean_left" | "center" | "lean_right" | "right" | "unknown";

type SourceRow = {
  name: string;
  spectrum: SourceSpectrum;
};

type ArticleRow = {
  id: string;
  title: string;
  url: string;
  sources: SourceRow | SourceRow[] | null;
};

type EventArticleRow = {
  articles: ArticleRow | ArticleRow[] | null;
};

type ClaimRow = {
  claim_text: string;
  confidence: number;
  is_core_fact: boolean;
};

type FrameRow = {
  bucket: SourceSpectrum;
  label: string;
  summary: string;
  emphasis: string[] | null;
  language: string[] | null;
  source_article_ids: string[] | null;
};

type AnalysisRunRow = {
  run_type: string;
  status: string;
  provider: string;
  model: string;
  prompt_version: string;
  estimated_cost_usd: number;
  finished_at: string | null;
};

type EnrichedEventRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  confidence: number;
  divergence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  event_articles: EventArticleRow[];
  claims: ClaimRow[];
  frames: FrameRow[];
  analysis_runs: AnalysisRunRow[];
};

function getArticle(link: EventArticleRow) {
  return Array.isArray(link.articles) ? link.articles[0] : link.articles;
}

function getSource(article: ArticleRow) {
  return Array.isArray(article.sources) ? article.sources[0] : article.sources;
}

function formatDate(value: string | null) {
  if (!value) {
    return "unknown";
  }

  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatList(values: string[] | null) {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function articlesById(links: EventArticleRow[]) {
  return new Map(
    links
      .map(getArticle)
      .filter((article): article is ArticleRow => Boolean(article))
      .map((article) => [article.id, article]),
  );
}

async function main() {
  assertManualAnalysisEnabled("inspect:enriched");

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,summary,confidence,divergence,first_seen_at,last_seen_at,event_articles(articles(id,title,url,sources(name,spectrum))),claims(claim_text,confidence,is_core_fact),frames(bucket,label,summary,emphasis,language,source_article_ids),analysis_runs(run_type,status,provider,model,prompt_version,estimated_cost_usd,finished_at)",
    )
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .eq("metadata->>analysisStage", "enriched")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(runtimeConfig.maxEventsPerRun);

  if (error) {
    throw new Error(`Enriched candidate read failed: ${error.message}`);
  }

  const events = (data as EnrichedEventRow[] | null) ?? [];

  if (events.length === 0) {
    console.log("No unpublished enriched candidates found.");
    return;
  }

  console.log(`Unpublished enriched candidates: ${events.length}`);

  for (const [index, event] of events.entries()) {
    const articleMap = articlesById(event.event_articles ?? []);
    const articleRows = [...articleMap.values()];

    console.log("");
    console.log(`${index + 1}. ${event.title}`);
    console.log(`   slug: ${event.slug}`);
    console.log(`   confidence: ${event.confidence}; divergence: ${event.divergence}`);
    console.log(`   first seen: ${formatDate(event.first_seen_at)}`);
    console.log(`   last seen: ${formatDate(event.last_seen_at)}`);
    console.log(`   summary: ${event.summary ?? "none"}`);

    console.log("   claims:");
    for (const claim of event.claims ?? []) {
      const marker = claim.is_core_fact ? "core" : "supporting";
      console.log(`   - (${marker}, ${claim.confidence}) ${claim.claim_text}`);
    }

    console.log("   frames:");
    for (const frame of event.frames ?? []) {
      console.log(`   - [${frame.bucket}] ${frame.label}`);
      console.log(`     ${frame.summary}`);
      console.log(`     emphasis: ${formatList(frame.emphasis)}`);
      console.log(`     language: ${formatList(frame.language)}`);

      const frameArticles = (frame.source_article_ids ?? [])
        .map((articleId) => articleMap.get(articleId))
        .filter((article): article is ArticleRow => Boolean(article));

      for (const article of frameArticles) {
        const source = getSource(article);
        console.log(`     source: ${source?.name ?? "Unknown source"} - ${article.title}`);
      }
    }

    console.log("   source coverage:");
    for (const article of articleRows.slice(0, runtimeConfig.maxArticlesPerEvent)) {
      const source = getSource(article);
      console.log(`   - [${source?.spectrum ?? "unknown"}] ${source?.name ?? "Unknown source"}`);
      console.log(`     ${article.title}`);
      console.log(`     ${article.url}`);
    }

    console.log("   analysis runs:");
    for (const run of event.analysis_runs ?? []) {
      console.log(
        `   - ${run.run_type} ${run.status}; ${run.provider}/${run.model}; ${run.prompt_version}; $${run.estimated_cost_usd}; finished ${formatDate(run.finished_at)}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
