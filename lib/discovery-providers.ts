import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CatalogSource } from "./source-catalog.ts";
import { normalizedUrlDomain } from "./url-utils.ts";

const execFileAsync = promisify(execFile);
const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_TIMESPAN = "24h";
const USER_AGENT = "news-spectrum-discovery/0.1";

export type DiscoveryProviderName = "gdelt" | "rss" | "rss-aggregator";

export type DiscoveredArticle = {
  provider: DiscoveryProviderName;
  url: string;
  title: string;
  publishedAt: string | null;
  providerDomain: string;
  sourceCountry?: string;
  sourceLanguage?: string;
  imageUrl?: string;
  description?: string;
  feedUrl?: string;
  aggregatorName?: string;
  originalSourceName?: string;
  originalSourceUrl?: string;
};

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

type RssItem = {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  imageUrl: string | null;
};

export type AggregatorFeed = {
  name: string;
  feedUrl: string;
};

export const aggregatorFeeds: AggregatorFeed[] = [
  {
    name: "Yahoo News",
    feedUrl: "https://news.yahoo.com/rss/",
  },
  {
    name: "Yahoo News Politics",
    feedUrl: "https://news.yahoo.com/rss/politics",
  },
];

export function normalizeDomain(domain: string) {
  return domain.toLowerCase().replace(/^www\./, "");
}

export function articleMatchesSourceDomain(articleDomain: string | undefined, source: CatalogSource) {
  if (!articleDomain) {
    return true;
  }

  const normalizedArticleDomain = normalizeDomain(articleDomain);
  const sourceDomain = normalizeDomain(source.gdeltDomain);
  return normalizedArticleDomain === sourceDomain || normalizedArticleDomain.endsWith(`.${sourceDomain}`);
}

export function parseGdeltDate(value: string | undefined) {
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

  return parseDate(value);
}

function parseDate(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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
    )
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " "));
}

function tagContent(xml: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(pattern);
  return match?.[1] ? stripHtml(match[1]) : null;
}

function tagAttribute(xml: string, tagName: string, attributeName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\s${attributeName}=["']([^"']+)["'][^>]*>`, "i");
  return xml.match(pattern)?.[1] ?? null;
}

async function curl(url: string, timeoutSeconds: number, maxBuffer = 2 * 1024 * 1024) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-fsSL",
      "--max-time",
      String(timeoutSeconds),
      "--retry",
      "1",
      "--retry-delay",
      "1",
      "--user-agent",
      USER_AGENT,
      url,
    ],
    { maxBuffer },
  );

  return stdout;
}

export async function fetchGdeltArticles(
  source: CatalogSource,
  maxArticles: number,
  timeoutSeconds = 30,
) {
  const params = new URLSearchParams({
    query: `domain:${source.gdeltDomain} sourcelang:english`,
    mode: "artlist",
    format: "json",
    maxrecords: String(maxArticles),
    sort: "datedesc",
    timespan: GDELT_TIMESPAN,
  });
  const payload = JSON.parse(
    await curl(`${GDELT_DOC_API_URL}?${params}`, timeoutSeconds, 1024 * 1024),
  ) as GdeltResponse;

  return (payload.articles ?? [])
    .filter((article) => article.url && article.title && articleMatchesSourceDomain(article.domain, source))
    .map(
      (article): DiscoveredArticle => ({
        provider: "gdelt",
        url: article.url ?? "",
        title: article.title ?? "",
        publishedAt: parseGdeltDate(article.seendate),
        providerDomain: article.domain ?? source.gdeltDomain,
        sourceCountry: article.sourceCountry,
        sourceLanguage: article.language,
        imageUrl: article.socialimage ?? article.image,
      }),
    );
}

function parseRss(xml: string) {
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match): RssItem | null => {
      const itemXml = match[1] ?? "";
      const title = tagContent(itemXml, "title") ?? "";
      const link = tagContent(itemXml, "link") ?? tagContent(itemXml, "guid") ?? "";

      if (!title || !link) {
        return null;
      }

      return {
        title,
        link,
        pubDate: tagContent(itemXml, "pubDate"),
        description: tagContent(itemXml, "description") ?? tagContent(itemXml, "content:encoded"),
        sourceName: tagContent(itemXml, "source"),
        sourceUrl: tagAttribute(itemXml, "source", "url"),
        imageUrl:
          tagAttribute(itemXml, "media:content", "url") ??
          tagAttribute(itemXml, "enclosure", "url"),
      };
    })
    .filter((item): item is RssItem => Boolean(item));
}

export async function fetchSourceRssArticles(
  source: CatalogSource,
  maxArticles: number,
  timeoutSeconds = 20,
) {
  const feedUrls = source.rssFeedUrls ?? [];
  const results: DiscoveredArticle[] = [];

  for (const feedUrl of feedUrls) {
    const items = parseRss(await curl(feedUrl, timeoutSeconds));
    const providerDomain = normalizedUrlDomain(feedUrl) || source.gdeltDomain;

    for (const item of items.slice(0, maxArticles)) {
      results.push({
        provider: "rss",
        url: item.link,
        title: item.title,
        publishedAt: parseDate(item.pubDate),
        providerDomain,
        imageUrl: item.imageUrl ?? undefined,
        description: item.description ?? undefined,
        feedUrl,
      });
    }
  }

  return results;
}

export function sourceForAggregatorItem(item: RssItem, sources: CatalogSource[]) {
  const itemSourceDomain = normalizedUrlDomain(item.sourceUrl ?? "");

  if (!itemSourceDomain) {
    return null;
  }

  return (
    sources.find((source) => {
      const catalogDomain = normalizeDomain(source.gdeltDomain);
      return itemSourceDomain === catalogDomain || itemSourceDomain.endsWith(`.${catalogDomain}`);
    }) ?? null
  );
}

export async function fetchAggregatorRssArticles(
  feed: AggregatorFeed,
  sources: CatalogSource[],
  maxItems: number,
  timeoutSeconds = 20,
) {
  const items = parseRss(await curl(feed.feedUrl, timeoutSeconds));
  const results: Array<{ source: CatalogSource; article: DiscoveredArticle }> = [];

  for (const item of items.slice(0, maxItems)) {
    const source = sourceForAggregatorItem(item, sources);

    if (!source) {
      continue;
    }

    results.push({
      source,
      article: {
        provider: "rss-aggregator",
        url: item.link,
        title: item.title,
        publishedAt: parseDate(item.pubDate),
        providerDomain: normalizedUrlDomain(feed.feedUrl) || "unknown",
        imageUrl: item.imageUrl ?? undefined,
        description: item.description ?? undefined,
        feedUrl: feed.feedUrl,
        aggregatorName: feed.name,
        originalSourceName: item.sourceName ?? source.name,
        originalSourceUrl: item.sourceUrl ?? source.homepageUrl,
      },
    });
  }

  return results;
}
