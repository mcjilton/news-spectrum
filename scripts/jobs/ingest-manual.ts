import crypto from "node:crypto";

import {
  aggregatorFeeds,
  type DiscoveredArticle,
  fetchAggregatorRssArticles,
  fetchGdeltArticles,
  fetchSourceRssArticles,
} from "../../lib/discovery-providers.ts";
import { runtimeConfig } from "../../lib/runtime-config.ts";
import { sourceCatalog, type CatalogSource } from "../../lib/source-catalog.ts";
import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { safeCanonicalizeUrl } from "../../lib/url-utils.ts";
import { assertManualIngestionEnabled, printJobBudget } from "./guards.ts";

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
    provider: DiscoveredArticle["provider"];
    providerDomain: string;
    catalogDomain: string;
    sourceCountry?: string;
    sourceLanguage?: string;
    imageUrl?: string;
    description?: string;
    feedUrl?: string;
    aggregatorName?: string;
    originalSourceName?: string;
    originalSourceUrl?: string;
  };
};

function contentHash(url: string) {
  return crypto.createHash("sha256").update(url).digest("hex");
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
  article: DiscoveredArticle,
  fetchedAt: string,
): ArticleInsert | null {
  const url = article.url.trim();
  const title = article.title.trim();

  if (!url || !title) {
    return null;
  }

  const canonicalUrl = safeCanonicalizeUrl(url);

  return {
    source_id: sourceId,
    url,
    canonical_url: canonicalUrl,
    title,
    published_at: article.publishedAt,
    fetched_at: fetchedAt,
    content_hash: contentHash(canonicalUrl),
    metadata: {
      provider: article.provider,
      providerDomain: article.providerDomain,
      catalogDomain: source.gdeltDomain,
      sourceCountry: article.sourceCountry,
      sourceLanguage: article.sourceLanguage,
      imageUrl: article.imageUrl,
      description: article.description,
      feedUrl: article.feedUrl,
      aggregatorName: article.aggregatorName,
      originalSourceName: article.originalSourceName,
      originalSourceUrl: article.originalSourceUrl,
    },
  };
}

function addDiscoveredArticle(
  articlesByUrl: Map<string, ArticleInsert>,
  source: CatalogSource,
  sourceId: string,
  article: DiscoveredArticle,
  fetchedAt: string,
) {
  const row = toArticleInsert(source, sourceId, article, fetchedAt);

  if (row) {
    articlesByUrl.set(row.canonical_url, row);
  }
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

  if (runtimeConfig.enableRssDiscovery) {
    for (const feed of aggregatorFeeds) {
      console.log(`Discovering aggregator feed: ${feed.name} (${feed.feedUrl})`);
      const feedArticles = await fetchAggregatorRssArticles(
        feed,
        enabledSources,
        runtimeConfig.maxAggregatorFeedItemsPerRun,
      ).catch((error: unknown) => {
        failedQueries += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Skipped ${feed.name}: ${message}`);
        return [];
      });

      queriesRun += 1;
      discoveredArticles += feedArticles.length;
      console.log(`- provider articles: ${feedArticles.length}`);

      for (const { source, article } of feedArticles) {
        if (articlesByUrl.size >= runtimeConfig.maxArticlesPerIngestRun) {
          break;
        }

        const sourceId = sourceIdsByName.get(source.name);

        if (sourceId) {
          addDiscoveredArticle(articlesByUrl, source, sourceId, article, fetchedAt);
        }
      }

      if (articlesByUrl.size >= runtimeConfig.maxArticlesPerIngestRun) {
        break;
      }
    }
  }

  for (const [index, source] of querySources.entries()) {
    const sourceId = sourceIdsByName.get(source.name);

    if (!sourceId) {
      throw new Error(`Source catalog sync did not return an id for ${source.name}`);
    }

    console.log(
      `Discovering ${index + 1}/${querySources.length}: ${source.name} (${source.gdeltDomain})`,
    );
    const rssArticles = runtimeConfig.enableRssDiscovery
      ? await fetchSourceRssArticles(
          source,
          runtimeConfig.maxArticlesPerDiscoveryQuery,
        ).catch((error: unknown) => {
          failedQueries += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Skipped RSS for ${source.name}: ${message}`);
          return [];
        })
      : [];
    const gdeltArticles = await fetchGdeltArticles(
      source,
      runtimeConfig.maxArticlesPerDiscoveryQuery,
    ).catch((error: unknown) => {
      failedQueries += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipped GDELT for ${source.name}: ${message}`);
      return [];
    });
    const articles = [...rssArticles, ...gdeltArticles];

    queriesRun += 1;
    discoveredArticles += articles.length;
    console.log(
      `- provider articles: ${articles.length} (rss: ${rssArticles.length}; gdelt: ${gdeltArticles.length})`,
    );

    for (const article of articles) {
      if (articlesByUrl.size >= runtimeConfig.maxArticlesPerIngestRun) {
        break;
      }

      addDiscoveredArticle(articlesByUrl, source, sourceId, article, fetchedAt);
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
