alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('score_diagnostic','ai_report'));
alter table public.jobs drop constraint if exists jobs_diagnostic_id_key;
alter table public.jobs add constraint jobs_kind_diagnostic_unique unique(kind, diagnostic_id);
create table public.ai_reports (
 id uuid primary key default gen_random_uuid(), diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
 version integer not null, prompt_version text not null, schema_version text not null, model text not null,
 status text not null check (status in ('queued','generating','completed','failed')),
 input_snapshot jsonb not null, input_hash text not null, structured_content jsonb,
 provider_request_id text, error_code text, error_message text, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(diagnostic_id,version)
);
create unique index ai_reports_one_completed on public.ai_reports(diagnostic_id) where status='completed';
alter table public.ai_reports enable row level security;
grant select on public.ai_reports to authenticated;
create policy ai_reports_owner_read on public.ai_reports for select to authenticated using (exists(select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid())));
