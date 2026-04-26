create extension if not exists vector;

create type source_spectrum as enum (
  'left',
  'lean_left',
  'center',
  'lean_right',
  'right',
  'unknown'
);

create type source_type as enum (
  'wire',
  'mainstream',
  'partisan',
  'local',
  'opinion_heavy',
  'policy',
  'state_media',
  'unknown'
);

create type event_status as enum (
  'monitoring',
  'developing',
  'settled',
  'archived'
);

create type claim_stance as enum (
  'supports',
  'contradicts',
  'mentions'
);

create type analysis_run_status as enum (
  'started',
  'succeeded',
  'failed',
  'skipped_budget'
);

create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  homepage_url text,
  country text not null default 'US',
  language text not null default 'en',
  spectrum source_spectrum not null default 'unknown',
  source_type source_type not null default 'unknown',
  rating_source text,
  rating_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete restrict,
  url text not null,
  canonical_url text,
  title text not null,
  description text,
  author text,
  published_at timestamptz,
  fetched_at timestamptz,
  content_hash text,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (url)
);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  topic text not null,
  status event_status not null default 'monitoring',
  summary text,
  confidence integer not null default 0 check (confidence between 0 and 100),
  divergence integer not null default 0 check (divergence between 0 and 100),
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  published_at timestamptz,
  is_published boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table event_articles (
  event_id uuid not null references events(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  relevance_score numeric(5,4) not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, article_id)
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  claim_text text not null,
  claim_type text not null default 'fact',
  confidence integer not null default 0 check (confidence between 0 and 100),
  is_core_fact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table claim_support (
  claim_id uuid not null references claims(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  stance claim_stance not null default 'mentions',
  quote text,
  created_at timestamptz not null default now(),
  primary key (claim_id, article_id, stance)
);

create table frames (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  bucket source_spectrum not null,
  label text not null,
  summary text not null,
  emphasis text[] not null default '{}',
  language text[] not null default '{}',
  source_article_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table analysis_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  run_type text not null,
  status analysis_run_status not null default 'started',
  provider text not null,
  model text not null,
  prompt_version text not null,
  source_article_ids uuid[] not null default '{}',
  input_hash text,
  estimated_cost_usd numeric(10,4) not null default 0,
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index articles_source_id_idx on articles(source_id);
create index articles_published_at_idx on articles(published_at desc);
create index events_published_idx on events(is_published, published_at desc);
create index event_articles_article_id_idx on event_articles(article_id);
create index claims_event_id_idx on claims(event_id);
create index frames_event_bucket_idx on frames(event_id, bucket);
create index analysis_runs_event_id_idx on analysis_runs(event_id);

alter table sources enable row level security;
alter table articles enable row level security;
alter table events enable row level security;
alter table event_articles enable row level security;
alter table claims enable row level security;
alter table claim_support enable row level security;
alter table frames enable row level security;
alter table analysis_runs enable row level security;

create policy "public can read sources"
  on sources for select
  using (true);

create policy "public can read published events"
  on events for select
  using (is_published = true);

create policy "public can read articles attached to published events"
  on articles for select
  using (
    exists (
      select 1
      from event_articles
      join events on events.id = event_articles.event_id
      where event_articles.article_id = articles.id
        and events.is_published = true
    )
  );

create policy "public can read published event article links"
  on event_articles for select
  using (
    exists (
      select 1
      from events
      where events.id = event_articles.event_id
        and events.is_published = true
    )
  );

create policy "public can read claims for published events"
  on claims for select
  using (
    exists (
      select 1
      from events
      where events.id = claims.event_id
        and events.is_published = true
    )
  );

create policy "public can read claim support for published events"
  on claim_support for select
  using (
    exists (
      select 1
      from claims
      join events on events.id = claims.event_id
      where claims.id = claim_support.claim_id
        and events.is_published = true
    )
  );

create policy "public can read frames for published events"
  on frames for select
  using (
    exists (
      select 1
      from events
      where events.id = frames.event_id
        and events.is_published = true
    )
  );
