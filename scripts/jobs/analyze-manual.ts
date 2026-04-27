import crypto from "node:crypto";

import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled, printJobBudget } from "./guards.ts";

const PROMPT_VERSION = "cluster-title-token-v1";

type SourceSpectrum = "left" | "lean_left" | "center" | "lean_right" | "right" | "unknown";

type SourceRow = {
  id: string;
  name: string;
  spectrum: SourceSpectrum;
};

type ArticleRow = {
  id: string;
  source_id: string;
  url: string;
  title: string;
  published_at: string | null;
  fetched_at: string | null;
  sources: SourceRow | SourceRow[] | null;
};

type EventRow = {
  id: string;
  slug: string;
};

type Cluster = {
  articleIds: Set<string>;
  sourceIds: Set<string>;
  tokens: Set<string>;
  articles: ArticleRow[];
};

const stopWords = new Set([
  "about",
  "after",
  "again",
  "against",
  "amid",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "new",
  "of",
  "on",
  "over",
  "says",
  "the",
  "their",
  "to",
  "trump",
  "us",
  "with",
]);

function getSource(article: ArticleRow) {
  return Array.isArray(article.sources) ? article.sources[0] : article.sources;
}

function normalizeToken(token: string) {
  return token
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .trim();
}

function titleTokens(title: string) {
  return new Set(
    title
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  return intersection / (left.size + right.size - intersection);
}

function addArticle(cluster: Cluster, article: ArticleRow, tokens: Set<string>) {
  cluster.articleIds.add(article.id);
  cluster.sourceIds.add(article.source_id);
  cluster.articles.push(article);

  for (const token of tokens) {
    cluster.tokens.add(token);
  }
}

function clusterArticles(articles: ArticleRow[]) {
  const clusters: Cluster[] = [];

  for (const article of articles) {
    const tokens = titleTokens(article.title);
    let bestCluster: Cluster | null = null;
    let bestScore = 0;

    for (const cluster of clusters) {
      const score = jaccard(tokens, cluster.tokens);

      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestScore >= runtimeConfig.clusterSimilarityThreshold) {
      addArticle(bestCluster, article, tokens);
    } else {
      clusters.push({
        articleIds: new Set([article.id]),
        sourceIds: new Set([article.source_id]),
        tokens: new Set(tokens),
        articles: [article],
      });
    }
  }

  return clusters
    .filter(
      (cluster) =>
        cluster.articleIds.size >= runtimeConfig.minArticlesPerCluster &&
        cluster.sourceIds.size >= runtimeConfig.minSourcesPerCluster,
    )
    .sort((left, right) => right.articleIds.size - left.articleIds.size)
    .slice(0, runtimeConfig.maxEventsPerRun);
}

function articleTime(article: ArticleRow) {
  return article.published_at ?? article.fetched_at ?? new Date(0).toISOString();
}

function confidenceFor(cluster: Cluster) {
  const articleScore = Math.min(cluster.articleIds.size * 12, 48);
  const sourceScore = Math.min(cluster.sourceIds.size * 14, 42);
  return Math.min(90, 20 + articleScore + sourceScore);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function stableHash(values: string[]) {
  return crypto.createHash("sha1").update(values.sort().join("|")).digest("hex").slice(0, 8);
}

function candidateSlug(cluster: Cluster) {
  const newest = cluster.articles
    .map(articleTime)
    .sort()
    .at(-1)
    ?.slice(0, 10);
  const title = cluster.articles[0]?.title ?? "candidate-event";
  return `candidate-${newest ?? "undated"}-${slugify(title)}-${stableHash([...cluster.articleIds])}`;
}

function spectrumCounts(cluster: Cluster) {
  const counts: Record<SourceSpectrum, number> = {
    left: 0,
    lean_left: 0,
    center: 0,
    lean_right: 0,
    right: 0,
    unknown: 0,
  };

  for (const article of cluster.articles) {
    const source = getSource(article);
    counts[source?.spectrum ?? "unknown"] += 1;
  }

  return counts;
}

function timespan(cluster: Cluster) {
  const times = cluster.articles.map(articleTime).sort();
  return {
    firstSeenAt: times[0] ?? null,
    lastSeenAt: times.at(-1) ?? null,
  };
}

async function fetchCandidateArticles(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
) {
  const candidateLimit = runtimeConfig.maxEventsPerRun * runtimeConfig.maxArticlesPerEvent * 4;
  const { data: linkedRows, error: linkError } = await supabase
    .from("event_articles")
    .select("article_id");

  if (linkError) {
    throw new Error(`Existing event link read failed: ${linkError.message}`);
  }

  const linkedArticleIds = new Set(
    (linkedRows as Array<{ article_id: string }> | null)?.map((row) => row.article_id),
  );

  const { data, error } = await supabase
    .from("articles")
    .select("id,source_id,url,title,published_at,fetched_at,sources(id,name,spectrum)")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("fetched_at", { ascending: false, nullsFirst: false })
    .limit(candidateLimit);

  if (error) {
    throw new Error(`Article metadata read failed: ${error.message}`);
  }

  return ((data as ArticleRow[] | null) ?? []).filter(
    (article) => !linkedArticleIds.has(article.id),
  );
}

async function writeCandidateEvents(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  clusters: Cluster[],
) {
  if (clusters.length === 0) {
    return [];
  }

  const eventRows = clusters.map((cluster) => {
    const { firstSeenAt, lastSeenAt } = timespan(cluster);
    const sourceNames = [
      ...new Set(cluster.articles.map((article) => getSource(article)?.name).filter(Boolean)),
    ];

    return {
      slug: candidateSlug(cluster),
      title: cluster.articles[0]?.title ?? "Candidate event",
      topic: "Candidate",
      status: "monitoring",
      summary: "Candidate event grouped from recent article metadata. Awaiting LLM analysis.",
      confidence: confidenceFor(cluster),
      divergence: 0,
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      is_published: false,
      metadata: {
        candidate: true,
        analysisStage: "clustered",
        clusteringMethod: PROMPT_VERSION,
        sourceCount: cluster.sourceIds.size,
        articleCount: cluster.articleIds.size,
        sourceNames,
        spectrumCounts: spectrumCounts(cluster),
        sharedFacts: [],
        disputedOrVariable: [],
      },
    };
  });

  const { data, error } = await supabase
    .from("events")
    .upsert(eventRows, { onConflict: "slug" })
    .select("id,slug");

  if (error) {
    throw new Error(`Candidate event upsert failed: ${error.message}`);
  }

  const eventIdsBySlug = new Map((data as EventRow[] | null)?.map((event) => [event.slug, event.id]));
  const linkRows = clusters.flatMap((cluster) => {
    const eventId = eventIdsBySlug.get(candidateSlug(cluster));

    if (!eventId) {
      throw new Error(`Candidate event upsert did not return id for ${candidateSlug(cluster)}`);
    }

    return [...cluster.articleIds].slice(0, runtimeConfig.maxArticlesPerEvent).map((articleId) => ({
      event_id: eventId,
      article_id: articleId,
      relevance_score: 0.75,
    }));
  });

  const { error: linkError } = await supabase
    .from("event_articles")
    .upsert(linkRows, { onConflict: "event_id,article_id" });

  if (linkError) {
    throw new Error(`Candidate event link upsert failed: ${linkError.message}`);
  }

  return (data as EventRow[] | null) ?? [];
}

async function writeAnalysisRun(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  clusters: Cluster[],
  candidateEvents: EventRow[],
) {
  const articleIds = clusters.flatMap((cluster) => [...cluster.articleIds]);
  const inputHash = crypto.createHash("sha256").update(articleIds.sort().join("|")).digest("hex");
  const { error } = await supabase.from("analysis_runs").insert({
    event_id: candidateEvents[0]?.id ?? null,
    run_type: "candidate_clustering",
    status: "succeeded",
    provider: "deterministic",
    model: "title-token-similarity",
    prompt_version: PROMPT_VERSION,
    source_article_ids: articleIds,
    input_hash: inputHash,
    estimated_cost_usd: 0,
    output: {
      candidateEventCount: candidateEvents.length,
      clusterCount: clusters.length,
      minArticlesPerCluster: runtimeConfig.minArticlesPerCluster,
      minSourcesPerCluster: runtimeConfig.minSourcesPerCluster,
      similarityThreshold: runtimeConfig.clusterSimilarityThreshold,
    },
    finished_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Analysis run audit write failed: ${error.message}`);
  }
}

async function main() {
  assertManualAnalysisEnabled("analyze:manual");
  printJobBudget();

  const supabase = createServiceSupabaseClient();
  const candidateArticles = await fetchCandidateArticles(supabase);
  const clusters = clusterArticles(candidateArticles);
  const candidateEvents = await writeCandidateEvents(supabase, clusters);
  await writeAnalysisRun(supabase, clusters, candidateEvents);

  console.log(`Candidate articles read: ${candidateArticles.length}`);
  console.log(`Candidate clusters accepted: ${clusters.length}`);
  console.log(`Unpublished candidate events upserted: ${candidateEvents.length}`);
  console.log("No events were published and no LLM calls were made.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
