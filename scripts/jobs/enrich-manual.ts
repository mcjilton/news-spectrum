import crypto from "node:crypto";

import { getRuntimeModelProvider } from "../../lib/ai/runtime-provider.ts";
import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled, assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

const PROMPT_VERSION = "event-enrichment-v1";

type SpectrumBucket = "left" | "center" | "right";
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
  article_evidence: EvidenceRow | EvidenceRow[] | null;
};

type EvidenceRow = {
  extraction_status: string;
  evidence_text: string | null;
  evidence_char_count: number;
  extracted_at: string | null;
};

type CandidateRow = {
  id: string;
  slug: string;
  title: string;
  metadata: Record<string, unknown> | null;
  event_articles: Array<{
    articles: ArticleRow | ArticleRow[] | null;
  }>;
};

type EnrichmentFrame = {
  bucket: SpectrumBucket;
  label: string;
  summary: string;
  emphasis: string[];
  loadedLanguage: string[];
  sourceArticleIds: string[];
};

type EventEnrichment = {
  title: string;
  summary: string;
  confidence: number;
  divergence: number;
  sharedFacts: string[];
  disputedOrVariable: string[];
  frames: EnrichmentFrame[];
};

type EnrichOptions = {
  dryRun: boolean;
  refreshEnriched: boolean;
};

function parseOptions(): EnrichOptions {
  return {
    dryRun: process.argv.includes("--dry-run"),
    refreshEnriched: process.argv.includes("--refresh-enriched"),
  };
}

function getArticle(link: CandidateRow["event_articles"][number]) {
  return Array.isArray(link.articles) ? link.articles[0] : link.articles;
}

function getSource(article: ArticleRow) {
  return Array.isArray(article.sources) ? article.sources[0] : article.sources;
}

function getEvidence(article: ArticleRow) {
  return Array.isArray(article.article_evidence)
    ? article.article_evidence[0]
    : article.article_evidence;
}

function cappedEvidenceText(article: ArticleRow, remainingChars: number) {
  const evidence = getEvidence(article);

  if (
    evidence?.extraction_status !== "succeeded" ||
    !evidence.evidence_text ||
    remainingChars <= 0
  ) {
    return "";
  }

  return evidence.evidence_text.slice(
    0,
    Math.min(runtimeConfig.maxEvidenceCharsPerArticle, remainingChars),
  );
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function coerceTextList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function isGenericFact(value: string) {
  return [
    /multiple sources/i,
    /multiple (news )?outlets/i,
    /article metadata/i,
    /published coverage/i,
    /candidate event/i,
    /source material/i,
  ].some((pattern) => pattern.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bucketForSpectrum(spectrum: SourceSpectrum): SpectrumBucket {
  if (spectrum === "left" || spectrum === "lean_left") {
    return "left";
  }

  if (spectrum === "right" || spectrum === "lean_right") {
    return "right";
  }

  return "center";
}

function fallbackFrames(articles: ArticleRow[]): EnrichmentFrame[] {
  const buckets = [
    ...new Set(
      articles.map((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown")),
    ),
  ];

  return buckets.map((bucket) => ({
    bucket,
    label: `Draft ${bucket} framing`,
    summary: "No model framing was returned for this bucket.",
    emphasis: [],
    loadedLanguage: [],
    sourceArticleIds: articles
      .filter((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown") === bucket)
      .map((article) => article.id),
  }));
}

function normalizeEnrichment(value: EventEnrichment, candidate: CandidateRow, articles: ArticleRow[]) {
  const fallbackFacts = ["Multiple sources published article metadata for this candidate event."];
  const frames = Array.isArray(value.frames) && value.frames.length > 0 ? value.frames : fallbackFrames(articles);
  const concreteSharedFacts = coerceTextList(value.sharedFacts)
    .filter((fact) => !isGenericFact(fact))
    .slice(0, 6);

  return {
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : candidate.title,
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.trim()
        : "Draft enrichment summary unavailable.",
    confidence: clampScore(value.confidence),
    divergence: clampScore(value.divergence),
    sharedFacts: concreteSharedFacts,
    disputedOrVariable: coerceTextList(value.disputedOrVariable).slice(0, 8),
    frames: frames.slice(0, 3).map((frame) => ({
      bucket: frame.bucket,
      label: frame.label || `Draft ${frame.bucket} framing`,
      summary: frame.summary || "Draft framing summary unavailable.",
      emphasis: coerceTextList(frame.emphasis).slice(0, 8),
      loadedLanguage: coerceTextList(frame.loadedLanguage).slice(0, 8),
      sourceArticleIds: articles
        .filter((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown") === frame.bucket)
        .map((article) => article.id),
    })),
    fallbackFacts,
  };
}

function validateEnrichment(value: unknown, articles: ArticleRow[]) {
  const errors: string[] = [];
  const representedBuckets = new Set(
    articles.map((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown")),
  );

  if (!isRecord(value)) {
    return ["enrichment must be an object"];
  }

  for (const key of ["title", "summary"] as const) {
    if (typeof value[key] !== "string" || !value[key].trim()) {
      errors.push(`${key} must be a non-empty string`);
    }
  }

  for (const key of ["confidence", "divergence"] as const) {
    if (typeof value[key] !== "number" || value[key] < 0 || value[key] > 100) {
      errors.push(`${key} must be a number between 0 and 100`);
    }
  }

  for (const key of ["sharedFacts", "disputedOrVariable"] as const) {
    if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === "string")) {
      errors.push(`${key} must be an array of strings`);
    }
  }

  if (Array.isArray(value.sharedFacts)) {
    const concreteFacts = value.sharedFacts.filter(
      (fact) => typeof fact === "string" && !isGenericFact(fact),
    );

    if (concreteFacts.length < 3 || concreteFacts.length > 6) {
      errors.push("sharedFacts must include 3 to 6 concrete non-generic facts");
    }
  }

  if (!Array.isArray(value.frames)) {
    errors.push("frames must be an array");
  } else {
    const allowedBuckets = new Set(["left", "center", "right"]);

    for (const [index, frame] of value.frames.entries()) {
      if (!isRecord(frame)) {
        errors.push(`frames[${index}] must be an object`);
        continue;
      }

      if (typeof frame.bucket !== "string" || !allowedBuckets.has(frame.bucket)) {
        errors.push(`frames[${index}].bucket must be left, center, or right`);
      } else if (!representedBuckets.has(frame.bucket as SpectrumBucket)) {
        errors.push(`frames[${index}].bucket ${frame.bucket} is not represented by source articles`);
      }

      for (const key of ["label", "summary"] as const) {
        if (typeof frame[key] !== "string" || !frame[key].trim()) {
          errors.push(`frames[${index}].${key} must be a non-empty string`);
        }
      }

      for (const key of ["emphasis", "loadedLanguage", "sourceArticleIds"] as const) {
        if (!Array.isArray(frame[key]) || !frame[key].every((item) => typeof item === "string")) {
          errors.push(`frames[${index}].${key} must be an array of strings`);
        }
      }
    }
  }

  return errors;
}

function buildPrompt(candidate: CandidateRow, articles: ArticleRow[]) {
  const representedBuckets = [
    ...new Set(
      articles.map((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown")),
    ),
  ];
  const articleIdsByBucket = Object.fromEntries(
    representedBuckets.map((bucket) => [
      bucket,
      articles
        .filter((article) => bucketForSpectrum(getSource(article)?.spectrum ?? "unknown") === bucket)
        .map((article) => article.id),
    ]),
  );
  let remainingEvidenceChars = runtimeConfig.maxEvidenceCharsPerEvent;
  const promptArticles = articles.map((article) => {
    const source = getSource(article);
    const evidenceSnippet = cappedEvidenceText(article, remainingEvidenceChars);
    remainingEvidenceChars -= evidenceSnippet.length;

    return {
      id: article.id,
      title: article.title,
      outlet: source?.name ?? "Unknown source",
      spectrum: source?.spectrum ?? "unknown",
      url: article.url,
      publishedAt: article.published_at,
      fetchedAt: article.fetched_at,
      evidenceSnippet: evidenceSnippet || null,
    };
  });
  const evidenceArticleCount = promptArticles.filter((article) => article.evidenceSnippet).length;
  const payload = {
    candidate: {
      slug: candidate.slug,
      title: candidate.title,
      metadata: candidate.metadata,
    },
    articles: promptArticles,
    instructions: {
      goal: "Produce draft event analysis from article metadata and bounded extracted evidence snippets.",
      evidenceArticleCount,
      maxEvidenceCharsPerArticle: runtimeConfig.maxEvidenceCharsPerArticle,
      maxEvidenceCharsPerEvent: runtimeConfig.maxEvidenceCharsPerEvent,
      allowedSourceArticleIdsByFrameBucket: articleIdsByBucket,
      constraints: [
        "Do not claim certainty beyond the supplied metadata and evidence snippets.",
        "Use only the supplied source names, titles, URLs, timestamps, and evidenceSnippet fields; do not infer unstated article body details.",
        "Do not assign current or former offices, roles, motives, locations, or identities unless that exact detail appears in the supplied metadata or evidence snippets.",
        "Prefer cautious wording such as reports, says, alleged, suspected, or according to titles/snippets when evidence is incomplete.",
        "Do not quote article text.",
        "Keep the event unpublished.",
        "Return 3 to 6 concrete sharedFacts about the event itself. Do not include generic facts about sources, metadata, or publication volume.",
        "Only include frames for represented source buckets.",
        `Represented source buckets: ${representedBuckets.join(", ")}.`,
        "If a bucket has no sources, omit that frame entirely.",
        "loadedLanguage means notable framing terms or charged wording from titles/metadata, not the human language of the article.",
        "Each frame summary must explicitly reflect the available source mix, title patterns, and evidence snippets; do not invent broader themes that are not visible in the supplied material.",
        "sourceArticleIds may be empty; the system will attach same-bucket source articles after validation.",
        "Return JSON matching the requested schema.",
      ],
    },
  };

  return JSON.stringify(payload, null, 2);
}

async function fetchCandidates(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  options: EnrichOptions,
) {
  const stages = options.refreshEnriched ? ["clustered", "enriched"] : ["clustered"];
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,metadata,event_articles(articles(id,title,url,published_at,fetched_at,sources(name,spectrum),article_evidence(extraction_status,evidence_text,evidence_char_count,extracted_at)))",
    )
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .in("metadata->>analysisStage", stages)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(runtimeConfig.maxEventsPerRun);

  if (error) {
    throw new Error(`Candidate read failed: ${error.message}`);
  }

  return (data as CandidateRow[] | null) ?? [];
}

async function replaceClaims(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  eventId: string,
  articleIds: string[],
  enrichment: ReturnType<typeof normalizeEnrichment>,
) {
  const { error: deleteError } = await supabase.from("claims").delete().eq("event_id", eventId);

  if (deleteError) {
    throw new Error(`Claim cleanup failed: ${deleteError.message}`);
  }

  const facts = enrichment.sharedFacts.length > 0 ? enrichment.sharedFacts : enrichment.fallbackFacts;
  const { data: claims, error: insertError } = await supabase
    .from("claims")
    .insert(
      facts.map((fact) => ({
        event_id: eventId,
        claim_text: fact,
        claim_type: "fact",
        confidence: enrichment.confidence,
        is_core_fact: true,
      })),
    )
    .select("id");

  if (insertError) {
    throw new Error(`Claim insert failed: ${insertError.message}`);
  }

  const supportRows = ((claims as Array<{ id: string }> | null) ?? []).flatMap((claim) =>
    articleIds.map((articleId) => ({
      claim_id: claim.id,
      article_id: articleId,
      stance: "mentions",
    })),
  );

  if (supportRows.length > 0) {
    const { error: supportError } = await supabase.from("claim_support").insert(supportRows);

    if (supportError) {
      throw new Error(`Claim support insert failed: ${supportError.message}`);
    }
  }
}

async function replaceFrames(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  eventId: string,
  enrichment: ReturnType<typeof normalizeEnrichment>,
) {
  const { error: deleteError } = await supabase.from("frames").delete().eq("event_id", eventId);

  if (deleteError) {
    throw new Error(`Frame cleanup failed: ${deleteError.message}`);
  }

  const { error: insertError } = await supabase.from("frames").insert(
    enrichment.frames.map((frame) => ({
      event_id: eventId,
      bucket: frame.bucket,
      label: frame.label,
      summary: frame.summary,
      emphasis: frame.emphasis,
      language: frame.loadedLanguage,
      source_article_ids: frame.sourceArticleIds,
    })),
  );

  if (insertError) {
    throw new Error(`Frame insert failed: ${insertError.message}`);
  }
}

async function updateEvent(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  candidate: CandidateRow,
  enrichment: ReturnType<typeof normalizeEnrichment>,
) {
  const { error } = await supabase
    .from("events")
    .update({
      title: enrichment.title,
      summary: enrichment.summary,
      confidence: enrichment.confidence,
      divergence: enrichment.divergence,
      metadata: {
        ...(candidate.metadata ?? {}),
        analysisStage: "enriched",
        enrichmentMethod: PROMPT_VERSION,
        sharedFacts: enrichment.sharedFacts,
        disputedOrVariable: enrichment.disputedOrVariable,
        updatedAt: new Date().toISOString(),
      },
    })
    .eq("id", candidate.id)
    .eq("is_published", false);

  if (error) {
    throw new Error(`Event enrichment update failed: ${error.message}`);
  }
}

async function writeAnalysisRun(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  candidate: CandidateRow,
  articleIds: string[],
  evidenceArticleCount: number,
  metadata: {
    provider: string;
    model: string;
    estimatedCostUsd: number;
  },
) {
  const inputHash = crypto.createHash("sha256").update(articleIds.sort().join("|")).digest("hex");
  const { error } = await supabase.from("analysis_runs").insert({
    event_id: candidate.id,
    run_type: "event_enrichment",
    status: "succeeded",
    provider: metadata.provider,
    model: metadata.model,
    prompt_version: PROMPT_VERSION,
    source_article_ids: articleIds,
    input_hash: inputHash,
    estimated_cost_usd: metadata.estimatedCostUsd,
    output: {
      schema: PROMPT_VERSION,
      candidateSlug: candidate.slug,
      evidenceArticleCount,
      maxEvidenceCharsPerArticle: runtimeConfig.maxEvidenceCharsPerArticle,
      maxEvidenceCharsPerEvent: runtimeConfig.maxEvidenceCharsPerEvent,
    },
    finished_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Analysis run audit write failed: ${error.message}`);
  }
}

async function main() {
  assertManualAnalysisEnabled("enrich:manual");
  const options = parseOptions();

  if (runtimeConfig.modelProvider !== "mock") {
    assertPrivateJobsEnabled("enrich:manual");

    if (runtimeConfig.llmEstimatedCostUsdPerCall <= 0) {
      throw new Error(
        "enrich:manual blocked: LLM_ESTIMATED_COST_USD_PER_CALL must be set above 0 before live model calls.",
      );
    }
  }

  printJobBudget();

  const supabase = createServiceSupabaseClient();
  const provider = getRuntimeModelProvider();
  const candidates = (await fetchCandidates(supabase, options)).slice(
    0,
    runtimeConfig.modelProvider === "mock" ? runtimeConfig.maxEventsPerRun : 1,
  );
  let enrichedCount = 0;
  let modelCalls = 0;
  let estimatedCostUsd = 0;

  for (const candidate of candidates) {
    if (modelCalls >= runtimeConfig.maxLlmCallsPerRun) {
      console.log("Stopped before candidate: max LLM calls per run reached.");
      break;
    }

    const articles = candidate.event_articles
      .map(getArticle)
      .filter((article): article is ArticleRow => Boolean(article))
      .slice(0, runtimeConfig.maxArticlesPerEvent);
    const articleIds = articles.map((article) => article.id);
    const evidenceArticleCount = articles.filter(
      (article) => getEvidence(article)?.extraction_status === "succeeded",
    ).length;

    if (articles.length === 0) {
      continue;
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
    });
    estimatedCostUsd += runEstimatedCostUsd;

    const validationErrors = validateEnrichment(result.json, articles);

    if (validationErrors.length > 0) {
      throw new Error(`Enrichment validation failed: ${validationErrors.join("; ")}`);
    }

    const enrichment = normalizeEnrichment(result.json, candidate, articles);

    if (options.dryRun) {
      console.log(`Dry-run validated candidate: ${candidate.slug}`);
      continue;
    }

    await updateEvent(supabase, candidate, enrichment);
    await replaceClaims(supabase, candidate.id, articleIds, enrichment);
    await replaceFrames(supabase, candidate.id, enrichment);
    await writeAnalysisRun(supabase, candidate, articleIds, evidenceArticleCount, {
      ...result.metadata,
      estimatedCostUsd: runEstimatedCostUsd,
    });

    enrichedCount += 1;
    console.log(`Enriched unpublished candidate: ${candidate.slug}`);
  }

  console.log(`Candidates read: ${candidates.length}`);
  console.log(`Candidates enriched: ${enrichedCount}`);
  console.log(`Model calls made: ${modelCalls}`);
  console.log(`Estimated model cost: $${estimatedCostUsd}`);
  console.log(`Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log("No events were published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
