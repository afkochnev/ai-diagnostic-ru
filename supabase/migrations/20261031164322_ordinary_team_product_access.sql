-- Ordinary Team product access is opt-in. Historical controlled targets stay fenced.
begin;
create table private.team_product_release (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 activated_at timestamptz
);
insert into private.team_product_release(singleton) values(true);
alter table private.team_product_release enable row level security;
revoke all on private.team_product_release from public,anon,authenticated,service_role;

create function private.team_product_enabled() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.team_product_release where singleton and enabled)
$$;
create function private.team_product_team(p_team uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.team_product_enabled() and exists(select 1 from public.team_diagnostics where id=p_team)
 and not exists(select 1 from private.controlled_team_runs where team_id=p_team)
$$;
create function private.team_product_participant(p_participant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.team_product_team(team_diagnostic_id) from public.team_participants where id=p_participant),false)
$$;
create function private.team_product_invitation(p_hash text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.team_product_participant(participant_id) from private.team_invitations where token_hash=p_hash),false)
$$;
create function private.team_product_report(p_report uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select private.team_product_team(team_diagnostic_id) from public.team_ai_reports where id=p_report),false)
$$;
create function private.team_product_job(p_job uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select controlled_run_id is null and controlled_window_id is null
 and private.team_product_team(team_diagnostic_id) from private.team_jobs where id=p_job),false)
$$;
revoke all on function private.team_product_enabled(),private.team_product_team(uuid),private.team_product_participant(uuid),
 private.team_product_invitation(text),private.team_product_report(uuid),private.team_product_job(uuid) from public,anon,authenticated,service_role;

create function public.activate_team_product_access() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.billing_service_actor();
 -- Serialize with inserts/updates before checking quiescence and opening creation.
 lock table private.controlled_team_runs,private.controlled_team_windows,private.controlled_team_effects,private.team_jobs,private.launch_controls,private.team_product_release in share row exclusive mode;
 if exists(select 1 from private.controlled_team_runs where status='active' and expires_at>clock_timestamp())
 or exists(select 1 from private.controlled_team_windows where status='active' and expires_at>clock_timestamp())
 or exists(select 1 from private.controlled_team_effects e join private.controlled_team_runs r on r.id=e.run_id
   left join private.controlled_team_windows w on w.id=e.window_id where e.status='reserved'
   and coalesce(w.expires_at,r.expires_at)>clock_timestamp())
 or exists(select 1 from private.team_jobs where controlled_run_id is null and controlled_window_id is null
   and lease_token is not null and lease_expires_at>clock_timestamp()) then raise exception 'team_product_not_quiescent';end if;
 update private.team_product_release set enabled=true,activated_at=coalesce(activated_at,clock_timestamp()) where singleton;
 update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true where singleton;
 return jsonb_build_object('enabled',true,'team_creation_enabled',true,'team_invitations_enabled',true);
end $$;
revoke all on function public.activate_team_product_access() from public,anon,authenticated,service_role;
grant execute on function public.activate_team_product_access() to service_role;

-- Prefix a normal-target branch; keep every existing controlled body and its ACL.
-- The pre-controlled implementations retain verified identity, Company ownership,
-- Account entitlement, consent, immutable scoring, lease and privacy checks.
do $$
declare item record; definition text; branch text;
begin
 for item in select * from (values
  ('public.create_team_diagnostic(uuid,text)','private.team_product_enabled()','return private.create_team_diagnostic_pre_controlled(p_company_id,p_title);'),
  ('public.invite_team_participant(uuid,text,text,text)','private.team_product_team(p_team_id)','return private.invite_team_participant_pre_controlled(p_team_id,p_email,p_display_name,p_token_hash);'),
  ('public.renew_team_invitation(uuid,text)','private.team_product_participant(p_participant_id)','perform private.renew_team_invitation_pre_controlled(p_participant_id,p_token_hash);return;'),
  ('public.revoke_team_participant(uuid)','private.team_product_participant(p_participant_id)','perform private.revoke_team_participant_pre_controlled(p_participant_id);return;'),
  ('public.refresh_team_results(uuid)','private.team_product_team(p_team_id)','perform private.refresh_team_results_pre_controlled(p_team_id);return;'),
  ('public.close_team_diagnostic(uuid)','private.team_product_team(p_team_id)','perform private.close_team_diagnostic_pre_controlled(p_team_id);return;'),
  ('public.request_team_report_v3(uuid,text)','private.team_product_team(p_team_id)','return private.request_team_report_v3_pre_controlled(p_team_id,p_provider);'),
  ('public.save_team_response(uuid,integer,jsonb,boolean)','private.team_product_participant(p_participant_id)','return private.save_team_response_pre_controlled(p_participant_id,p_expected_revision,p_answers,p_submit);'),
  ('public.accept_team_invitation(text)','private.team_product_invitation(encode(sha256(convert_to(p_token,''UTF8'')),''hex''))','return private.accept_team_invitation_pre_controlled(p_token);'),
  ('public.finalize_team_invitation_identity(text,boolean,text,text)','private.team_product_invitation(encode(sha256(convert_to(p_token,''UTF8'')),''hex''))','return private.finalize_team_invitation_identity_pre_controlled(p_token,p_consent,p_data_version,p_marketing_version);'),
  ('public.resolve_team_invitation_auth(text)','private.team_product_invitation(p_token_hash)','return private.resolve_team_invitation_auth_pre_controlled(p_token_hash);'),
  ('public.reserve_team_invitation_identity(text,text)','private.team_product_invitation(p_token_hash)','return private.reserve_team_invitation_identity_pre_controlled(p_token_hash,p_nonce_hash);'),
  ('public.process_team_aggregate(uuid,uuid)','private.team_product_job(p_job_id)','return private.process_team_aggregate_pre_controlled(p_job_id,p_lease_token);'),
  ('public.prepare_team_report_job(uuid,uuid)','private.team_product_job(p_job_id)','return private.prepare_team_report_job_pre_controlled(p_job_id,p_lease_token);'),
  ('public.store_team_synthesis(uuid,uuid,jsonb,text,text)','private.team_product_job(p_job_id)','return private.store_team_synthesis_pre_controlled(p_job_id,p_lease_token,p_summary,p_provider,p_model);'),
  ('public.publish_team_report(uuid,uuid,jsonb,text)','private.team_product_job(p_job_id)','return private.publish_team_report_pre_controlled(p_job_id,p_lease_token,p_content,p_model);'),
  ('public.fail_team_job(uuid,uuid,text,boolean)','private.team_product_job(p_job_id)','perform private.fail_team_job_pre_controlled(p_job_id,p_lease_token,p_error_code,p_retryable);return;')
 ) x(signature,predicate,operation) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if position('begin' in definition)=0 or position('private.team_product_' in definition)>0 then raise exception 'team_product_definition_drift';end if;
  branch:='begin if '||item.predicate||' then '||item.operation||'end if;';
  execute regexp_replace(definition,'begin',branch);
 end loop;

 definition:=pg_get_functiondef('public.regenerate_team_report_v3(uuid,uuid,text)'::regprocedure);
 branch:='if position(''private.request_team_report_v3_pre_controlled('' in pg_get_functiondef(''public.request_team_report_v3(uuid,text)''::regprocedure))>0 or position(''private.require_controlled_team('' in pg_get_functiondef(''public.request_team_report_v3(uuid,text)''::regprocedure))>0 then';
 if position(branch in definition)=0 then raise exception 'team_product_regeneration_drift';end if;
 execute replace(definition,branch,'if not private.team_product_team(p_team_id) and ('||substring(branch from 4 for length(branch)-8)||') then');

 definition:=pg_get_functiondef('public.claim_team_jobs_v3(integer,integer)'::regprocedure);
 if position('controlled_run_id is null and ' in definition)=0 then raise exception 'team_product_claim_drift';end if;
 definition:=regexp_replace(definition,'begin','begin if not private.team_product_enabled() then return;end if;');
 execute replace(definition,'controlled_run_id is null and ','controlled_run_id is null and controlled_window_id is null and private.team_product_team(team_diagnostic_id) and ');

 definition:=pg_get_functiondef('private.controlled_team_artifact_insert()'::regprocedure);
 if position('begin' in definition)=0 then raise exception 'team_product_artifact_drift';end if;
 execute regexp_replace(definition,'begin','begin if private.team_product_report(new.team_report_id) then perform private.billing_service_actor();if not exists(select 1 from public.team_ai_reports where id=new.team_report_id and status=''completed'' and version=new.team_report_version) then raise exception ''team_pdf_not_ready'';end if;return new;end if;');
end $$;
commit;
