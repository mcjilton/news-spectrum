# News Spectrum

Prototype for an AI-assisted news comparison site.

The product goal is to surface broadly agreed facts about a U.S. news event, then show how different outlets frame or spin those facts across the political spectrum. It is not intended to decide the truth for readers; it should make source material and framing differences easier to inspect.

## Current State

- Next.js app shell
- Seeded event feed
- Seeded event detail pages
- Left / Center / Right framing comparison
- Source table with outbound links
- MVP plan in `docs/mvp-plan.md`

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Copy `.env.example` to `.env.local` when adding real services. The prototype
defaults to seeded data and mock model providers; do not put real secrets in
tracked files.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

Imported Supabase data can be checked through the public/RLS path with:

```bash
npm run verify:imported
```

Private article discovery can be run manually after Supabase service-role
secrets are available in the current shell:

```bash
npm run ingest:manual
```

The ingestion script imports source and article metadata only. It does not
publish events or run model analysis.

Private candidate clustering can be run after ingestion:

```bash
npm run analyze:manual
```

The current analysis job creates unpublished candidate events only. It does not
run LLM analysis or expose new content to readers.

Candidate quality can be inspected without writing data:

```bash
npm run inspect:candidates
```

## Deployment Notes

The public app is read-only. Readers can view generated analysis and source
links, but they must never trigger ingestion, clustering, model calls,
regeneration, queueing, or scheduling. See `docs/deployment-security.md` before
enabling live ingestion, scheduled jobs, or real model providers.
