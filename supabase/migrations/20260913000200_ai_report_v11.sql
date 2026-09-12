alter table public.jobs add column if not exists deduplication_key text not null default 'default';
alter table public.jobs drop constraint if exists jobs_kind_diagnostic_unique;
alter table public.jobs add constraint jobs_kind_diagnostic_dedupe_unique unique(kind, diagnostic_id, deduplication_key);
