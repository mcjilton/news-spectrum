import { createPublicSupabaseClient } from "../../lib/supabase/runtime.ts";

async function main() {
  const supabase = createPublicSupabaseClient();
  const eventsResult = await supabase
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("is_published", true);
  const sourcesResult = await supabase.from("sources").select("*", { count: "exact", head: true });
  const articlesResult = await supabase.from("articles").select("*", { count: "exact", head: true });
  const linksResult = await supabase.from("event_articles").select("*", { count: "exact", head: true });
  const claimsResult = await supabase.from("claims").select("*", { count: "exact", head: true });
  const framesResult = await supabase.from("frames").select("*", { count: "exact", head: true });

  for (const [label, result] of [
    ["events", eventsResult],
    ["sources", sourcesResult],
    ["articles", articlesResult],
    ["event_articles", linksResult],
    ["claims", claimsResult],
    ["frames", framesResult],
  ] as const) {
    if (result.error) {
      throw new Error(`Failed to verify ${label}: ${result.error.message}`);
    }
  }

  const publishedEvents = eventsResult.count ?? 0;
  const sources = sourcesResult.count ?? 0;
  const articles = articlesResult.count ?? 0;
  const eventArticles = linksResult.count ?? 0;
  const claims = claimsResult.count ?? 0;
  const frames = framesResult.count ?? 0;

  if (publishedEvents < 2) {
    throw new Error(`Expected at least 2 published events, found ${publishedEvents}.`);
  }

  if (articles < 9 || eventArticles < 9) {
    throw new Error(
      `Expected at least 9 published articles and links, found ${articles} articles and ${eventArticles} links.`,
    );
  }

  if (claims < 6 || frames < 6) {
    throw new Error(`Expected claims and frames, found ${claims} claims and ${frames} frames.`);
  }

  console.log("Imported data verified through public Supabase/RLS path.");
  console.log(`- published events: ${publishedEvents}`);
  console.log(`- sources: ${sources}`);
  console.log(`- articles: ${articles}`);
  console.log(`- event links: ${eventArticles}`);
  console.log(`- claims: ${claims}`);
  console.log(`- frames: ${frames}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
