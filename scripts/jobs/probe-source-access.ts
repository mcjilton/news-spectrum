import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { sourceCatalog, type CatalogSource } from "../../lib/source-catalog.ts";

const execFileAsync = promisify(execFile);
const GDELT_DOC_API_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_TIMESPAN = "7d";
const USER_AGENT = "news-spectrum-access-probe/0.1";

type GdeltArticle = {
  url?: string;
  title?: string;
  domain?: string;
  seendate?: string;
};

type GdeltResponse = {
  articles?: GdeltArticle[];
};

type ProbeResult = {
  source: string;
  domain: string;
  catalogAccessProfile: CatalogSource["accessProfile"];
  spectrum: CatalogSource["spectrum"];
  sourceType: CatalogSource["sourceType"];
  ratingSource: string;
  ratingUrl: string | null;
  samplesRequested: number;
  samplesFound: number;
  fetchSuccesses: number;
  usableEvidence: number;
  averageEvidenceChars: number;
  commonFailure: string | null;
  recommendedAccessProfile: CatalogSource["accessProfile"];
  sampleUrls: string[];
};

function optionValue(name: string, fallback: string) {
  const prefix = `${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));

  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function intOption(name: string, fallback: number) {
  const parsed = Number.parseInt(optionValue(name, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
  return normalizeWhitespace([description, ...paragraphs].filter(Boolean).join(" ")).slice(0, limit);
}

function failureKey(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/timed out|timeout|operation timed out/i.test(message)) {
    return "timeout";
  }

  if (/403|forbidden/i.test(message)) {
    return "403";
  }

  if (/404|not found/i.test(message)) {
    return "404";
  }

  if (/429|too many/i.test(message)) {
    return "429";
  }

  if (/Could not resolve|resolve host/i.test(message)) {
    return "dns";
  }

  return message.slice(0, 80);
}

async function curl(url: string, timeoutSeconds: number, maxBuffer = 2 * 1024 * 1024) {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-fsSL",
      "--location",
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

async function fetchGdeltArticles(source: CatalogSource, samplesPerSource: number, timeoutSeconds: number) {
  const params = new URLSearchParams({
    query: `domain:${source.gdeltDomain} sourcelang:english`,
    mode: "artlist",
    format: "json",
    maxrecords: String(Math.max(samplesPerSource * 2, 8)),
    sort: "datedesc",
    timespan: GDELT_TIMESPAN,
  });
  const payload = JSON.parse(
    await curl(`${GDELT_DOC_API_URL}?${params}`, timeoutSeconds, 1024 * 1024),
  ) as GdeltResponse;

  const articles = (payload.articles ?? [])
    .filter((article) => article.url && article.title && articleMatchesSource(article, source))
    .slice(0, samplesPerSource);

  return articles;
}

function recommendProfile(
  result: Omit<ProbeResult, "recommendedAccessProfile">,
): CatalogSource["accessProfile"] {
  if (result.samplesFound === 0) {
    return "unknown";
  }

  const usableRate = result.usableEvidence / result.samplesFound;
  const fetchRate = result.fetchSuccesses / result.samplesFound;
  const failedBeforeExtraction =
    result.fetchSuccesses === 0 &&
    result.commonFailure !== null &&
    result.commonFailure !== "insufficient_text";

  if (usableRate >= 0.67) {
    return "open";
  }

  if (fetchRate >= 0.67 && usableRate >= 0.34) {
    return "metered";
  }

  if (result.samplesFound >= 3 && usableRate === 0 && !failedBeforeExtraction) {
    return "hard_paywall";
  }

  return "unknown";
}

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function probeSource(source: CatalogSource, samplesPerSource: number, timeoutSeconds: number) {
  const failures: string[] = [];
  let articles: GdeltArticle[] = [];

  try {
    articles = await fetchGdeltArticles(source, samplesPerSource, timeoutSeconds);
  } catch (error: unknown) {
    failures.push(`gdelt:${failureKey(error)}`);
  }

  let fetchSuccesses = 0;
  let usableEvidence = 0;
  let totalEvidenceChars = 0;

  for (const article of articles) {
    try {
      const html = await curl(article.url ?? "", timeoutSeconds);
      fetchSuccesses += 1;
      const evidence = buildEvidenceText(html, 1_500);

      if (evidence.length >= 120) {
        usableEvidence += 1;
        totalEvidenceChars += evidence.length;
      } else {
        failures.push("insufficient_text");
      }
    } catch (error: unknown) {
      failures.push(failureKey(error));
    }
  }

  const partial = {
    source: source.name,
    domain: source.gdeltDomain,
    catalogAccessProfile: source.accessProfile,
    spectrum: source.spectrum,
    sourceType: source.sourceType,
    ratingSource: source.ratingSource,
    ratingUrl: source.ratingUrl ?? null,
    samplesRequested: samplesPerSource,
    samplesFound: articles.length,
    fetchSuccesses,
    usableEvidence,
    averageEvidenceChars: usableEvidence > 0 ? Math.round(totalEvidenceChars / usableEvidence) : 0,
    commonFailure: mostCommon(failures),
    sampleUrls: articles.map((article) => article.url).filter((url): url is string => Boolean(url)),
  };

  return {
    ...partial,
    recommendedAccessProfile: recommendProfile(partial),
  };
}

async function main() {
  const maxSources = intOption("--max-sources", 60);
  const samplesPerSource = intOption("--samples-per-source", 3);
  const timeoutSeconds = intOption("--timeout-seconds", 15);
  const outputPath = optionValue("--out", "reports/source-access-probe.json");
  const sources = sourceCatalog.filter((source) => source.enabled).slice(0, maxSources);
  const startedAt = new Date().toISOString();
  const results: ProbeResult[] = [];

  console.log(`Source access probe started: ${startedAt}`);
  console.log(`Sources: ${sources.length}; samples/source: ${samplesPerSource}; timeout: ${timeoutSeconds}s`);

  for (const [index, source] of sources.entries()) {
    const result = await probeSource(source, samplesPerSource, timeoutSeconds);
    results.push(result);
    console.log(
      `${index + 1}/${sources.length} ${source.name}: ${result.usableEvidence}/${result.samplesFound} usable; recommended ${result.recommendedAccessProfile}`,
    );
  }

  const finishedAt = new Date().toISOString();
  const summary = {
    startedAt,
    finishedAt,
    maxSources,
    samplesPerSource,
    timeoutSeconds,
    resultCount: results.length,
    byRecommendedProfile: Object.fromEntries(
      Object.entries(Object.groupBy(results, (result) => result.recommendedAccessProfile)).map(
        ([key, values]) => [key, values?.length ?? 0],
      ),
    ),
    changesSuggested: results.filter(
      (result) => result.catalogAccessProfile !== result.recommendedAccessProfile,
    ).length,
  };

  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);

  console.log("Source access probe finished.");
  console.log(`- output: ${outputPath}`);
  console.log(`- recommended profiles: ${JSON.stringify(summary.byRecommendedProfile)}`);
  console.log(`- changes suggested: ${summary.changesSuggested}`);
  console.log("No events were created or published.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
