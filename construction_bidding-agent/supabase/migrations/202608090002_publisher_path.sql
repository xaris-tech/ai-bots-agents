create table if not exists public.publisher_devices (
  id text primary key,
  display_name text not null,
  key_salt bytea not null,
  key_hash bytea not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.publication_runs (
  run_id uuid primary key,
  publisher_id text not null references public.publisher_devices(id),
  schema_version integer not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  bid_count integer not null,
  created_at timestamptz not null default now()
);

alter table public.publisher_devices enable row level security;
alter table public.publication_runs enable row level security;
revoke all on public.publisher_devices from anon, authenticated;
revoke all on public.publication_runs from anon, authenticated;
