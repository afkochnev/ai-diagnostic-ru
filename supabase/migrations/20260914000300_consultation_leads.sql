alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check (kind in ('score_diagnostic','ai_report','consultation_notification'));

alter table public.diagnostics add constraint diagnostics_id_company_key unique (id, company_id);
alter table public.ai_reports add constraint ai_reports_id_diagnostic_key unique (id, diagnostic_id);

create table public.lead_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  diagnostic_id uuid not null,
  report_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  email text not null,
  contact_type text check (contact_type is null or contact_type in ('phone','telegram')),
  contact_value text,
  comment text,
  status text not null default 'new' check (status in ('new','contacted','consultation_scheduled','closed')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (diagnostic_id, company_id) references public.diagnostics(id, company_id) on delete restrict,
  foreign key (report_id, diagnostic_id) references public.ai_reports(id, diagnostic_id) on delete restrict,
  check ((contact_type is null and contact_value is null) or (contact_type is not null and contact_value is not null and char_length(btrim(contact_value)) > 0)),
  check (comment is null or char_length(comment) <= 3000)
);
create index lead_requests_owner_idx on public.lead_requests(user_id, created_at desc);
create unique index lead_requests_idempotency_idx on public.lead_requests(user_id, idempotency_key);
create unique index lead_requests_active_idx on public.lead_requests(user_id, report_id) where status in ('new','contacted','consultation_scheduled');

create table public.consultation_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_request_id uuid not null unique references public.lead_requests(id) on delete restrict,
  job_id uuid not null unique references public.jobs(id) on delete restrict,
  provider text not null default 'resend',
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.lead_requests enable row level security;
alter table public.consultation_notification_deliveries enable row level security;
grant select, insert on public.lead_requests to authenticated;
grant select on public.consultation_notification_deliveries to authenticated;
create policy lead_requests_owner_read on public.lead_requests for select to authenticated using (user_id = (select auth.uid()));
create policy lead_requests_owner_create on public.lead_requests for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.company_id=company_id and d.created_by_user_id=(select auth.uid())));
create policy consultation_delivery_owner_read on public.consultation_notification_deliveries for select to authenticated using (exists (select 1 from public.lead_requests l where l.id=lead_request_id and l.user_id=(select auth.uid())));

create or replace function public.create_lead_request(
  p_diagnostic_id uuid, p_report_id uuid, p_name text, p_contact_type text,
  p_contact_value text, p_comment text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare actor uuid := (select auth.uid()); u public.users%rowtype; d public.diagnostics%rowtype; r public.ai_reports%rowtype; existing public.lead_requests%rowtype; lead public.lead_requests%rowtype; j public.jobs%rowtype;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select * into u from public.users where id=actor;
  if u.id is null then raise exception 'user_not_found'; end if;
  if not exists (select 1 from auth.users au where au.id=actor and au.email_confirmed_at is not null) then raise exception 'email_not_verified'; end if;
  if char_length(btrim(coalesce(p_name,''))) < 2 or char_length(btrim(coalesce(p_name,''))) > 100 then raise exception 'invalid_name'; end if;
  if p_contact_type is not null and p_contact_type not in ('phone','telegram') then raise exception 'invalid_contact_type'; end if;
  if (p_contact_type is null) <> (nullif(btrim(coalesce(p_contact_value,'')),'') is null) then raise exception 'contact_pair_required'; end if;
  if p_contact_type='phone' and (btrim(p_contact_value) !~ '^\+?[0-9 ()-]{7,25}$' or regexp_replace(p_contact_value,'[^0-9]','','g') !~ '^[0-9]{7,15}$') then raise exception 'invalid_phone'; end if;
  if p_contact_type='telegram' and btrim(p_contact_value) !~* '^(https?://)?(www\.)?t\.me/|^@?[A-Za-z0-9_]{5,32}$' then raise exception 'invalid_telegram'; end if;
  if p_comment is not null and char_length(p_comment) > 3000 then raise exception 'invalid_comment'; end if;
  select * into existing from public.lead_requests where user_id=actor and idempotency_key=p_idempotency_key;
  if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',false,'lead_id',existing.id,'status',existing.status); end if;
  select * into d from public.diagnostics where id=p_diagnostic_id and created_by_user_id=actor and status='completed';
  if d.id is null then raise exception 'diagnostic_not_owned_or_completed'; end if;
  select * into r from public.ai_reports where id=p_report_id and diagnostic_id=d.id and status='completed';
  if r.id is null then raise exception 'report_not_owned_or_completed'; end if;
  select * into existing from public.lead_requests where user_id=actor and report_id=r.id and status in ('new','contacted','consultation_scheduled');
  if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status); end if;
  insert into public.lead_requests(user_id,company_id,diagnostic_id,report_id,name,email,contact_type,contact_value,comment,idempotency_key)
    select actor,d.company_id,d.id,r.id,btrim(p_name),(select email from auth.users where id=actor),p_contact_type,
      case when p_contact_type='phone' then regexp_replace(btrim(p_contact_value),'[() -]','','g') when p_contact_type='telegram' then regexp_replace(regexp_replace(regexp_replace(lower(btrim(p_contact_value)),'^https?://',''),'^www\.',''),'^t\.me/','') end,
      nullif(btrim(p_comment),''),p_idempotency_key returning * into lead;
  insert into public.jobs(kind,diagnostic_id,deduplication_key) values ('consultation_notification',lead.diagnostic_id,'lead:'||lead.id::text) returning * into j;
  insert into public.consultation_notification_deliveries(lead_request_id,job_id) values (lead.id,j.id);
  return jsonb_build_object('ok',true,'duplicate',false,'lead_id',lead.id,'status',lead.status);
exception when unique_violation then
  select * into existing from public.lead_requests where user_id=actor and report_id=p_report_id and status in ('new','contacted','consultation_scheduled');
  if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status); end if;
  raise;
end; $$;
grant execute on function public.create_lead_request(uuid,uuid,text,text,text,text,uuid) to authenticated;
