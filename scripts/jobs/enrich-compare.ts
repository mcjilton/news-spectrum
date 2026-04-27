import crypto from "node:crypto";

import { getRuntimeModelProvider } from "../../lib/ai/runtime-provider.ts";
import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import {
  buildPrompt,
  fetchCandidates,
  getArticle,
  getEvidence,
  normalizeEnrichment,
  PROMPT_VERSION,
  validateEnrichment,
  type ArticleRow,
  type EventEnrichment,
} from "./enrich-manual.ts";
import { assertManualAnalysisEnabled, assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
type TextVerbosity = "low" | "medium" | "high";

type CompareOptions = {
  dryRun: boolean;
  models: string[];
  reasoningEffort?: ReasoningEffort;
  textVerbosity?: TextVerbosity;
};

const allowedReasoningEfforts = new Set(["low", "medium", "high", "xhigh"]);
const allowedTextVerbosities = new Set(["low", "medium", "high"]);

function optionValue(name: string) {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));

  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOptions(): CompareOptions {
  const models = parseList(optionValue("--models"));
  const reasoningEffort = optionValue("--reasoning-effort");
  const textVerbosity = optionValue("--text-verbosity");

  if (reasoningEffort && !allowedReasoningEfforts.has(reasoningEffort)) {
    throw new Error("--reasoning-effort must be one of low, medium, high, xhigh.");
  }

  if (textVerbosity && !allowedTextVerbosities.has(textVerbosity)) {
    throw new Error("--text-verbosity must be one of low, medium, high.");
  }

  return {
    dryRun: process.argv.includes("--dry-run"),
    models: models.length > 0 ? models : [runtimeConfig.modelSummary],
    reasoningEffort: reasoningEffort as ReasoningEffort | undefined,
    textVerbosity: textVerbosity as TextVerbosity | undefined,
  };
}

function articleSet(candidate: Awaited<ReturnType<typeof fetchCandidates>>[number]) {
  return candidate.event_articles
    .map(getArticle)
    .filter((article): article is ArticleRow => Boolean(article))
    .slice(0, runtimeConfig.maxArticlesPerEvent);
}

function evidenceArticleCount(articles: ArticleRow[]) {
  return articles.filter((article) => getEvidence(article)?.extraction_status === "succeeded")
    .length;
}

async function writeComparisonRun(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  eventId: string,
  articleIds: string[],
  metadata: {
    provider: string;
    model: string;
    estimatedCostUsd: number;
  },
  options: CompareOptions,
  enrichment: ReturnType<typeof normalizeEnrichment>,
  evidenceCount: number,
) {
  const inputHash = crypto
    .createHash("sha256")
    .update([metadata.model, ...articleIds.sort()].join("|"))
    .digest("hex");
  const { error } = await supabase.from("analysis_runs").insert({
    event_id: eventId,
    run_type: "event_enrichment_compare",
    status: "succeeded",
    provider: metadata.provider,
    model: metadata.model,
    prompt_version: PROMPT_VERSION,
    source_article_ids: articleIds,
    input_hash: inputHash,
    estimated_cost_usd: metadata.estimatedCostUsd,
    output: {
      schema: PROMPT_VERSION,
      comparison: true,
      reasoningEffort: options.reasoningEffort ?? null,
      textVerbosity: options.textVerbosity ?? null,
      evidenceArticleCount: evidenceCount,
      maxEvidenceCharsPerArticle: runtimeConfig.maxEvidenceCharsPerArticle,
      maxEvidenceCharsPerEvent: runtimeConfig.maxEvidenceCharsPerEvent,
      enrichment,
    },
    finished_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Comparison audit write failed: ${error.message}`);
  }
}

async function main() {
  assertManualAnalysisEnabled("enrich:compare");
  const options = parseOptions();

  if (runtimeConfig.modelProvider !== "mock") {
    assertPrivateJobsEnabled("enrich:compare");

    if (runtimeConfig.llmEstimatedCostUsdPerCall <= 0) {
      throw new Error(
        "enrich:compare blocked: LLM_ESTIMATED_COST_USD_PER_CALL must be set above 0 before live model calls.",
      );
    }
  }

  printJobBudget();
  console.log(`Models: ${options.models.join(", ")}`);
  console.log(`Reasoning effort: ${options.reasoningEffort ?? "default"}`);
  console.log(`Text verbosity: ${options.textVerbosity ?? "default"}`);

  const supabase = createServiceSupabaseClient();
  const provider = getRuntimeModelProvider();
  const candidates = await fetchCandidates(supabase, {
    dryRun: options.dryRun,
    refreshEnriched: true,
  });
  const candidate = candidates[0];

  if (!candidate) {
    console.log("Candidates read: 0");
    console.log("No events were published.");
    return;
  }

  const articles = articleSet(candidate);
  const articleIds = articles.map((article) => article.id);
  const evidenceCount = evidenceArticleCount(articles);
  let modelCalls = 0;
  let estimatedCostUsd = 0;

  if (articles.length === 0) {
    throw new Error(`${candidate.slug} has no linked articles.`);
  }

  for (const model of options.models) {
    if (modelCalls >= runtimeConfig.maxLlmCallsPerRun) {
      console.log("Stopped before model: max LLM calls per run reached.");
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
    const result = await provider.generateJson<EventEnrichment>({
      task: "summarizeEvent",
      schemaName: PROMPT_VERSION,
      prompt: buildPrompt(candidate, articles),
      sourceIds: articleIds,
      model,
      reasoningEffort: options.reasoningEffort,
      textVerbosity: options.textVerbosity,
    });
    estimatedCostUsd += runEstimatedCostUsd;

    const validationErrors = validateEnrichment(result.json, articles);

    if (validationErrors.length > 0) {
      throw new Error(`Comparison validation failed for ${model}: ${validationErrors.join("; ")}`);
    }

    const enrichment = normalizeEnrichment(result.json, candidate, articles);
    console.log(`\nModel: ${model}`);
    console.log(`Title: ${enrichment.title}`);
    console.log(`Confidence: ${enrichment.confidence}; divergence: ${enrichment.divergence}`);
    console.log(`Summary: ${enrichment.summary}`);
    console.log("Shared facts:");

    for (const fact of enrichment.sharedFacts) {
      console.log(`- ${fact}`);
    }

    if (!options.dryRun) {
      await writeComparisonRun(
        supabase,
        candidate.id,
        articleIds,
        {
          ...result.metadata,
          model,
          estimatedCostUsd: runEstimatedCostUsd,
        },
        options,
        enrichment,
        evidenceCount,
      );
    }
  }

  console.log(`\nCandidate compared: ${candidate.slug}`);
  console.log(`Evidence articles available: ${evidenceCount}/${articles.length}`);
  console.log(`Model calls made: ${modelCalls}`);
  console.log(`Estimated model cost: $${estimatedCostUsd}`);
  console.log(`Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log("No events were modified or published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
