#!/usr/bin/env bash

# Non-sensitive local runtime defaults and pipeline guardrails.
# Source this file from a terminal before running manual jobs:
#   source ./local-runtime.env.sh

# Non-sensitive app/runtime mode.
export DATA_MODE=imported
export NEXT_PUBLIC_APP_URL=https://news-spectrum-three.vercel.app
export ENABLE_JOB_ENDPOINTS=false
export OLLAMA_BASE_URL=http://localhost:11434

# Non-sensitive model routing. Credentials still belong only in the shell/env.
export MODEL_PROVIDER=openai
export MODEL_SUMMARY=gpt-5.5
export MODEL_EXTRACTION=mock-extraction
export MODEL_EMBEDDINGS=mock-embeddings
export DISABLE_LIVE_ANALYSIS=false

export MAX_EVENTS_PER_RUN=5
export MAX_ARTICLES_PER_EVENT=40
export MAX_DISCOVERY_QUERIES_PER_RUN=8
export MAX_ARTICLES_PER_DISCOVERY_QUERY=15
export MAX_ARTICLES_PER_INGEST_RUN=80
export ENABLE_RSS_DISCOVERY=true
export MAX_AGGREGATOR_FEED_ITEMS_PER_RUN=60
export MAX_EVIDENCE_ARTICLES_PER_RUN=25
export MAX_EVIDENCE_CHARS_PER_ARTICLE=900
export MAX_EVIDENCE_CHARS_PER_EVENT=18000
export MIN_ARTICLES_PER_CLUSTER=2
export MIN_SOURCES_PER_CLUSTER=2
export CLUSTER_SIMILARITY_THRESHOLD=0.3
export MAX_LLM_CALLS_PER_RUN=25
export MAX_LLM_ESTIMATED_COST_USD_PER_RUN=2
