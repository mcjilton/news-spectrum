import { createServiceSupabaseClient } from "../../lib/supabase/runtime.ts";
import { events, type EventSource, type NewsEvent, type SpectrumBucket } from "../../lib/events.ts";
import { assertManualPublishEnabled } from "./guards.ts";

type SourceRow = {
  id: string;
  name: string;
};

type ArticleRow = {
  id: string;
  url: string;
};

function spectrumForSource(bucket: SpectrumBucket, rating: string) {
  const normalized = rating.toLowerCase();

  if (normalized === "lean left") {
    return "lean_left";
  }

  if (normalized === "lean right") {
    return "lean_right";
  }

  return bucket;
}

function sourceTypeForDb(type: EventSource["type"]) {
  return type === "opinion-heavy" ? "opinion_heavy" : type;
}

function placeholderPublishedAt(index: number) {
  return new Date(Date.UTC(2026, 0, 1, 12, index, 0)).toISOString();
}

async function upsertSources(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  event: NewsEvent,
) {
  const uniqueSources = new Map<string, EventSource>();

  for (const source of event.sources) {
    uniqueSources.set(source.outlet, source);
  }

  const rows = [...uniqueSources.values()].map((source) => ({
    name: source.outlet,
    country: "US",
    language: "en",
    spectrum: spectrumForSource(source.bucket, source.rating),
    source_type: sourceTypeForDb(source.type),
    notes: "Seed prototype source.",
  }));

  const { data, error } = await supabase
    .from("sources")
    .upsert(rows, { onConflict: "name" })
    .select("id, name");

  if (error) {
    throw new Error(`Failed to upsert sources for ${event.slug}: ${error.message}`);
  }

  return new Map((data as SourceRow[]).map((source) => [source.name, source.id]));
}

async function upsertArticles(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  event: NewsEvent,
  sourceIdsByName: Map<string, string>,
) {
  const rows = event.sources.map((source, index) => {
    const sourceId = sourceIdsByName.get(source.outlet);

    if (!sourceId) {
      throw new Error(`Missing source id for ${source.outlet}`);
    }

    return {
      source_id: sourceId,
      url: source.url,
      canonical_url: source.url,
      title: source.title,
      published_at: placeholderPublishedAt(index),
      content_hash: `seed:${event.slug}:${source.id}`,
      metadata: {
        frame: source.frame,
        rating: source.rating,
        localId: source.id,
      },
    };
  });

  const { data, error } = await supabase
    .from("articles")
    .upsert(rows, { onConflict: "url" })
    .select("id, url");

  if (error) {
    throw new Error(`Failed to upsert articles for ${event.slug}: ${error.message}`);
  }

  return new Map((data as ArticleRow[]).map((article) => [article.url, article.id]));
}

async function upsertEvent(supabase: ReturnType<typeof createServiceSupabaseClient>, event: NewsEvent) {
  const { data, error } = await supabase
    .from("events")
    .upsert(
      {
        slug: event.slug,
        title: event.title,
        topic: event.topic,
        status: event.status,
        summary: event.summary,
        confidence: event.confidence,
        divergence: event.divergence,
        first_seen_at: "2026-01-01T12:00:00.000Z",
        last_seen_at: "2026-01-01T12:30:00.000Z",
        published_at: new Date().toISOString(),
        is_published: true,
        metadata: {
          sharedFacts: event.sharedFacts,
          disputedOrVariable: event.disputedOrVariable,
          timespan: event.timespan,
          updatedAt: event.updatedAt,
        },
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to upsert event ${event.slug}: ${error.message}`);
  }

  return data.id as string;
}

async function replaceEventAnalysis(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  event: NewsEvent,
  eventId: string,
  articleIdsByUrl: Map<string, string>,
) {
  const linkedArticles = event.sources.map((source) => {
    const articleId = articleIdsByUrl.get(source.url);

    if (!articleId) {
      throw new Error(`Missing article id for ${source.url}`);
    }

    return {
      articleId,
      source,
    };
  });

  const { error: linkDeleteError } = await supabase
    .from("event_articles")
    .delete()
    .eq("event_id", eventId);

  if (linkDeleteError) {
    throw new Error(`Failed to clear event links for ${event.slug}: ${linkDeleteError.message}`);
  }

  const { error: linkInsertError } = await supabase.from("event_articles").insert(
    linkedArticles.map(({ articleId }) => ({
      event_id: eventId,
      article_id: articleId,
      relevance_score: 1,
    })),
  );

  if (linkInsertError) {
    throw new Error(`Failed to insert event links for ${event.slug}: ${linkInsertError.message}`);
  }

  const { error: claimsDeleteError } = await supabase.from("claims").delete().eq("event_id", eventId);

  if (claimsDeleteError) {
    throw new Error(`Failed to clear claims for ${event.slug}: ${claimsDeleteError.message}`);
  }

  const claimRows = event.sharedFacts.map((fact) => ({
    event_id: eventId,
    claim_text: fact,
    claim_type: "fact",
    confidence: event.confidence,
    is_core_fact: true,
  }));

  const { data: claims, error: claimsInsertError } = await supabase
    .from("claims")
    .insert(claimRows)
    .select("id");

  if (claimsInsertError) {
    throw new Error(`Failed to insert claims for ${event.slug}: ${claimsInsertError.message}`);
  }

  const claimSupportRows = (claims as Array<{ id: string }>).flatMap((claim) =>
    linkedArticles.map(({ articleId }) => ({
      claim_id: claim.id,
      article_id: articleId,
      stance: "mentions",
    })),
  );

  if (claimSupportRows.length > 0) {
    const { error: supportError } = await supabase.from("claim_support").insert(claimSupportRows);

    if (supportError) {
      throw new Error(`Failed to insert claim support for ${event.slug}: ${supportError.message}`);
    }
  }

  const { error: framesDeleteError } = await supabase.from("frames").delete().eq("event_id", eventId);

  if (framesDeleteError) {
    throw new Error(`Failed to clear frames for ${event.slug}: ${framesDeleteError.message}`);
  }

  const frameRows = event.spectrum.map((frame) => ({
    event_id: eventId,
    bucket: frame.bucket,
    label: frame.label,
    summary: frame.summary,
    emphasis: frame.emphasis,
    language: frame.language,
    source_article_ids: frame.sourceIds
      .map((sourceId) => event.sources.find((source) => source.id === sourceId))
      .map((source) => (source ? articleIdsByUrl.get(source.url) : undefined))
      .filter((articleId): articleId is string => Boolean(articleId)),
  }));

  const { error: framesInsertError } = await supabase.from("frames").insert(frameRows);

  if (framesInsertError) {
    throw new Error(`Failed to insert frames for ${event.slug}: ${framesInsertError.message}`);
  }
}

async function main() {
  assertManualPublishEnabled("publish:manual");

  const supabase = createServiceSupabaseClient();

  for (const event of events) {
    const sourceIdsByName = await upsertSources(supabase, event);
    const articleIdsByUrl = await upsertArticles(supabase, event, sourceIdsByName);
    const eventId = await upsertEvent(supabase, event);
    await replaceEventAnalysis(supabase, event, eventId, articleIdsByUrl);
    console.log(`Published seed event: ${event.slug}`);
  }

  console.log(`Published ${events.length} seed events.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
