alter table public.ai_reports add constraint ai_reports_id_version_key unique (id, version);
create table public.report_artifacts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.ai_reports(id) on delete restrict,
  ai_report_version integer not null,
  format text not null check (format = 'pdf'),
  template_version text not null,
  status text not null check (status in ('ready','failed')),
  storage_path text not null,
  content_base64 text not null,
  checksum text not null,
  generated_at timestamptz not null default now(),
  unique (report_id, format, template_version),
  foreign key (report_id, ai_report_version) references public.ai_reports(id, version)
);
alter table public.report_artifacts enable row level security;
grant select on public.report_artifacts to authenticated;
create policy report_artifacts_owner_read on public.report_artifacts for select to authenticated using (exists (select 1 from public.ai_reports ar join public.diagnostics d on d.id=ar.diagnostic_id where ar.id=report_id and d.created_by_user_id=(select auth.uid())));
