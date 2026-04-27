import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runtimeConfig } from "../../lib/runtime-config.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { assertManualAnalysisEnabled, assertPrivateJobsEnabled, printJobBudget } from "./guards.ts";

const execFileAsync = promisify(execFile);
const USER_AGENT = "news-spectrum-evidence/0.1";

type EvidenceOptions = {
  dryRun: boolean;
  refresh: boolean;
};

type ArticleRow = {
  id: string;
  url: string;
  title: string;
};

type CandidateRow = {
  id: string;
  slug: string;
  event_articles: Array<{
    articles: ArticleRow | ArticleRow[] | null;
  }>;
};

type EvidenceRow = {
  article_id: string;
  extraction_status: "pending" | "succeeded" | "failed" | "skipped";
  evidence_text: string | null;
  evidence_char_count: number;
  extracted_at: string | null;
  metadata: Record<string, unknown>;
};

function parseOptions(): EvidenceOptions {
  return {
    dryRun: process.argv.includes("--dry-run"),
    refresh: process.argv.includes("--refresh"),
  };
}

function firstRelated<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function metaContent(html: string, names: string[]) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`,
        "i",
      ),
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);

      if (match?.[1]) {
        return normalizeWhitespace(decodeHtmlEntities(match[1]));
      }
    }
  }

  return "";
}

function extractParagraphs(html: string) {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => normalizeWhitespace(stripHtml(match[1] ?? "")))
    .filter((paragraph) => paragraph.length >= 80)
    .filter((paragraph) => !/subscribe|sign up|all rights reserved|advertisement/i.test(paragraph));

  return [...new Set(paragraphs)];
}

function buildEvidenceText(html: string, limit: number) {
  const description = metaContent(html, ["og:description", "description", "twitter:description"]);
  const paragraphs = extractParagraphs(html);
  const parts = [description, ...paragraphs].filter(Boolean);
  const text = normalizeWhitespace(parts.join(" "));

  if (text.length <= limit) {
    return text;
  }

  const truncated = text.slice(0, limit);
  const sentenceBreak = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! "),
  );

  if (sentenceBreak > Math.floor(limit * 0.55)) {
    return truncated.slice(0, sentenceBreak + 1).trim();
  }

  return truncated.trim();
}

async function fetchHtml(url: string) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-fsSL",
      "--location",
      "--max-time",
      "30",
      "--retry",
      "1",
      "--retry-delay",
      "1",
      "--user-agent",
      USER_AGENT,
      url,
    ],
    {
      maxBuffer: 2 * 1024 * 1024,
    },
  );

  return stdout;
}

async function fetchCandidateArticles(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const { data, error } = await supabase
    .from("events")
    .select("id,slug,event_articles(articles(id,title,url))")
    .eq("is_published", false)
    .eq("metadata->>candidate", "true")
    .in("metadata->>analysisStage", ["clustered", "enriched"])
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(runtimeConfig.maxEventsPerRun);

  if (error) {
    throw new Error(`Candidate article read failed: ${error.message}`);
  }

  const articles = ((data as CandidateRow[] | null) ?? [])
    .flatMap((candidate) => candidate.event_articles.map((link) => firstRelated(link.articles)))
    .filter((article): article is ArticleRow => Boolean(article));

  return [...new Map(articles.map((article) => [article.id, article])).values()];
}

async function fetchExistingEvidence(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  articleIds: string[],
) {
  if (articleIds.length === 0) {
    return new Map<string, EvidenceRow>();
  }

  const { data, error } = await supabase
    .from("article_evidence")
    .select("article_id,extraction_status,evidence_text,evidence_char_count,extracted_at,metadata")
    .in("article_id", articleIds);

  if (error) {
    throw new Error(`Evidence read failed: ${error.message}`);
  }

  return new Map(
    ((data as EvidenceRow[] | null) ?? []).map((row) => [row.article_id, row] as const),
  );
}

async function writeEvidence(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  article: ArticleRow,
  row: Omit<EvidenceRow, "article_id">,
) {
  const { error } = await supabase.from("article_evidence").upsert(
    {
      article_id: article.id,
      ...row,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "article_id" },
  );

  if (error) {
    throw new Error(`Evidence write failed for article ${article.id}: ${error.message}`);
  }
}

async function main() {
  assertManualAnalysisEnabled("extract:evidence");
  assertPrivateJobsEnabled("extract:evidence");
  const options = parseOptions();
  printJobBudget();

  const supabase = createServiceSupabaseClient();
  const candidates = await fetchCandidateArticles(supabase);
  const existing = await fetchExistingEvidence(
    supabase,
    candidates.map((article) => article.id),
  );
  const articles = candidates
    .filter((article) => options.refresh || existing.get(article.id)?.extraction_status !== "succeeded")
    .slice(0, runtimeConfig.maxEvidenceArticlesPerRun);

  let extracted = 0;
  let failed = 0;
  let skipped = 0;

  for (const article of articles) {
    const startedAt = Date.now();

    if (options.dryRun) {
      console.log(`Would extract evidence for article ${article.id}`);
      skipped += 1;
      continue;
    }

    try {
      const html = await fetchHtml(article.url);
      const evidenceText = buildEvidenceText(html, runtimeConfig.maxEvidenceCharsPerArticle);
      const now = new Date().toISOString();
      const metadata = {
        extractor: "html-meta-paragraph-v1",
        sourceHash: crypto.createHash("sha256").update(html).digest("hex"),
        elapsedMs: Date.now() - startedAt,
      };

      if (evidenceText.length < 80) {
        await writeEvidence(supabase, article, {
          extraction_status: "skipped",
          evidence_text: evidenceText || null,
          evidence_char_count: evidenceText.length,
          extracted_at: now,
          metadata: {
            ...metadata,
            reason: "insufficient_text",
          },
        });
        skipped += 1;
        continue;
      }

      await writeEvidence(supabase, article, {
        extraction_status: "succeeded",
        evidence_text: evidenceText,
        evidence_char_count: evidenceText.length,
        extracted_at: now,
        metadata,
      });
      extracted += 1;
    } catch (error: unknown) {
      failed += 1;
      const now = new Date().toISOString();
      await writeEvidence(supabase, article, {
        extraction_status: "failed",
        evidence_text: null,
        evidence_char_count: 0,
        extracted_at: now,
        metadata: {
          extractor: "html-meta-paragraph-v1",
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        },
      });
    }
  }

  console.log(`Candidate articles found: ${candidates.length}`);
  console.log(`Articles selected for extraction: ${articles.length}`);
  console.log(`Evidence rows extracted: ${extracted}`);
  console.log(`Evidence rows skipped: ${skipped}`);
  console.log(`Evidence rows failed: ${failed}`);
  console.log(`Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log("No events were published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
