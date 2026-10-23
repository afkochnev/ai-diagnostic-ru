-- Controlled Team launch only. Existing response/legal/financial rows remain immutable.
begin;
create table private.controlled_team_runs (
 id uuid primary key,account_id uuid not null references public.accounts(id),company_id uuid not null references public.company_profiles(id),owner_user_id uuid not null references public.users(id),participant_emails text[] not null check(cardinality(participant_emails)=3),expires_at timestamptz not null,status text not null default 'active' check(status in('active','stopped')),team_id uuid unique references public.team_diagnostics(id),report_id uuid unique references public.team_ai_reports(id),source_fingerprint text,aggregate_claimed boolean not null default false,ai_claimed boolean not null default false,generation_deadline timestamptz,expected_subscription_id uuid not null references private.account_subscriptions(id),grant_subscription_id uuid references private.account_subscriptions(id),restored_subscription_id uuid references private.account_subscriptions(id),created_at timestamptz not null default clock_timestamp(),stopped_at timestamptz,stop_reason text
);
create table private.controlled_team_policy(singleton boolean primary key default true check(singleton),run_id uuid references private.controlled_team_runs(id));
insert into private.controlled_team_policy(singleton) values(true);
create table private.controlled_team_effects (
 id uuid primary key default gen_random_uuid(),run_id uuid not null references private.controlled_team_runs(id),effect text not null check(effect in('auth_link','invitation_email','pdf','model_get','synthesis','synthesis_repair','main_report','report_repair')),slot text not null,participant_id uuid references public.team_participants(id),report_id uuid references public.team_ai_reports(id),job_id uuid,status text not null default 'reserved' check(status in('reserved','succeeded','failed','unknown')),request_bytes integer,max_output_tokens integer,provider_reference text,metadata jsonb not null default '{}',reserved_at timestamptz not null default clock_timestamp(),completed_at timestamptz,unique(run_id,effect,slot)
);
alter table private.controlled_team_runs enable row level security;
alter table private.controlled_team_policy enable row level security;
alter table private.controlled_team_effects enable row level security;
revoke all on private.controlled_team_runs,private.controlled_team_policy,private.controlled_team_effects from public,anon,authenticated,service_role;
alter table private.team_jobs add column controlled_run_id uuid references private.controlled_team_runs(id);

create function private.configure_controlled_team_run(p_run_id uuid,p_account_id uuid,p_company_id uuid,p_owner_user_id uuid,p_participant_emails text[],p_expires_at timestamptz,p_expected_subscription_id uuid) returns void
language plpgsql set search_path='' as $$declare mails text[];begin
 if current_user<>'postgres' then raise exception 'controlled_team_operator_required';end if;
 if p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '1 hour' then raise exception 'controlled_team_invalid_window';end if;
 select array_agg(lower(btrim(x)) order by lower(btrim(x))) into mails from unnest(p_participant_emails) x;
 if cardinality(mails)<>3 or(select count(distinct x) from unnest(mails) x)<>3 or exists(select 1 from unnest(mails) x where char_length(x)>254 or x!~'^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$') then raise exception 'controlled_team_invalid_participants';end if;
 perform 1 from private.controlled_team_policy where singleton for update;
 if exists(select 1 from private.launch_controls where anonymous_start_enabled or team_creation_enabled or team_invitations_enabled) or exists(select 1 from private.billing_configuration where mock_enabled or yookassa_enabled or yookassa_reconciliation_enabled or yookassa_live_approved) or exists(select 1 from private.controlled_team_runs r where r.grant_subscription_id is not null and r.restored_subscription_id is null) or exists(select 1 from private.controlled_team_runs r join private.controlled_team_policy p on p.run_id=r.id where r.status='active') or exists(select 1 from public.jobs where status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3)) or exists(select 1 from private.team_jobs where status='running' or(status in('queued','failed') and attempts<3)) then raise exception 'controlled_team_not_quiescent';end if;
 if not exists(select 1 from public.company_profiles c join public.accounts a on a.id=c.account_id join public.account_memberships m on m.account_id=a.id where c.id=p_company_id and a.id=p_account_id and a.status='active' and m.user_id=p_owner_user_id and m.status='active' and m.role='owner') or not exists(select 1 from private.account_subscriptions s join public.plans p on p.id=s.plan_id where s.id=p_expected_subscription_id and s.account_id=p_account_id and s.status='active' and p.key='free' and s.source<>'provider') then raise exception 'controlled_team_target_changed';end if;
 insert into private.controlled_team_runs(id,account_id,company_id,owner_user_id,participant_emails,expires_at,expected_subscription_id) values(p_run_id,p_account_id,p_company_id,p_owner_user_id,mails,p_expires_at,p_expected_subscription_id);
 update private.controlled_team_policy set run_id=p_run_id where singleton;
end $$;
revoke all on function private.configure_controlled_team_run(uuid,uuid,uuid,uuid,text[],timestamptz,uuid) from public,anon,authenticated,service_role;
create function private.require_controlled_team(p_team_id uuid default null,p_company_id uuid default null) returns private.controlled_team_runs
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;begin
 select x.* into r from private.controlled_team_runs x join private.controlled_team_policy p on p.run_id=x.id where p.singleton for update of x;
 if r.id is null or r.status<>'active' or r.expires_at<=clock_timestamp() or(p_team_id is not null and r.team_id is distinct from p_team_id) or(p_company_id is not null and r.company_id<>p_company_id) then raise exception 'controlled_team_unavailable';end if;return r;
end $$;
create function private.controlled_team_service() returns void language plpgsql stable security definer set search_path='' as $$begin
 if current_setting('role',true)<>'service_role' or coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'controlled_team_service_required';end if;
end $$;
create function private.controlled_team_participant(p_participant_id uuid) returns private.controlled_team_runs language plpgsql security definer set search_path='' as $$declare p public.team_participants;r private.controlled_team_runs;begin
 select * into p from public.team_participants where id=p_participant_id;r:=private.require_controlled_team(p.team_diagnostic_id);
 if p.id is null or p.revoked_at is not null or not(p.email=any(r.participant_emails)) then raise exception 'controlled_team_unavailable';end if;return r;
end $$;
create function private.controlled_team_token(p_hash text) returns uuid language plpgsql security definer set search_path='' as $$declare pid uuid;begin
 select participant_id into pid from private.team_invitations where token_hash=p_hash;perform private.controlled_team_participant(pid);return pid;
end $$;
revoke all on function private.require_controlled_team(uuid,uuid),private.controlled_team_service(),private.controlled_team_participant(uuid),private.controlled_team_token(text) from public,anon,authenticated,service_role;
create function public.controlled_team_context(p_company_id uuid default null,p_team_id uuid default null,p_participant_id uuid default null,p_invitation_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;pid uuid:=p_participant_id;begin
 perform private.controlled_team_service();if p_invitation_hash is not null then pid:=private.controlled_team_token(p_invitation_hash);end if;
 if pid is not null then r:=private.controlled_team_participant(pid);else r:=private.require_controlled_team(p_team_id,p_company_id);end if;
 if(p_team_id is not null and r.team_id is distinct from p_team_id) or(p_company_id is not null and r.company_id<>p_company_id) then raise exception 'controlled_team_unavailable';end if;
 return jsonb_build_object('mode','controlled','run_id',r.id,'owner_user_id',r.owner_user_id,'account_id',r.account_id,'company_id',r.company_id,'team_id',r.team_id,'expires_at',r.expires_at,'server_now',clock_timestamp(),'participant_id',pid,'model','gpt-5.6-sol');
end $$;
revoke all on function public.controlled_team_context(uuid,uuid,uuid,text) from public,anon,authenticated;grant execute on function public.controlled_team_context(uuid,uuid,uuid,text) to service_role;
create function public.reserve_controlled_team_effect(p_team_id uuid,p_effect text,p_participant_id uuid default null,p_report_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;rid uuid;slot_key text;mail text;hash text;begin
 perform private.controlled_team_service();r:=private.require_controlled_team(p_team_id);
 if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
 if p_effect in('auth_link','invitation_email') then
  if not exists(select 1 from private.launch_controls where team_invitations_enabled) then raise exception 'team_invitations_paused';end if;
  perform private.controlled_team_participant(p_participant_id);
  select p.email,i.token_hash into mail,hash from public.team_participants p join private.team_invitations i on i.participant_id=p.id where p.id=p_participant_id and p.team_diagnostic_id=r.team_id and p.status='invited';
  if mail is null then raise exception 'controlled_team_unavailable';end if;
  if p_effect='invitation_email' and not exists(select 1 from private.controlled_team_effects where run_id=r.id and effect='auth_link' and participant_id=p_participant_id and status='succeeded') then raise exception 'controlled_team_auth_not_ready';end if;slot_key:=p_participant_id::text;
 elsif p_effect='pdf' then
  if p_participant_id is not null or r.report_id is distinct from p_report_id or r.source_fingerprint is distinct from(select fingerprint from private.team_source(r.team_id)) or not exists(select 1 from public.team_ai_reports where id=p_report_id and status='completed' and prompt_version='TEAM-RU-3' and provider_mode='openai') then raise exception 'controlled_team_unavailable';end if;slot_key:=p_report_id::text;
 else raise exception 'controlled_team_invalid_effect';end if;
 insert into private.controlled_team_effects(run_id,effect,slot,participant_id,report_id) values(r.id,p_effect,slot_key,p_participant_id,p_report_id) returning id into rid;
 return jsonb_build_object('reservation_id',rid,'run_id',r.id,'deadline_at',r.expires_at,'server_now',clock_timestamp(),'team_id',r.team_id,'participant_id',p_participant_id,'report_id',p_report_id,'recipient_email',mail,'invitation_hash',hash);
exception when unique_violation then raise exception 'controlled_team_budget_consumed';end $$;
create function public.complete_controlled_team_effect(p_reservation_id uuid,p_status text,p_provider_reference text default null,p_metadata jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$declare e private.controlled_team_effects;begin
 perform private.controlled_team_service();
 if p_status not in('succeeded','failed','unknown') or coalesce(length(p_provider_reference),0)>256 or jsonb_typeof(p_metadata)<>'object' or length(p_metadata::text)>2048 or exists(select 1 from jsonb_object_keys(p_metadata) k where k not in('model','input_tokens','output_tokens','response_id','http_status','elapsed_ms','request_bytes')) then raise exception 'controlled_team_invalid_receipt';end if;
 if exists(select 1 from jsonb_each(p_metadata) x where(x.key in('model','response_id') and(jsonb_typeof(x.value)<>'string' or length(x.value#>>'{}')>256)) or(x.key not in('model','response_id') and(jsonb_typeof(x.value)<>'number' or x.value::text!~'^[0-9]+$' or(x.value::text)::numeric>2147483647))) then raise exception 'controlled_team_invalid_receipt';end if;
 select * into e from private.controlled_team_effects where id=p_reservation_id for update;if e.id is null then raise exception 'controlled_team_invalid_receipt';end if;
 if e.status<>'reserved' then if e.status=p_status and e.provider_reference is not distinct from p_provider_reference and e.metadata=p_metadata then return jsonb_build_object('status',e.status,'duplicate',true);end if;raise exception 'controlled_team_receipt_immutable';end if;
 update private.controlled_team_effects set status=p_status,provider_reference=p_provider_reference,metadata=p_metadata,completed_at=clock_timestamp() where id=e.id;
 if p_status in('failed','unknown') then update private.controlled_team_runs set status='stopped',stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,'effect_'||p_status) where id=e.run_id;end if;
 return jsonb_build_object('status',p_status,'duplicate',false);
end $$;
revoke all on function public.reserve_controlled_team_effect(uuid,text,uuid,uuid),public.complete_controlled_team_effect(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_controlled_team_effect(uuid,text,uuid,uuid),public.complete_controlled_team_effect(uuid,text,text,jsonb) to service_role;
-- New jobs remain permanently fenced from every ordinary legacy/V2/V3 claimer.
create function private.controlled_team_tag_job() returns trigger language plpgsql security definer set search_path='' as $$begin
 select id into new.controlled_run_id from private.controlled_team_runs where team_id=new.team_diagnostic_id;
 return new;
end $$;
revoke all on function private.controlled_team_tag_job() from public,anon,authenticated,service_role;
create trigger controlled_team_tag_job before insert on private.team_jobs for each row execute function private.controlled_team_tag_job();
do $$declare n text;d text;begin
 foreach n in array array['claim_team_jobs','claim_team_jobs_v2','claim_team_jobs_v3'] loop
  d:=pg_get_functiondef(format('public.%I(integer,integer)',n)::regprocedure);
  if position('from private.team_jobs where ' in d)=0 then raise exception 'controlled_team_claim_definition_drift';end if;
  execute replace(d,'from private.team_jobs where ','from private.team_jobs where controlled_run_id is null and ');
 end loop;
end $$;
create function public.claim_controlled_team_job(p_run_id uuid,p_kind text,p_source_fingerprint text,p_report_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;j private.team_jobs;t timestamptz:=clock_timestamp();begin
 perform private.controlled_team_service();r:=private.require_controlled_team();
 if exists(select 1 from public.jobs where status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3)) then raise exception 'controlled_team_foreign_work';end if;
 if p_kind='team_aggregate' and p_report_id is not null then raise exception 'controlled_team_target_changed';end if;
 if r.id is distinct from p_run_id or p_kind not in('team_aggregate','team_ai_report') or p_source_fingerprint is distinct from(select fingerprint from private.team_source(r.team_id)) then raise exception 'controlled_team_target_changed';end if;
 if exists(select 1 from private.team_jobs where (status='running' or(status in('queued','failed') and attempts<3)) and not(team_diagnostic_id=r.team_id and kind=p_kind and source_fingerprint=p_source_fingerprint and controlled_run_id=r.id)) then raise exception 'controlled_team_foreign_work';end if;
 if(p_kind='team_aggregate' and r.aggregate_claimed) or(p_kind='team_ai_report' and(r.ai_claimed or r.report_id is distinct from p_report_id or r.source_fingerprint is distinct from p_source_fingerprint)) then raise exception 'controlled_team_claim_consumed';end if;
 select * into j from private.team_jobs where controlled_run_id=r.id and team_diagnostic_id=r.team_id and kind=p_kind and source_fingerprint=p_source_fingerprint and status='queued' and attempts=0 and available_at<=t for update;
 if j.id is null or(p_kind='team_ai_report' and(j.pipeline_version is distinct from 'TEAM-RU-3' or j.provider_mode is distinct from 'openai')) then raise exception 'controlled_team_target_changed';end if;
 update private.team_jobs set status='running',attempts=1,lease_token=gen_random_uuid(),lease_expires_at=t+interval '600 seconds',started_at=t where id=j.id returning * into j;
 if p_kind='team_aggregate' then update private.controlled_team_runs set aggregate_claimed=true where id=r.id;
 else update private.controlled_team_runs set ai_claimed=true,generation_deadline=least(t+interval '540 seconds',j.lease_expires_at-interval '60 seconds',r.expires_at) where id=r.id returning * into r;end if;
 return jsonb_build_object('run_id',r.id,'team_id',r.team_id,'report_id',r.report_id,'source_fingerprint',j.source_fingerprint,'job_id',j.id,'kind',j.kind,'lease_token',j.lease_token,'lease_expires_at',j.lease_expires_at,'deadline_at',case when p_kind='team_ai_report' then r.generation_deadline else least(j.lease_expires_at-interval '60 seconds',r.expires_at) end,'server_now',clock_timestamp(),'pipeline_version',j.pipeline_version,'provider_mode',j.provider_mode,'attempts',j.attempts);
end $$;
create function public.reserve_controlled_team_ai_call(p_run_id uuid,p_job_id uuid,p_lease_token uuid,p_stage text,p_request_bytes integer,p_max_output_tokens integer) returns jsonb
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;j private.team_jobs;rid uuid;cap integer;begin
 perform private.controlled_team_service();r:=private.require_controlled_team();
 select * into j from private.team_jobs where id=p_job_id for update;
 if exists(select 1 from public.jobs where status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3)) then raise exception 'controlled_team_foreign_work';end if;
 cap:=case p_stage when 'model_get' then 0 when 'synthesis' then 6000 when 'synthesis_repair' then 6000 when 'main_report' then 14000 when 'report_repair' then 6000 else -1 end;
 if r.id is distinct from p_run_id or j.controlled_run_id is distinct from r.id or j.kind<>'team_ai_report' or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp()+interval '60 seconds' or r.generation_deadline is null or r.generation_deadline<=clock_timestamp() or cap<0 or p_max_output_tokens is distinct from cap or p_request_bytes is null or p_request_bytes<0 or p_request_bytes>131072 or(p_stage='model_get' and p_request_bytes<>0) or(p_stage<>'model_get' and p_request_bytes=0) or j.source_fingerprint is distinct from r.source_fingerprint or j.source_fingerprint is distinct from(select fingerprint from private.team_source(r.team_id)) then raise exception 'controlled_team_dispatch_denied';end if;
 if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_run_failed';end if;
 if(select count(*) from private.controlled_team_effects where run_id=r.id and effect in('model_get','synthesis','synthesis_repair','main_report','report_repair'))>=5 then raise exception 'controlled_team_budget_consumed';end if;
 if p_stage<>'model_get' and not exists(select 1 from private.controlled_team_effects where run_id=r.id and effect='model_get' and status='succeeded') then raise exception 'controlled_team_preflight_required';end if;
 if(p_stage='synthesis_repair' and not exists(select 1 from private.controlled_team_effects where run_id=r.id and effect='synthesis' and status='succeeded')) or(p_stage='report_repair' and not exists(select 1 from private.controlled_team_effects where run_id=r.id and effect='main_report' and status='succeeded')) or(p_stage='main_report' and not exists(select 1 from private.team_qualitative_syntheses where team_diagnostic_id=r.team_id and source_fingerprint=r.source_fingerprint and prompt_version='TEAM-SYNTHESIS-RU-3' and provider='openai')) then raise exception 'controlled_team_stage_order';end if;
 insert into private.controlled_team_effects(run_id,effect,slot,report_id,job_id,request_bytes,max_output_tokens) values(r.id,p_stage,'once',r.report_id,j.id,p_request_bytes,p_max_output_tokens) returning id into rid;
 return jsonb_build_object('reservation_id',rid,'stage',p_stage,'deadline_at',r.generation_deadline,'server_now',clock_timestamp(),'lease_expires_at',j.lease_expires_at,'model','gpt-5.6-sol','run_id',r.id,'team_id',r.team_id,'report_id',r.report_id,'source_fingerprint',j.source_fingerprint);
exception when unique_violation then raise exception 'controlled_team_budget_consumed';end $$;
create function public.stop_controlled_team_run(p_run_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();
 if p_reason is null or p_reason!~'^[a-z0-9_]{3,80}$' then raise exception 'controlled_team_invalid_reason';end if;
 update private.controlled_team_runs set status='stopped',stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,p_reason) where id=p_run_id;
 if not found then raise exception 'controlled_team_unavailable';end if;
 return jsonb_build_object('status','stopped');
end $$;
revoke all on function public.claim_controlled_team_job(uuid,text,text,uuid),public.reserve_controlled_team_ai_call(uuid,uuid,uuid,text,integer,integer),public.stop_controlled_team_run(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_controlled_team_job(uuid,text,text,uuid),public.reserve_controlled_team_ai_call(uuid,uuid,uuid,text,integer,integer),public.stop_controlled_team_run(uuid,text) to service_role;
-- Reservations cannot be deleted/reset, even by service_role. A terminal receipt is one-way.
create function private.controlled_effect_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or old.status<>'reserved' or(new.run_id,new.effect,new.slot,new.participant_id,new.report_id,new.job_id,new.request_bytes,new.max_output_tokens,new.reserved_at) is distinct from(old.run_id,old.effect,old.slot,old.participant_id,old.report_id,old.job_id,old.request_bytes,old.max_output_tokens,old.reserved_at) or new.status='reserved' then raise exception 'controlled_team_receipt_immutable';end if;return new;
end $$;
revoke all on function private.controlled_effect_immutable() from public,anon,authenticated,service_role;
create trigger controlled_effect_immutable before update or delete on private.controlled_team_effects for each row execute function private.controlled_effect_immutable();
create function private.assert_controlled_team_job(p_job_id uuid,p_lease_token uuid,p_terminal boolean default false) returns private.team_jobs language plpgsql security definer set search_path='' as $$declare j private.team_jobs;r private.controlled_team_runs;begin
 perform private.controlled_team_service();select * into j from private.team_jobs where id=p_job_id;
 select * into r from private.controlled_team_runs where id=j.controlled_run_id for update;
 select * into j from private.team_jobs where id=p_job_id for update;
 if j.id is null or r.id is null or j.team_diagnostic_id<>r.team_id or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'controlled_team_lease_invalid';end if;
 if not p_terminal and exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
 if not p_terminal and(r.status<>'active' or r.expires_at<=clock_timestamp() or(j.kind='team_ai_report' and(r.generation_deadline<=clock_timestamp() or r.source_fingerprint is distinct from j.source_fingerprint)) or j.source_fingerprint is distinct from(select fingerprint from private.team_source(r.team_id))) then raise exception 'controlled_team_dispatch_denied';end if;
 return j;
end $$;
revoke all on function private.assert_controlled_team_job(uuid,uuid,boolean) from public,anon,authenticated,service_role;
alter function public.create_team_diagnostic(uuid,text) rename to create_team_diagnostic_pre_controlled;
alter function public.create_team_diagnostic_pre_controlled(uuid,text) set schema private;
revoke all on function private.create_team_diagnostic_pre_controlled(uuid,text) from public,anon,authenticated,service_role;
create function public.create_team_diagnostic(p_company_id uuid,p_title text) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;t uuid;begin
 r:=private.require_controlled_team(null,p_company_id);
 if auth.uid() is distinct from r.owner_user_id or not private.is_verified_session() or r.team_id is not null then raise exception 'controlled_team_unavailable';end if;
 t:=private.create_team_diagnostic_pre_controlled(p_company_id,p_title);
 update private.controlled_team_runs set team_id=t where id=r.id;return t;end;
$$;
revoke all on function public.create_team_diagnostic(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.create_team_diagnostic(uuid,text) to authenticated;

alter function public.invite_team_participant(uuid,text,text,text) rename to invite_team_participant_pre_controlled;
alter function public.invite_team_participant_pre_controlled(uuid,text,text,text) set schema private;
revoke all on function private.invite_team_participant_pre_controlled(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.invite_team_participant(p_team_id uuid,p_email text,p_display_name text,p_token_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;begin
 r:=private.require_controlled_team(p_team_id);
 if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
 if auth.uid() is distinct from r.owner_user_id or not(lower(btrim(p_email))=any(r.participant_emails)) or(select count(*) from public.team_participants where team_diagnostic_id=p_team_id)>=3 then raise exception 'controlled_team_unavailable';end if;
 return private.invite_team_participant_pre_controlled(p_team_id,p_email,p_display_name,p_token_hash);end;
$$;
revoke all on function public.invite_team_participant(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.invite_team_participant(uuid,text,text,text) to authenticated;

alter function public.renew_team_invitation(uuid,text) rename to renew_team_invitation_pre_controlled;
alter function public.renew_team_invitation_pre_controlled(uuid,text) set schema private;
revoke all on function private.renew_team_invitation_pre_controlled(uuid,text) from public,anon,authenticated,service_role;
create function public.renew_team_invitation(p_participant_id uuid,p_token_hash text) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'controlled_team_renewal_denied';end;
$$;
revoke all on function public.renew_team_invitation(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.renew_team_invitation(uuid,text) to authenticated;

alter function public.revoke_team_participant(uuid) rename to revoke_team_participant_pre_controlled;
alter function public.revoke_team_participant_pre_controlled(uuid) set schema private;
revoke all on function private.revoke_team_participant_pre_controlled(uuid) from public,anon,authenticated,service_role;
create function public.revoke_team_participant(p_participant_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'controlled_team_mutation_denied';end;
$$;
revoke all on function public.revoke_team_participant(uuid) from public,anon,authenticated,service_role;
grant execute on function public.revoke_team_participant(uuid) to authenticated;

alter function public.request_team_report(uuid) rename to request_team_report_pre_controlled;
alter function public.request_team_report_pre_controlled(uuid) set schema private;
revoke all on function private.request_team_report_pre_controlled(uuid) from public,anon,authenticated,service_role;
create function public.request_team_report(p_team_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
begin raise exception 'controlled_team_legacy_denied';end;
$$;
revoke all on function public.request_team_report(uuid) from public,anon,authenticated,service_role;
grant execute on function public.request_team_report(uuid) to authenticated;

alter function public.request_team_report_v3(uuid,text) rename to request_team_report_v3_pre_controlled;
alter function public.request_team_report_v3_pre_controlled(uuid,text) set schema private;
revoke all on function private.request_team_report_v3_pre_controlled(uuid,text) from public,anon,authenticated,service_role;
create function public.request_team_report_v3(p_team_id uuid,p_provider text default 'mock') returns uuid language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;rid uuid;begin
 r:=private.require_controlled_team(p_team_id);
 if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
 if auth.uid() is distinct from r.owner_user_id or p_provider is distinct from 'openai' then raise exception 'controlled_team_unavailable';end if;
 if r.report_id is not null then
  if exists(select 1 from public.team_ai_reports where id=r.report_id and status in('queued','generating','completed')) then return r.report_id;end if;
  raise exception 'controlled_team_budget_consumed';end if;
 rid:=private.request_team_report_v3_pre_controlled(p_team_id,p_provider);
 if rid is null then raise exception 'controlled_team_aggregate_not_ready';end if;
 update private.controlled_team_runs set report_id=rid,source_fingerprint=(select source_fingerprint from public.team_ai_reports where id=rid) where id=r.id;return rid;end;
$$;
revoke all on function public.request_team_report_v3(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.request_team_report_v3(uuid,text) to authenticated;

alter function public.refresh_team_results(uuid) rename to refresh_team_results_pre_controlled;
alter function public.refresh_team_results_pre_controlled(uuid) set schema private;
revoke all on function private.refresh_team_results_pre_controlled(uuid) from public,anon,authenticated,service_role;
create function public.refresh_team_results(p_team_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;begin r:=private.require_controlled_team(p_team_id);
 if auth.uid() is distinct from r.owner_user_id or r.aggregate_claimed then raise exception 'controlled_team_mutation_denied';end if;
 perform private.refresh_team_results_pre_controlled(p_team_id);end;
$$;
revoke all on function public.refresh_team_results(uuid) from public,anon,authenticated,service_role;
grant execute on function public.refresh_team_results(uuid) to authenticated;

alter function public.close_team_diagnostic(uuid) rename to close_team_diagnostic_pre_controlled;
alter function public.close_team_diagnostic_pre_controlled(uuid) set schema private;
revoke all on function private.close_team_diagnostic_pre_controlled(uuid) from public,anon,authenticated,service_role;
create function public.close_team_diagnostic(p_team_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;begin r:=private.require_controlled_team(p_team_id);
 if auth.uid() is distinct from r.owner_user_id or r.aggregate_claimed then raise exception 'controlled_team_mutation_denied';end if;
 perform private.close_team_diagnostic_pre_controlled(p_team_id);end;
$$;
revoke all on function public.close_team_diagnostic(uuid) from public,anon,authenticated,service_role;
grant execute on function public.close_team_diagnostic(uuid) to authenticated;

alter function public.save_team_response(uuid,integer,jsonb,boolean) rename to save_team_response_pre_controlled;
alter function public.save_team_response_pre_controlled(uuid,integer,jsonb,boolean) set schema private;
revoke all on function private.save_team_response_pre_controlled(uuid,integer,jsonb,boolean) from public,anon,authenticated,service_role;
create function public.save_team_response(p_participant_id uuid,p_expected_revision integer,p_answers jsonb,p_submit boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.controlled_team_participant(p_participant_id);return private.save_team_response_pre_controlled(p_participant_id,p_expected_revision,p_answers,p_submit);end;
$$;
revoke all on function public.save_team_response(uuid,integer,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_team_response(uuid,integer,jsonb,boolean) to authenticated;

alter function public.accept_team_invitation(text) rename to accept_team_invitation_pre_controlled;
alter function public.accept_team_invitation_pre_controlled(text) set schema private;
revoke all on function private.accept_team_invitation_pre_controlled(text) from public,anon,authenticated,service_role;
create function public.accept_team_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
begin raise exception 'controlled_team_consent_required';end;
$$;
revoke all on function public.accept_team_invitation(text) from public,anon,authenticated,service_role;
grant execute on function public.accept_team_invitation(text) to authenticated;

alter function public.finalize_team_invitation_identity(text,boolean,text,text) rename to finalize_team_invitation_identity_pre_controlled;
alter function public.finalize_team_invitation_identity_pre_controlled(text,boolean,text,text) set schema private;
revoke all on function private.finalize_team_invitation_identity_pre_controlled(text,boolean,text,text) from public,anon,authenticated,service_role;
create function public.finalize_team_invitation_identity(p_token text,p_consent boolean,p_data_version text,p_marketing_version text) returns uuid language plpgsql security definer set search_path='' as $$
begin perform private.controlled_team_token(encode(sha256(convert_to(p_token,'UTF8')),'hex'));return private.finalize_team_invitation_identity_pre_controlled(p_token,p_consent,p_data_version,p_marketing_version);end;
$$;
revoke all on function public.finalize_team_invitation_identity(text,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finalize_team_invitation_identity(text,boolean,text,text) to authenticated;

alter function public.resolve_team_invitation_auth(text) rename to resolve_team_invitation_auth_pre_controlled;
alter function public.resolve_team_invitation_auth_pre_controlled(text) set schema private;
revoke all on function private.resolve_team_invitation_auth_pre_controlled(text) from public,anon,authenticated,service_role;
create function public.resolve_team_invitation_auth(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.controlled_team_token(p_token_hash);return private.resolve_team_invitation_auth_pre_controlled(p_token_hash);end;
$$;
revoke all on function public.resolve_team_invitation_auth(text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_team_invitation_auth(text) to service_role;

alter function public.reserve_team_invitation_identity(text,text) rename to reserve_team_invitation_identity_pre_controlled;
alter function public.reserve_team_invitation_identity_pre_controlled(text,text) set schema private;
revoke all on function private.reserve_team_invitation_identity_pre_controlled(text,text) from public,anon,authenticated,service_role;
create function public.reserve_team_invitation_identity(p_token_hash text,p_nonce_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.controlled_team_token(p_token_hash);return private.reserve_team_invitation_identity_pre_controlled(p_token_hash,p_nonce_hash);end;
$$;
revoke all on function public.reserve_team_invitation_identity(text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_team_invitation_identity(text,text) to service_role;

alter function public.prepare_team_report_job(uuid,uuid) rename to prepare_team_report_job_pre_controlled;
alter function public.prepare_team_report_job_pre_controlled(uuid,uuid) set schema private;
revoke all on function private.prepare_team_report_job_pre_controlled(uuid,uuid) from public,anon,authenticated,service_role;
create function public.prepare_team_report_job(p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;begin j:=private.assert_controlled_team_job(p_job_id,p_lease_token);return private.prepare_team_report_job_pre_controlled(p_job_id,p_lease_token)||jsonb_build_object('controlled_run_id',j.controlled_run_id);end;
$$;
revoke all on function public.prepare_team_report_job(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_team_report_job(uuid,uuid) to service_role;

alter function public.process_team_aggregate(uuid,uuid) rename to process_team_aggregate_pre_controlled;
alter function public.process_team_aggregate_pre_controlled(uuid,uuid) set schema private;
revoke all on function private.process_team_aggregate_pre_controlled(uuid,uuid) from public,anon,authenticated,service_role;
create function public.process_team_aggregate(p_job_id uuid,p_lease_token uuid) returns text language plpgsql security definer set search_path='' as $$
begin perform private.assert_controlled_team_job(p_job_id,p_lease_token);return private.process_team_aggregate_pre_controlled(p_job_id,p_lease_token);end;
$$;
revoke all on function public.process_team_aggregate(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.process_team_aggregate(uuid,uuid) to service_role;

alter function public.store_team_synthesis(uuid,uuid,jsonb,text,text) rename to store_team_synthesis_pre_controlled;
alter function public.store_team_synthesis_pre_controlled(uuid,uuid,jsonb,text,text) set schema private;
revoke all on function private.store_team_synthesis_pre_controlled(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
create function public.store_team_synthesis(p_job_id uuid,p_lease_token uuid,p_summary jsonb,p_provider text,p_model text) returns text language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;begin j:=private.assert_controlled_team_job(p_job_id,p_lease_token);
 if exists(select 1 from private.team_questionnaires tq cross join jsonb_array_elements(tq.questions) q cross join private.team_completed(j.team_diagnostic_id) c where tq.team_diagnostic_id=j.team_diagnostic_id and q->>'answer_type'='text' and nullif(btrim(c.answers->>(q->>'id')),'') is not null group by q having count(*)>=3) and not exists(select 1 from private.controlled_team_effects where run_id=j.controlled_run_id and job_id=j.id and effect='synthesis' and status='succeeded') then raise exception 'controlled_team_receipt_required';end if;
 if p_provider<>'openai' or p_model<>'gpt-5.6-sol' then raise exception 'controlled_team_provider_mismatch';end if;return private.store_team_synthesis_pre_controlled(p_job_id,p_lease_token,p_summary,p_provider,p_model);end;
$$;
revoke all on function public.store_team_synthesis(uuid,uuid,jsonb,text,text) from public,anon,authenticated,service_role;
grant execute on function public.store_team_synthesis(uuid,uuid,jsonb,text,text) to service_role;

alter function public.publish_team_report(uuid,uuid,jsonb,text) rename to publish_team_report_pre_controlled;
alter function public.publish_team_report_pre_controlled(uuid,uuid,jsonb,text) set schema private;
revoke all on function private.publish_team_report_pre_controlled(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
create function public.publish_team_report(p_job_id uuid,p_lease_token uuid,p_content jsonb,p_model text) returns text language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;begin j:=private.assert_controlled_team_job(p_job_id,p_lease_token);
 if not exists(select 1 from private.controlled_team_effects where run_id=j.controlled_run_id and job_id=j.id and effect='main_report' and status='succeeded') then raise exception 'controlled_team_receipt_required';end if;
 if p_model<>'gpt-5.6-sol' then raise exception 'controlled_team_provider_mismatch';end if;return private.publish_team_report_pre_controlled(p_job_id,p_lease_token,p_content,p_model);end;
$$;
revoke all on function public.publish_team_report(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.publish_team_report(uuid,uuid,jsonb,text) to service_role;

alter function public.fail_team_job(uuid,uuid,text,boolean) rename to fail_team_job_pre_controlled;
alter function public.fail_team_job_pre_controlled(uuid,uuid,text,boolean) set schema private;
revoke all on function private.fail_team_job_pre_controlled(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
create function public.fail_team_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;begin j:=private.assert_controlled_team_job(p_job_id,p_lease_token,true);perform private.fail_team_job_pre_controlled(p_job_id,p_lease_token,p_error_code,false);update private.controlled_team_runs set status='stopped',stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,'job_failed') where id=j.controlled_run_id;end;
$$;
revoke all on function public.fail_team_job(uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.fail_team_job(uuid,uuid,text,boolean) to service_role;
-- No consent-less public acceptance entry point. Only the already validated finalizer
-- can invoke the private original acceptance body; fail migration on source drift.
do $$declare d text;begin
 d:=pg_get_functiondef('private.finalize_team_invitation_identity_pre_controlled(text,boolean,text,text)'::regprocedure);
 if position('pid:=public.accept_team_invitation(p_token);' in d)=0 then raise exception 'controlled_team_finalize_definition_drift';end if;
 execute replace(d,'pid:=public.accept_team_invitation(p_token);','pid:=private.accept_team_invitation_pre_controlled(p_token);');
end $$;
-- New artifact insertion is the only write path; historical completed PDF reads are unchanged.
create function private.controlled_team_artifact_insert() returns trigger language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;begin
 select x.* into r from private.controlled_team_runs x where x.report_id=new.team_report_id;
 if r.id is null then raise exception 'controlled_team_unavailable';end if;
 perform private.require_controlled_team(r.team_id);
 if not exists(select 1 from private.controlled_team_effects e where e.run_id=r.id and e.effect='pdf' and e.report_id=new.team_report_id and e.status='reserved') or new.template_version<>'team-report-v3' then raise exception 'controlled_team_pdf_not_reserved';end if;
 return new;
end $$;
revoke all on function private.controlled_team_artifact_insert() from public,anon,authenticated,service_role;
create trigger controlled_team_artifact_insert before insert on public.team_report_artifacts for each row execute function private.controlled_team_artifact_insert();

-- The audited Admin RPC remains the only plan transition. CAS runs under its Account lock.
alter function public.admin_assign_account_plan(uuid,text,text,text) rename to admin_assign_account_plan_pre_controlled;
alter function public.admin_assign_account_plan_pre_controlled(uuid,text,text,text) set schema private;
revoke all on function private.admin_assign_account_plan_pre_controlled(uuid,text,text,text) from public,anon,authenticated,service_role;
create function public.admin_assign_account_plan(p_account_id uuid,p_target_plan text,p_reason text,p_expected_plan text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.controlled_team_runs;active_id uuid;result jsonb;
begin
 perform private.admin_console_actor();
 select x.* into r from private.controlled_team_runs x where x.account_id=p_account_id and(x.id=(select run_id from private.controlled_team_policy where singleton) or(x.grant_subscription_id is not null and x.restored_subscription_id is null)) order by x.created_at desc limit 1 for update of x;
 if r.id is null then return private.admin_assign_account_plan_pre_controlled(p_account_id,p_target_plan,p_reason,p_expected_plan);end if;
 perform 1 from public.accounts where id=p_account_id for update;
 select id into active_id from private.account_subscriptions where account_id=p_account_id and status='active';
 if(select count(*) from private.account_subscriptions where account_id=p_account_id and status='active')<>1 or active_id is distinct from r.expected_subscription_id then raise exception 'controlled_team_subscription_changed';end if;
 if r.grant_subscription_id is null then
  if r.status<>'active' or r.expires_at<=clock_timestamp() or p_target_plan<>'advanced' or p_expected_plan<>'free' then raise exception 'controlled_team_plan_transition_denied';end if;
 else
  if r.restored_subscription_id is not null then
   if p_target_plan='free' and active_id=r.restored_subscription_id then return jsonb_build_object('status','unchanged','plan','free');end if;
   raise exception 'controlled_team_plan_transition_denied';end if;
  if p_target_plan<>'free' or p_expected_plan<>'advanced' or active_id<>r.grant_subscription_id or not exists(select 1 from private.account_subscriptions where id=active_id and source='manual') then raise exception 'controlled_team_plan_transition_denied';end if;
  if exists(select 1 from private.team_jobs where controlled_run_id=r.id and(status='running' or(status in('queued','failed') and attempts<3))) then raise exception 'controlled_team_work_in_flight';end if;
 end if;
 result:=private.admin_assign_account_plan_pre_controlled(p_account_id,p_target_plan,p_reason,p_expected_plan);
 if result->>'status'<>'changed' then raise exception 'controlled_team_plan_transition_denied';end if;
 if r.grant_subscription_id is null then update private.controlled_team_runs set grant_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=r.id;
 else update private.controlled_team_runs set restored_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=r.id;end if;
 return result;
end $$;
revoke all on function public.admin_assign_account_plan(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_assign_account_plan(uuid,text,text,text) to authenticated;
commit;
