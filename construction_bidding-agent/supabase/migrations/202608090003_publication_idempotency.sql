alter table public.publication_runs
  add column if not exists content_checksum text not null default '',
  add column if not exists result_json jsonb;

alter table public.publication_runs
  add constraint publication_runs_checksum_format
  check (content_checksum = '' or content_checksum ~ '^[0-9a-f]{64}$');
