create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  ai_report_id uuid not null references public.ai_reports(id) on delete restrict,
  ai_report_version integer not null,
  pdf_artifact_id uuid not null references public.report_artifacts(id) on delete restrict,
  recipient_email text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  provider text not null,
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (ai_report_id, ai_report_version) references public.ai_reports(id, version)
);

create index email_deliveries_owner_idx on public.email_deliveries(user_id, created_at desc);
create unique index email_deliveries_active_idx on public.email_deliveries(user_id, ai_report_id) where status in ('queued','sending');
alter table public.email_deliveries enable row level security;
grant select on public.email_deliveries to authenticated;
create policy email_deliveries_owner_read on public.email_deliveries for select to authenticated using (user_id = (select auth.uid()));
