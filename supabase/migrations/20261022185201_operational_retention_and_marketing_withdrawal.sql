-- Operational retention only. No legal publication, scheduled execution or historical rewrites.
begin;
alter table private.anonymous_diagnostic_sessions add column retention_purged_at timestamptz;
alter table public.email_deliveries add column retention_minimized_at timestamptz;
alter table public.consultation_notification_deliveries add column retention_minimized_at timestamptz;

-- Explicit, reviewed exceptions; never infer legal evidence from analytics event names.
create table private.retention_holds (
 category text not null check(category in ('anonymous_sessions','product_events','email_deliveries','consultation_deliveries')),
 record_id uuid not null, basis_code text not null check(basis_code in ('legal_claim','statutory_evidence')),
 review_at timestamptz not null, created_at timestamptz not null default now(), primary key(category,record_id)
);
alter table private.retention_holds enable row level security;
revoke all on private.retention_holds from public,anon,authenticated,service_role;

create table private.retention_runs (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
 counts jsonb not null, batch_size integer not null check(batch_size between 1 and 500), scoped boolean not null
);
alter table private.retention_runs enable row level security;
revoke all on private.retention_runs from public,anon,authenticated,service_role;
create trigger retention_runs_immutable before update or delete on private.retention_runs
 for each row execute function private.reject_result_change();

-- Manual service-only entry point, no cron and no execution during migration.
-- NULL scope means all eligible rows; an object limits EACH category to exact IDs.
-- Empty/missing category arrays mean no candidates (never a fallback to global scope).
create function public.run_retention_maintenance(p_dry_run boolean default true,p_batch_size integer default 100,p_scope jsonb default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare cat text; ids uuid[]; candidates jsonb:='{}'; affected jsonb:='{}'; n integer; run_id uuid;
 cutoff timestamptz:=statement_timestamp();
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'retention_forbidden';end if;
 if p_dry_run is null or p_batch_size is null or p_batch_size not between 1 and 500 then raise exception 'retention_invalid';end if;
 if p_scope is not null then
  if jsonb_typeof(p_scope)<>'object' or exists(select 1 from jsonb_object_keys(p_scope) k where k not in
   ('anonymous_sessions','product_events','email_deliveries','consultation_deliveries')) then raise exception 'retention_invalid';end if;
  for cat in select jsonb_object_keys(p_scope) loop
   if jsonb_typeof(p_scope->cat)<>'array' or jsonb_array_length(p_scope->cat)>500 then raise exception 'retention_invalid';end if;
   if exists(select 1 from jsonb_array_elements_text(p_scope->cat) x where x is null or x !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$') then raise exception 'retention_invalid';end if;
  end loop;
 end if;
 -- Serialize maintenance runs. Claim/session mutations lock the same session rows.
 perform pg_advisory_xact_lock(270022,1);
 for cat in select unnest(array['anonymous_sessions','product_events','email_deliveries','consultation_deliveries']) loop
  ids:='{}';
  if cat='anonymous_sessions' then
   select coalesce(array_agg(t.id),'{}') into ids from (
    select s.id from private.anonymous_diagnostic_sessions s
    where s.expires_at<=cutoff and s.status<>'claimed' and s.claimed_diagnostic_id is null
     and s.claimed_at is null and s.claimed_user_id is null and s.claimed_account_id is null and s.claimed_company_id is null
     and s.retention_purged_at is null
     and (p_scope is null or s.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_scope->cat,'[]'))))
     and not exists(select 1 from private.retention_holds h where h.category=cat and h.record_id=s.id)
    order by s.expires_at,s.id limit p_batch_size for update of s skip locked
   )t;
  elsif cat='product_events' then
   select coalesce(array_agg(t.id),'{}') into ids from (
    select e.id from private.product_events e where e.occurred_at<cutoff-interval '12 months'
     and (p_scope is null or e.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_scope->cat,'[]'))))
     and not exists(select 1 from private.retention_holds h where h.category=cat and h.record_id=e.id)
    order by e.occurred_at,e.id limit p_batch_size for update of e skip locked
   )t;
  elsif cat='email_deliveries' then
   select coalesce(array_agg(t.id),'{}') into ids from (
    select e.id from public.email_deliveries e where greatest(e.created_at,e.updated_at,e.sent_at)<cutoff-interval '12 months'
     and e.status in ('sent','failed') and e.retention_minimized_at is null
     and (p_scope is null or e.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_scope->cat,'[]'))))
     and not exists(select 1 from private.retention_holds h where h.category=cat and h.record_id=e.id)
    order by e.created_at,e.id limit p_batch_size for update of e skip locked
   )t;
  else
   select coalesce(array_agg(t.id),'{}') into ids from (
    select e.id from public.consultation_notification_deliveries e where greatest(e.created_at,e.updated_at,e.sent_at)<cutoff-interval '12 months'
     and e.status in ('sent','failed') and e.retention_minimized_at is null
     and (p_scope is null or e.id in(select value::uuid from jsonb_array_elements_text(coalesce(p_scope->cat,'[]'))))
     and not exists(select 1 from private.retention_holds h where h.category=cat and h.record_id=e.id)
    order by e.created_at,e.id limit p_batch_size for update of e skip locked
   )t;
  end if;
  candidates:=candidates||jsonb_build_object(cat,cardinality(ids));n:=0;
  if not p_dry_run and cardinality(ids)>0 then
   if cat='anonymous_sessions' then
    -- Preserve non-identifying consent evidence and the FK tombstone, erase all temporary content/proofs.
    update private.anonymous_diagnostic_sessions set answers='{}',company_context_draft=null,target_email=null,display_name=null,
     identity_nonce_hash=null,pending_auth_user_id=null,secret_hash=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex'),
     status='expired',retention_purged_at=cutoff,updated_at=cutoff where id=any(ids);
    get diagnostics n=row_count;
    update private.acquisition_visits v set attribution='{}',secret_hash=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex')
     from private.anonymous_diagnostic_sessions s where s.id=any(ids) and s.visit_id=v.id;
   elsif cat='product_events' then
    delete from private.product_events where id=any(ids);get diagnostics n=row_count;
   elsif cat='email_deliveries' then
    update public.email_deliveries set recipient_email='redacted@invalid.invalid',provider_message_id=null,
     last_error_code=null,last_error_message=null,retention_minimized_at=cutoff where id=any(ids);get diagnostics n=row_count;
   else
    update public.consultation_notification_deliveries set provider_message_id=null,last_error_code=null,
     last_error_message=null,retention_minimized_at=cutoff where id=any(ids);get diagnostics n=row_count;
   end if;
  end if;
  affected:=affected||jsonb_build_object(cat,n);
 end loop;
 if not p_dry_run then
  insert into private.retention_runs(counts,batch_size,scoped) values(affected,p_batch_size,p_scope is not null) returning id into run_id;
 end if;
 return jsonb_build_object('dry_run',p_dry_run,'batch_size_per_category',p_batch_size,'scoped',p_scope is not null,
  'candidate_counts',candidates,'affected_counts',affected,'run_id',run_id);
end;$$;
revoke all on function public.run_retention_maintenance(boolean,integer,jsonb) from public,anon,authenticated;
grant execute on function public.run_retention_maintenance(boolean,integer,jsonb) to service_role;

-- Eligibility is distinct from immutable issuance/withdrawal evidence.
create table private.marketing_preferences (
 user_id uuid primary key references public.users(id), marketing_allowed boolean not null check(not marketing_allowed),
 withdrawn_at timestamptz not null default now()
);
create table private.marketing_withdrawals (
 request_id uuid primary key, user_id uuid not null references public.users(id),
 received_at timestamptz not null default now(), source text not null check(source in ('self_service','operator_verified'))
);
alter table private.marketing_preferences enable row level security;
alter table private.marketing_withdrawals enable row level security;
revoke all on private.marketing_preferences,private.marketing_withdrawals from public,anon,authenticated,service_role;
create trigger marketing_withdrawals_immutable before update or delete on private.marketing_withdrawals
 for each row execute function private.reject_result_change();
-- Existing rows remain byte-for-byte identical; no UPDATE or backfill.
create trigger user_consents_immutable before update or delete on public.user_consents
 for each row execute function private.reject_result_change();

create function public.withdraw_marketing_consent(p_request_id uuid,p_user_id uuid default null) returns boolean
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target uuid; previous private.marketing_withdrawals;
begin
 if auth.jwt()->>'role'='service_role' then target:=p_user_id;
 elsif private.is_verified_session() and (p_user_id is null or p_user_id=actor) then target:=actor;
 else raise exception 'marketing_forbidden';end if;
 if target is null or p_request_id is null or not exists(select 1 from public.users where id=target) then raise exception 'marketing_invalid';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,270022));
 select * into previous from private.marketing_withdrawals where request_id=p_request_id;
 if previous.request_id is not null then
  if previous.user_id<>target then raise exception 'marketing_invalid';end if;return true;
 end if;
 insert into private.marketing_withdrawals(request_id,user_id,source) values(p_request_id,target,
  case when auth.jwt()->>'role'='service_role' then 'operator_verified' else 'self_service' end);
 insert into private.marketing_preferences(user_id,marketing_allowed) values(target,false)
 on conflict(user_id) do update set marketing_allowed=false,withdrawn_at=now();
 insert into private.audit_events(actor_id,subject_id,action) values(actor,target,'marketing_withdrawn');
 return true;
end;$$;
revoke all on function public.withdraw_marketing_consent(uuid,uuid) from public,anon;
grant execute on function public.withdraw_marketing_consent(uuid,uuid) to authenticated,service_role;
create function public.marketing_send_allowed(p_user_id uuid) returns boolean
 language plpgsql stable security definer set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'marketing_forbidden';end if;
 return exists(select 1 from public.users where id=p_user_id)
  and not exists(select 1 from private.marketing_preferences where user_id=p_user_id and not marketing_allowed)
  and coalesce((select granted from public.user_consents where user_id=p_user_id and kind='marketing'
    order by recorded_at desc,id desc limit 1),false);
end;$$;
revoke all on function public.marketing_send_allowed(uuid) from public,anon,authenticated;
grant execute on function public.marketing_send_allowed(uuid) to service_role;
-- Empty publication registry: no draft bodies or final version switch in this migration.
create table public.privacy_legal_documents (
 version text primary key check(version ~ '^[a-z0-9-]{1,100}$'),
 kind text not null check(kind in ('policy','data_processing','marketing')),
 body text not null, body_sha256 text not null check(body_sha256=encode(sha256(convert_to(body,'UTF8')),'hex')),
 policy_version text references public.privacy_legal_documents(version) deferrable initially deferred,
 approved_at timestamptz not null, published_at timestamptz not null,
 check((kind='policy')=(policy_version is null))
);
alter table public.privacy_legal_documents enable row level security;
revoke all on public.privacy_legal_documents from public,anon,authenticated,service_role;
grant select on public.privacy_legal_documents to anon,authenticated,service_role;
create policy published_privacy_documents on public.privacy_legal_documents for select to anon,authenticated,service_role using(true);
create trigger privacy_legal_documents_immutable before update or delete on public.privacy_legal_documents
 for each row execute function private.reject_result_change();
create index retention_email_pending on public.email_deliveries(created_at) where retention_minimized_at is null and status in ('sent','failed');
create index retention_consultation_pending on public.consultation_notification_deliveries(created_at) where retention_minimized_at is null and status in ('sent','failed');
commit;
