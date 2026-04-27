import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runtimeConfig } from "../../lib/runtime-config.ts";
import { sourceCatalog, type CatalogSource } from "../../lib/source-catalog.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { safeCanonicalizeUrl } from "../../lib/url-utils.ts";
import { assertManualIngestionEnabled, printJobBudget } from "./guards.ts";

const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_TIMESPAN = "24h";
const execFileAsync = promisify(execFile);

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourceCountry?: string;
  socialimage?: string;
  image?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type SourceRow = {
  id: string;
  name: string;
};

type ArticleInsert = {
  source_id: string;
  url: string;
  canonical_url: string;
  title: string;
  published_at: string | null;
  fetched_at: string;
  content_hash: string;
  metadata: {
    provider: "gdelt";
    providerDomain: string;
    catalogDomain: string;
    sourceCountry?: string;
    sourceLanguage?: string;
    imageUrl?: string;
    seenAt?: string;
  };
};

function normalizeDomain(domain: string) {
  return domain.toLowerCase().replace(/^www\./, "");
}

function articleMatchesSource(article: GdeltArticle, source: CatalogSource) {
  if (!article.domain) {
    return true;
  }

  const articleDomain = normalizeDomain(article.domain);
  const sourceDomain = normalizeDomain(source.gdeltDomain);
  return articleDomain === sourceDomain || articleDomain.endsWith(`.${sourceDomain}`);
}

function parseGdeltDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const compactDateMatch = value.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
  );

  if (compactDateMatch) {
    const [, year, month, day, hour, minute, second] = compactDateMatch;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function contentHash(url: string) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

async function fetchGdeltArticles(source: CatalogSource) {
  const params = new URLSearchParams({
    query: `domain:${source.gdeltDomain} sourcelang:english`,
    mode: "artlist",
    format: "json",
    maxrecords: String(runtimeConfig.maxArticlesPerDiscoveryQuery),
    sort: "datedesc",
    timespan: GDELT_TIMESPAN,
  });

  const url = `${GDELT_DOC_API_URL}?${params}`;
  return fetchGdeltArticlesWithCurl(url, source.name);
}

async function fetchGdeltArticlesWithCurl(url: string, sourceName: string) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-fsSL",
      "--max-time",
      "30",
      "--retry",
      "2",
      "--retry-delay",
      "2",
      "--user-agent",
      "news-spectrum-ingest/0.1",
      url,
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  ).catch((error: unknown) => {
    const curlMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`GDELT request failed for ${sourceName}: ${curlMessage}`);
  });

  const payload = JSON.parse(stdout) as GdeltResponse;
  return payload.articles ?? [];
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function upsertSources(supabase: ReturnType<typeof createServiceSupabaseClient>) {
  const enabledSources = sourceCatalog.filter((source) => source.enabled);
  const rows = enabledSources.map((source) => ({
    name: source.name,
    homepage_url: source.homepageUrl,
    country: source.country,
    language: source.language,
    spectrum: source.spectrum,
    source_type: source.sourceType,
    rating_source: source.ratingSource,
    rating_url: source.ratingUrl ?? null,
    notes: `Starter catalog domain: ${source.gdeltDomain}`,
  }));

  const { data, error } = await supabase
    .from("sources")
    .upsert(rows, { onConflict: "name" })
    .select("id,name");

  if (error) {
    throw new Error(`Source catalog upsert failed: ${error.message}`);
  }

  const rowsByName = new Map((data as SourceRow[] | null)?.map((row) => [row.name, row.id]));

  return {
    enabledSources,
    sourceIdsByName: rowsByName,
  };
}

function toArticleInsert(
  source: CatalogSource,
  sourceId: string,
  article: GdeltArticle,
  fetchedAt: string,
): ArticleInsert | null {
  const url = article.url?.trim();
  const title = article.title?.trim();

  if (!url || !title || !articleMatchesSource(article, source)) {
    return null;
  }

  const seenAt = parseGdeltDate(article.seendate);
  const imageUrl = article.socialimage ?? article.image;
  const canonicalUrl = safeCanonicalizeUrl(url);

  return {
    source_id: sourceId,
    url,
    canonical_url: canonicalUrl,
    title,
    published_at: seenAt,
    fetched_at: fetchedAt,
    content_hash: contentHash(canonicalUrl),
    metadata: {
      provider: "gdelt",
      providerDomain: article.domain ?? source.gdeltDomain,
      catalogDomain: source.gdeltDomain,
      sourceCountry: article.sourceCountry,
      sourceLanguage: article.language,
      imageUrl,
      seenAt: article.seendate,
    },
  };
}

async function main() {
  assertManualIngestionEnabled("ingest:manual");
  printJobBudget();

  const supabase = createServiceSupabaseClient();
  const { enabledSources, sourceIdsByName } = await upsertSources(supabase);
  const querySources = enabledSources.slice(0, runtimeConfig.maxDiscoveryQueriesPerRun);
  const fetchedAt = new Date().toISOString();
  const articlesByUrl = new Map<string, ArticleInsert>();
  let queriesRun = 0;
  let failedQueries = 0;
  let discoveredArticles = 0;

  for (const [index, source] of querySources.entries()) {
    const sourceId = sourceIdsByName.get(source.name);

    if (!sourceId) {
      throw new Error(`Source catalog sync did not return an id for ${source.name}`);
    }

    console.log(
      `Discovering ${index + 1}/${querySources.length}: ${source.name} (${source.gdeltDomain})`,
    );
    const articles = await fetchGdeltArticles(source).catch((error: unknown) => {
      failedQueries += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped ${source.name}: ${message}`);
      return [];
    });

    queriesRun += 1;
    discoveredArticles += articles.length;
    console.log(`- provider articles: ${articles.length}`);

    for (const article of articles) {
      if (articlesByUrl.size >= runtimeConfig.maxArticlesPerIngestRun) {
        break;
      }

      const row = toArticleInsert(source, sourceId, article, fetchedAt);

      if (row) {
        articlesByUrl.set(row.canonical_url, row);
      }
    }

    if (articlesByUrl.size >= runtimeConfig.maxArticlesPerIngestRun) {
      break;
    }

    await delay(1_500);
  }

  const articleRows = [...articlesByUrl.values()];

  if (articleRows.length > 0) {
    const { error } = await supabase.from("articles").upsert(articleRows, {
      onConflict: "url",
    });

    if (error) {
      throw new Error(`Article metadata upsert failed: ${error.message}`);
    }
  }

  console.log(`Catalog sources upserted: ${enabledSources.length}`);
  console.log(`Discovery queries run: ${queriesRun}`);
  console.log(`Discovery queries skipped after provider errors: ${failedQueries}`);
  console.log(`Provider articles discovered: ${discoveredArticles}`);
  console.log(`Article metadata rows upserted: ${articleRows.length}`);
  console.log("No events were created or published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
