create table if not exists public.entity_check_results (
  run_id uuid not null references public.publication_runs(run_id) on delete cascade,
  source_id text not null,
  status text not null,
  warning text not null default '',
  record_count integer not null default 0,
  retained_count integer not null default 0,
  checked_at timestamptz not null,
  primary key (run_id, source_id)
);

create table if not exists public.opportunity_sources (
  dedupe_key text not null references public.bids(dedupe_key) on delete cascade,
  source_id text not null,
  source_url text not null default '',
  is_current boolean not null default true,
  first_seen_run_id uuid not null references public.publication_runs(run_id),
  last_seen_run_id uuid not null references public.publication_runs(run_id),
  updated_at timestamptz not null default now(),
  primary key (dedupe_key, source_id, source_url)
);

create index if not exists opportunity_sources_current_source_idx
  on public.opportunity_sources (source_id, is_current);

alter table public.entity_check_results enable row level security;
alter table public.opportunity_sources enable row level security;
revoke all on public.entity_check_results from anon, authenticated;
revoke all on public.opportunity_sources from anon, authenticated;
