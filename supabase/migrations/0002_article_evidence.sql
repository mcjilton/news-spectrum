create table article_evidence (
  article_id uuid primary key references articles(id) on delete cascade,
  extraction_status text not null default 'pending',
  evidence_text text,
  evidence_char_count integer not null default 0,
  extracted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (extraction_status in ('pending', 'succeeded', 'failed', 'skipped'))
);

create index article_evidence_status_idx on article_evidence(extraction_status);
create index article_evidence_extracted_at_idx on article_evidence(extracted_at desc);

alter table article_evidence enable row level security;
