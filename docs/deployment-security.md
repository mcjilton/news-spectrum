# Deployment And Security Notes

## Public App Rule

The public app is read-only. Readers must never be able to create, update, delete, ingest, cluster, analyze, regenerate, queue, or schedule anything.

The site can be dynamic because data refreshes in the background, but every refresh must originate from a private manual or scheduled process controlled by the project owner.

The public app should only read already-generated event analysis.

Ingestion and analysis should run only from:

- manual command-line jobs
- scheduled jobs controlled by the project owner
- protected server-side job endpoints, if explicitly enabled later and never reachable from reader-facing UI

## Cost Control Rule

Live analysis stays disabled by default. Enable it only when run caps, provider budgets, and job authentication are configured.

Required controls before live ingestion:

- `DISABLE_LIVE_ANALYSIS=false`
- `ENABLE_JOB_ENDPOINTS=true` only if protected job endpoints exist
- strong `INGESTION_JOB_TOKEN` and `ANALYSIS_JOB_TOKEN`
- `MAX_EVENTS_PER_RUN`
- `MAX_ARTICLES_PER_EVENT`
- `MAX_LLM_CALLS_PER_RUN`
- `MAX_LLM_ESTIMATED_COST_USD_PER_RUN`

## Secret Handling

- Never commit `.env` files.
- Never expose server secrets with `NEXT_PUBLIC_` prefixes.
- Keep `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and job tokens server-only.
- Use Vercel/Supabase secret stores for deployed environments.
- Treat article text as untrusted input inside model prompts.

## Initial Deployment Mode

Deploy the first public MVP in `DATA_MODE=seed` or `DATA_MODE=imported`.

`DATA_MODE=live` should wait until we have:

- database schema and migrations
- ingestion job scripts
- model budget tracking
- deduplication before model calls
- source-count and event-count caps
- logs for every analysis run

## Architecture Boundary

Public runtime:

- render pages
- read published event analysis
- read source metadata and outbound links
- never mutate data
- never call model providers
- never call ingestion providers

Private runtime:

- discover articles
- cluster events
- extract claims
- generate summaries
- compare framing
- write analysis results
- enforce run budgets and caps
