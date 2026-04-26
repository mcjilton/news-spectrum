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

## Deployment Notes

The public app is read-only. Readers can view generated analysis and source
links, but they must never trigger ingestion, clustering, model calls,
regeneration, queueing, or scheduling. See `docs/deployment-security.md` before
enabling live ingestion, scheduled jobs, or real model providers.
