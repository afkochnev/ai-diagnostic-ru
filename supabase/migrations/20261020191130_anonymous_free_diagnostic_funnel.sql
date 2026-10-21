-- V2.5. Staging-only rollout; no historical migration replay.
begin;
-- Unknown progressive context is NULL, never an invented business fact.
alter table public.company_profiles alter column country drop not null,
 alter column customer_segments drop not null, alter column sales_channels drop not null,
 alter column annual_revenue_key drop not null, alter column company_age_years drop not null,
 alter column management_levels drop not null;

create table private.acquisition_visits(
 id uuid primary key default gen_random_uuid(), secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 attribution jsonb not null default '{}', created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days'
);
create table private.anonymous_diagnostic_sessions(
 id uuid primary key default gen_random_uuid(), visit_id uuid not null unique references private.acquisition_visits(id),
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 methodology_version_id uuid not null references public.diagnostic_versions(id),
 status text not null default 'in_progress' check(status in('in_progress','diagnostic_completed','profile_completed','email_pending','claim_pending','claimed','expired')),
 revision integer not null default 1 check(revision>0), current_block_id uuid not null references public.diagnostic_blocks(id),
 answers jsonb not null default '{}', company_context_draft jsonb,
 consent_version text not null, consented_at timestamptz not null,
 marketing_version text, marketing_granted boolean not null default false, marketing_accepted_at timestamptz,
 target_email text, display_name text, identity_nonce_hash text, pending_auth_user_id uuid references auth.users(id),
 identity_finalized_at timestamptz,
 email_generation integer not null default 0, email_requested_at timestamptz, email_sent_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 expires_at timestamptz not null default now()+interval '7 days',
 claimed_at timestamptz, claimed_user_id uuid references public.users(id), claimed_account_id uuid references public.accounts(id),
 claimed_company_id uuid references public.company_profiles(id), claimed_diagnostic_id uuid unique references public.diagnostics(id),
 check(octet_length(answers::text)<=262144), check(company_context_draft is null or octet_length(company_context_draft::text)<=32768),
 check(target_email is null or (target_email=lower(target_email) and length(target_email)<=254)),
 check((status='claimed')=(claimed_diagnostic_id is not null))
);
create table private.anonymous_diagnostic_consents(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references private.anonymous_diagnostic_sessions(id),
 kind text not null check(kind in('data_processing','marketing')),version text not null,granted boolean not null,
 accepted_at timestamptz not null,check(kind<>'data_processing' or granted)
);
create index anonymous_consents_session on private.anonymous_diagnostic_consents(session_id,accepted_at);
alter table private.anonymous_diagnostic_consents enable row level security;
revoke all on private.anonymous_diagnostic_consents from public,anon,authenticated,service_role;
create trigger anonymous_consents_immutable before update or delete on private.anonymous_diagnostic_consents for each row execute function private.reject_result_change();
create table private.anonymous_diagnostic_mutations(
 session_id uuid not null references private.anonymous_diagnostic_sessions(id), mutation_id uuid not null,
 resulting_revision integer not null, primary key(session_id,mutation_id)
);
create table private.product_events(
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references private.acquisition_visits(id),
 anonymous_session_id uuid references private.anonymous_diagnostic_sessions(id),
 user_id uuid references public.users(id), account_id uuid references public.accounts(id), company_id uuid references public.company_profiles(id),
 diagnostic_id uuid references public.diagnostics(id), event_name text not null,
 entity_key text not null default '', occurred_at timestamptz not null default now(), metadata jsonb not null default '{}',
 unique(visit_id,event_name,entity_key), check(octet_length(metadata::text)<=512)
);
create table private.advanced_conversion_intents(
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references private.acquisition_visits(id),
 user_id uuid not null references public.users(id),account_id uuid not null references public.accounts(id),
 company_id uuid not null references public.company_profiles(id),source_surface text not null,
 destination text not null default 'team_create' check(destination='team_create'),created_at timestamptz not null default now(),
 unique(visit_id,company_id)
);
create index anonymous_sessions_expiry on private.anonymous_diagnostic_sessions(expires_at) where status<>'claimed';
create index anonymous_sessions_claimed_company on private.anonymous_diagnostic_sessions(claimed_company_id,claimed_at desc) where claimed_company_id is not null;
create index product_events_funnel_time on private.product_events(occurred_at,event_name,visit_id);
create index product_events_session on private.product_events(anonymous_session_id);
create index product_events_account on private.product_events(account_id,event_name);
create index acquisition_campaign on private.acquisition_visits((attribution->>'utm_source'),(attribution->>'utm_medium'),(attribution->>'utm_campaign'),created_at);

alter table private.acquisition_visits enable row level security;
alter table private.anonymous_diagnostic_sessions enable row level security;
alter table private.anonymous_diagnostic_mutations enable row level security;
alter table private.product_events enable row level security;
alter table private.advanced_conversion_intents enable row level security;
revoke all on private.acquisition_visits,private.anonymous_diagnostic_sessions,private.anonymous_diagnostic_mutations,
 private.product_events,private.advanced_conversion_intents from public,anon,authenticated,service_role;

create function private.acquisition_event(p_visit uuid,p_name text,p_key text default '',p_metadata jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare s private.anonymous_diagnostic_sessions;
begin
 if p_name not in('landing_view','landing_cta_clicked','anonymous_diagnostic_started','diagnostic_block_completed',
 'anonymous_diagnostic_completed','company_profile_completed','claim_email_submitted','claim_email_verified','diagnostic_claimed',
 'individual_result_ready','individual_report_ready','individual_report_viewed','individual_pdf_downloaded','advanced_offer_viewed',
 'team_explainer_viewed','advanced_cta_clicked','account_became_advanced','team_diagnostic_created','first_team_invitation_sent','team_report_ready')
 or length(p_key)>100 or jsonb_typeof(p_metadata)<>'object' or exists(select 1 from jsonb_object_keys(p_metadata) k where k not in('block_position','total_blocks','source_surface','source'))
 or (p_metadata ? 'source_surface' and p_metadata->>'source_surface' not in('individual_report','dashboard','diagnostics_hub','team_explainer'))
 or (p_metadata ? 'source' and p_metadata->>'source' not in('manual','provider','system'))
 or (p_metadata ? 'block_position' and (p_metadata->>'block_position') !~ '^[0-9]{1,3}$')
 or (p_metadata ? 'total_blocks' and (p_metadata->>'total_blocks') !~ '^[0-9]{1,3}$')
 then raise exception 'acquisition_invalid_event'; end if;
 select * into s from private.anonymous_diagnostic_sessions where visit_id=p_visit;
 insert into private.product_events(visit_id,anonymous_session_id,user_id,account_id,company_id,diagnostic_id,event_name,entity_key,metadata)
 values(p_visit,s.id,s.claimed_user_id,s.claimed_account_id,s.claimed_company_id,s.claimed_diagnostic_id,p_name,coalesce(p_key,''),p_metadata)
 on conflict(visit_id,event_name,entity_key) do nothing;
end; $$;

-- Server-only RPC. A UUID alone never authorizes read or mutation.
create function public.acquisition_session(p_operation text,p_id uuid,p_secret_hash text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.anonymous_diagnostic_sessions; v private.acquisition_visits; vid uuid; bid uuid; item jsonb; q public.questions;
 merged jsonb; previous integer; missing jsonb; context jsonb; nonce text; created boolean; pkey text; doc text;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' or p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$'
 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>300000 then raise exception 'acquisition_unavailable'; end if;
 if p_operation in('visit','visit_direct') then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in('utm_source','utm_medium','utm_campaign','utm_content','referrer_host','landing_variant'))
   or exists(select 1 from jsonb_each_text(p_payload) t where t.value !~ '^[A-Za-z0-9._-]{1,100}$') then raise exception 'acquisition_invalid'; end if;
  insert into private.acquisition_visits(id,secret_hash,attribution) values(p_id,p_secret_hash,p_payload) on conflict(id) do nothing;
  select * into v from private.acquisition_visits where id=p_id and secret_hash=p_secret_hash and expires_at>now();
  if v.id is null then raise exception 'acquisition_unavailable'; end if;
  if p_operation='visit' then perform private.acquisition_event(v.id,'landing_view'); end if; return jsonb_build_object('id',v.id,'attribution',v.attribution);
 end if;
 if p_operation='cta' then
  select * into v from private.acquisition_visits where id=p_id and secret_hash=p_secret_hash and expires_at>now();
  if v.id is null then raise exception 'acquisition_unavailable'; end if;
  perform private.acquisition_event(v.id,'landing_cta_clicked');return jsonb_build_object('ok',true);
 end if;
 if p_operation='start' then
  select * into v from private.acquisition_visits where id=p_id and secret_hash=p_secret_hash and expires_at>now() for update;
  if v.id is null then raise exception 'acquisition_unavailable'; end if;
  doc:=(select version from public.consent_documents where kind='data_processing');
  if p_payload->>'consent_version' is distinct from doc or p_payload->'consent' is distinct from 'true'::jsonb then raise exception 'acquisition_consent_required'; end if;
  select * into s from private.anonymous_diagnostic_sessions where visit_id=v.id;
  if s.id is not null then
   raise exception 'acquisition_session_exists';
  else
   select ver.id into vid from public.diagnostic_versions ver join public.diagnostic_definitions d on d.id=ver.definition_id
    where d.key='manageability' and ver.status='published' order by ver.version_number desc limit 1;
   select id into bid from public.diagnostic_blocks where version_id=vid and is_active order by position limit 1;
   if bid is null or p_payload->>'session_hash' !~ '^[a-f0-9]{64}$' then raise exception 'acquisition_invalid'; end if;
   insert into private.anonymous_diagnostic_sessions(visit_id,secret_hash,methodology_version_id,current_block_id,consent_version,consented_at)
    values(v.id,p_payload->>'session_hash',vid,bid,doc,clock_timestamp()) returning * into s;
  end if;
  if not exists(select 1 from private.anonymous_diagnostic_consents where session_id=s.id and kind='data_processing' and version=s.consent_version) then
   insert into private.anonymous_diagnostic_consents(session_id,kind,version,granted,accepted_at) values(s.id,'data_processing',s.consent_version,true,s.consented_at);
  end if;
  perform private.acquisition_event(v.id,'anonymous_diagnostic_started');
  return jsonb_build_object('id',s.id);
 end if;
 select * into s from private.anonymous_diagnostic_sessions where id=p_id and secret_hash=p_secret_hash for update;
 if s.id is null then raise exception 'acquisition_unavailable'; end if;
 if s.status='claimed' or s.status='expired' or s.expires_at<=now() then raise exception 'acquisition_expired'; end if;
 if p_operation='read' then
  return (to_jsonb(s)-'secret_hash'-'identity_nonce_hash'-'target_email'-'pending_auth_user_id'-'display_name')||jsonb_build_object('email_cooldown_seconds',coalesce(greatest(0,ceil(60-extract(epoch from(now()-s.email_requested_at))))::int,0));
 elsif p_operation='consent' then
  if p_payload->'consent' is distinct from 'true'::jsonb or p_payload->>'consent_version' is distinct from (select version from public.consent_documents where kind='data_processing') then raise exception 'acquisition_consent_required'; end if;
  if s.consent_version is distinct from p_payload->>'consent_version' then
   update private.anonymous_diagnostic_sessions set consent_version=p_payload->>'consent_version',consented_at=clock_timestamp() where id=s.id returning * into s;
   insert into private.anonymous_diagnostic_consents(session_id,kind,version,granted,accepted_at) values(s.id,'data_processing',s.consent_version,true,s.consented_at);
  end if;
  if p_payload ? 'marketing_version' then
   if p_payload->>'marketing_version' is distinct from(select version from public.consent_documents where kind='marketing') or jsonb_typeof(p_payload->'marketing_granted') is distinct from 'boolean' then raise exception 'acquisition_consent_required'; end if;
   update private.anonymous_diagnostic_sessions set marketing_version=p_payload->>'marketing_version',marketing_granted=(p_payload->>'marketing_granted')::boolean,marketing_accepted_at=clock_timestamp() where id=s.id returning * into s;
   insert into private.anonymous_diagnostic_consents(session_id,kind,version,granted,accepted_at) values(s.id,'marketing',s.marketing_version,s.marketing_granted,s.marketing_accepted_at);
  end if;
  return jsonb_build_object('ok',true);
 elsif p_operation='save' then
  if s.status<>'in_progress' then raise exception 'acquisition_not_editable'; end if;
  select resulting_revision into previous from private.anonymous_diagnostic_mutations where session_id=s.id and mutation_id=(p_payload->>'mutation_id')::uuid;
  if previous is not null then return jsonb_build_object('revision',previous,'current_block_id',s.current_block_id); end if;
  if (p_payload->>'expected_revision')::int is distinct from s.revision then raise exception 'acquisition_conflict'; end if;
  bid:=(p_payload->>'current_block_id')::uuid;
  if not exists(select 1 from public.diagnostic_blocks where id=bid and version_id=s.methodology_version_id and is_active) then raise exception 'acquisition_invalid'; end if;
  merged:=s.answers;
  if coalesce((p_payload->>'answers_dirty')::boolean,true) then
   if jsonb_typeof(p_payload->'answers')<>'array' or jsonb_array_length(p_payload->'answers')>200 then raise exception 'acquisition_invalid'; end if;
   if (select count(*) from jsonb_array_elements(p_payload->'answers'))<>(select count(distinct x->>'question_id') from jsonb_array_elements(p_payload->'answers') x) then raise exception 'acquisition_invalid'; end if;
   for item in select value from jsonb_array_elements(p_payload->'answers') loop
    if jsonb_typeof(item) is distinct from 'object' or not(item?'question_id') or not(item?'value') or exists(select 1 from jsonb_object_keys(item) k where k not in('question_id','value')) then raise exception 'acquisition_invalid'; end if;
    select * into q from public.questions where id=(item->>'question_id')::uuid and version_id=s.methodology_version_id and is_active;
    if q.id is null then raise exception 'acquisition_invalid'; end if;
    if item->'value' is null or item->'value'='null' or (q.answer_type='text' and btrim(item->>'value')='') then merged:=merged-q.id::text;
    elsif q.answer_type='scale_0_4' and jsonb_typeof(item->'value')='number' and (item->>'value')::numeric between 0 and 4 and mod((item->>'value')::numeric,1)=0 then merged:=jsonb_set(merged,array[q.id::text],item->'value');
    elsif q.answer_type='text' and jsonb_typeof(item->'value')='string' and length(item->>'value')<=10000 then merged:=jsonb_set(merged,array[q.id::text],to_jsonb(btrim(item->>'value')));
    else raise exception 'acquisition_invalid'; end if;
   end loop;
  end if;
  update private.anonymous_diagnostic_sessions set answers=merged,current_block_id=bid,revision=revision+1,updated_at=now() where id=s.id;
  insert into private.anonymous_diagnostic_mutations values(s.id,(p_payload->>'mutation_id')::uuid,s.revision+1);
  for item in select jsonb_build_object('block_position',b.position,'total_blocks',(select count(*) from public.diagnostic_blocks where version_id=s.methodology_version_id and is_active),'id',b.id) from public.diagnostic_blocks b
   where b.version_id=s.methodology_version_id and b.is_active and not exists(select 1 from public.questions q2 where q2.block_id=b.id and q2.version_id=s.methodology_version_id and q2.is_active and q2.is_required and not(merged ? q2.id::text)) loop
   perform private.acquisition_event(s.visit_id,'diagnostic_block_completed',item->>'id',item-'id');
  end loop;
  return jsonb_build_object('revision',s.revision+1,'current_block_id',bid);
 elsif p_operation='complete' then
  if s.status<>'in_progress' then return jsonb_build_object('ok',true); end if;
  if (p_payload->>'expected_revision')::int is distinct from s.revision then raise exception 'acquisition_conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id',q2.id,'block_id',q2.block_id,'position',q2.position)),'[]') into missing from public.questions q2
   where q2.version_id=s.methodology_version_id and q2.is_active and q2.is_required and not(s.answers ? q2.id::text);
  if jsonb_array_length(missing)>0 then return jsonb_build_object('ok',false,'missing',missing); end if;
  update private.anonymous_diagnostic_sessions set status='diagnostic_completed',completed_at=now(),updated_at=now() where id=s.id;
  perform private.acquisition_event(s.visit_id,'anonymous_diagnostic_completed');return jsonb_build_object('ok',true);
 elsif p_operation='profile' then
  if s.status not in('diagnostic_completed','profile_completed') then raise exception 'acquisition_invalid'; end if;
  context:=p_payload->'context';
  if jsonb_typeof(context) is distinct from 'object' or exists(select 1 from jsonb_object_keys(context) k where k not in('name','industry_key','employee_count','products','key_problems','main_goals','country','customer_segments','sales_channels','annual_revenue_key','company_age_years','management_levels')) then raise exception 'acquisition_invalid'; end if;
  foreach pkey in array array['name','industry_key','products','key_problems','main_goals'] loop
   if jsonb_typeof(context->pkey) is distinct from 'string' or length(btrim(context->>pkey)) not between 1 and 5000 then raise exception 'acquisition_invalid'; end if;
  end loop;
  if not exists(select 1 from public.industries where key=context->>'industry_key' and is_active) or jsonb_typeof(context->'employee_count') is distinct from 'number' or (context->>'employee_count')::numeric not between 1 and 10000000 or mod((context->>'employee_count')::numeric,1)<>0 then raise exception 'acquisition_invalid'; end if;
  if context->>'annual_revenue_key' is not null and not exists(select 1 from public.revenue_ranges where key=context->>'annual_revenue_key' and is_active) then raise exception 'acquisition_invalid'; end if;
  foreach pkey in array array['country','customer_segments','sales_channels'] loop
   if context ? pkey and context->pkey<>'null' and (jsonb_typeof(context->pkey) is distinct from 'string' or length(context->>pkey)>5000) then raise exception 'acquisition_invalid'; end if;
  end loop;
  foreach pkey in array array['company_age_years','management_levels'] loop
   if context->>pkey is not null and (jsonb_typeof(context->pkey)<>'number' or (context->>pkey)::numeric<case when pkey='management_levels' then 1 else 0 end or mod((context->>pkey)::numeric,1)<>0 or (context->>pkey)::numeric>10000) then raise exception 'acquisition_invalid'; end if;
  end loop;
  if context::text ~ '<[/]?[A-Za-z][^>]*>' then raise exception 'acquisition_invalid'; end if;
  update private.anonymous_diagnostic_sessions set company_context_draft=context,status='profile_completed',updated_at=now() where id=s.id;
  perform private.acquisition_event(s.visit_id,'company_profile_completed');return jsonb_build_object('ok',true);
 elsif p_operation='email' then
  if s.status not in('profile_completed','email_pending') or s.consent_version is distinct from(select version from public.consent_documents where kind='data_processing') then raise exception 'acquisition_consent_required'; end if;
  if s.email_requested_at>now()-interval '60 seconds' then return jsonb_build_object('reserved',false); end if;
  if p_payload->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(p_payload->>'email')>254
   or length(btrim(p_payload->>'display_name')) not between 1 and 100 or p_payload->>'nonce_hash' !~ '^[a-f0-9]{64}$' then raise exception 'acquisition_invalid'; end if;
  if p_payload->>'marketing_version' is distinct from(select version from public.consent_documents where kind='marketing') or jsonb_typeof(p_payload->'marketing_granted')<>'boolean' then raise exception 'acquisition_consent_required'; end if;
  select not exists(select 1 from auth.users where lower(email)=lower(p_payload->>'email')) into created;
  update private.anonymous_diagnostic_sessions set target_email=lower(p_payload->>'email'),display_name=btrim(p_payload->>'display_name'),identity_nonce_hash=p_payload->>'nonce_hash',
   marketing_version=p_payload->>'marketing_version',marketing_granted=(p_payload->>'marketing_granted')::boolean,marketing_accepted_at=clock_timestamp(),
   status='email_pending',email_generation=email_generation+1,email_requested_at=clock_timestamp(),updated_at=now() where id=s.id;
  insert into private.anonymous_diagnostic_consents(session_id,kind,version,granted,accepted_at)
   select id,'marketing',marketing_version,marketing_granted,marketing_accepted_at from private.anonymous_diagnostic_sessions where id=s.id;
  perform private.acquisition_event(s.visit_id,'claim_email_submitted');
  return jsonb_build_object('reserved',true,'create_user',created,'generation',s.email_generation+1);
 elsif p_operation='email_sent' then
  update private.anonymous_diagnostic_sessions set email_sent_at=now() where id=s.id and email_generation=(p_payload->>'generation')::int;
  return jsonb_build_object('ok',true);
 elsif p_operation='catalog' then
  return jsonb_build_object('industries',(select jsonb_agg(jsonb_build_object('industry_key',i.key,'name',t.name) order by i.sort_order) from public.industries i join public.industry_translations t on t.industry_key=i.key and t.locale='ru' where i.is_active),
   'revenues',(select jsonb_agg(jsonb_build_object('revenue_key',i.key,'name',t.name) order by i.sort_order) from public.revenue_ranges i join public.revenue_range_translations t on t.revenue_key=i.key and t.locale='ru' where i.is_active));
 end if;
 raise exception 'acquisition_invalid';
end; $$;
revoke all on function public.acquisition_session(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.acquisition_session(text,uuid,text,jsonb) to service_role;

create or replace function private.provision_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare doc record; consent jsonb; pending private.team_identity_reservations;
begin
 if exists(select 1 from private.anonymous_diagnostic_sessions s where s.target_email=lower(new.email)
  and s.identity_nonce_hash=encode(sha256(convert_to(new.raw_user_meta_data->>'anonymous_pending_nonce','UTF8')),'hex')
  and s.status='email_pending' and s.expires_at>now() and s.email_requested_at>now()-interval '5 minutes'
  and s.consent_version=(select version from public.consent_documents where kind='data_processing')) then
  update private.anonymous_diagnostic_sessions set pending_auth_user_id=new.id
   where target_email=lower(new.email) and identity_nonce_hash=encode(sha256(convert_to(new.raw_user_meta_data->>'anonymous_pending_nonce','UTF8')),'hex') and status='email_pending';
  return new;
 end if;
 select * into pending from private.team_identity_reservations
 where email=lower(new.email) and user_id is null and expires_at>now()
  and nonce_hash=encode(sha256(convert_to(new.raw_user_meta_data->>'team_pending_nonce','UTF8')),'hex')
 for update;
 if pending.email is not null then
  if not exists(select 1 from private.team_invitations i join public.team_participants p on p.id=i.participant_id
   join public.team_diagnostics d on d.id=p.team_diagnostic_id join public.company_profiles c on c.id=d.company_id
   join public.accounts a on a.id=c.account_id
   where i.token_hash=pending.invitation_hash and p.email=pending.email and i.expires_at>now()
    and p.revoked_at is null and d.status='open' and a.status='active')
  then raise exception 'team_invitation_unavailable'; end if;
  update private.team_identity_reservations set user_id=new.id where email=pending.email;
  -- No profile, role, consent, Account or membership is created here.
  return new;
 end if;
  if new.raw_user_meta_data->'data_processing_consent' <> 'true'::jsonb
     or new.raw_user_meta_data->'data_processing_consent' is null then
    raise exception 'Data processing consent is required';
  end if;
  if jsonb_typeof(new.raw_user_meta_data->'marketing_consent') is distinct from 'boolean' then
    raise exception 'Marketing choice is required';
  end if;
  for doc in select * from public.consent_documents loop
    if new.raw_user_meta_data->>(doc.kind || '_version') is distinct from doc.version then
      raise exception 'Consent version mismatch';
    end if;
  end loop;
  insert into public.users(id, full_name) values(new.id, trim(new.raw_user_meta_data->>'full_name'));
  insert into public.user_roles(user_id, role) values(new.id, 'user');
  for doc in select * from public.consent_documents loop
    consent := new.raw_user_meta_data->(doc.kind || '_consent');
    insert into public.user_consents(user_id, kind, version, granted, source)
    values(new.id, doc.kind, doc.version, consent = 'true'::jsonb, 'email_registration');
  end loop;
  insert into private.audit_events(subject_id, action) values(new.id, 'identity_created');
  perform private.ensure_legacy_account(new.id);
  return new;
end; $$;
revoke all on function private.provision_identity() from public,anon,authenticated;


-- Anonymous preliminary identities cannot acquire normal verified-session privileges.
create or replace function private.is_verified_session() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null)
 and not exists(select 1 from private.team_identity_reservations r where r.user_id=auth.uid() and r.finalized_at is null)
 and not exists(select 1 from private.anonymous_diagnostic_sessions s where s.pending_auth_user_id=auth.uid() and s.identity_finalized_at is null);
$$;

-- The completed anonymous source is already submitted, so it cannot collide with an older in-progress questionnaire.
-- Reuse the same required-answer validation, immutable snapshot and scoring enqueue path.
create or replace function public.submit_diagnostic(p_diagnostic_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.diagnostics%rowtype; missing jsonb; j public.jobs%rowtype;
begin
  select * into d from public.diagnostics where id = p_diagnostic_id and private.can_access_company(company_id) for update;
  if d.id is null then raise exception 'not_found'; end if;
  if d.status <> 'in_progress' and not (
    d.status='submitted' and exists(select 1 from private.anonymous_diagnostic_sessions s where s.claimed_diagnostic_id=d.id and s.claimed_user_id=auth.uid())
    and not exists(select 1 from public.jobs where kind='score_diagnostic' and diagnostic_id=d.id and deduplication_key='default')
  ) then
    select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default';
    return jsonb_build_object('ok', true, 'status', d.status, 'job_id', j.id);
  end if;
  if d.revision <> p_expected_revision then raise exception 'conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.id, 'block_id', q.block_id, 'position', q.position)), '[]'::jsonb) into missing
  from public.questions q left join public.answers a on a.diagnostic_id = d.id and a.question_id = q.id
  where q.version_id = d.version_id and q.is_active and q.is_required
    and ((q.answer_type = 'scale_0_4' and a.numeric_value is null) or (q.answer_type = 'text' and nullif(btrim(a.text_value), '') is null));
  if jsonb_array_length(missing) > 0 then return jsonb_build_object('ok', false, 'missing', missing, 'status', d.status); end if;
  insert into public.diagnostic_company_snapshots(diagnostic_id, company_id, profile_revision, profile_data)
    select d.id, c.id, c.revision, to_jsonb(c) from public.company_profiles c where c.id = d.company_id on conflict do nothing;
  update public.diagnostics set status = 'submitted', submitted_at = now(), revision = revision + 1 where id = d.id and status = 'in_progress' and revision = p_expected_revision;
  insert into public.jobs(kind, diagnostic_id, deduplication_key) values ('score_diagnostic', d.id, 'default')
    on conflict (kind, diagnostic_id, deduplication_key) do nothing returning * into j;
  if j.id is null then select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default'; end if;
  return jsonb_build_object('ok', true, 'status', 'submitted', 'job_id', j.id);
end; $$;


create function public.claim_anonymous_diagnostic(p_session_id uuid,p_secret_hash text,p_company_id uuid default null,p_account_id uuid default null,p_mode text default 'claim') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); s private.anonymous_diagnostic_sessions; c public.company_profiles; aid uuid; did uuid; ctx jsonb;
 result jsonb; was_new boolean; vcount integer; sid uuid; doc record;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or actor is null
 or not exists(select 1 from auth.users u join auth.sessions se on se.user_id=u.id where u.id=actor and u.email_confirmed_at is not null and se.id::text=auth.jwt()->>'session_id')
 then raise exception 'acquisition_unavailable'; end if;
 if exists(select 1 from public.user_roles where user_id=actor and role='administrator') and auth.jwt()->>'aal' is distinct from 'aal2' then raise exception 'acquisition_mfa_required'; end if;
 -- Lock the actor BEFORE any source row: finalizing their pending identities may
 -- touch another source, so opposite row/advisory ordering could deadlock.
 perform pg_advisory_xact_lock(hashtextextended(actor::text,25));
 select * into s from private.anonymous_diagnostic_sessions where id=p_session_id for update;
 if s.id is null or not exists(select 1 from auth.users where id=actor and lower(email)=s.target_email) then raise exception 'acquisition_unavailable'; end if;
 if s.status='claimed' then
  if s.claimed_user_id<>actor then raise exception 'acquisition_unavailable'; end if;
  return jsonb_build_object('status','claimed','diagnostic_id',s.claimed_diagnostic_id);
 end if;
 if s.expires_at<=now() or s.status='expired' then raise exception 'acquisition_expired'; end if;
 if s.status not in('email_pending','claim_pending') then raise exception 'acquisition_invalid'; end if;
 if p_mode='recover' then
  if p_secret_hash is null or p_secret_hash !~ '^[a-f0-9]{64}$' then raise exception 'acquisition_invalid'; end if;
  update private.anonymous_diagnostic_sessions set secret_hash=p_secret_hash,status='claim_pending',updated_at=now() where id=s.id;
  perform private.acquisition_event(s.visit_id,'claim_email_verified');
  return jsonb_build_object('status','claim_pending');
 end if;
 if p_secret_hash is distinct from s.secret_hash then raise exception 'acquisition_unavailable'; end if;
 if p_mode='choices' then
  return jsonb_build_object('new_user',not exists(select 1 from public.users where id=actor),'draft_name',s.company_context_draft->>'name',
   'companies',(select coalesce(jsonb_agg(jsonb_build_object('id',cp.id,'name',cp.name,'account_id',cp.account_id) order by cp.created_at),'[]') from public.company_profiles cp join public.account_memberships m on m.account_id=cp.account_id join public.accounts a on a.id=m.account_id where m.user_id=actor and m.status='active' and m.revoked_at is null and m.role='owner' and a.status='active'),
   'accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'can_create',not exists(select 1 from public.company_profiles cp where cp.account_id=a.id) or private.account_has_entitlement(a.id,'multi_company')) order by a.created_at),'[]') from public.accounts a join public.account_memberships m on m.account_id=a.id where m.user_id=actor and m.status='active' and m.role='owner' and m.revoked_at is null and a.status='active'));
 end if;
 if s.consent_version is distinct from(select version from public.consent_documents where kind='data_processing') or s.marketing_version is distinct from(select version from public.consent_documents where kind='marketing') then raise exception 'acquisition_consent_required'; end if;
 if p_mode<>'claim' then raise exception 'acquisition_invalid'; end if;
 if s.completed_at is null or s.company_context_draft is null then raise exception 'acquisition_invalid'; end if;
 was_new:=not exists(select 1 from public.users where id=actor);
 if was_new then
  if s.pending_auth_user_id is distinct from actor and not exists(select 1 from private.anonymous_diagnostic_sessions prior where prior.pending_auth_user_id=actor) then raise exception 'acquisition_pending_identity'; end if;
  update private.anonymous_diagnostic_sessions set identity_finalized_at=now() where id=s.id or pending_auth_user_id=actor;
  insert into public.users(id,full_name) values(actor,s.display_name);
  insert into public.user_roles(user_id,role) values(actor,'user');
  aid:=private.ensure_legacy_account(actor);
  if private.effective_account_plan(aid)<>'free' then raise exception 'acquisition_invalid'; end if;
 else
  -- Current verified application identity, never trust editable Auth metadata.
  if not exists(select 1 from public.user_roles where user_id=actor) then raise exception 'acquisition_unavailable'; end if;
 end if;
 if p_company_id is not null then
  select cp.* into c from public.company_profiles cp join public.account_memberships m on m.account_id=cp.account_id join public.accounts a on a.id=m.account_id
   where cp.id=p_company_id and m.user_id=actor and m.role='owner' and m.status='active' and m.revoked_at is null and a.status='active' for update of a;
  if c.id is null or (p_account_id is not null and p_account_id<>c.account_id) then raise exception 'acquisition_unavailable'; end if;
  aid:=c.account_id;
 else
  if not was_new then
   if p_account_id is null then return jsonb_build_object('status','selection_required'); end if;
   select a.id into aid from public.accounts a join public.account_memberships m on m.account_id=a.id where a.id=p_account_id and a.status='active' and m.user_id=actor and m.role='owner' and m.status='active' and m.revoked_at is null for update of a;
   if aid is null then raise exception 'acquisition_unavailable'; end if;
  end if;
  -- Same established DB gate applies, including account lock/concurrent downgrades.
  ctx:=s.company_context_draft;
  insert into public.company_profiles(owner_user_id,account_id,name,industry_key,employee_count,products,key_problems,main_goals,
   country,customer_segments,sales_channels,annual_revenue_key,company_age_years,management_levels)
  values(actor,aid,ctx->>'name',ctx->>'industry_key',(ctx->>'employee_count')::int,ctx->>'products',ctx->>'key_problems',ctx->>'main_goals',
   nullif(ctx->>'country',''),nullif(ctx->>'customer_segments',''),nullif(ctx->>'sales_channels',''),nullif(ctx->>'annual_revenue_key',''),(ctx->>'company_age_years')::int,(ctx->>'management_levels')::int) returning * into c;
 end if;
 -- Transfer the append-only consent history, including original version/time before explicit renewal.
 insert into public.user_consents(user_id,kind,version,granted,recorded_at,source)
 select actor,kind,version,granted,accepted_at,'anonymous_diagnostic:'||s.id::text
 from private.anonymous_diagnostic_consents where session_id=s.id order by accepted_at,id;
 insert into public.diagnostics(company_id,created_by_user_id,version_id,locale,current_block_id,status,submitted_at,started_at)
 values(c.id,actor,s.methodology_version_id,'ru',s.current_block_id,'submitted',now(),s.created_at) returning id into did;
 insert into public.answers(diagnostic_id,version_id,question_id,numeric_value,text_value,revision)
 select did,s.methodology_version_id,q.id,case when q.answer_type='scale_0_4' then a.value::text::numeric end,
 case when q.answer_type='text' then a.value#>>'{}' end,1
 from jsonb_each(s.answers) a join public.questions q on q.id=a.key::uuid and q.version_id=s.methodology_version_id and q.is_active;
 -- Explicit immutable context for THIS diagnostic, not the mutable selected Company.
 insert into public.diagnostic_company_snapshots(diagnostic_id,company_id,profile_revision,profile_data)
 values(did,c.id,c.revision,jsonb_build_object('id',c.id,'account_id',c.account_id,'owner_user_id',c.owner_user_id,'revision',c.revision,'country',null,'customer_segments',null,'sales_channels',null,'annual_revenue_key',null,'company_age_years',null,'management_levels',null)||s.company_context_draft);
 -- Release preliminary guard inside the same transaction, then use the normal submit pipeline.
 update private.anonymous_diagnostic_sessions set status='claimed',claimed_at=now(),claimed_user_id=actor,claimed_account_id=aid,claimed_company_id=c.id,claimed_diagnostic_id=did,updated_at=now() where id=s.id;
 result:=public.submit_diagnostic(did,1);
 if result->'ok' is distinct from 'true'::jsonb then raise exception 'acquisition_incomplete'; end if;
 if (select count(*) from public.answers where diagnostic_id=did)<>(select count(*) from jsonb_object_keys(s.answers)) then raise exception 'acquisition_answer_mismatch'; end if;
 perform private.acquisition_event(s.visit_id,'diagnostic_claimed');
 return jsonb_build_object('status','claimed','diagnostic_id',did);
end; $$;
revoke all on function public.claim_anonymous_diagnostic(uuid,text,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.claim_anonymous_diagnostic(uuid,text,uuid,uuid,text) to authenticated;

-- Server/actor-scoped interactions, never a general event ingest endpoint.
create function public.record_acquisition_interaction(p_name text,p_company_id uuid,p_diagnostic_id uuid default null,p_surface text default 'individual_report') returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.anonymous_diagnostic_sessions; target public.company_profiles;
begin
 if not private.can_access_company(p_company_id) then raise exception 'not_found'; end if;
 if p_name not in('individual_report_viewed','advanced_offer_viewed','team_explainer_viewed','advanced_cta_clicked') or p_surface not in('individual_report','dashboard','diagnostics_hub','team_explainer') then raise exception 'acquisition_invalid_event'; end if;
 if p_diagnostic_id is not null then
  select * into s from private.anonymous_diagnostic_sessions where claimed_company_id=p_company_id and claimed_diagnostic_id=p_diagnostic_id;
 else select * into s from private.anonymous_diagnostic_sessions where claimed_company_id=p_company_id order by claimed_at desc limit 1; end if;
 if s.id is null then return jsonb_build_object('recorded',false); end if;
 if p_name in('individual_report_viewed','individual_pdf_downloaded','advanced_offer_viewed') and not exists(select 1 from public.ai_reports where diagnostic_id=s.claimed_diagnostic_id and status='completed') then return jsonb_build_object('recorded',false); end if;
 if p_name='advanced_cta_clicked' then
  insert into private.advanced_conversion_intents(visit_id,user_id,account_id,company_id,source_surface)
  values(s.visit_id,auth.uid(),s.claimed_account_id,p_company_id,p_surface) on conflict(visit_id,company_id) do nothing;
 end if;
 perform private.acquisition_event(s.visit_id,p_name,'',jsonb_build_object('source_surface',p_surface));
 return jsonb_build_object('recorded',true);
end; $$;
revoke all on function public.record_acquisition_interaction(text,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.record_acquisition_interaction(text,uuid,uuid,text) to authenticated;

-- Milestones originate in committed product state, not from refresh/browser claims.
create function private.acquisition_product_milestone() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; vid uuid; label text; source text:=''; rowdata jsonb:=to_jsonb(new);
begin
 if tg_table_name='diagnostic_results' then sid:=new.diagnostic_id;label:='individual_result_ready';
 elsif tg_table_name='ai_reports' then
  if new.status<>'completed' then return new; end if;sid:=new.diagnostic_id;label:='individual_report_ready';
 elsif tg_table_name='account_subscriptions' then
  if new.status<>'active' or not exists(select 1 from public.plans where id=new.plan_id and key='advanced') then return new; end if;
  for vid in select distinct visit_id from private.anonymous_diagnostic_sessions where claimed_account_id=new.account_id loop
   perform private.acquisition_event(vid,'account_became_advanced','',jsonb_build_object('source',new.source));
  end loop;return new;
 elsif tg_table_name='team_diagnostics' then cid:=new.company_id;label:='team_diagnostic_created';
 elsif tg_table_name='team_participants' then
  if tg_op='INSERT' or (rowdata->>'invitation_status') is distinct from 'sent' then return new; end if;
  select company_id into cid from public.team_diagnostics where id=new.team_diagnostic_id;label:='first_team_invitation_sent';
 elsif tg_table_name='team_ai_reports' then
  if new.status<>'completed' then return new; end if;
  select company_id into cid from public.team_diagnostics where id=new.team_diagnostic_id;label:='team_report_ready';
 end if;
 if sid is not null then select visit_id into vid from private.anonymous_diagnostic_sessions where claimed_diagnostic_id=sid;
 elsif cid is not null then select visit_id into vid from private.anonymous_diagnostic_sessions where claimed_company_id=cid order by claimed_at desc limit 1; end if;
 if vid is not null then perform private.acquisition_event(vid,label); end if;
 return new;
end; $$;
create trigger acquisition_result after insert on public.diagnostic_results for each row execute function private.acquisition_product_milestone();
create trigger acquisition_report after insert or update of status on public.ai_reports for each row execute function private.acquisition_product_milestone();
create trigger acquisition_plan after insert on private.account_subscriptions for each row execute function private.acquisition_product_milestone();
create trigger acquisition_team after insert on public.team_diagnostics for each row execute function private.acquisition_product_milestone();
create trigger acquisition_team_report after insert or update of status on public.team_ai_reports for each row execute function private.acquisition_product_milestone();

create function public.read_acquisition_funnel(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; data jsonb;
begin
 actor:=private.admin_console_actor();
 if jsonb_typeof(p_filters)<>'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','utm_source','utm_medium','utm_campaign'))
 or exists(select 1 from jsonb_each_text(p_filters) t where t.value !~ '^[A-Za-z0-9._-]{0,100}$') then raise exception 'admin_invalid_filter'; end if;
 with cohort as(select v.id from private.acquisition_visits v where
  (coalesce(p_filters->>'from','')='' or v.created_at >= (p_filters->>'from')::date)
  and(coalesce(p_filters->>'to','')='' or v.created_at < (p_filters->>'to')::date+interval '1 day')
  and(coalesce(p_filters->>'utm_source','')='' or v.attribution->>'utm_source'=p_filters->>'utm_source')
  and(coalesce(p_filters->>'utm_medium','')='' or v.attribution->>'utm_medium'=p_filters->>'utm_medium')
  and(coalesce(p_filters->>'utm_campaign','')='' or v.attribution->>'utm_campaign'=p_filters->>'utm_campaign')),
 stages as(select e.event_name,count(distinct e.visit_id) n from private.product_events e join cohort c on c.id=e.visit_id group by e.event_name)
 select jsonb_build_object('cohort_size',(select count(*) from cohort),'stages',(select coalesce(jsonb_object_agg(event_name,n),'{}') from stages),
 'campaigns',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select v.attribution->>'utm_source' utm_source,v.attribution->>'utm_medium' utm_medium,v.attribution->>'utm_campaign' utm_campaign,count(*) visits from private.acquisition_visits v join cohort c on c.id=v.id group by 1,2,3 order by count(*) desc limit 25)x),
 'block_progress',(select coalesce(jsonb_agg(to_jsonb(x) order by x.block_position),'[]') from(select (e.metadata->>'block_position')::int block_position,max((e.metadata->>'total_blocks')::int) total_blocks,count(distinct e.visit_id) sessions from private.product_events e join cohort c on c.id=e.visit_id where e.event_name='diagnostic_block_completed' group by 1)x),
 'conversions',(select jsonb_agg(jsonb_build_object('from',p.a,'to',p.b,'denominator',(select count(*) from cohort c where exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.a)),'numerator',(select count(*) from cohort c where exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.a) and exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.b)))) from(values('landing_view','anonymous_diagnostic_started'),('anonymous_diagnostic_started','anonymous_diagnostic_completed'),('anonymous_diagnostic_completed','company_profile_completed'),('company_profile_completed','claim_email_submitted'),('claim_email_submitted','claim_email_verified'),('claim_email_verified','individual_report_ready'),('individual_report_viewed','advanced_cta_clicked'),('account_became_advanced','team_diagnostic_created'))p(a,b)),
 'intents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select i.account_id,i.company_id,i.source_surface,i.destination,i.created_at from private.advanced_conversion_intents i join cohort c on c.id=i.visit_id order by i.created_at desc limit 25)x)) into data;
 return data;
end; $$;
revoke all on function public.read_acquisition_funnel(jsonb) from public,anon,service_role;
grant execute on function public.read_acquisition_funnel(jsonb) to authenticated;


create function public.acquisition_delivery_milestone(p_kind text,p_entity_id uuid,p_user_id uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare cid uuid; did uuid; vid uuid;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'acquisition_unavailable'; end if;
 if p_kind='invitation' then
  select t.company_id into cid from public.team_participants p join public.team_diagnostics t on t.id=p.team_diagnostic_id
   where p.id=p_entity_id and p.revoked_at is null;
 elsif p_kind='pdf' then
  select d.company_id,d.id into cid,did from public.ai_reports r join public.diagnostics d on d.id=r.diagnostic_id
   join public.account_memberships m on m.account_id=(select account_id from public.company_profiles where id=d.company_id)
   where r.id=p_entity_id and r.status='completed' and m.user_id=p_user_id and m.status='active' and m.revoked_at is null;
 else raise exception 'acquisition_invalid_event'; end if;
 select visit_id into vid from private.anonymous_diagnostic_sessions where claimed_company_id=cid and (did is null or claimed_diagnostic_id=did) order by claimed_at desc limit 1;
 if vid is not null then perform private.acquisition_event(vid,case when p_kind='invitation' then 'first_team_invitation_sent' else 'individual_pdf_downloaded' end); end if;
end; $$;
revoke all on function public.acquisition_delivery_milestone(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.acquisition_delivery_milestone(text,uuid,uuid) to service_role;

create function public.read_acquisition_continuation(p_account_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
 if not private.can_access_account(p_account_id) then raise exception 'not_found'; end if;
 select i.company_id into cid from private.advanced_conversion_intents i where i.user_id=auth.uid() and i.account_id=p_account_id
 and private.can_access_company(i.company_id) order by i.created_at desc limit 1;
 return cid;
end; $$;
revoke all on function public.read_acquisition_continuation(uuid) from public,anon,service_role;
grant execute on function public.read_acquisition_continuation(uuid) to authenticated;

revoke all on function private.acquisition_event(uuid,text,text,jsonb),private.acquisition_product_milestone() from public,anon,authenticated,service_role;
commit;
