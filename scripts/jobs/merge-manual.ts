import crypto from "node:crypto";

import { getRuntimeModelProvider } from "../../lib/ai/runtime-provider.ts";
import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled, assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

const PROMPT_VERSION = "cluster-merge-decision-v1";
const mergeConfidenceThreshold = 85;
const maxPairWindowMs = 48 * 60 * 60 * 1000;

type SourceSpectrum = "left" | "lean_left" | "center" | "lean_right" | "right" | "unknown";

type SourceRow = {
  name: string;
  spectrum: SourceSpectrum;
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
  summary: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
  event_articles: Array<{
    articles: ArticleRow | ArticleRow[] | null;
  }>;
};

type MergeDecision = {
  sameEvent: boolean;
  confidence: number;
  reason: string;
  canonicalTitle: string;
  mergeStrategy: "merge" | "keep_separate";
};

function parseOptions() {
  return {
    dryRun: process.argv.includes("--dry-run"),
  };
}

function firstRelated<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getArticle(link: CandidateRow["event_articles"][number]) {
  return firstRelated(link.articles);
}

function getSource(article: ArticleRow) {
  return firstRelated(article.sources);
}

function articleTime(article: ArticleRow) {
  return article.published_at ?? article.fetched_at ?? new Date(0).toISOString();
}

function candidateArticles(candidate: CandidateRow) {
  return candidate.event_articles
    .map(getArticle)
    .filter((article): article is ArticleRow => Boolean(article));
}

function candidateSourceNames(candidate: CandidateRow) {
  return [
    ...new Set(
      candidateArticles(candidate)
        .map((article) => getSource(article)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

function overlapWindow(left: CandidateRow, right: CandidateRow) {
  if (!left.first_seen_at || !right.first_seen_at) {
    return true;
  }

  const leftStart = new Date(left.first_seen_at).getTime();
  const leftEnd = new Date(left.last_seen_at ?? left.first_seen_at).getTime();
  const rightStart = new Date(right.first_seen_at).getTime();
  const rightEnd = new Date(right.last_seen_at ?? right.first_seen_at).getTime();

  if ([leftStart, leftEnd, rightStart, rightEnd].some(Number.isNaN)) {
    return true;
  }

  return leftStart <= rightEnd + maxPairWindowMs && rightStart <= leftEnd + maxPairWindowMs;
}

function tokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4),
  );
}

function sharedTokenCount(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  let count = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      count += 1;
    }
  }

  return count;
}

function shouldAdjudicate(left: CandidateRow, right: CandidateRow) {
  const leftSmall = candidateArticles(left).length <= 3;
  const rightSmall = candidateArticles(right).length <= 3;
  return overlapWindow(left, right) && (leftSmall || rightSmall || sharedTokenCount(left.title, right.title) >= 2);
}

function buildPrompt(left: CandidateRow, right: CandidateRow) {
  const compactCandidate = (candidate: CandidateRow) => ({
    slug: candidate.slug,
    title: candidate.title,
    summary: candidate.summary,
    sourceNames: candidateSourceNames(candidate),
    firstSeenAt: candidate.first_seen_at,
    lastSeenAt: candidate.last_seen_at,
    articles: candidateArticles(candidate).map((article) => {
      const source = getSource(article);

      return {
        id: article.id,
        title: article.title,
        outlet: source?.name ?? "Unknown source",
        spectrum: source?.spectrum ?? "unknown",
        url: article.url,
        observedAt: articleTime(article),
      };
    }),
  });

  return JSON.stringify(
    {
      task: "Decide whether these two candidate clusters describe the same real-world news event.",
      mergeThreshold: mergeConfidenceThreshold,
      constraints: [
        "Use only the metadata provided.",
        "Return sameEvent true only if the clusters describe the same incident or directly connected substory.",
        "Keep separate if one cluster is merely a broad related theme or a later unrelated event.",
        "If sameEvent is true and confidence is at least the threshold, mergeStrategy must be merge.",
        "Otherwise mergeStrategy must be keep_separate.",
      ],
      left: compactCandidate(left),
      right: compactCandidate(right),
    },
    null,
    2,
  );
}

function validateDecision(value: MergeDecision) {
  const errors: string[] = [];

  if (typeof value.sameEvent !== "boolean") {
    errors.push("sameEvent must be boolean");
  }

  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 100) {
    errors.push("confidence must be 0-100");
  }

  if (typeof value.reason !== "string" || !value.reason.trim()) {
    errors.push("reason must be a non-empty string");
  }

  if (typeof value.canonicalTitle !== "string" || !value.canonicalTitle.trim()) {
    errors.push("canonicalTitle must be a non-empty string");
  }

  if (value.mergeStrategy !== "merge" && value.mergeStrategy !== "keep_separate") {
    errors.push("mergeStrategy must be merge or keep_separate");
  }

  if (value.mergeStrategy === "merge" && (!value.sameEvent || value.confidence < mergeConfidenceThreshold)) {
    errors.push("merge decisions require sameEvent=true and high confidence");
  }

  return errors;
}

async function fetchCandidates(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,summary,first_seen_at,last_seen_at,metadata,event_articles(articles(id,title,url,published_at,fetched_at,sources(name,spectrum)))",
    )
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .in("metadata->>analysisStage", ["clustered", "enriched"])
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(runtimeConfig.maxEventsPerRun);

  if (error) {
    throw new Error(`Candidate read failed: ${error.message}`);
  }

  return (data as CandidateRow[] | null) ?? [];
}

async function applyMerge(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  keeper: CandidateRow,
  absorbed: CandidateRow,
  decision: MergeDecision,
) {
  const keeperArticleIds = new Set(candidateArticles(keeper).map((article) => article.id));
  const newLinks = candidateArticles(absorbed)
    .filter((article) => !keeperArticleIds.has(article.id))
    .map((article) => ({
      event_id: keeper.id,
      article_id: article.id,
      relevance_score: 0.7,
    }));

  if (newLinks.length > 0) {
    const { error: linkError } = await supabase
      .from("event_articles")
      .upsert(newLinks, { onConflict: "event_id,article_id" });

    if (linkError) {
      throw new Error(`Merge link upsert failed: ${linkError.message}`);
    }
  }

  const mergedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("events")
    .update({
      title: decision.canonicalTitle || keeper.title,
      metadata: {
        ...(keeper.metadata ?? {}),
        mergeReviewedAt: mergedAt,
        mergedCandidateSlugs: [
          ...new Set([
            ...(((keeper.metadata ?? {}).mergedCandidateSlugs as string[] | undefined) ?? []),
            absorbed.slug,
          ]),
        ],
      },
    })
    .eq("id", keeper.id)
    .eq("is_published", false);

  if (updateError) {
    throw new Error(`Merge keeper update failed: ${updateError.message}`);
  }

  const { error: deleteError } = await supabase
    .from("events")
    .delete()
    .eq("id", absorbed.id)
    .eq("is_published", false)
    .eq("metadata->>candidate", "true");

  if (deleteError) {
    throw new Error(`Merged candidate delete failed: ${deleteError.message}`);
  }
}

async function writeAnalysisRun(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  left: CandidateRow,
  right: CandidateRow,
  decision: MergeDecision,
  metadata: { provider: string; model: string; estimatedCostUsd: number },
) {
  const articleIds = [...candidateArticles(left), ...candidateArticles(right)].map((article) => article.id);
  const inputHash = crypto.createHash("sha256").update(articleIds.sort().join("|")).digest("hex");
  const { error } = await supabase.from("analysis_runs").insert({
    event_id: left.id,
    run_type: "candidate_merge_adjudication",
    status: "succeeded",
    provider: metadata.provider,
    model: metadata.model,
    prompt_version: PROMPT_VERSION,
    source_article_ids: articleIds,
    input_hash: inputHash,
    estimated_cost_usd: metadata.estimatedCostUsd,
    output: {
      leftSlug: left.slug,
      rightSlug: right.slug,
      decision,
    },
    finished_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Merge analysis run write failed: ${error.message}`);
  }
}

async function main() {
  assertManualAnalysisEnabled("merge:manual");
  const options = parseOptions();

  if (runtimeConfig.modelProvider !== "mock") {
    assertPrivateJobsEnabled("merge:manual");

    if (runtimeConfig.llmEstimatedCostUsdPerCall <= 0) {
      throw new Error(
        "merge:manual blocked: LLM_ESTIMATED_COST_USD_PER_CALL must be set above 0 before live model calls.",
      );
    }
  }

  printJobBudget();

  const supabase = createServiceSupabaseClient();
  const provider = getRuntimeModelProvider();
  const candidates = await fetchCandidates(supabase);
  let pairsConsidered = 0;
  let modelCalls = 0;
  let mergeRecommendations = 0;
  let mergesApplied = 0;
  let estimatedCostUsd = 0;

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const left = candidates[leftIndex];
      const right = candidates[rightIndex];

      if (!left || !right || !shouldAdjudicate(left, right)) {
        continue;
      }

      pairsConsidered += 1;

      if (modelCalls >= runtimeConfig.maxLlmCallsPerRun) {
        console.log("Stopped before pair: max LLM calls per run reached.");
        break;
      }

      const runEstimatedCostUsd =
        runtimeConfig.modelProvider === "mock" ? 0 : runtimeConfig.llmEstimatedCostUsdPerCall;

      if (estimatedCostUsd + runEstimatedCostUsd > runtimeConfig.maxLlmEstimatedCostUsdPerRun) {
        throw new Error(
          `Estimated LLM cost cap would be exceeded before next call: ${
            estimatedCostUsd + runEstimatedCostUsd
          } > ${runtimeConfig.maxLlmEstimatedCostUsdPerRun}`,
        );
      }

      modelCalls += 1;
      const result = await provider.generateJson<MergeDecision>({
        task: "classifyArticle",
        schemaName: PROMPT_VERSION,
        prompt: buildPrompt(left, right),
        sourceIds: [...candidateArticles(left), ...candidateArticles(right)].map((article) => article.id),
      });
      estimatedCostUsd += runEstimatedCostUsd;

      const validationErrors = validateDecision(result.json);

      if (validationErrors.length > 0) {
        throw new Error(`Merge decision validation failed: ${validationErrors.join("; ")}`);
      }

      console.log("");
      console.log(`Pair: ${left.slug} <> ${right.slug}`);
      console.log(`Decision: ${result.json.mergeStrategy}; sameEvent=${result.json.sameEvent}; confidence=${result.json.confidence}`);
      console.log(`Reason: ${result.json.reason}`);

      if (result.json.mergeStrategy === "merge" && result.json.confidence >= mergeConfidenceThreshold) {
        mergeRecommendations += 1;

        if (!options.dryRun) {
          const keeper = candidateArticles(left).length >= candidateArticles(right).length ? left : right;
          const absorbed = keeper.id === left.id ? right : left;
          await applyMerge(supabase, keeper, absorbed, result.json);
          await writeAnalysisRun(supabase, left, right, result.json, {
            ...result.metadata,
            estimatedCostUsd: runEstimatedCostUsd,
          });
          mergesApplied += 1;
        }
      } else if (!options.dryRun) {
        await writeAnalysisRun(supabase, left, right, result.json, {
          ...result.metadata,
          estimatedCostUsd: runEstimatedCostUsd,
        });
      }
    }
  }

  console.log("");
  console.log(`Candidates read: ${candidates.length}`);
  console.log(`Pairs considered: ${pairsConsidered}`);
  console.log(`Model calls made: ${modelCalls}`);
  console.log(`Merge recommendations: ${mergeRecommendations}`);
  console.log(`Merges applied: ${mergesApplied}`);
  console.log(`Estimated model cost: $${estimatedCostUsd}`);
  console.log(`Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log("No events were published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
