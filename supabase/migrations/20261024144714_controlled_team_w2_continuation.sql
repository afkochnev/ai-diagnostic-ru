-- Append-only continuation of one stopped controlled Team run. Default remains closed.
-- No production identifiers, provider credentials or activation is encoded here.
begin;
create table private.controlled_team_windows (
 id uuid primary key,root_run_id uuid not null unique references private.controlled_team_runs(id),
 status text not null default 'prepared' check(status in('prepared','active','stopped')),
 approved_plan_hash text not null check(approved_plan_hash ~ '^[a-f0-9]{64}$'),
 cohort_fingerprint text not null,created_at timestamptz not null default clock_timestamp(),
 armed_at timestamptz,expires_at timestamptz,personal_deadline_at timestamptz,
 stopped_at timestamptz,stop_reason text,
 expected_subscription_id uuid not null references private.account_subscriptions(id),
 grant_subscription_id uuid references private.account_subscriptions(id),restored_subscription_id uuid references private.account_subscriptions(id),
 report_id uuid unique references public.team_ai_reports(id),source_fingerprint text,
 aggregate_claimed boolean not null default false,ai_claimed boolean not null default false,generation_deadline timestamptz,
 check((armed_at is null and expires_at is null and personal_deadline_at is null) or
 (armed_at is not null and expires_at=armed_at+interval '60 minutes' and personal_deadline_at=armed_at+interval '20 minutes')),
 check(status<>'active' or armed_at is not null)
);
create table private.controlled_team_verifications (
 id uuid primary key default gen_random_uuid(),root_run_id uuid not null references private.controlled_team_runs(id),
 window_id uuid not null references private.controlled_team_windows(id),participant_id uuid not null references public.team_participants(id),
 user_id uuid not null references auth.users(id),invitation_hash text not null check(invitation_hash ~ '^[a-f0-9]{64}$'),
 reserved_at timestamptz not null default clock_timestamp(),finalized_at timestamptz,
 unique(root_run_id,participant_id),unique(window_id,participant_id)
);
alter table private.controlled_team_windows enable row level security;
alter table private.controlled_team_verifications enable row level security;
revoke all on private.controlled_team_windows,private.controlled_team_verifications from public,anon,authenticated,service_role;
alter table private.controlled_team_effects add column window_id uuid references private.controlled_team_windows(id);
alter table private.controlled_team_effects drop constraint controlled_team_effects_effect_check;
alter table private.controlled_team_effects add constraint controlled_team_effects_effect_check check(effect in('auth_link','invitation_email','reauth_link','access_email','pdf','model_get','synthesis','synthesis_repair','main_report','report_repair'));
alter table private.team_jobs add column controlled_window_id uuid references private.controlled_team_windows(id);

create function private.controlled_team_w2_cohort(p_run_id uuid) returns text language sql stable security definer set search_path='' as $$
 select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('participant_id',p.id,'email',p.email,'display_name',p.display_name,'team_id',p.team_diagnostic_id,'invitation_hash',i.token_hash,'invitation_expiry',i.expires_at,'reservation_email',r.email,'nonce_hash',r.nonce_hash,'reservation_hash',r.invitation_hash,'reservation_expiry',r.expires_at,'reservation_created_at',r.created_at,'user_id',r.user_id,'auth_email',u.email,'auth_created_at',u.created_at,'auth_pending_nonce_hash',encode(sha256(convert_to(u.raw_user_meta_data->>'team_pending_nonce','UTF8')),'hex')) order by p.id)::text,''),'UTF8')),'hex')
 from private.controlled_team_runs root join public.team_participants p on p.team_diagnostic_id=root.team_id
 join private.team_invitations i on i.participant_id=p.id join private.team_identity_reservations r on r.email=p.email and r.invitation_hash=i.token_hash
 join auth.users u on u.id=r.user_id where root.id=p_run_id;
$$;
create function private.controlled_team_w2_quiescent() returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from private.launch_controls where anonymous_start_enabled or team_creation_enabled or team_invitations_enabled)
 or exists(select 1 from private.billing_configuration where mock_enabled or yookassa_enabled or yookassa_reconciliation_enabled or yookassa_live_approved)
 or exists(select 1 from public.jobs where status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3))
 or exists(select 1 from private.team_jobs where status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3))
 then raise exception 'controlled_team_not_quiescent';end if;
end $$;
create function private.configure_controlled_team_w2(p_window_id uuid,p_root_run_id uuid,p_expected_free_subscription_id uuid,p_approved_plan_hash text) returns jsonb language plpgsql set search_path='' as $$declare r private.controlled_team_runs;begin
 if current_user<>'postgres' then raise exception 'controlled_team_operator_required';end if;
 perform 1 from private.controlled_team_policy where singleton for update;
 select * into r from private.controlled_team_runs where id=p_root_run_id for update;
 perform private.controlled_team_w2_quiescent();
 if r.id is null or r.id is distinct from(select run_id from private.controlled_team_policy where singleton) or r.status<>'stopped' or r.stopped_at is null or r.team_id is null
 or r.aggregate_claimed or r.ai_claimed or r.report_id is not null or r.source_fingerprint is not null or r.generation_deadline is not null
 or r.grant_subscription_id is null or r.restored_subscription_id is null or r.expected_subscription_id is distinct from r.restored_subscription_id
 or p_expected_free_subscription_id is distinct from r.restored_subscription_id
 or not exists(select 1 from private.account_subscriptions s join public.plans p on p.id=s.plan_id where s.id=p_expected_free_subscription_id and s.account_id=r.account_id and s.status='active' and s.source='manual' and p.key='free')
 or(select count(*) from private.account_subscriptions where account_id=r.account_id and status='active')<>1
 or not exists(select 1 from public.team_diagnostics where id=r.team_id and status='open')
 or(select count(*) from public.team_participants where team_diagnostic_id=r.team_id)<>3
 or(select count(*) from public.team_participants p join private.team_invitations i on i.participant_id=p.id join private.team_identity_reservations t on t.email=p.email and t.invitation_hash=i.token_hash join auth.users u on u.id=t.user_id where p.team_diagnostic_id=r.team_id and p.email=any(r.participant_emails) and p.status='invited' and p.revoked_at is null and i.expires_at>clock_timestamp()+interval '60 minutes' and i.redeemed_at is null and t.finalized_at is null and lower(u.email)=p.email and u.email_confirmed_at is null and encode(sha256(convert_to(u.raw_user_meta_data->>'team_pending_nonce','UTF8')),'hex')=t.nonce_hash and not exists(select 1 from public.users x where x.id=u.id))<>3
 or(select count(*) from private.controlled_team_effects where run_id=r.id)<>6
 or(select count(*) from private.controlled_team_effects where run_id=r.id and effect in('auth_link','invitation_email') and status='succeeded')<>6
 or exists(select 1 from public.team_participants p where p.team_diagnostic_id=r.team_id and(select count(*) from private.controlled_team_effects e where e.run_id=r.id and e.participant_id=p.id and e.effect='auth_link' and e.status='succeeded')<>1)
 or exists(select 1 from public.team_participants p where p.team_diagnostic_id=r.team_id and(select count(*) from private.controlled_team_effects e where e.run_id=r.id and e.participant_id=p.id and e.effect='invitation_email' and e.status='succeeded')<>1)
 then raise exception 'controlled_team_w2_target_changed';end if;
 insert into private.controlled_team_windows(id,root_run_id,approved_plan_hash,cohort_fingerprint,expected_subscription_id) values(p_window_id,r.id,p_approved_plan_hash,private.controlled_team_w2_cohort(r.id),p_expected_free_subscription_id);
 return jsonb_build_object('window_id',p_window_id,'run_id',r.id,'status','prepared','expires_at',null);
end $$;
create function private.arm_controlled_team_w2(p_window_id uuid,p_approved_plan_hash text) returns jsonb language plpgsql set search_path='' as $$declare w private.controlled_team_windows;t timestamptz:=clock_timestamp();begin
 if current_user<>'postgres' then raise exception 'controlled_team_operator_required';end if;
 perform 1 from private.controlled_team_policy where singleton for update;
 select * into w from private.controlled_team_windows where id=p_window_id for update;
 perform private.controlled_team_w2_quiescent();
 if w.id is null or w.status<>'prepared' or w.armed_at is not null or w.approved_plan_hash is distinct from p_approved_plan_hash or w.root_run_id is distinct from(select run_id from private.controlled_team_policy where singleton)
 or w.cohort_fingerprint is distinct from private.controlled_team_w2_cohort(w.root_run_id)
 or not exists(select 1 from private.account_subscriptions where id=w.expected_subscription_id and status='active')
 then raise exception 'controlled_team_w2_unavailable';end if;
 update private.controlled_team_windows set status='active',armed_at=t,expires_at=t+interval '60 minutes',personal_deadline_at=t+interval '20 minutes' where id=w.id;
 return jsonb_build_object('window_id',w.id,'run_id',w.root_run_id,'status','active','server_now',t,'expires_at',t+interval '60 minutes','personal_deadline_at',t+interval '20 minutes');
end $$;
-- The continuation is a one-shot tombstone: the legacy operator cannot select
-- an independent R2 budget, including after W2 stops and compensation completes.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('private.configure_controlled_team_run(uuid,uuid,uuid,uuid,text[],timestamptz,uuid)'::regprocedure);
 needle:='if current_user<>''postgres'' then raise exception ''controlled_team_operator_required'';end if;';
 if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;
 d:=replace(d,needle,needle||'if exists(select 1 from private.controlled_team_windows) then raise exception ''controlled_team_w2_dedicated_path_required'';end if;');
 needle:='perform 1 from private.controlled_team_policy where singleton for update;';
 if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;
 execute replace(d,needle,needle||'if exists(select 1 from private.controlled_team_windows) then raise exception ''controlled_team_w2_dedicated_path_required'';end if;');
end $$;
create function private.controlled_team_policy_frozen() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from private.controlled_team_windows) then raise exception 'controlled_team_policy_immutable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.controlled_team_policy_frozen() from public,anon,authenticated,service_role;
create trigger controlled_team_policy_frozen before update or delete on private.controlled_team_policy for each row execute function private.controlled_team_policy_frozen();
-- Immutable original R is historical evidence after W2 preparation, including all old flags/pointers.
create function private.controlled_team_root_frozen() returns trigger language plpgsql set search_path='' as $$begin
 if exists(select 1 from private.controlled_team_windows where root_run_id=old.id) then raise exception 'controlled_team_root_immutable';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger controlled_team_root_frozen before update or delete on private.controlled_team_runs for each row execute function private.controlled_team_root_frozen();
create function private.controlled_team_window_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or (new.id,new.root_run_id,new.approved_plan_hash,new.cohort_fingerprint,new.created_at) is distinct from(old.id,old.root_run_id,old.approved_plan_hash,old.cohort_fingerprint,old.created_at)
 or (old.armed_at is not null and(new.armed_at,new.expires_at,new.personal_deadline_at) is distinct from(old.armed_at,old.expires_at,old.personal_deadline_at))
 or(old.status='stopped' and new.status<>'stopped') or(old.status='active' and new.status='prepared')
 or(old.aggregate_claimed and not new.aggregate_claimed) or(old.ai_claimed and not new.ai_claimed)
 or(old.report_id is not null and(new.report_id,new.source_fingerprint) is distinct from(old.report_id,old.source_fingerprint))
 or(old.generation_deadline is not null and new.generation_deadline is distinct from old.generation_deadline)
 or(old.grant_subscription_id is not null and new.grant_subscription_id is distinct from old.grant_subscription_id)
 or(old.restored_subscription_id is not null and new.restored_subscription_id is distinct from old.restored_subscription_id)
 or(old.stopped_at is not null and(new.stopped_at,new.stop_reason) is distinct from(old.stopped_at,old.stop_reason)) then raise exception 'controlled_team_window_immutable';end if;
 return new;
end $$;
create trigger controlled_team_window_immutable before update or delete on private.controlled_team_windows for each row execute function private.controlled_team_window_immutable();
create function private.controlled_team_verification_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or old.finalized_at is not null or new.finalized_at is null or (to_jsonb(new)-'finalized_at') is distinct from(to_jsonb(old)-'finalized_at') then raise exception 'controlled_team_verification_immutable';end if;return new;
end $$;
create trigger controlled_team_verification_immutable before update or delete on private.controlled_team_verifications for each row execute function private.controlled_team_verification_immutable();
create or replace function private.require_controlled_team(p_team_id uuid default null,p_company_id uuid default null) returns private.controlled_team_runs language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;begin
 select x.* into r from private.controlled_team_runs x join private.controlled_team_policy p on p.run_id=x.id where p.singleton for update of x;
 select * into w from private.controlled_team_windows where root_run_id=r.id for update;
 if w.id is not null then
  if w.status<>'active' or w.expires_at<=clock_timestamp() or w.cohort_fingerprint is distinct from private.controlled_team_w2_cohort(r.id) or w.restored_subscription_id is not null or(w.grant_subscription_id is not null and not exists(select 1 from private.account_subscriptions s join public.plans p on p.id=s.plan_id where s.id=w.expected_subscription_id and s.id=w.grant_subscription_id and s.account_id=r.account_id and s.source='manual' and s.status='active' and p.key='advanced')) then raise exception 'controlled_team_unavailable';end if;
  r.status:=w.status;r.expires_at:=w.expires_at;r.stopped_at:=w.stopped_at;r.stop_reason:=w.stop_reason;
  r.aggregate_claimed:=r.aggregate_claimed or w.aggregate_claimed;r.ai_claimed:=r.ai_claimed or w.ai_claimed;
  r.report_id:=coalesce(r.report_id,w.report_id);r.source_fingerprint:=coalesce(r.source_fingerprint,w.source_fingerprint);r.generation_deadline:=coalesce(r.generation_deadline,w.generation_deadline);
  r.expected_subscription_id:=w.expected_subscription_id;r.grant_subscription_id:=w.grant_subscription_id;r.restored_subscription_id:=w.restored_subscription_id;
 end if;
 if r.id is null or r.status<>'active' or r.expires_at<=clock_timestamp() or(p_team_id is not null and r.team_id is distinct from p_team_id) or(p_company_id is not null and r.company_id<>p_company_id) then raise exception 'controlled_team_unavailable';end if;return r;
end $$;
create function private.controlled_team_state(p_run_id uuid,p_patch jsonb) returns void language plpgsql security definer set search_path='' as $$declare w private.controlled_team_windows;begin
 if exists(select 1 from jsonb_object_keys(p_patch) k where k not in('status','stopped_at','stop_reason','aggregate_claimed','ai_claimed','generation_deadline','report_id','source_fingerprint')) then raise exception 'controlled_team_invalid_state';end if;
 select * into w from private.controlled_team_windows where root_run_id=p_run_id for update;
 if w.id is not null then
  if w.stopped_at is not null then p_patch:=p_patch-'stopped_at'-'stop_reason';end if;
  select * into w from jsonb_populate_record(w,p_patch);
  update private.controlled_team_windows set status=w.status,stopped_at=w.stopped_at,stop_reason=w.stop_reason,aggregate_claimed=w.aggregate_claimed,ai_claimed=w.ai_claimed,generation_deadline=w.generation_deadline,report_id=w.report_id,source_fingerprint=w.source_fingerprint where id=w.id;
 else
  update private.controlled_team_runs r set status=coalesce(p_patch->>'status',r.status),stopped_at=coalesce(r.stopped_at,(p_patch->>'stopped_at')::timestamptz),stop_reason=coalesce(r.stop_reason,p_patch->>'stop_reason'),aggregate_claimed=coalesce((p_patch->>'aggregate_claimed')::boolean,r.aggregate_claimed),ai_claimed=coalesce((p_patch->>'ai_claimed')::boolean,r.ai_claimed),generation_deadline=coalesce((p_patch->>'generation_deadline')::timestamptz,r.generation_deadline),report_id=coalesce((p_patch->>'report_id')::uuid,r.report_id),source_fingerprint=coalesce(p_patch->>'source_fingerprint',r.source_fingerprint) where id=p_run_id;
 end if;
end $$;
-- Definition assertions fail the transaction on source drift; only mutable state writes are redirected.
do $$declare d text;needle text;replacement text;pair text[];sig text;begin
 foreach sig in array array['public.claim_controlled_team_job(uuid,text,text,uuid)','public.complete_controlled_team_effect(uuid,text,text,jsonb)','public.request_team_report_v3(uuid,text)','public.fail_team_job(uuid,uuid,text,boolean)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  if sig like 'public.claim_controlled%' then
   needle:='update private.controlled_team_runs set aggregate_claimed=true where id=r.id;';replacement:='perform private.controlled_team_state(r.id,jsonb_build_object(''aggregate_claimed'',true));';
   if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;d:=replace(d,needle,replacement);
   needle:='update private.controlled_team_runs set ai_claimed=true,generation_deadline=least(t+interval ''540 seconds'',j.lease_expires_at-interval ''60 seconds'',r.expires_at) where id=r.id returning * into r;';
   replacement:='perform private.controlled_team_state(r.id,jsonb_build_object(''ai_claimed'',true,''generation_deadline'',least(t+interval ''540 seconds'',j.lease_expires_at-interval ''60 seconds'',r.expires_at)));r:=private.require_controlled_team();';
   if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;d:=replace(d,needle,replacement);
   if position('if p_kind=''team_aggregate'' and p_report_id is not null then' in d)=0 or position('''run_id'',r.id,''team_id'',r.team_id' in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;
   d:=replace(d,'if p_kind=''team_aggregate'' and p_report_id is not null then','if exists(select 1 from private.controlled_team_windows where root_run_id=r.id and expires_at<=t+interval ''12 minutes'') and p_kind=''team_ai_report'' then raise exception ''controlled_team_window_dispatch_late'';end if;if p_kind=''team_aggregate'' and p_report_id is not null then');
   d:=replace(d,'''run_id'',r.id,''team_id'',r.team_id','''window_id'',j.controlled_window_id,''run_id'',r.id,''team_id'',r.team_id');
  elsif sig like 'public.complete%' then
   needle:='update private.controlled_team_runs set status=''stopped'',stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,''effect_''||p_status) where id=e.run_id;';
   replacement:='perform private.controlled_team_state(e.run_id,jsonb_build_object(''status'',''stopped'',''stopped_at'',clock_timestamp(),''stop_reason'',''effect_''||p_status));';
   if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;d:=replace(d,needle,replacement);
  elsif sig like 'public.request%' then
   needle:='update private.controlled_team_runs set report_id=rid,source_fingerprint=(select source_fingerprint from public.team_ai_reports where id=rid) where id=r.id;';
   replacement:='perform private.controlled_team_state(r.id,jsonb_build_object(''report_id'',rid,''source_fingerprint'',(select source_fingerprint from public.team_ai_reports where id=rid)));';
   if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;d:=replace(d,needle,replacement);
  else
   needle:='update private.controlled_team_runs set status=''stopped'',stopped_at=coalesce(stopped_at,clock_timestamp()),stop_reason=coalesce(stop_reason,''job_failed'') where id=j.controlled_run_id;';
   replacement:='perform private.controlled_team_state(j.controlled_run_id,jsonb_build_object(''status'',''stopped'',''stopped_at'',clock_timestamp(),''stop_reason'',''job_failed''));';
   if position(needle in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;d:=replace(d,needle,replacement);
  end if;execute d;
 end loop;
end $$;
-- Generic creation/identity reservation remain forbidden while a W2 record is selected.
do $$declare d text;sig text;begin
 foreach sig in array array['public.create_team_diagnostic(uuid,text)','public.invite_team_participant(uuid,text,text,text)','public.reserve_team_invitation_identity(text,text)','public.finalize_team_invitation_identity(text,boolean,text,text)'] loop
  d:=pg_get_functiondef(sig::regprocedure);
  if position('begin' in d)=0 then raise exception 'controlled_team_w2_source_drift';end if;
  d:=regexp_replace(d,'begin','begin if exists(select 1 from private.controlled_team_windows where root_run_id=(select run_id from private.controlled_team_policy where singleton)) then raise exception ''controlled_team_w2_dedicated_path_required'';end if;');execute d;
 end loop;
end $$;
create function private.require_controlled_team_window(p_run_id uuid,p_window_id uuid) returns private.controlled_team_windows language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;begin
 r:=private.require_controlled_team();select * into w from private.controlled_team_windows where root_run_id=r.id for update;
 if p_run_id is distinct from r.id or p_window_id is distinct from w.id or w.id is null then raise exception 'controlled_team_window_mismatch';end if;return w;
end $$;
create or replace function public.controlled_team_context(p_company_id uuid default null,p_team_id uuid default null,p_participant_id uuid default null,p_invitation_hash text default null) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;pid uuid:=p_participant_id;w private.controlled_team_windows;begin
 perform private.controlled_team_service();if p_invitation_hash is not null then pid:=private.controlled_team_token(p_invitation_hash);end if;
 if pid is not null then r:=private.controlled_team_participant(pid);else r:=private.require_controlled_team(p_team_id,p_company_id);end if;
 if(p_team_id is not null and r.team_id is distinct from p_team_id) or(p_company_id is not null and r.company_id<>p_company_id) then raise exception 'controlled_team_unavailable';end if;
 select * into w from private.controlled_team_windows where root_run_id=r.id;
 return jsonb_build_object('mode','controlled','run_id',r.id,'window_id',w.id,'continuation_window_id',w.id,'approved_plan_hash',w.approved_plan_hash,'owner_user_id',r.owner_user_id,'account_id',r.account_id,'company_id',r.company_id,'team_id',r.team_id,'expires_at',r.expires_at,'personal_deadline_at',w.personal_deadline_at,'server_now',clock_timestamp(),'participant_id',pid,'model','gpt-5.6-sol');
end $$;
create function public.resolve_controlled_team_w2_access(p_window_id uuid,p_participant_id uuid,p_invitation_hash text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;p public.team_participants;i private.team_invitations;t private.team_identity_reservations;begin
 perform private.controlled_team_service();r:=private.controlled_team_participant(p_participant_id);w:=private.require_controlled_team_window(r.id,p_window_id);
 select * into p from public.team_participants where id=p_participant_id;
 select * into i from private.team_invitations where participant_id=p.id;
 select * into t from private.team_identity_reservations where email=p.email and invitation_hash=i.token_hash;
 if p.status<>'invited' or i.token_hash is distinct from p_invitation_hash or i.expires_at<=clock_timestamp() or i.redeemed_at is not null or t.user_id is null or t.finalized_at is not null
 or not exists(select 1 from auth.users where id=t.user_id and lower(email)=p.email) then raise exception 'controlled_team_w2_identity_changed';end if;
 return jsonb_build_object('run_id',r.id,'window_id',w.id,'team_id',r.team_id,'participant_id',p.id,'report_id',null,'approved_plan_hash',w.approved_plan_hash,'user_id',t.user_id,'email',p.email,'recipient_email',p.email,'display_name',p.display_name,'invitation_hash',i.token_hash,'create_user',false,'server_now',clock_timestamp(),'deadline_at',least(w.personal_deadline_at,w.expires_at));
end $$;
create or replace function public.resolve_team_invitation_auth(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;pid uuid;wid uuid;begin
 perform private.controlled_team_service();pid:=private.controlled_team_token(p_token_hash);r:=private.controlled_team_participant(pid);
 select id into wid from private.controlled_team_windows where root_run_id=r.id;
 if wid is not null then return public.resolve_controlled_team_w2_access(wid,pid,p_token_hash);end if;
 return private.resolve_team_invitation_auth_pre_controlled(p_token_hash);
end $$;
create function public.reserve_controlled_team_w2_access(p_window_id uuid,p_participant_id uuid,p_effect text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;target jsonb;eid uuid;h text;begin
 perform private.controlled_team_service();r:=private.controlled_team_participant(p_participant_id);w:=private.require_controlled_team_window(r.id,p_window_id);
 if clock_timestamp()>=w.personal_deadline_at or w.grant_subscription_id is null or w.restored_subscription_id is not null or p_effect not in('reauth_link','access_email') then raise exception 'controlled_team_w2_access_denied';end if;
 if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
 select token_hash into h from private.team_invitations where participant_id=p_participant_id;
 target:=public.resolve_controlled_team_w2_access(w.id,p_participant_id,h);
 if exists(select 1 from auth.users where id=(target->>'user_id')::uuid and email_confirmed_at is not null) then raise exception 'controlled_team_w2_identity_changed';end if;
 if p_effect='access_email' and not exists(select 1 from private.controlled_team_effects where run_id=r.id and window_id=w.id and participant_id=p_participant_id and effect='reauth_link' and status='succeeded') then raise exception 'controlled_team_auth_not_ready';end if;
 insert into private.controlled_team_effects(run_id,window_id,effect,slot,participant_id) values(r.id,w.id,p_effect,p_participant_id::text,p_participant_id) returning id into eid;
 return target||jsonb_build_object('reservation_id',eid,'effect',p_effect);
exception when unique_violation then raise exception 'controlled_team_budget_consumed';end $$;
create function public.reserve_controlled_team_w2_verification(p_window_id uuid,p_participant_id uuid,p_invitation_hash text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;target jsonb;vid uuid;begin
 perform private.controlled_team_service();r:=private.controlled_team_participant(p_participant_id);w:=private.require_controlled_team_window(r.id,p_window_id);
 if clock_timestamp()>=w.personal_deadline_at or w.grant_subscription_id is null or w.restored_subscription_id is not null then raise exception 'controlled_team_personal_deadline';end if;
 target:=public.resolve_controlled_team_w2_access(w.id,p_participant_id,p_invitation_hash);
 if not exists(select 1 from private.controlled_team_effects where run_id=r.id and window_id=w.id and participant_id=p_participant_id and effect='access_email' and status='succeeded') or exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_receipt_required';end if;
 insert into private.controlled_team_verifications(root_run_id,window_id,participant_id,user_id,invitation_hash) values(r.id,w.id,p_participant_id,(target->>'user_id')::uuid,p_invitation_hash) returning id into vid;
 return target||jsonb_build_object('verification_id',vid,'deadline_at',w.personal_deadline_at);
exception when unique_violation then raise exception 'controlled_team_verification_consumed';end $$;
-- Hash-only finalizer is a private clone of the accepted consent/acceptance implementations.
-- It does not persist/recreate a raw invitation token or modify invitation binding/expiry.
do $$declare d text;begin
 d:=pg_get_functiondef('private.accept_team_invitation_pre_controlled(text)'::regprocedure);
 if position('private.accept_team_invitation_pre_controlled(p_token text)' in d)=0 then raise exception 'controlled_team_w2_finalize_drift';end if;
 d:=replace(d,'private.accept_team_invitation_pre_controlled(p_token text)','private.accept_team_invitation_w2_hash(p_token text)');
 if position('encode(sha256(convert_to(p_token,''UTF8'')),''hex'')' in d)=0 then raise exception 'controlled_team_w2_finalize_drift';end if;
 d:=replace(d,'encode(sha256(convert_to(p_token,''UTF8'')),''hex'')','p_token');execute d;
 d:=pg_get_functiondef('private.finalize_team_invitation_identity_pre_controlled(text,boolean,text,text)'::regprocedure);
 if position('private.finalize_team_invitation_identity_pre_controlled(p_token text' in d)=0 then raise exception 'controlled_team_w2_finalize_drift';end if;
 d:=replace(d,'private.finalize_team_invitation_identity_pre_controlled(p_token text','private.finalize_team_invitation_identity_w2_hash(p_token text');
 if position('encode(sha256(convert_to(p_token,''UTF8'')),''hex'')' in d)=0 or position('private.accept_team_invitation_pre_controlled(p_token)' in d)=0 then raise exception 'controlled_team_w2_finalize_drift';end if;
 d:=replace(d,'encode(sha256(convert_to(p_token,''UTF8'')),''hex'')','p_token');d:=replace(d,'private.accept_team_invitation_pre_controlled(p_token)','private.accept_team_invitation_w2_hash(p_token)');execute d;
end $$;
create function public.finalize_controlled_team_w2_identity(p_window_id uuid,p_verification_id uuid,p_invitation_hash text,p_consent boolean,p_data_version text,p_marketing_version text) returns uuid language plpgsql security definer set search_path='' as $$declare v private.controlled_team_verifications;r private.controlled_team_runs;w private.controlled_team_windows;pid uuid;begin
 select * into v from private.controlled_team_verifications where id=p_verification_id for update;
 if v.id is null or v.user_id is distinct from auth.uid() or v.window_id is distinct from p_window_id or v.invitation_hash is distinct from p_invitation_hash or v.finalized_at is not null or p_consent is distinct from true then raise exception 'controlled_team_verification_denied';end if;
 r:=private.controlled_team_participant(v.participant_id);w:=private.require_controlled_team_window(r.id,p_window_id);
 if clock_timestamp()>=w.personal_deadline_at then raise exception 'controlled_team_personal_deadline';end if;
 pid:=private.finalize_team_invitation_identity_w2_hash(p_invitation_hash,p_consent,p_data_version,p_marketing_version);
 if pid is distinct from v.participant_id then raise exception 'controlled_team_w2_identity_changed';end if;
 update private.controlled_team_verifications set finalized_at=clock_timestamp() where id=v.id;return pid;
end $$;
-- Every durable effect and new job is bound to the exact effective window. Old rows stay NULL/full exact.
create function private.controlled_team_effect_window() returns trigger language plpgsql security definer set search_path='' as $$declare wid uuid;begin
 select id into wid from private.controlled_team_windows where root_run_id=new.run_id;
 if wid is not null then
  perform private.require_controlled_team_window(new.run_id,wid);
  if new.effect in('auth_link','invitation_email') or(new.window_id is not null and new.window_id<>wid) then raise exception 'controlled_team_w2_dedicated_path_required';end if;new.window_id:=wid;
 elsif new.window_id is not null or new.effect in('reauth_link','access_email') then raise exception 'controlled_team_window_mismatch';end if;return new;
end $$;
create trigger controlled_team_effect_window before insert on private.controlled_team_effects for each row execute function private.controlled_team_effect_window();
create or replace function private.controlled_effect_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or old.status<>'reserved' or(new.run_id,new.window_id,new.effect,new.slot,new.participant_id,new.report_id,new.job_id,new.request_bytes,new.max_output_tokens,new.reserved_at) is distinct from(old.run_id,old.window_id,old.effect,old.slot,old.participant_id,old.report_id,old.job_id,old.request_bytes,old.max_output_tokens,old.reserved_at) or new.status='reserved' then raise exception 'controlled_team_receipt_immutable';end if;return new;
end $$;
create or replace function private.controlled_team_tag_job() returns trigger language plpgsql security definer set search_path='' as $$begin
 select id into new.controlled_run_id from private.controlled_team_runs where team_id=new.team_diagnostic_id;
 select id into new.controlled_window_id from private.controlled_team_windows where root_run_id=new.controlled_run_id;
 if new.controlled_window_id is not null then perform private.require_controlled_team_window(new.controlled_run_id,new.controlled_window_id);end if;return new;
end $$;
create or replace function private.assert_controlled_team_job(p_job_id uuid,p_lease_token uuid,p_terminal boolean default false) returns private.team_jobs language plpgsql security definer set search_path='' as $$declare j private.team_jobs;r private.controlled_team_runs;wid uuid;begin
 perform private.controlled_team_service();select * into j from private.team_jobs where id=p_job_id;
 perform 1 from private.controlled_team_runs where id=j.controlled_run_id for update;
 select id into wid from private.controlled_team_windows where root_run_id=j.controlled_run_id for update;
 select * into j from private.team_jobs where id=p_job_id for update;
 if j.id is null or j.controlled_window_id is distinct from wid or j.status<>'running' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then raise exception 'controlled_team_lease_invalid';end if;
 if p_terminal then select * into r from private.controlled_team_runs where id=j.controlled_run_id;
 else r:=private.require_controlled_team(j.team_diagnostic_id);
  if exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded') then raise exception 'controlled_team_prior_effect_unresolved';end if;
  if(j.kind='team_ai_report' and(r.generation_deadline is null or r.generation_deadline<=clock_timestamp() or r.source_fingerprint is distinct from j.source_fingerprint)) or j.source_fingerprint is distinct from(select fingerprint from private.team_source(r.team_id)) then raise exception 'controlled_team_dispatch_denied';end if;
 end if;
 if r.id is null or j.team_diagnostic_id is distinct from r.team_id then raise exception 'controlled_team_lease_invalid';end if;return j;
end $$;
create function public.claim_controlled_team_window_job(p_run_id uuid,p_window_id uuid,p_kind text,p_source_fingerprint text,p_report_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();perform private.require_controlled_team_window(p_run_id,p_window_id);return private.claim_controlled_team_job_pre_w2(p_run_id,p_kind,p_source_fingerprint,p_report_id)||jsonb_build_object('approved_plan_hash',(select approved_plan_hash from private.controlled_team_windows where id=p_window_id));
end $$;
create function public.reserve_controlled_team_window_ai_call(p_run_id uuid,p_window_id uuid,p_job_id uuid,p_lease_token uuid,p_stage text,p_request_bytes integer,p_max_output_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();perform private.require_controlled_team_window(p_run_id,p_window_id);perform private.assert_controlled_team_job(p_job_id,p_lease_token);
 return private.reserve_controlled_team_ai_call_pre_w2(p_run_id,p_job_id,p_lease_token,p_stage,p_request_bytes,p_max_output_tokens)||jsonb_build_object('window_id',p_window_id,'approved_plan_hash',(select approved_plan_hash from private.controlled_team_windows where id=p_window_id));
end $$;
create function public.reserve_controlled_team_window_effect(p_run_id uuid,p_window_id uuid,p_team_id uuid,p_effect text,p_participant_id uuid default null,p_report_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();perform private.require_controlled_team_window(p_run_id,p_window_id);
 if p_effect<>'pdf' then raise exception 'controlled_team_invalid_effect';end if;
 return private.reserve_controlled_team_effect_pre_w2(p_team_id,p_effect,p_participant_id,p_report_id)||jsonb_build_object('window_id',p_window_id,'approved_plan_hash',(select approved_plan_hash from private.controlled_team_windows where id=p_window_id));
end $$;
create or replace function public.stop_controlled_team_run(p_run_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare w private.controlled_team_windows;r private.controlled_team_runs;begin
 perform private.controlled_team_service();if p_reason is null or p_reason!~'^[a-z0-9_]{3,80}$' then raise exception 'controlled_team_invalid_reason';end if;
 select * into w from private.controlled_team_windows where root_run_id=p_run_id for update;
 if w.id is not null then raise exception 'controlled_team_w2_dedicated_path_required';end if;
 select * into r from private.controlled_team_runs where id=p_run_id for update;if r.id is null then raise exception 'controlled_team_unavailable';end if;
 if r.status<>'stopped' then perform private.controlled_team_state(p_run_id,jsonb_build_object('status','stopped','stopped_at',clock_timestamp(),'stop_reason',p_reason));end if;return jsonb_build_object('status','stopped');
end $$;
create function public.stop_controlled_team_window(p_run_id uuid,p_window_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare w private.controlled_team_windows;begin
 perform private.controlled_team_service();if p_reason is null or p_reason!~'^[a-z0-9_]{3,80}$' then raise exception 'controlled_team_invalid_reason';end if;
 select * into w from private.controlled_team_windows where id=p_window_id and root_run_id=p_run_id for update;if w.id is null then raise exception 'controlled_team_window_mismatch';end if;
 if w.status<>'stopped' then perform private.controlled_team_state(p_run_id,jsonb_build_object('status','stopped','stopped_at',clock_timestamp(),'stop_reason',p_reason));end if;
 return jsonb_build_object('status','stopped','window_id',w.id,'run_id',w.root_run_id);
end $$;
create function public.terminalize_controlled_team_window_job(p_run_id uuid,p_window_id uuid,p_job_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$declare w private.controlled_team_windows;j private.team_jobs;begin
 perform private.controlled_team_service();select * into w from private.controlled_team_windows where id=p_window_id and root_run_id=p_run_id for update;
 select * into j from private.team_jobs where id=p_job_id for update;
 if w.id is null or w.status<>'stopped' or p_reason is null or p_reason!~'^[a-z0-9_]{3,80}$' or j.id is null or j.controlled_run_id is distinct from w.root_run_id or j.controlled_window_id is distinct from w.id or j.lease_token is not null or j.lease_expires_at is not null or j.status='running' then raise exception 'controlled_team_terminalize_denied';end if;
 if j.status='completed' or(j.status='failed' and j.attempts=3) then return jsonb_build_object('status',j.status,'duplicate',true);end if;
 if j.status not in('queued','failed') or j.attempts<>0 then raise exception 'controlled_team_terminalize_denied';end if;
 update private.team_jobs set status='failed',attempts=3,last_error_code=p_reason,completed_at=clock_timestamp() where id=j.id;
 if j.kind='team_ai_report' then update public.team_ai_reports set status='failed',error_code='team_processing_failed' where id=w.report_id and team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and status='queued';end if;
 return jsonb_build_object('status','failed','duplicate',false);
end $$;
create or replace function private.controlled_team_artifact_insert() returns trigger language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;begin
 select x.* into r from private.controlled_team_runs x left join private.controlled_team_windows w on w.root_run_id=x.id where x.report_id=new.team_report_id or w.report_id=new.team_report_id;
 if r.id is null then raise exception 'controlled_team_unavailable';end if;perform private.require_controlled_team(r.team_id);
 if not exists(select 1 from private.controlled_team_effects e where e.run_id=r.id and e.effect='pdf' and e.report_id=new.team_report_id and e.status='reserved') or new.template_version<>'team-report-v3' then raise exception 'controlled_team_pdf_not_reserved';end if;return new;
end $$;
-- prepare result exposes the window so a strict manifest can match before any outbound call.
create or replace function public.prepare_team_report_job(p_job_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare j private.team_jobs;begin
 j:=private.assert_controlled_team_job(p_job_id,p_lease_token);return private.prepare_team_report_job_pre_controlled(p_job_id,p_lease_token)||jsonb_build_object('controlled_run_id',j.controlled_run_id,'controlled_window_id',j.controlled_window_id);
end $$;
-- Existing Admin privilege/authentication checks and append-only audit remain authoritative.
create or replace function public.admin_assign_account_plan(p_account_id uuid,p_target_plan text,p_reason text,p_expected_plan text) returns jsonb language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;active_id uuid;result jsonb;begin
 perform private.admin_console_actor();
 select x.* into w from private.controlled_team_windows x join private.controlled_team_runs z on z.id=x.root_run_id where z.account_id=p_account_id for update of x;
 if w.id is not null then
  select * into r from private.controlled_team_runs where id=w.root_run_id;perform 1 from public.accounts where id=p_account_id for update;
  select id into active_id from private.account_subscriptions where account_id=p_account_id and status='active';
  if(select count(*) from private.account_subscriptions where account_id=p_account_id and status='active')<>1 or active_id is distinct from w.expected_subscription_id then raise exception 'controlled_team_subscription_changed';end if;
  if w.restored_subscription_id is not null then
   if p_target_plan='free' and active_id=w.restored_subscription_id then return jsonb_build_object('status','unchanged','plan','free');end if;raise exception 'controlled_team_plan_transition_denied';
  elsif w.grant_subscription_id is null then
   perform private.require_controlled_team_window(r.id,w.id);
   if p_target_plan<>'advanced' or p_expected_plan<>'free' then raise exception 'controlled_team_plan_transition_denied';end if;
  else
   if p_target_plan<>'free' or p_expected_plan<>'advanced' or active_id is distinct from w.grant_subscription_id or not exists(select 1 from private.account_subscriptions where id=active_id and source='manual') then raise exception 'controlled_team_plan_transition_denied';end if;
   if exists(select 1 from private.team_jobs where controlled_run_id=r.id and(status='running' or lease_token is not null or lease_expires_at is not null or(status in('queued','failed') and attempts<3))) then raise exception 'controlled_team_work_in_flight';end if;
  end if;
  result:=private.admin_assign_account_plan_pre_controlled(p_account_id,p_target_plan,p_reason,p_expected_plan);
  if result->>'status'<>'changed' then raise exception 'controlled_team_plan_transition_denied';end if;
  if w.grant_subscription_id is null then update private.controlled_team_windows set grant_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=w.id;
  else update private.controlled_team_windows set restored_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=w.id;end if;return result;
 end if;
 -- Preserve original guard for selected legacy roots, with no new privilege or bypass.
 select x.* into r from private.controlled_team_runs x where x.account_id=p_account_id and(x.id=(select run_id from private.controlled_team_policy where singleton) or(x.grant_subscription_id is not null and x.restored_subscription_id is null)) order by x.created_at desc limit 1 for update of x;
 if r.id is null then return private.admin_assign_account_plan_pre_controlled(p_account_id,p_target_plan,p_reason,p_expected_plan);end if;
 perform 1 from public.accounts where id=p_account_id for update;select id into active_id from private.account_subscriptions where account_id=p_account_id and status='active';
 if(select count(*) from private.account_subscriptions where account_id=p_account_id and status='active')<>1 or active_id is distinct from r.expected_subscription_id then raise exception 'controlled_team_subscription_changed';end if;
 if r.grant_subscription_id is null then
  if r.status<>'active' or r.expires_at<=clock_timestamp() or p_target_plan<>'advanced' or p_expected_plan<>'free' then raise exception 'controlled_team_plan_transition_denied';end if;
 else
  if r.restored_subscription_id is not null then if p_target_plan='free' and active_id=r.restored_subscription_id then return jsonb_build_object('status','unchanged','plan','free');end if;raise exception 'controlled_team_plan_transition_denied';end if;
  if p_target_plan<>'free' or p_expected_plan<>'advanced' or active_id<>r.grant_subscription_id or not exists(select 1 from private.account_subscriptions where id=active_id and source='manual') then raise exception 'controlled_team_plan_transition_denied';end if;
  if exists(select 1 from private.team_jobs where controlled_run_id=r.id and(status='running' or(status in('queued','failed') and attempts<3))) then raise exception 'controlled_team_work_in_flight';end if;
 end if;
 result:=private.admin_assign_account_plan_pre_controlled(p_account_id,p_target_plan,p_reason,p_expected_plan);if result->>'status'<>'changed' then raise exception 'controlled_team_plan_transition_denied';end if;
 if r.grant_subscription_id is null then update private.controlled_team_runs set grant_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=r.id;
 else update private.controlled_team_runs set restored_subscription_id=(result->>'subscription_id')::uuid,expected_subscription_id=(result->>'subscription_id')::uuid where id=r.id;end if;return result;
end $$;
-- No execution grants on any new private helpers, including clones/operator functions.
do $$declare p record;begin
 for p in select oid::regprocedure sig from pg_proc where pronamespace='private'::regnamespace and(proname like '%controlled_team%w2%' or proname in('controlled_team_root_frozen','controlled_team_window_immutable','controlled_team_verification_immutable','controlled_team_state','require_controlled_team_window','controlled_team_effect_window','accept_team_invitation_w2_hash','finalize_team_invitation_identity_w2_hash')) loop execute format('revoke all on function %s from public,anon,authenticated,service_role',p.sig);end loop;
end $$;
revoke all on function public.resolve_controlled_team_w2_access(uuid,uuid,text),public.reserve_controlled_team_w2_access(uuid,uuid,text),public.reserve_controlled_team_w2_verification(uuid,uuid,text),public.finalize_controlled_team_w2_identity(uuid,uuid,text,boolean,text,text),public.claim_controlled_team_window_job(uuid,uuid,text,text,uuid),public.reserve_controlled_team_window_ai_call(uuid,uuid,uuid,uuid,text,integer,integer),public.reserve_controlled_team_window_effect(uuid,uuid,uuid,text,uuid,uuid),public.stop_controlled_team_window(uuid,uuid,text),public.terminalize_controlled_team_window_job(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.resolve_controlled_team_w2_access(uuid,uuid,text),public.reserve_controlled_team_w2_access(uuid,uuid,text),public.reserve_controlled_team_w2_verification(uuid,uuid,text),public.claim_controlled_team_window_job(uuid,uuid,text,text,uuid),public.reserve_controlled_team_window_ai_call(uuid,uuid,uuid,uuid,text,integer,integer),public.reserve_controlled_team_window_effect(uuid,uuid,uuid,text,uuid,uuid),public.stop_controlled_team_window(uuid,uuid,text),public.terminalize_controlled_team_window_job(uuid,uuid,uuid,text) to service_role;
grant execute on function public.finalize_controlled_team_w2_identity(uuid,uuid,text,boolean,text,text) to authenticated;

-- Root-only runner/effect APIs cannot bypass an explicit W2 manifest.
alter function public.claim_controlled_team_job(uuid,text,text,uuid) rename to claim_controlled_team_job_pre_w2;
alter function public.claim_controlled_team_job_pre_w2(uuid,text,text,uuid) set schema private;
alter function public.reserve_controlled_team_ai_call(uuid,uuid,uuid,text,integer,integer) rename to reserve_controlled_team_ai_call_pre_w2;
alter function public.reserve_controlled_team_ai_call_pre_w2(uuid,uuid,uuid,text,integer,integer) set schema private;
alter function public.reserve_controlled_team_effect(uuid,text,uuid,uuid) rename to reserve_controlled_team_effect_pre_w2;
alter function public.reserve_controlled_team_effect_pre_w2(uuid,text,uuid,uuid) set schema private;
revoke all on function private.claim_controlled_team_job_pre_w2(uuid,text,text,uuid),private.reserve_controlled_team_ai_call_pre_w2(uuid,uuid,uuid,text,integer,integer),private.reserve_controlled_team_effect_pre_w2(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
create function public.claim_controlled_team_job(p_run_id uuid,p_kind text,p_source_fingerprint text,p_report_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();if exists(select 1 from private.controlled_team_windows where root_run_id=p_run_id) then raise exception 'controlled_team_window_mismatch';end if;
 return private.claim_controlled_team_job_pre_w2(p_run_id,p_kind,p_source_fingerprint,p_report_id);end $$;
create function public.reserve_controlled_team_ai_call(p_run_id uuid,p_job_id uuid,p_lease_token uuid,p_stage text,p_request_bytes integer,p_max_output_tokens integer) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();if exists(select 1 from private.controlled_team_windows where root_run_id=p_run_id) then raise exception 'controlled_team_window_mismatch';end if;
 return private.reserve_controlled_team_ai_call_pre_w2(p_run_id,p_job_id,p_lease_token,p_stage,p_request_bytes,p_max_output_tokens);end $$;
create function public.reserve_controlled_team_effect(p_team_id uuid,p_effect text,p_participant_id uuid default null,p_report_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.controlled_team_service();if exists(select 1 from private.controlled_team_windows w join private.controlled_team_runs r on r.id=w.root_run_id where r.team_id=p_team_id) then raise exception 'controlled_team_window_mismatch';end if;
 return private.reserve_controlled_team_effect_pre_w2(p_team_id,p_effect,p_participant_id,p_report_id);end $$;
revoke all on function public.claim_controlled_team_job(uuid,text,text,uuid),public.reserve_controlled_team_ai_call(uuid,uuid,uuid,text,integer,integer),public.reserve_controlled_team_effect(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_controlled_team_job(uuid,text,text,uuid),public.reserve_controlled_team_ai_call(uuid,uuid,uuid,text,integer,integer),public.reserve_controlled_team_effect(uuid,text,uuid,uuid) to service_role;
commit;
