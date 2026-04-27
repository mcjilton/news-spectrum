import { mkdir, writeFile } from "node:fs/promises";

import { parseRss } from "../../lib/discovery-providers.ts";
import { sourceCatalog } from "../../lib/source-catalog.ts";

type ProbeResult = {
  source: string;
  feedUrl: string;
  status: "ok" | "failed";
  itemCount: number;
  recent24h: number;
  recent72h: number;
  newestPublishedAt: string | null;
  oldestPublishedAt: string | null;
  commonFailure: string | null;
  sampleTitles: string[];
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

  return message.slice(0, 120);
}

async function fetchFeed(url: string, timeoutSeconds: number) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "news-spectrum-rss-probe/0.1",
    },
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

function dateValue(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function isoDate(value: number | null) {
  return value ? new Date(value).toISOString() : null;
}

async function probeFeed(source: string, feedUrl: string, timeoutSeconds: number): Promise<ProbeResult> {
  try {
    const xml = await fetchFeed(feedUrl, timeoutSeconds);
    const items = parseRss(xml);
    const now = Date.now();
    const times = items
      .map((item) => dateValue(item.pubDate))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    const recent24h = times.filter((time) => now - time <= 24 * 60 * 60 * 1000).length;
    const recent72h = times.filter((time) => now - time <= 72 * 60 * 60 * 1000).length;

    return {
      source,
      feedUrl,
      status: "ok",
      itemCount: items.length,
      recent24h,
      recent72h,
      newestPublishedAt: isoDate(times.at(-1) ?? null),
      oldestPublishedAt: isoDate(times[0] ?? null),
      commonFailure: null,
      sampleTitles: items.slice(0, 5).map((item) => item.title),
    };
  } catch (error: unknown) {
    return {
      source,
      feedUrl,
      status: "failed",
      itemCount: 0,
      recent24h: 0,
      recent72h: 0,
      newestPublishedAt: null,
      oldestPublishedAt: null,
      commonFailure: failureKey(error),
      sampleTitles: [],
    };
  }
}

async function main() {
  const timeoutSeconds = intOption("--timeout-seconds", 15);
  const outputPath = optionValue("--out", "reports/rss-feed-probe.json");
  const startedAt = new Date().toISOString();
  const feedEntries = sourceCatalog
    .filter((source) => source.enabled)
    .flatMap((source) =>
      (source.rssFeedUrls ?? []).map((feedUrl) => ({
        source: source.name,
        feedUrl,
      })),
    );
  const results: ProbeResult[] = [];

  console.log(`RSS feed probe started: ${startedAt}`);
  console.log(`Feeds: ${feedEntries.length}; timeout: ${timeoutSeconds}s`);

  for (const [index, entry] of feedEntries.entries()) {
    const result = await probeFeed(entry.source, entry.feedUrl, timeoutSeconds);
    results.push(result);
    console.log(
      `${index + 1}/${feedEntries.length} ${entry.source}: ${result.status}; items ${result.itemCount}; recent72h ${result.recent72h}`,
    );
  }

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    feedCount: results.length,
    ok: results.filter((result) => result.status === "ok").length,
    failed: results.filter((result) => result.status === "failed").length,
    withRecent72h: results.filter((result) => result.recent72h > 0).length,
    stale: results.filter((result) => result.status === "ok" && result.recent72h === 0).length,
  };

  await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ summary, results }, null, 2)}\n`);

  console.log("RSS feed probe finished.");
  console.log(`- output: ${outputPath}`);
  console.log(`- summary: ${JSON.stringify(summary)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
