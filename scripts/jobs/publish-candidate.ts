import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualPublishEnabled } from "./guards.ts";

type SourceSpectrum = "left" | "lean_left" | "center" | "lean_right" | "right" | "unknown";

type CandidateMetadata = {
  candidate?: boolean;
  analysisStage?: string;
  mergedCandidateSlugs?: string[];
  [key: string]: unknown;
};

type ArticleRow = {
  id: string;
  title: string;
};

type EventArticleRow = {
  article_id: string;
  articles?: ArticleRow | ArticleRow[] | null;
};

type ClaimSupportRow = {
  article_id: string;
  stance: "supports" | "disputes" | "mentions";
  quote: string | null;
};

type ClaimRow = {
  id: string;
  claim_text: string;
  claim_type: string;
  confidence: number;
  is_core_fact: boolean;
  claim_support?: ClaimSupportRow[];
};

type FrameRow = {
  id: string;
  bucket: SourceSpectrum;
  label: string;
  summary: string;
  emphasis: string[] | null;
  language: string[] | null;
  source_article_ids: string[] | null;
};

type CandidateRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  confidence: number;
  divergence: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  published_at: string | null;
  is_published: boolean;
  metadata: CandidateMetadata | null;
  event_articles: EventArticleRow[];
  claims: ClaimRow[];
  frames: FrameRow[];
};

type PublishedEventRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  published_at: string | null;
  metadata: CandidateMetadata | null;
  event_articles: EventArticleRow[];
  claims: Pick<ClaimRow, "claim_text">[];
  frames: Pick<FrameRow, "label" | "summary">[];
};

const duplicateWindowMs = 72 * 60 * 60 * 1000;
const eventTokenPrefix = "event:";
const stopWords = new Set([
  "about",
  "after",
  "again",
  "against",
  "amid",
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "its",
  "new",
  "over",
  "says",
  "the",
  "their",
  "trump",
  "with",
]);

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

function firstRelated<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function articleTitle(link: EventArticleRow) {
  return firstRelated(link.articles)?.title ?? "";
}

function normalizeToken(token: string) {
  const normalized = token
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .trim();

  if (["shooting", "shooter"].includes(normalized)) {
    return "shoot";
  }

  if (["suspected", "suspect"].includes(normalized)) {
    return "suspect";
  }

  if (normalized.length > 4 && normalized.endsWith("s")) {
    return normalized.slice(0, -1);
  }

  return normalized;
}

function inferredEventTokens(value: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const tokens: string[] = [];
  const violenceTerms =
    /\battack|attacker|breach|gunfire|gunman|manifesto|scare|security|shooting|shooter|suspect|targeted\b/;

  if (
    /\b(?:whcd|whca)\b/.test(normalized) ||
    (/\bcorrespondent/.test(normalized) && /\bdinner\b/.test(normalized) && violenceTerms.test(normalized))
  ) {
    tokens.push(`${eventTokenPrefix}whcd-shooting`);
  }

  if (/\biran\b/.test(normalized) && /\bhormuz\b/.test(normalized)) {
    tokens.push(`${eventTokenPrefix}iran-hormuz`);
  }

  return tokens;
}

function textTokens(value: string) {
  const tokens = value
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !stopWords.has(token));

  tokens.push(...inferredEventTokens(value));
  return new Set(tokens);
}

function eventTokens(event: CandidateRow | PublishedEventRow) {
  const text = [
    event.title,
    event.summary ?? "",
    ...(event.claims ?? []).map((claim) => claim.claim_text),
    ...(event.frames ?? []).flatMap((frame) => [frame.label, "summary" in frame ? frame.summary : ""]),
    ...(event.event_articles ?? []).map(articleTitle),
  ].join(" ");

  return textTokens(text);
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

function sharedTokenCount(left: Set<string>, right: Set<string>) {
  let count = 0;

  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }

  return count;
}

function strongEventTokenOverlap(left: Set<string>, right: Set<string>) {
  for (const token of left) {
    if (token.startsWith(eventTokenPrefix) && right.has(token)) {
      return true;
    }
  }

  return false;
}

function eventWindowsOverlap(left: CandidateRow, right: PublishedEventRow) {
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

  return leftStart <= rightEnd + duplicateWindowMs && rightStart <= leftEnd + duplicateWindowMs;
}

function duplicateScore(candidate: CandidateRow, published: PublishedEventRow) {
  if (!eventWindowsOverlap(candidate, published)) {
    return 0;
  }

  const candidateTokens = eventTokens(candidate);
  const publishedTokens = eventTokens(published);
  const tokenScore = jaccard(candidateTokens, publishedTokens);
  const sharedCount = sharedTokenCount(candidateTokens, publishedTokens);

  if (strongEventTokenOverlap(candidateTokens, publishedTokens) && sharedCount >= 2) {
    return Math.max(0.92, tokenScore);
  }

  return tokenScore;
}

async function findDuplicatePublishedEvent(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  candidate: CandidateRow,
) {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,summary,first_seen_at,last_seen_at,published_at,metadata,event_articles(article_id,articles(id,title)),claims(claim_text),frames(label,summary)",
    )
    .eq("is_published", true)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(25);

  if (error) {
    throw new Error(`Published duplicate check failed: ${error.message}`);
  }

  const scored = ((data as PublishedEventRow[] | null) ?? [])
    .map((event) => ({ event, score: duplicateScore(candidate, event) }))
    .filter((result) => result.score >= 0.72)
    .sort((left, right) => right.score - left.score);

  return scored[0] ?? null;
}

function minDate(left: string | null, right: string | null) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function maxDate(left: string | null, right: string | null) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

async function copyCandidateAnalysisToPublishedEvent(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  candidate: CandidateRow,
  published: PublishedEventRow,
  duplicateMatchScore: number,
) {
  const mergedAt = new Date().toISOString();

  const linkRows = candidate.event_articles.map((link) => ({
    event_id: published.id,
    article_id: link.article_id,
    relevance_score: 0.75,
  }));

  if (linkRows.length > 0) {
    const { error } = await supabase
      .from("event_articles")
      .upsert(linkRows, { onConflict: "event_id,article_id" });

    if (error) {
      throw new Error(`Duplicate merge article link upsert failed: ${error.message}`);
    }
  }

  const { error: deleteClaimError } = await supabase.from("claims").delete().eq("event_id", published.id);

  if (deleteClaimError) {
    throw new Error(`Duplicate merge old claim delete failed: ${deleteClaimError.message}`);
  }

  const claimRows = candidate.claims.map((claim) => ({
    event_id: published.id,
    claim_text: claim.claim_text,
    claim_type: claim.claim_type,
    confidence: claim.confidence,
    is_core_fact: claim.is_core_fact,
  }));

  if (claimRows.length > 0) {
    const { data: insertedClaims, error } = await supabase
      .from("claims")
      .insert(claimRows)
      .select("id");

    if (error) {
      throw new Error(`Duplicate merge claim insert failed: ${error.message}`);
    }

    const supportRows = candidate.claims.flatMap((claim, claimIndex) => {
      const insertedClaim = (insertedClaims as Array<{ id: string }> | null)?.[claimIndex];

      if (!insertedClaim) {
        return [];
      }

      return (claim.claim_support ?? []).map((support) => ({
        claim_id: insertedClaim.id,
        article_id: support.article_id,
        stance: support.stance,
        quote: support.quote,
      }));
    });

    if (supportRows.length > 0) {
      const { error: supportError } = await supabase.from("claim_support").insert(supportRows);

      if (supportError) {
        throw new Error(`Duplicate merge claim support insert failed: ${supportError.message}`);
      }
    }
  }

  const { error: deleteFrameError } = await supabase.from("frames").delete().eq("event_id", published.id);

  if (deleteFrameError) {
    throw new Error(`Duplicate merge old frame delete failed: ${deleteFrameError.message}`);
  }

  const frameRows = candidate.frames.map((frame) => ({
    event_id: published.id,
    bucket: frame.bucket,
    label: frame.label,
    summary: frame.summary,
    emphasis: frame.emphasis ?? [],
    language: frame.language ?? [],
    source_article_ids: frame.source_article_ids ?? [],
  }));

  if (frameRows.length > 0) {
    const { error } = await supabase.from("frames").insert(frameRows);

    if (error) {
      throw new Error(`Duplicate merge frame insert failed: ${error.message}`);
    }
  }

  const { error: runUpdateError } = await supabase
    .from("analysis_runs")
    .update({ event_id: published.id })
    .eq("event_id", candidate.id);

  if (runUpdateError) {
    throw new Error(`Duplicate merge analysis run update failed: ${runUpdateError.message}`);
  }

  const { error: eventUpdateError } = await supabase
    .from("events")
    .update({
      title: candidate.title,
      summary: candidate.summary,
      confidence: candidate.confidence,
      divergence: candidate.divergence,
      first_seen_at: minDate(published.first_seen_at, candidate.first_seen_at),
      last_seen_at: maxDate(published.last_seen_at, candidate.last_seen_at),
      metadata: {
        ...(published.metadata ?? {}),
        ...(candidate.metadata ?? {}),
        candidate: false,
        analysisStage: "published",
        duplicateGuard: {
          mergedAt,
          mergedFromCandidateSlug: candidate.slug,
          matchScore: duplicateMatchScore,
        },
        mergedCandidateSlugs: [
          ...new Set([
            ...((published.metadata?.mergedCandidateSlugs as string[] | undefined) ?? []),
            ...((candidate.metadata?.mergedCandidateSlugs as string[] | undefined) ?? []),
            candidate.slug,
          ]),
        ],
        updatedAt: mergedAt,
      },
    })
    .eq("id", published.id)
    .eq("is_published", true);

  if (eventUpdateError) {
    throw new Error(`Duplicate merge published event update failed: ${eventUpdateError.message}`);
  }

  const { error: candidateDeleteError } = await supabase
    .from("events")
    .delete()
    .eq("id", candidate.id)
    .eq("is_published", false)
    .eq("metadata->>candidate", "true");

  if (candidateDeleteError) {
    throw new Error(`Duplicate merge candidate delete failed: ${candidateDeleteError.message}`);
  }
}

async function main() {
  assertManualPublishEnabled("publish:candidate");

  const slug = slugArg();
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id,slug,title,summary,confidence,divergence,first_seen_at,last_seen_at,published_at,is_published,metadata,event_articles(article_id,articles(id,title)),claims(id,claim_text,claim_type,confidence,is_core_fact,claim_support(article_id,stance,quote)),frames(id,bucket,label,summary,emphasis,language,source_article_ids)",
    )
    .eq("slug", slug)
    .single();

  if (error) {
    throw new Error(`Candidate lookup failed for ${slug}: ${error.message}`);
  }

  const candidate = data as CandidateRow;
  assertPublishable(candidate);

  const duplicate = await findDuplicatePublishedEvent(supabase, candidate);

  if (duplicate) {
    await copyCandidateAnalysisToPublishedEvent(
      supabase,
      candidate,
      duplicate.event,
      duplicate.score,
    );
    console.log(`Merged candidate into existing published event: ${duplicate.event.slug}`);
    console.log(`Duplicate candidate: ${candidate.slug}`);
    console.log(`Match score: ${duplicate.score.toFixed(2)}`);
    console.log(`Title: ${candidate.title}`);
    console.log(`Merged linked articles: ${candidate.event_articles.length}`);
    console.log(`Claims copied: ${candidate.claims.length}`);
    console.log(`Frames copied: ${candidate.frames.length}`);
    return;
  }

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
