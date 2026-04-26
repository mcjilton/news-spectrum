# News Comparison MVP

## Intent

This product is not a truth oracle. It highlights the clearest shared facts around a news event, then shows how different outlets frame, emphasize, omit, or interpret those facts across the political spectrum.

The user should leave with:

- a concise understanding of what appears broadly agreed upon
- a clear view of where coverage diverges
- links to original reporting
- enough source context to make their own judgment

## Primary Audience

Politically curious power users who already read news but want a faster way to compare coverage across many outlets.

## MVP Scope

- Focus on U.S. national news and politics.
- Use algorithmic event discovery only; no editorial/admin curation.
- Prioritize source breadth while weighting duplicated or low-quality coverage appropriately.
- Use LLM-assisted summaries and framing analysis.
- Keep all analysis citation-heavy and link back to original materials.
- Do not republish full article text.

## Initial Product Surface

### Event Feed

- Shows algorithmically detected events.
- Sorts by freshness, coverage breadth, and framing divergence.
- Displays source count, spectrum coverage, confidence, and summary.

### Event Detail

- Core facts agreed across coverage.
- Spectrum comparison for Left, Center, and Right.
- Framing differences: emphasis, language, causal explanation, blame/agency.
- Source table with original links.
- Methodology and confidence notes.

## First Technical Milestone

Build a real app shell with seeded data before live ingestion. This lets us test the information architecture, visual hierarchy, and analysis model before solving ingestion and clustering edge cases.

## Later Pipeline

1. Ingest articles from GDELT, RSS, and optional commercial APIs.
2. Normalize source metadata and canonical URLs.
3. Cluster articles into event groups.
4. Extract claims, entities, and event facts.
5. Assign source spectrum metadata.
6. Summarize agreed facts and framing differences with citations.
7. Regenerate analysis when new coverage materially changes an event.
