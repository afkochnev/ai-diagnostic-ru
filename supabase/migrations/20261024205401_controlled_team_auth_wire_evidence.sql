-- Private, at-most-once evidence for the existing W2 Auth reservations only.
-- No window, gate, user, credential, secret or provider effect is created here.
begin;
do $$begin
 if to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then raise exception 'controlled_team_auth_crypto_unavailable';end if;
end $$;
create table private.controlled_team_auth_wire (
 id uuid primary key default gen_random_uuid(),root_run_id uuid not null references private.controlled_team_runs(id),
 window_id uuid not null references private.controlled_team_windows(id),participant_id uuid not null references public.team_participants(id),
 user_id uuid not null references auth.users(id),operation text not null check(operation in('issue','verify')),
 effect_id uuid unique references private.controlled_team_effects(id),verification_id uuid unique references private.controlled_team_verifications(id),
 credential_source_trace_id uuid references private.controlled_team_auth_wire(id),
 approved_plan_hash text not null check(approved_plan_hash ~ '^[a-f0-9]{64}$'),
 status text not null check(status in('reserved','blocked','succeeded','failed','unknown')),
 reserved_at timestamptz not null default clock_timestamp(),deadline_at timestamptz not null,
 prewire_credential_match boolean,credential_match boolean,credential_mac text check(credential_mac ~ '^[a-f0-9]{64}$'),
 dispatched_at timestamptz,received_at timestamptz,http_status integer check(http_status between 100 and 599),
 response_identity_matches boolean,finished_at timestamptz,
 unique(root_run_id,participant_id,operation),
 check((operation='issue' and effect_id is not null and verification_id is null and credential_source_trace_id is null) or
       (operation='verify' and effect_id is null and verification_id is not null and credential_source_trace_id is not null)),
 check((status='reserved' and finished_at is null) or(status<>'reserved' and finished_at is not null)),
 check(status<>'succeeded' or(http_status=200 and credential_match is true and response_identity_matches is true and dispatched_at is not null and received_at is not null)),
 check(credential_mac is null or(operation='issue' and status='succeeded'))
);
alter table private.controlled_team_auth_wire enable row level security;
revoke all on private.controlled_team_auth_wire from public,anon,authenticated,service_role;
create function private.controlled_team_auth_wire_immutable() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' or old.status<>'reserved' or new.status='reserved'
 or (to_jsonb(new)-array['status','credential_match','credential_mac','dispatched_at','received_at','http_status','response_identity_matches','finished_at'])
 is distinct from(to_jsonb(old)-array['status','credential_match','credential_mac','dispatched_at','received_at','http_status','response_identity_matches','finished_at'])
 then raise exception 'controlled_team_auth_trace_immutable';end if;return new;
end $$;
create trigger controlled_team_auth_wire_immutable before update or delete on private.controlled_team_auth_wire for each row execute function private.controlled_team_auth_wire_immutable();
create function private.controlled_team_auth_mac(p_message text) returns text language plpgsql stable security definer set search_path='' as $$declare headers jsonb;header text;begin
 perform private.controlled_team_service();
 begin headers:=current_setting('request.headers',true)::jsonb;exception when others then return null;end;
 header:=headers->>'authorization';
 if header is null or length(header) not between 27 and 4103 or header !~ '^Bearer [A-Za-z0-9._-]+$' then return null;end if;
 return encode(extensions.hmac(convert_to(p_message,'UTF8'),convert_to(header,'UTF8'),'sha256'),'hex');
end $$;
create function private.controlled_team_auth_scope(p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,p_operation text,p_reservation_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;begin
 select x.* into r from private.controlled_team_runs x join private.controlled_team_policy z on z.run_id=x.id where z.singleton and x.id=p_run_id;
 if r.id is null or not exists(select 1 from public.team_participants p join private.team_invitations i on i.participant_id=p.id join private.team_identity_reservations t on t.email=p.email and t.invitation_hash=i.token_hash join auth.users u on u.id=t.user_id where p.id=p_participant_id and p.team_diagnostic_id=r.team_id and p.email=any(r.participant_emails) and p.revoked_at is null and t.user_id=p_user_id and lower(u.email)=p.email and encode(sha256(convert_to(u.raw_user_meta_data->>'team_pending_nonce','UTF8')),'hex')=t.nonce_hash)
 then raise exception 'controlled_team_auth_scope_denied';end if;
 if p_operation='capability' then
  if p_window_id is not null or p_reservation_id is not null then raise exception 'controlled_team_auth_scope_denied';end if;return null;
 end if;
 select * into w from private.controlled_team_windows where id=p_window_id and root_run_id=r.id;
 if w.id is null or p_reservation_id is null then raise exception 'controlled_team_auth_scope_denied';end if;
 if p_operation='issue' then
  if not exists(select 1 from private.controlled_team_effects where id=p_reservation_id and run_id=r.id and window_id=w.id and participant_id=p_participant_id and effect='reauth_link' and slot=p_participant_id::text and status='reserved') then raise exception 'controlled_team_auth_scope_denied';end if;
 elsif p_operation='verify' then
  if not exists(select 1 from private.controlled_team_verifications where id=p_reservation_id and root_run_id=r.id and window_id=w.id and participant_id=p_participant_id and user_id=p_user_id and finalized_at is null) then raise exception 'controlled_team_auth_scope_denied';end if;
 else raise exception 'controlled_team_auth_scope_denied';end if;
 return w.approved_plan_hash;
end $$;
create function public.check_controlled_team_auth_evidence_key(p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,p_operation text,p_reservation_id uuid,p_challenge text,p_challenge_mac text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare plan text;expected text;begin
 perform private.controlled_team_service();plan:=private.controlled_team_auth_scope(p_run_id,p_window_id,p_participant_id,p_user_id,p_operation,p_reservation_id);
 if p_challenge ~ '^[a-f0-9]{64}$' and p_challenge_mac ~ '^[a-f0-9]{64}$' then expected:=private.controlled_team_auth_mac(E'aca-w2-auth-evidence-v1\nchallenge\n'||p_run_id::text||E'\n'||coalesce(p_window_id::text,'-')||E'\n'||p_participant_id::text||E'\n'||p_user_id::text||E'\n'||p_operation||E'\n'||coalesce(p_reservation_id::text,'-')||E'\n'||p_challenge);end if;
 return jsonb_build_object('matched',coalesce(expected=p_challenge_mac,false),'run_id',p_run_id,'window_id',p_window_id,'participant_id',p_participant_id,'user_id',p_user_id,'operation',p_operation,'reservation_id',p_reservation_id,'server_now',clock_timestamp(),'approved_plan_hash',plan);
end $$;
create function public.begin_controlled_team_auth_wire(p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,p_operation text,p_reservation_id uuid,p_challenge text,p_challenge_mac text,p_credential_mac text) returns jsonb
language plpgsql security definer set search_path='' as $$declare r private.controlled_team_runs;w private.controlled_team_windows;u auth.users;source private.controlled_team_auth_wire;plan text;target jsonb;keycheck jsonb;matched boolean;admitted boolean;tid uuid;begin
 perform private.controlled_team_service();r:=private.controlled_team_participant(p_participant_id);w:=private.require_controlled_team_window(p_run_id,p_window_id);
 plan:=private.controlled_team_auth_scope(p_run_id,p_window_id,p_participant_id,p_user_id,p_operation,p_reservation_id);
 if r.id is distinct from p_run_id or p_operation not in('issue','verify') or w.grant_subscription_id is null or w.restored_subscription_id is not null or clock_timestamp()>=w.personal_deadline_at then raise exception 'controlled_team_auth_scope_denied';end if;
 if p_operation='issue' then perform 1 from private.controlled_team_effects where id=p_reservation_id for update;else perform 1 from private.controlled_team_verifications where id=p_reservation_id for update;end if;
 if exists(select 1 from private.controlled_team_auth_wire where root_run_id=r.id and participant_id=p_participant_id and operation=p_operation) then raise exception 'controlled_team_auth_wire_consumed';end if;
 select * into u from auth.users where id=p_user_id;
 if u.email_confirmed_at is not null or exists(select 1 from public.users where id=u.id) or exists(select 1 from private.controlled_team_effects where run_id=r.id and status<>'succeeded' and id is distinct from case when p_operation='issue' then p_reservation_id else null end) then raise exception 'controlled_team_auth_scope_denied';end if;
 target:=public.resolve_controlled_team_w2_access(w.id,p_participant_id,(select token_hash from private.team_invitations where participant_id=p_participant_id));
 if (target->>'user_id')::uuid is distinct from p_user_id then raise exception 'controlled_team_auth_scope_denied';end if;
 keycheck:=public.check_controlled_team_auth_evidence_key(p_run_id,p_window_id,p_participant_id,p_user_id,p_operation,p_reservation_id,p_challenge,p_challenge_mac);
 admitted:=coalesce((keycheck->>'matched')::boolean,false);
 if p_operation='issue' then admitted:=admitted and p_credential_mac is null;
 else
  select * into source from private.controlled_team_auth_wire where root_run_id=r.id and window_id=w.id and participant_id=p_participant_id and user_id=p_user_id and operation='issue' and status='succeeded' and credential_match;
  if source.id is null then raise exception 'controlled_team_auth_issuance_evidence_required';end if;
  matched:=coalesce(p_credential_mac ~ '^[a-f0-9]{64}$' and p_credential_mac=source.credential_mac and p_credential_mac=private.controlled_team_auth_mac(E'aca-w2-auth-evidence-v1\ncredential\n'||r.id::text||E'\n'||w.id::text||E'\n'||p_participant_id::text||E'\n'||u.id::text||E'\n'||u.recovery_token) and length(u.recovery_token) between 32 and 256 and u.recovery_token ~ '^[A-Za-z0-9_-]+$',false);
  admitted:=admitted and matched;
 end if;
 insert into private.controlled_team_auth_wire(root_run_id,window_id,participant_id,user_id,operation,effect_id,verification_id,credential_source_trace_id,approved_plan_hash,status,deadline_at,prewire_credential_match,credential_match,finished_at)
 values(r.id,w.id,p_participant_id,p_user_id,p_operation,case when p_operation='issue' then p_reservation_id end,case when p_operation='verify' then p_reservation_id end,source.id,plan,case when admitted then 'reserved' else 'blocked' end,least(w.expires_at,w.personal_deadline_at),matched,case when admitted then null else false end,case when admitted then null else clock_timestamp() end) returning id into tid;
 if not admitted then perform private.controlled_team_state(r.id,jsonb_build_object('status','stopped','stopped_at',clock_timestamp(),'stop_reason','auth_wire_blocked'));end if;
 return jsonb_build_object('trace_id',tid,'admitted',admitted,'status',case when admitted then 'reserved' else 'blocked' end,'run_id',r.id,'window_id',w.id,'participant_id',p_participant_id,'user_id',p_user_id,'operation',p_operation,'reservation_id',p_reservation_id,'server_now',clock_timestamp(),'approved_plan_hash',plan,'credential_match',case when admitted then matched else false end);
exception when unique_violation then raise exception 'controlled_team_auth_wire_consumed';end $$;
create function public.finish_controlled_team_auth_wire(p_trace_id uuid,p_dispatched_at timestamptz,p_received_at timestamptz,p_http_status integer,p_outcome text,p_credential_mac text,p_response_identity_matches boolean) returns jsonb
language plpgsql security definer set search_path='' as $$declare t private.controlled_team_auth_wire;w private.controlled_team_windows;u auth.users;source private.controlled_team_auth_wire;matched boolean:=false;result text;valid_time boolean;begin
 perform private.controlled_team_service();select * into t from private.controlled_team_auth_wire where id=p_trace_id for update;
 if t.id is null or t.status<>'reserved' then raise exception 'controlled_team_auth_trace_immutable';end if;
 if p_outcome is null or p_outcome not in('succeeded','failed','unknown') or(p_http_status is not null and p_http_status not between 100 and 599) then raise exception 'controlled_team_auth_invalid_receipt';end if;
 select * into w from private.controlled_team_windows where id=t.window_id and root_run_id=t.root_run_id;select * into u from auth.users where id=t.user_id;
 valid_time:=coalesce(p_dispatched_at is not null and p_received_at is not null and p_received_at>=p_dispatched_at and p_received_at-p_dispatched_at<=interval '15 seconds' ,false);
 if p_outcome='succeeded' and p_http_status=200 and p_response_identity_matches is true and valid_time and w.status='active' and w.expires_at>clock_timestamp() and w.personal_deadline_at>clock_timestamp() and w.restored_subscription_id is null and w.cohort_fingerprint=private.controlled_team_w2_cohort(w.root_run_id) and exists(select 1 from private.account_subscriptions s join public.plans p on p.id=s.plan_id where s.id=w.expected_subscription_id and s.id=w.grant_subscription_id and s.status='active' and s.source='manual' and p.key='advanced') then
  if t.operation='issue' then
   matched:=coalesce(u.email_confirmed_at is null and length(u.recovery_token) between 32 and 256 and u.recovery_token ~ '^[A-Za-z0-9_-]+$' and p_credential_mac ~ '^[a-f0-9]{64}$' and p_credential_mac=private.controlled_team_auth_mac(E'aca-w2-auth-evidence-v1\ncredential\n'||t.root_run_id::text||E'\n'||t.window_id::text||E'\n'||t.participant_id::text||E'\n'||t.user_id::text||E'\n'||u.recovery_token),false);
  else
   select * into source from private.controlled_team_auth_wire where id=t.credential_source_trace_id;
   matched:=coalesce(t.prewire_credential_match and source.status='succeeded' and source.user_id=t.user_id and source.window_id=t.window_id and source.credential_mac=p_credential_mac and u.email_confirmed_at is not null and coalesce(u.recovery_token,'')='' and coalesce(u.confirmation_token,'')='' and u.raw_user_meta_data->'email_verified'='true'::jsonb,false);
  end if;
 end if;
 result:=case when p_outcome='unknown' then 'unknown' when p_outcome='succeeded' and matched then 'succeeded' else 'failed' end;
 -- Persist raw wire clocks unchanged. Cross-clock acceptance belongs to the
 -- separately authorized operator policy; no skew allowance/repair is encoded.
 -- Invalid local order/interval can never authorize success. DB deadlines are real.
 update private.controlled_team_auth_wire set status=result,credential_match=matched,credential_mac=case when result='succeeded' and t.operation='issue' then p_credential_mac end,dispatched_at=p_dispatched_at,received_at=p_received_at,http_status=p_http_status,response_identity_matches=coalesce(p_response_identity_matches,false),finished_at=clock_timestamp() where id=t.id;
 if result<>'succeeded' then perform private.controlled_team_state(t.root_run_id,jsonb_build_object('status','stopped','stopped_at',clock_timestamp(),'stop_reason','auth_wire_'||result));end if;
 return jsonb_build_object('trace_id',t.id,'run_id',t.root_run_id,'window_id',t.window_id,'participant_id',t.participant_id,'user_id',t.user_id,'operation',t.operation,'reservation_id',coalesce(t.effect_id,t.verification_id),'approved_plan_hash',t.approved_plan_hash,'status',result,'credential_match',matched,'dispatched_at',p_dispatched_at,'received_at',p_received_at,'http_status',p_http_status,'response_identity_matches',coalesce(p_response_identity_matches,false));
end $$;
-- Existing service completion and personal finalizer cannot bypass the wire receipt.
-- Canonical preimage prosrc SHA-256 pins reject even drift retaining a replacement needle.
do $$declare d text;needle text;begin
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.complete_controlled_team_effect(uuid,text,text,jsonb)'::regprocedure) is distinct from 'a697a0c7add776724880013d627fb2f94d207c43497c1e1e47ea13dd0ba9e8f9' then raise exception 'controlled_team_auth_definition_drift';end if;
 d:=pg_get_functiondef('public.complete_controlled_team_effect(uuid,text,text,jsonb)'::regprocedure);needle:='if e.status<>''reserved'' then';
 if position(needle in d)=0 then raise exception 'controlled_team_auth_definition_drift';end if;
 d:=replace(d,needle,'if e.window_id is not null and e.effect=''reauth_link'' and p_status=''succeeded'' and not exists(select 1 from private.controlled_team_auth_wire x where x.effect_id=e.id and x.operation=''issue'' and x.status=''succeeded'' and x.credential_match) then raise exception ''controlled_team_auth_wire_required'';end if;'||needle);execute d;
 if (select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='public.finalize_controlled_team_w2_identity(uuid,uuid,text,boolean,text,text)'::regprocedure) is distinct from '564149357abd449ae0c60c3c5bd02e9d682ef5b7ba84671d7fc04a954f79e5fb' then raise exception 'controlled_team_auth_definition_drift';end if;
 d:=pg_get_functiondef('public.finalize_controlled_team_w2_identity(uuid,uuid,text,boolean,text,text)'::regprocedure);needle:='pid:=private.finalize_team_invitation_identity_w2_hash';
 if position(needle in d)=0 then raise exception 'controlled_team_auth_definition_drift';end if;
 d:=replace(d,needle,'if not exists(select 1 from private.controlled_team_auth_wire x where x.verification_id=v.id and x.operation=''verify'' and x.root_run_id=v.root_run_id and x.window_id=v.window_id and x.participant_id=v.participant_id and x.user_id=v.user_id and x.status=''succeeded'' and x.credential_match) then raise exception ''controlled_team_auth_wire_required'';end if;'||needle);execute d;
end $$;
revoke all on function private.controlled_team_auth_wire_immutable(),private.controlled_team_auth_mac(text),private.controlled_team_auth_scope(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.check_controlled_team_auth_evidence_key(uuid,uuid,uuid,uuid,text,uuid,text,text),public.begin_controlled_team_auth_wire(uuid,uuid,uuid,uuid,text,uuid,text,text,text),public.finish_controlled_team_auth_wire(uuid,timestamptz,timestamptz,integer,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.check_controlled_team_auth_evidence_key(uuid,uuid,uuid,uuid,text,uuid,text,text),public.begin_controlled_team_auth_wire(uuid,uuid,uuid,uuid,text,uuid,text,text,text),public.finish_controlled_team_auth_wire(uuid,timestamptz,timestamptz,integer,text,text,boolean) to service_role;
-- Private full-row/cell capture; fixed root and source tables; no key args.
create function private.controlled_team_preservation_hmac(p_domain text,p_value jsonb) returns text
language plpgsql stable security definer set search_path='' as $$declare h text;begin
 perform private.controlled_team_service();
 begin h:=current_setting('request.headers',true)::jsonb->>'authorization';exception when others then raise exception 'controlled_team_capture_denied';end;
 if h is null or h !~ '^Bearer [A-Za-z0-9._-]+$' or length(h) not between 27 and 4103 then raise exception 'controlled_team_capture_denied';end if;
 return encode(extensions.hmac(convert_to(E'aca-w2-preservation-v1\n'||p_domain||E'\n'||coalesce(p_value,'null'::jsonb)::text,'UTF8'),convert_to(h,'UTF8'),'sha256'),'hex');
 exception when others then raise exception 'controlled_team_capture_denied';end $$;
revoke all on function private.controlled_team_preservation_hmac(text,jsonb) from public,anon,authenticated,service_role;
create function private.controlled_team_preservation_output_valid(p_kind text,p_content jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$begin
 perform private.controlled_team_service();
 if p_content is null or p_content='null'::jsonb then return false;end if;
 if p_kind='report' then perform private.validate_team_report_v2(p_content,3);
 elsif p_kind='synthesis' then perform private.validate_team_synthesis_v2('8383647f-10d9-45f9-8c76-f22cf357074b'::uuid,p_content,3);
 elsif p_kind='privacy' then perform private.validate_team_output('8383647f-10d9-45f9-8c76-f22cf357074b'::uuid,p_content);
 else return false;end if;return true;
 exception when others then return false;end $$;
revoke all on function private.controlled_team_preservation_output_valid(text,jsonb) from public,anon,authenticated,service_role;
create function private.controlled_team_preservation_facts(p_table text,j jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare x jsonb;u text;session_key text;begin
 perform private.controlled_team_service();
 if p_table like 'auth.%' then
  u:=j->>'user_id';
  if p_table='auth.users' then u:=j->>'id';
  elsif p_table='auth.audit_log_entries' then u:=j->'payload'->>'actor_id';
  elsif p_table='auth.mfa_amr_claims' then select s.user_id::text into u from auth.sessions s where s.id::text=j->>'session_id';end if;
  if u is null or u not in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569') then return null;end if;
  if p_table='auth.users' then return jsonb_build_object('uid',u,
   'emailMatchesOriginalParticipant',exists(select 1 from public.team_participants p join private.team_invitations i on i.participant_id=p.id join private.team_identity_reservations z on z.email=p.email and z.invitation_hash=i.token_hash where p.team_diagnostic_id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid and z.user_id::text=u and p.email=lower(j->>'email')),
   'recoveryTokenEmpty',coalesce(j->>'recovery_token','')='','confirmationTokenEmpty',coalesce(j->>'confirmation_token','')='',
   'emailConfirmedAt',j->'email_confirmed_at','confirmedAt',j->'confirmed_at','recoverySentAt',j->'recovery_sent_at','lastSignInAt',j->'last_sign_in_at','updatedAt',j->'updated_at',
   'emailVerifiedPresent',(j->'raw_user_meta_data')?'email_verified','emailVerifiedType',jsonb_typeof(j->'raw_user_meta_data'->'email_verified'),
   'emailVerifiedBoolean',case when jsonb_typeof(j->'raw_user_meta_data'->'email_verified')='boolean' then j->'raw_user_meta_data'->'email_verified' else null end,
   'metadataRestHMAC',private.controlled_team_preservation_hmac(E'metadata-rest\n'||u,(j->'raw_user_meta_data')-'email_verified'),
   'nonceHMAC',private.controlled_team_preservation_hmac(E'pending-nonce\n'||u,j->'raw_user_meta_data'->'team_pending_nonce'),
   'appMetadataHMAC',private.controlled_team_preservation_hmac(E'app-metadata\n'||u,j->'raw_app_meta_data'),
   'providerEmailOnly',j->'raw_app_meta_data'->>'provider'='email' and j->'raw_app_meta_data'->'providers'='["email"]'::jsonb);end if;
  if p_table='auth.identities' then return jsonb_build_object('uid',u,'provider',j->'provider');end if;
  select jsonb_object_agg(k,j->k) into x from jsonb_array_elements_text('["created_at","updated_at","refreshed_at","not_after","expires_at","revoked","authentication_method","aal","token_type","refresh_token_counter"]') k where j?k;
  x:=coalesce(x,'{}')||jsonb_build_object('uid',u,'parentEmpty',coalesce(j->>'parent','')='','refreshKeyNonempty',coalesce(j->>'refresh_token_hmac_key','')<>'');
  x:=x||(select jsonb_object_agg(k||'Null',coalesce(j->k,'null'::jsonb)='null'::jsonb) from jsonb_array_elements_text('["factor_id","oauth_client_id","scopes","tag","not_after","refreshed_at","expires_at","refresh_token_hmac_key"]') k);
  if p_table in('auth.refresh_tokens','auth.mfa_amr_claims') then select private.controlled_team_preservation_hmac(E'key\nauth.sessions',jsonb_build_object('id',s.id)) into session_key from auth.sessions s where s.id::text=j->>'session_id';
  elsif p_table='auth.sessions' then session_key:=private.controlled_team_preservation_hmac(E'key\nauth.sessions',jsonb_build_object('id',j->'id'));end if;
  if p_table in('auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims') then x:=x||jsonb_build_object('sessionRowKey',session_key);end if;
  if p_table='auth.one_time_tokens' then x:=x||jsonb_build_object('tokenMatchesCurrentRecovery',exists(select 1 from auth.users z where z.id::text=u and j->>'token_type'='recovery_token' and j->>'token_hash'=z.recovery_token),'relatesToMatchesEmail',exists(select 1 from auth.users z where z.id::text=u and j->>'relates_to'=z.email));end if;
  if p_table='auth.audit_log_entries' then x:=x||jsonb_build_object('action',case when j->'payload'->>'action'~'^[a-z_]{1,40}$' then j->'payload'->'action' else null end,'actorViaSSO',j->'payload'->'actor_via_sso');end if;return x;
 end if;
 if not coalesce((
  j->>'root_run_id'='e3623f1d-2da0-4dfe-b600-d747f529c5fc' or j->>'run_id'='e3623f1d-2da0-4dfe-b600-d747f529c5fc' or j->>'team_diagnostic_id'='8383647f-10d9-45f9-8c76-f22cf357074b' or j->>'account_id'='af1b67c8-5c92-4300-92e2-d666ca75c3cd'
  or j->>'participant_id' in('0ae17418-e97a-46c7-9000-c13580f72506','231f0ccf-ee6d-4955-9940-9188914dab75','556b1e8e-346f-4990-96af-e621950f20e3') or j->>'user_id' in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569') or j->>'legacy_origin_user_id' in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569')
  or(p_table='private.controlled_team_runs' and j->>'id'='e3623f1d-2da0-4dfe-b600-d747f529c5fc') or p_table='private.controlled_team_policy'
  or(p_table='public.team_diagnostics' and j->>'id'='8383647f-10d9-45f9-8c76-f22cf357074b') or(p_table='public.team_participants' and j->>'id' in('0ae17418-e97a-46c7-9000-c13580f72506','231f0ccf-ee6d-4955-9940-9188914dab75','556b1e8e-346f-4990-96af-e621950f20e3'))
  or(p_table='public.users' and j->>'id' in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569')) or(p_table='public.accounts' and j->>'id'='af1b67c8-5c92-4300-92e2-d666ca75c3cd')
  or(p_table='private.audit_events' and (j->>'subject_id' in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569') or j->>'subject_id'='af1b67c8-5c92-4300-92e2-d666ca75c3cd'))
  or(p_table='private.account_subscriptions' and exists(select 1 from public.accounts a where a.id::text=j->>'account_id' and a.legacy_origin_user_id::text in('b7cc06c7-056c-4fd8-b445-eeaf187cec7c','6041e8a9-5df5-497d-b4d2-43605a75ae43','cb133a51-dc91-488b-8fc5-31e0b76ee569')))
  or(p_table='public.rate_limit_windows' and (exists(select 1 from private.team_invitations i where i.participant_id::text in('0ae17418-e97a-46c7-9000-c13580f72506','231f0ccf-ee6d-4955-9940-9188914dab75','556b1e8e-346f-4990-96af-e621950f20e3') and j->>'key'='team-single-verify:'||i.token_hash) or j->>'key' in('team-save:b7cc06c7-056c-4fd8-b445-eeaf187cec7c','team-save:6041e8a9-5df5-497d-b4d2-43605a75ae43','team-save:cb133a51-dc91-488b-8fc5-31e0b76ee569','team-results:56ff8470-db76-4b56-b9da-4d4a7a382db1')))
  or(p_table='public.team_report_artifacts' and exists(select 1 from public.team_ai_reports r where r.id::text=j->>'team_report_id' and r.team_diagnostic_id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid))
 ),false) then return null;end if;
 select jsonb_object_agg(k,j->k) into x from jsonb_array_elements_text('["id", "root_run_id", "run_id", "window_id", "participant_id", "user_id", "team_diagnostic_id", "team_report_id", "report_id", "job_id", "account_id", "legacy_origin_user_id", "owner_user_id", "created_by_user_id", "plan_id", "subscription_id", "expected_subscription_id", "grant_subscription_id", "restored_subscription_id", "version_id", "verification_id", "effect_id", "credential_source_trace_id", "administrator_user_id", "status", "source", "kind", "effect", "operation", "role", "format", "template_version", "provider_key", "plan_key", "old_plan", "new_plan", "action", "error_code", "last_error_code", "approved_plan_hash", "source_fingerprint", "stop_reason", "expected_plan", "attempts", "revision", "version", "team_report_version", "count", "completed_participant_count", "participant_count", "overall_mean", "overall_stddev", "overall_min", "overall_max", "mean_score", "stddev_score", "min_score", "max_score", "request_bytes", "max_output_tokens", "http_status", "created_at", "updated_at", "reserved_at", "finished_at", "completed_at", "effective_from", "effective_until", "armed_at", "expires_at", "personal_deadline_at", "stopped_at", "started_at", "available_at", "redeemed_at", "finalized_at", "invited_at", "revoked_at", "dispatched_at", "received_at", "deadline_at", "granted_at", "granted", "prewire_credential_match", "credential_match", "response_identity_matches", "enabled", "subject_id", "actor_id", "kind", "recorded_at", "generated_at", "computed_at", "pipeline_version", "provider_mode", "aggregate_claimed", "ai_claimed", "generation_deadline", "block_id", "question_id"]') k where j?k;
 x:=coalesce(x,'{}');
 if p_table='private.controlled_team_effects' then x:=x||jsonb_build_object('providerReferenceMatchesArtifact',exists(select 1 from public.team_report_artifacts a where a.team_report_id::text=j->>'report_id' and a.status='ready' and a.format='pdf' and a.template_version='team-report-v3' and a.checksum=j->>'provider_reference'));
 elsif p_table='public.users' then x:=x||jsonb_build_object('fullNameMatchesReservation',exists(select 1 from private.team_identity_reservations z where z.user_id::text=j->>'id' and btrim(z.display_name)=j->>'full_name'),'defaultProfileFields',coalesce(j->'phone','null'::jsonb)='null'::jsonb and j->>'locale'='ru');
 elsif p_table='public.accounts' then x:=x||jsonb_build_object('nameMatchesUser',exists(select 1 from public.users u where u.id::text=j->>'legacy_origin_user_id' and u.full_name=j->>'name'));
 elsif p_table='public.user_consents' then x:=x||jsonb_build_object('currentApprovedVersion',exists(select 1 from public.consent_documents d where d.kind=j->>'kind' and d.version=j->>'version' and not d.is_temporary));
 elsif p_table='public.team_block_results' then x:=x||jsonb_build_object('oracleMatches',exists(select 1 from public.diagnostic_blocks b where b.id::text=j->>'block_id' and b.position between 1 and 8 and abs((j->>'mean_score')::numeric-(array[75,50,25,50,50,75,50,25])[b.position])<0.000000001 and abs((j->>'stddev_score')::numeric-25*sqrt(2::numeric/3))<0.000000001 and (j->>'min_score')::numeric=(array[75,50,25,50,50,75,50,25])[b.position]-25 and (j->>'max_score')::numeric=(array[75,50,25,50,50,75,50,25])[b.position]+25));
 elsif p_table='public.team_question_statistics' then x:=x||jsonb_build_object('oracleMatches',exists(select 1 from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.id::text=j->>'question_id' and b.position between 1 and 8 and q.answer_type='scale_0_4' and abs((j->>'mean_score')::numeric-(array[75,50,25,50,50,75,50,25])[b.position]/25::numeric)<0.000000001 and abs((j->>'stddev_score')::numeric-sqrt(2::numeric/3))<0.000000001 and (j->>'min_score')::numeric=(array[75,50,25,50,50,75,50,25])[b.position]/25::numeric-1 and (j->>'max_score')::numeric=(array[75,50,25,50,50,75,50,25])[b.position]/25::numeric+1));
 elsif p_table='private.account_subscriptions' then x:=x||jsonb_build_object('plan_key',(select key from public.plans z where z.id::text=j->>'plan_id'),'providerFieldsNull',coalesce(j->'provider_key','null'::jsonb)='null'::jsonb and coalesce(j->'provider_customer_ref','null'::jsonb)='null'::jsonb and coalesce(j->'provider_subscription_ref','null'::jsonb)='null'::jsonb);
 elsif p_table='private.team_identity_reservations' then x:=x||jsonb_build_object('invitationMatches',exists(select 1 from private.team_invitations i join public.team_participants p on p.id=i.participant_id where p.team_diagnostic_id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid and i.token_hash=j->>'invitation_hash' and p.email=j->>'email'));
 elsif p_table='private.team_responses' then x:=x||jsonb_build_object('answersCount',(select count(*) from jsonb_object_keys(j->'answers')),'answersEmpty',j->'answers'='{}'::jsonb,'allQuestionKeysKnown',not exists(select 1 from jsonb_object_keys(j->'answers') k where not exists(select 1 from private.team_questionnaires q,jsonb_array_elements(q.questions) z where q.team_diagnostic_id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid and z->>'id'=k)));
 elsif p_table='private.team_jobs' then x:=x||jsonb_build_object('leaseEmpty',coalesce(j->'lease_token','null'::jsonb)='null'::jsonb and coalesce(j->'lease_expires_at','null'::jsonb)='null'::jsonb,'controlled_run_id',j->'controlled_run_id','controlled_window_id',j->'controlled_window_id','last_error_message_empty',coalesce(j->'last_error_message','null'::jsonb)='null'::jsonb);
 elsif p_table='public.team_ai_reports' then x:=x||jsonb_build_object('contentPresent',coalesce(j->'structured_content','null'::jsonb)<>'null'::jsonb,'model',j->'model','prompt_version',j->'prompt_version','validReportV3',private.controlled_team_preservation_output_valid('report',j->'structured_content'),'privacyContract',private.controlled_team_preservation_output_valid('privacy',j->'structured_content'),'pdfSnapshotMatches',exists(select 1 from public.team_diagnostics d cross join lateral(select private.team_numeric_evidence_v2(d.id) e) z where d.id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid and j->'pdf_snapshot'=jsonb_build_object('team_title',d.title,'overall',z.e->'overall','blocks',z.e->'blocks')),'companyContextMatches',exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id where d.id='8383647f-10d9-45f9-8c76-f22cf357074b'::uuid and j->'company_context_snapshot'=jsonb_build_object('company_name',c.name,'industry',c.industry_key,'country',c.country,'products',c.products,'customers',c.customer_segments,'sales_channels',c.sales_channels,'employees_count',c.employee_count,'annual_revenue',c.annual_revenue_key,'company_age_years',c.company_age_years,'management_levels',c.management_levels,'key_problems',c.key_problems,'main_goals',c.main_goals)));
 elsif p_table='private.team_qualitative_syntheses' then x:=x||jsonb_build_object('provider',j->'provider','model',j->'model','prompt_version',j->'prompt_version','summaryPresent',coalesce(j->'structured_summary','null'::jsonb)<>'null'::jsonb,'validSynthesisV3',private.controlled_team_preservation_output_valid('synthesis',j->'structured_summary'),'privacyContract',private.controlled_team_preservation_output_valid('privacy',j->'structured_summary'));
 elsif p_table='public.team_report_artifacts' then x:=x||jsonb_build_object('checksum',j->'checksum','contentPresent',coalesce(j->>'content_base64','')<>'','checksumMatchesContent',encode(sha256(decode(j->>'content_base64','base64')),'hex')=j->>'checksum','storagePathExact',j->>'storage_path'='team-reports/'||(j->>'team_report_id')||'/'||(j->>'template_version')||'.pdf');
 elsif p_table='public.rate_limit_windows' then x:=x||jsonb_build_object('participant_id',case when j->>'key' like 'team-single-verify:%' then(select i.participant_id from private.team_invitations i where i.participant_id::text in('0ae17418-e97a-46c7-9000-c13580f72506','231f0ccf-ee6d-4955-9940-9188914dab75','556b1e8e-346f-4990-96af-e621950f20e3') and j->>'key'='team-single-verify:'||i.token_hash) when j->>'key' like 'team-save:%' then case substring(j->>'key' from 11) when 'b7cc06c7-056c-4fd8-b445-eeaf187cec7c' then '0ae17418-e97a-46c7-9000-c13580f72506'::uuid when '6041e8a9-5df5-497d-b4d2-43605a75ae43' then '231f0ccf-ee6d-4955-9940-9188914dab75'::uuid when 'cb133a51-dc91-488b-8fc5-31e0b76ee569' then '556b1e8e-346f-4990-96af-e621950f20e3'::uuid end else null end,'rateKind',case when j->>'key' like 'team-single-verify:%' then 'verify' when j->>'key' like 'team-save:%' then 'save' else 'results' end,'window_start',j->'window_start');end if;return x;
 exception when others then raise exception 'controlled_team_capture_denied';end $$;
revoke all on function private.controlled_team_preservation_facts(text,jsonb) from public,anon,authenticated,service_role;
create function public.capture_controlled_team_w2_preservation() returns jsonb
language plpgsql stable security definer set search_path='' as $$declare evidence jsonb;begin
 perform private.controlled_team_service();
 if current_setting('transaction_read_only')<>'on' or current_setting('TimeZone') not in('UTC','Etc/UTC') or not exists(select 1 from private.controlled_team_policy p join private.controlled_team_runs r on r.id=p.run_id where p.singleton and r.id='e3623f1d-2da0-4dfe-b600-d747f529c5fc'::uuid and r.status='stopped') then raise exception 'controlled_team_capture_denied';end if;
 with raw as materialized (
select 'auth.audit_log_entries' name,to_jsonb(r) j from auth.audit_log_entries r
union all
select 'auth.custom_oauth_providers' name,to_jsonb(r) j from auth.custom_oauth_providers r
union all
select 'auth.flow_state' name,to_jsonb(r) j from auth.flow_state r
union all
select 'auth.identities' name,to_jsonb(r) j from auth.identities r
union all
select 'auth.instances' name,to_jsonb(r) j from auth.instances r
union all
select 'auth.mfa_amr_claims' name,to_jsonb(r) j from auth.mfa_amr_claims r
union all
select 'auth.mfa_challenges' name,to_jsonb(r) j from auth.mfa_challenges r
union all
select 'auth.mfa_factors' name,to_jsonb(r) j from auth.mfa_factors r
union all
select 'auth.mfa_recovery_code_sets' name,to_jsonb(r) j from auth.mfa_recovery_code_sets r
union all
select 'auth.mfa_recovery_codes' name,to_jsonb(r) j from auth.mfa_recovery_codes r
union all
select 'auth.oauth_authorizations' name,to_jsonb(r) j from auth.oauth_authorizations r
union all
select 'auth.oauth_client_states' name,to_jsonb(r) j from auth.oauth_client_states r
union all
select 'auth.oauth_clients' name,to_jsonb(r) j from auth.oauth_clients r
union all
select 'auth.oauth_consents' name,to_jsonb(r) j from auth.oauth_consents r
union all
select 'auth.one_time_tokens' name,to_jsonb(r) j from auth.one_time_tokens r
union all
select 'auth.refresh_tokens' name,to_jsonb(r) j from auth.refresh_tokens r
union all
select 'auth.saml_providers' name,to_jsonb(r) j from auth.saml_providers r
union all
select 'auth.saml_relay_states' name,to_jsonb(r) j from auth.saml_relay_states r
union all
select 'auth.schema_migrations' name,to_jsonb(r) j from auth.schema_migrations r
union all
select 'auth.scim_tokens' name,to_jsonb(r) j from auth.scim_tokens r
union all
select 'auth.scim_users' name,to_jsonb(r) j from auth.scim_users r
union all
select 'auth.sessions' name,to_jsonb(r) j from auth.sessions r
union all
select 'auth.sso_domains' name,to_jsonb(r) j from auth.sso_domains r
union all
select 'auth.sso_providers' name,to_jsonb(r) j from auth.sso_providers r
union all
select 'auth.users' name,to_jsonb(r) j from auth.users r
union all
select 'auth.webauthn_challenges' name,to_jsonb(r) j from auth.webauthn_challenges r
union all
select 'auth.webauthn_credentials' name,to_jsonb(r) j from auth.webauthn_credentials r
union all
select 'private.account_subscriptions' name,to_jsonb(r) j from private.account_subscriptions r
union all
select 'private.acquisition_visits' name,to_jsonb(r) j from private.acquisition_visits r
union all
select 'private.admin_plan_changes' name,to_jsonb(r) j from private.admin_plan_changes r
union all
select 'private.advanced_conversion_intents' name,to_jsonb(r) j from private.advanced_conversion_intents r
union all
select 'private.anonymous_diagnostic_consents' name,to_jsonb(r) j from private.anonymous_diagnostic_consents r
union all
select 'private.anonymous_diagnostic_mutations' name,to_jsonb(r) j from private.anonymous_diagnostic_mutations r
union all
select 'private.anonymous_diagnostic_sessions' name,to_jsonb(r) j from private.anonymous_diagnostic_sessions r
union all
select 'private.audit_events' name,to_jsonb(r) j from private.audit_events r
union all
select 'private.billing_checkout_sessions' name,to_jsonb(r) j from private.billing_checkout_sessions r
union all
select 'private.billing_checkout_terms' name,to_jsonb(r) j from private.billing_checkout_terms r
union all
select 'private.billing_configuration' name,to_jsonb(r) j from private.billing_configuration r
union all
select 'private.billing_event_attempts' name,to_jsonb(r) j from private.billing_event_attempts r
union all
select 'private.billing_events' name,to_jsonb(r) j from private.billing_events r
union all
select 'private.billing_offers' name,to_jsonb(r) j from private.billing_offers r
union all
select 'private.billing_payments' name,to_jsonb(r) j from private.billing_payments r
union all
select 'private.billing_plan_audit' name,to_jsonb(r) j from private.billing_plan_audit r
union all
select 'private.billing_provider_subscriptions' name,to_jsonb(r) j from private.billing_provider_subscriptions r
union all
select 'private.billing_refunds' name,to_jsonb(r) j from private.billing_refunds r
union all
select 'private.commercial_legal_configuration' name,to_jsonb(r) j from private.commercial_legal_configuration r
union all
select 'private.controlled_team_auth_wire' name,to_jsonb(r) j from private.controlled_team_auth_wire r
union all
select 'private.controlled_team_effects' name,to_jsonb(r) j from private.controlled_team_effects r
union all
select 'private.controlled_team_policy' name,to_jsonb(r) j from private.controlled_team_policy r
union all
select 'private.controlled_team_runs' name,to_jsonb(r) j from private.controlled_team_runs r
union all
select 'private.controlled_team_verifications' name,to_jsonb(r) j from private.controlled_team_verifications r
union all
select 'private.controlled_team_windows' name,to_jsonb(r) j from private.controlled_team_windows r
union all
select 'private.entitlement_definitions' name,to_jsonb(r) j from private.entitlement_definitions r
union all
select 'private.launch_controls' name,to_jsonb(r) j from private.launch_controls r
union all
select 'private.marketing_preferences' name,to_jsonb(r) j from private.marketing_preferences r
union all
select 'private.marketing_withdrawals' name,to_jsonb(r) j from private.marketing_withdrawals r
union all
select 'private.plan_entitlements' name,to_jsonb(r) j from private.plan_entitlements r
union all
select 'private.product_events' name,to_jsonb(r) j from private.product_events r
union all
select 'private.retention_holds' name,to_jsonb(r) j from private.retention_holds r
union all
select 'private.retention_runs' name,to_jsonb(r) j from private.retention_runs r
union all
select 'private.team_identity_reservations' name,to_jsonb(r) j from private.team_identity_reservations r
union all
select 'private.team_invitations' name,to_jsonb(r) j from private.team_invitations r
union all
select 'private.team_jobs' name,to_jsonb(r) j from private.team_jobs r
union all
select 'private.team_qualitative_syntheses' name,to_jsonb(r) j from private.team_qualitative_syntheses r
union all
select 'private.team_questionnaires' name,to_jsonb(r) j from private.team_questionnaires r
union all
select 'private.team_responses' name,to_jsonb(r) j from private.team_responses r
union all
select 'private.team_scoring_snapshots' name,to_jsonb(r) j from private.team_scoring_snapshots r
union all
select 'public.account_memberships' name,to_jsonb(r) j from public.account_memberships r
union all
select 'public.accounts' name,to_jsonb(r) j from public.accounts r
union all
select 'public.ai_reports' name,to_jsonb(r) j from public.ai_reports r
union all
select 'public.answers' name,to_jsonb(r) j from public.answers r
union all
select 'public.commercial_legal_documents' name,to_jsonb(r) j from public.commercial_legal_documents r
union all
select 'public.company_profiles' name,to_jsonb(r) j from public.company_profiles r
union all
select 'public.consent_documents' name,to_jsonb(r) j from public.consent_documents r
union all
select 'public.consultation_notification_deliveries' name,to_jsonb(r) j from public.consultation_notification_deliveries r
union all
select 'public.diagnostic_block_results' name,to_jsonb(r) j from public.diagnostic_block_results r
union all
select 'public.diagnostic_block_translations' name,to_jsonb(r) j from public.diagnostic_block_translations r
union all
select 'public.diagnostic_blocks' name,to_jsonb(r) j from public.diagnostic_blocks r
union all
select 'public.diagnostic_company_snapshots' name,to_jsonb(r) j from public.diagnostic_company_snapshots r
union all
select 'public.diagnostic_definitions' name,to_jsonb(r) j from public.diagnostic_definitions r
union all
select 'public.diagnostic_mutations' name,to_jsonb(r) j from public.diagnostic_mutations r
union all
select 'public.diagnostic_results' name,to_jsonb(r) j from public.diagnostic_results r
union all
select 'public.diagnostic_version_translations' name,to_jsonb(r) j from public.diagnostic_version_translations r
union all
select 'public.diagnostic_versions' name,to_jsonb(r) j from public.diagnostic_versions r
union all
select 'public.diagnostics' name,to_jsonb(r) j from public.diagnostics r
union all
select 'public.email_deliveries' name,to_jsonb(r) j from public.email_deliveries r
union all
select 'public.feedback' name,to_jsonb(r) j from public.feedback r
union all
select 'public.industries' name,to_jsonb(r) j from public.industries r
union all
select 'public.industry_translations' name,to_jsonb(r) j from public.industry_translations r
union all
select 'public.jobs' name,to_jsonb(r) j from public.jobs r
union all
select 'public.lead_requests' name,to_jsonb(r) j from public.lead_requests r
union all
select 'public.maturity_level_translations' name,to_jsonb(r) j from public.maturity_level_translations r
union all
select 'public.maturity_levels' name,to_jsonb(r) j from public.maturity_levels r
union all
select 'public.plans' name,to_jsonb(r) j from public.plans r
union all
select 'public.privacy_legal_documents' name,to_jsonb(r) j from public.privacy_legal_documents r
union all
select 'public.question_option_translations' name,to_jsonb(r) j from public.question_option_translations r
union all
select 'public.question_options' name,to_jsonb(r) j from public.question_options r
union all
select 'public.question_translations' name,to_jsonb(r) j from public.question_translations r
union all
select 'public.questions' name,to_jsonb(r) j from public.questions r
union all
select 'public.rate_limit_windows' name,to_jsonb(r) j from public.rate_limit_windows r
union all
select 'public.report_artifacts' name,to_jsonb(r) j from public.report_artifacts r
union all
select 'public.revenue_range_translations' name,to_jsonb(r) j from public.revenue_range_translations r
union all
select 'public.revenue_ranges' name,to_jsonb(r) j from public.revenue_ranges r
union all
select 'public.scoring_policies' name,to_jsonb(r) j from public.scoring_policies r
union all
select 'public.team_ai_reports' name,to_jsonb(r) j from public.team_ai_reports r
union all
select 'public.team_block_results' name,to_jsonb(r) j from public.team_block_results r
union all
select 'public.team_diagnostics' name,to_jsonb(r) j from public.team_diagnostics r
union all
select 'public.team_participants' name,to_jsonb(r) j from public.team_participants r
union all
select 'public.team_question_statistics' name,to_jsonb(r) j from public.team_question_statistics r
union all
select 'public.team_report_artifacts' name,to_jsonb(r) j from public.team_report_artifacts r
union all
select 'public.team_results' name,to_jsonb(r) j from public.team_results r
union all
select 'public.user_consents' name,to_jsonb(r) j from public.user_consents r
union all
select 'public.user_roles' name,to_jsonb(r) j from public.user_roles r
union all
select 'public.users' name,to_jsonb(r) j from public.users r
union all
select 'storage.buckets' name,to_jsonb(r) j from storage.buckets r
union all
select 'storage.objects' name,to_jsonb(r) j from storage.objects r), keyed as materialized(select name,j,coalesce((select jsonb_object_agg(a.attname,j->a.attname order by a.attname) from pg_constraint c cross join lateral unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum where c.contype='p' and c.conrelid=name::regclass),j) pk from raw),
 rows as materialized(select name,private.controlled_team_preservation_hmac(E'key\n'||name,pk) key,
 jsonb_build_object('key',private.controlled_team_preservation_hmac(E'key\n'||name,pk),'full',private.controlled_team_preservation_hmac(E'row\n'||name||E'\n'||pk::text,j),
 'fields',(select jsonb_object_agg(k,private.controlled_team_preservation_hmac(E'cell\n'||name||E'\n'||pk::text||E'\n'||k,v) order by k) from jsonb_each(j) f(k,v)),
 'facts',private.controlled_team_preservation_facts(name,j)) value from keyed),
 captures as materialized(select unnest(ARRAY['auth.audit_log_entries','auth.custom_oauth_providers','auth.flow_state','auth.identities','auth.instances','auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors','auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients','auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens','auth.saml_providers','auth.saml_relay_states','auth.schema_migrations','auth.scim_tokens','auth.scim_users','auth.sessions','auth.sso_domains','auth.sso_providers','auth.users','auth.webauthn_challenges','auth.webauthn_credentials','private.account_subscriptions','private.acquisition_visits','private.admin_plan_changes','private.advanced_conversion_intents','private.anonymous_diagnostic_consents','private.anonymous_diagnostic_mutations','private.anonymous_diagnostic_sessions','private.audit_events','private.billing_checkout_sessions','private.billing_checkout_terms','private.billing_configuration','private.billing_event_attempts','private.billing_events','private.billing_offers','private.billing_payments','private.billing_plan_audit','private.billing_provider_subscriptions','private.billing_refunds','private.commercial_legal_configuration','private.controlled_team_auth_wire','private.controlled_team_effects','private.controlled_team_policy','private.controlled_team_runs','private.controlled_team_verifications','private.controlled_team_windows','private.entitlement_definitions','private.launch_controls','private.marketing_preferences','private.marketing_withdrawals','private.plan_entitlements','private.product_events','private.retention_holds','private.retention_runs','private.team_identity_reservations','private.team_invitations','private.team_jobs','private.team_qualitative_syntheses','private.team_questionnaires','private.team_responses','private.team_scoring_snapshots','public.account_memberships','public.accounts','public.ai_reports','public.answers','public.commercial_legal_documents','public.company_profiles','public.consent_documents','public.consultation_notification_deliveries','public.diagnostic_block_results','public.diagnostic_block_translations','public.diagnostic_blocks','public.diagnostic_company_snapshots','public.diagnostic_definitions','public.diagnostic_mutations','public.diagnostic_results','public.diagnostic_version_translations','public.diagnostic_versions','public.diagnostics','public.email_deliveries','public.feedback','public.industries','public.industry_translations','public.jobs','public.lead_requests','public.maturity_level_translations','public.maturity_levels','public.plans','public.privacy_legal_documents','public.question_option_translations','public.question_options','public.question_translations','public.questions','public.rate_limit_windows','public.report_artifacts','public.revenue_range_translations','public.revenue_ranges','public.scoring_policies','public.team_ai_reports','public.team_block_results','public.team_diagnostics','public.team_participants','public.team_question_statistics','public.team_report_artifacts','public.team_results','public.user_consents','public.user_roles','public.users','storage.buckets','storage.objects']::text[]) name)
 select jsonb_build_object('format','ACA_W2_PRESERVATION_HMAC_V1','project','fhvxqeaujjeiflanqsbg','capturedAt',clock_timestamp(),'databaseClock',clock_timestamp(),'transactionReadOnly',current_setting('transaction_read_only'),'timezone','UTC','keyId',private.controlled_team_preservation_hmac('key-id','null'::jsonb),
 'tables',(select jsonb_object_agg(c.name,jsonb_build_object('columns',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.name::regclass and a.attnum>0 and not a.attisdropped),'rows',coalesce((select jsonb_agg(r.value order by r.key) from rows r where r.name=c.name),'[]'::jsonb)) order by c.name) from captures c),
 'catalogue',private.controlled_team_preservation_hmac('catalogue',jsonb_build_object(
 'tables',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and c.relkind in('r','p')),
 'namespaces',(select coalesce(jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl) order by nspname),'[]'::jsonb) from pg_namespace where nspname in('public','private','auth','storage','supabase_migrations')),
 'columnACLs',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attnum,a.attname,a.attacl,a.attisdropped) order by n.nspname,c.relname,a.attnum),'[]'::jsonb) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and a.attnum>0),
 'defaultACLs',(select coalesce(jsonb_agg(to_jsonb(d) order by d.defaclrole,d.defaclnamespace,d.defaclobjtype),'[]'::jsonb) from pg_default_acl d),
 'roleFlags',(select coalesce(jsonb_agg(to_jsonb(r) order by r.oid),'[]'::jsonb) from(select oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig from pg_roles) r),
 'roleMemberships',(select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]'::jsonb) from pg_auth_members m),
 'relations',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relpersistence,case when c.relkind in('v','m') then pg_get_viewdef(c.oid,true) else null end) order by n.nspname,c.relname),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and c.relkind in('r','p','v','m','S','f')),
 'sequences',(select coalesce(jsonb_agg(to_jsonb(x) order by schemaname,sequencename),'[]'::jsonb) from (select schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size from pg_sequences where schemaname in('public','private','auth','storage','supabase_migrations')) x),
 'columns',(select coalesce(jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.ordinal_position),'[]'::jsonb) from information_schema.columns x where table_schema in('public','private','auth','storage','supabase_migrations')),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname),'[]'::jsonb) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations')),
 'functions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl,p.proconfig,p.proowner) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and p.prokind='f'),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]'::jsonb) from pg_policies p where schemaname in('public','private','auth','storage','supabase_migrations')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and not t.tgisinternal),
 'indexes',(select coalesce(jsonb_agg(to_jsonb(i) order by schemaname,tablename,indexname),'[]'::jsonb) from pg_indexes i where schemaname in('public','private','auth','storage','supabase_migrations')))),
 'ledger',jsonb_build_object('count',(select count(*) from supabase_migrations.schema_migrations),'digest',private.controlled_team_preservation_hmac('ledger',(select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations m))),
 'gates',jsonb_build_object('launch',(select count(*) from private.launch_controls where anonymous_start_enabled or team_creation_enabled or team_invitations_enabled),'financial',(select count(*) from private.billing_configuration where mock_enabled or yookassa_enabled or yookassa_reconciliation_enabled or yookassa_live_approved)),
 'wireTraces',(select coalesce(jsonb_agg(to_jsonb(w)-'credential_mac' order by reserved_at,id),'[]'::jsonb) from private.controlled_team_auth_wire w where root_run_id='e3623f1d-2da0-4dfe-b600-d747f529c5fc'::uuid)) into evidence;
 if (select array_agg(n.nspname||'.'||c.relname order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage') and c.relkind in('r','p')) is distinct from ARRAY['auth.audit_log_entries','auth.custom_oauth_providers','auth.flow_state','auth.identities','auth.instances','auth.mfa_amr_claims','auth.mfa_challenges','auth.mfa_factors','auth.mfa_recovery_code_sets','auth.mfa_recovery_codes','auth.oauth_authorizations','auth.oauth_client_states','auth.oauth_clients','auth.oauth_consents','auth.one_time_tokens','auth.refresh_tokens','auth.saml_providers','auth.saml_relay_states','auth.schema_migrations','auth.scim_tokens','auth.scim_users','auth.sessions','auth.sso_domains','auth.sso_providers','auth.users','auth.webauthn_challenges','auth.webauthn_credentials','private.account_subscriptions','private.acquisition_visits','private.admin_plan_changes','private.advanced_conversion_intents','private.anonymous_diagnostic_consents','private.anonymous_diagnostic_mutations','private.anonymous_diagnostic_sessions','private.audit_events','private.billing_checkout_sessions','private.billing_checkout_terms','private.billing_configuration','private.billing_event_attempts','private.billing_events','private.billing_offers','private.billing_payments','private.billing_plan_audit','private.billing_provider_subscriptions','private.billing_refunds','private.commercial_legal_configuration','private.controlled_team_auth_wire','private.controlled_team_effects','private.controlled_team_policy','private.controlled_team_runs','private.controlled_team_verifications','private.controlled_team_windows','private.entitlement_definitions','private.launch_controls','private.marketing_preferences','private.marketing_withdrawals','private.plan_entitlements','private.product_events','private.retention_holds','private.retention_runs','private.team_identity_reservations','private.team_invitations','private.team_jobs','private.team_qualitative_syntheses','private.team_questionnaires','private.team_responses','private.team_scoring_snapshots','public.account_memberships','public.accounts','public.ai_reports','public.answers','public.commercial_legal_documents','public.company_profiles','public.consent_documents','public.consultation_notification_deliveries','public.diagnostic_block_results','public.diagnostic_block_translations','public.diagnostic_blocks','public.diagnostic_company_snapshots','public.diagnostic_definitions','public.diagnostic_mutations','public.diagnostic_results','public.diagnostic_version_translations','public.diagnostic_versions','public.diagnostics','public.email_deliveries','public.feedback','public.industries','public.industry_translations','public.jobs','public.lead_requests','public.maturity_level_translations','public.maturity_levels','public.plans','public.privacy_legal_documents','public.question_option_translations','public.question_options','public.question_translations','public.questions','public.rate_limit_windows','public.report_artifacts','public.revenue_range_translations','public.revenue_ranges','public.scoring_policies','public.team_ai_reports','public.team_block_results','public.team_diagnostics','public.team_participants','public.team_question_statistics','public.team_report_artifacts','public.team_results','public.user_consents','public.user_roles','public.users','storage.buckets','storage.objects']::text[] then raise exception 'controlled_team_capture_denied';end if;
 return evidence;exception when others then raise exception 'controlled_team_capture_denied';end $$;
revoke all on function public.capture_controlled_team_w2_preservation() from public,anon,authenticated;
grant execute on function public.capture_controlled_team_w2_preservation() to service_role;

commit;
