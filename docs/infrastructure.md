# Infrastructure Plan

## Initial Target

- Vercel hosts the read-only Next.js app.
- Supabase hosts Postgres and `pgvector`.
- Manual private jobs run from a trusted developer machine or Codespace.
- Readers never trigger writes, ingestion, analysis, model calls, queues, or schedules.

## Deployment Modes

### `DATA_MODE=seed`

Current prototype mode. The app reads local seeded data from `lib/events.ts`.

### `DATA_MODE=imported`

Next target. The app reads already-published event analysis from Supabase.
Private jobs write the data.

### `DATA_MODE=live`

Future mode. Private scheduled jobs discover and analyze stories with strict
budget controls. The public app remains read-only.

## Supabase Setup

1. Create a Supabase project.
2. Apply migrations in `supabase/migrations`.
3. Confirm `vector` extension is enabled.
4. Store secrets outside git.
5. Use the anon key only for public read access.
6. Use the service-role key only in private jobs.

## Vercel Setup

Initial app env:

```text
DATA_MODE=seed
MODEL_PROVIDER=mock
DISABLE_LIVE_ANALYSIS=true
ENABLE_JOB_ENDPOINTS=false
```

When moving to imported data, add:

```text
DATA_MODE=imported
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Do not add service-role keys or model provider keys to any environment used by
reader-facing code.

## Private Job Runtime

Manual scripts are intentionally local/private entrypoints:

```bash
npm run ingest:manual
npm run analyze:manual
npm run merge:manual -- --dry-run
npm run enrich:manual
npm run inspect:candidates
npm run inspect:enriched
npm run candidates:reset
npm run mock:reset
npm run publish:candidate -- <candidate-slug>
npm run publish:manual
```

`ingest:manual` syncs the starter source catalog and imports recent article
metadata from GDELT into Supabase. It does not create events, publish rows, or
call an LLM. It requires `DATA_MODE=imported`, `SUPABASE_URL`, and
`SUPABASE_SERVICE_ROLE_KEY`. Article URLs are canonicalized before storage so
regional hosts and tracking parameters do not create duplicate candidates.

`analyze:manual` clusters recent, unlinked article metadata into unpublished
candidate events. The first pass is deterministic title-token clustering: it
does not scrape article bodies, publish events, create claims/frames, or call an
LLM. It deduplicates by canonical URL and same-source title keys, requires
distinct source domains, and runs a merge pass for closely related candidates.
Later analysis passes can enrich these candidates with LLM-generated facts and
framing analysis before publication.

`merge:manual` uses the configured model as a bounded adjudicator for borderline
candidate pairs. Dry-run mode reports structured merge decisions without writes;
write mode rewires article links and deletes only the merged-away unpublished
candidate.

`enrich:manual` selects unpublished clustered candidates and writes draft event
analysis, claims, and frames while keeping `is_published = false`. It should be
run with `MODEL_PROVIDER=mock` until the data flow has been verified; the mock
provider returns structured zero-cost output. Use `npm run enrich:manual --
--dry-run` to call the configured provider and validate structured output
without writing Supabase changes. Use `--refresh-enriched` only when an
unpublished enriched candidate needs analysis refreshed after its source set
changes, such as after a manual merge.

Live OpenAI enrichment is fail-closed: it requires `MODEL_PROVIDER=openai`,
`OPENAI_API_KEY`, a real `MODEL_SUMMARY`, `DISABLE_LIVE_ANALYSIS=false`, and a
positive `LLM_ESTIMATED_COST_USD_PER_CALL`. Non-mock enrichment is limited to
one candidate per run initially and checks the configured estimated-cost cap
before each model call.

`inspect:candidates` reads unpublished candidate events through the private
service-role path and prints compact source/article details for quality review.
It does not write data.

`inspect:enriched` reads unpublished enriched candidates and prints the full
draft package: summary, claims, frames, source coverage, and analysis-run audit
metadata. It does not write data.

`candidates:reset` deletes only unpublished candidate events where
`metadata.candidate = true`. Published events are not touched.

`mock:reset` deletes only mock-published candidate events carrying the mock
enrichment, manual publish, mock title, and mock analysis-run markers. It is a
rollback lever for end-to-end pipeline tests and should not match real events.

`publish:candidate` publishes exactly one enriched candidate by slug. It refuses
to publish unless the event is unpublished, marked as a candidate, enriched, and
has linked articles, claims, and frames.

`publish:manual` publishes already-prepared event analysis through the
Supabase/RLS read path.

All manual jobs are capped by environment variables such as
`MAX_DISCOVERY_QUERIES_PER_RUN`, `MAX_ARTICLES_PER_DISCOVERY_QUERY`,
`MAX_ARTICLES_PER_INGEST_RUN`, `MAX_EVENTS_PER_RUN`,
`MAX_ARTICLES_PER_EVENT`, `MIN_ARTICLES_PER_CLUSTER`,
`MIN_SOURCES_PER_CLUSTER`, `CLUSTER_SIMILARITY_THRESHOLD`, and
`MAX_LLM_CALLS_PER_RUN`, `MAX_LLM_ESTIMATED_COST_USD_PER_RUN`, and
`LLM_ESTIMATED_COST_USD_PER_CALL`.
