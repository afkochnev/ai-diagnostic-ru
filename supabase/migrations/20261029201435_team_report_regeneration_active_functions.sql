-- Restored ordinary deployments can retain inactive *_pre_controlled backups.
-- Bind the functions actually called by the application, preserving real wrappers.
begin;
do $$
declare d text; old_fragment text; new_fragment text; item record;
begin
 d:=pg_get_functiondef('public.request_team_report_v3(uuid,text)'::regprocedure);
 old_fragment:='insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode) values(''team_ai_report'',p_team_id,s.fingerprint,''TEAM-RU-3'',p_provider) on conflict do nothing;';
 if position(old_fragment in d)>0 then
  d:=replace(d,old_fragment,'insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode,team_report_id) values(''team_ai_report'',p_team_id,s.fingerprint,''TEAM-RU-3'',p_provider,rid) on conflict do nothing;');
  old_fragment:='select id into rid from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=p_provider;';
  if position(old_fragment in d)=0 then raise exception 'team_regeneration_active_request_drift';end if;
  d:=replace(d,old_fragment,replace(old_fragment,'provider_mode=p_provider;','provider_mode=p_provider order by version desc limit 1;'));
  old_fragment:='update private.team_jobs set status=''queued'',available_at=now(),attempts=0,last_error_code=null,last_error_message=null';
  if position(old_fragment in d)=0 then raise exception 'team_regeneration_active_request_drift';end if;
  d:=replace(d,old_fragment,old_fragment||',team_report_id=rid,lease_token=null,lease_expires_at=null,started_at=null,completed_at=null');
  old_fragment:='and provider_mode=p_provider and status=''failed'';';
  if position(old_fragment in d)=0 then raise exception 'team_regeneration_active_request_drift';end if;
  execute replace(d,old_fragment,'and provider_mode=p_provider and status=''failed'' and exists(select 1 from public.team_ai_reports where id=rid and status=''failed'');');
 elsif position('team_report_id=rid' in d)=0 and position('private.request_team_report_v3_pre_controlled(' in d)=0 then
  raise exception 'team_regeneration_active_request_drift';
 end if;

 for item in select * from (values
  ('public.prepare_team_report_job(uuid,uuid)','private.prepare_team_report_job_pre_controlled(',
   'select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=j.provider_mode;'),
  ('public.publish_team_report(uuid,uuid,jsonb,text)','private.publish_team_report_pre_controlled(',
   'where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=j.provider_mode and status<>''completed'';'),
  ('public.fail_team_job(uuid,uuid,text,boolean)','private.fail_team_job_pre_controlled(',
   'where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=coalesce(j.pipeline_version,''TEAM-RU-1'') and provider_mode=j.provider_mode and status<>''completed'';')
 ) x(signature,wrapper_call,fragment) loop
  d:=pg_get_functiondef(item.signature::regprocedure);
  if position(item.fragment in d)>0 then
   execute replace(d,item.fragment,replace(item.fragment,'where team_diagnostic_id=','where id=j.team_report_id and team_diagnostic_id='));
  elsif position('id=j.team_report_id' in d)=0 and position(item.wrapper_call in d)=0 then
   raise exception 'team_regeneration_active_worker_drift';
  end if;
 end loop;

 d:=pg_get_functiondef('public.regenerate_team_report_v3(uuid,uuid,text)'::regprocedure);
 old_fragment:='if to_regprocedure(''private.request_team_report_v3_pre_controlled(uuid,text)'') is not null then';
 new_fragment:='if position(''private.request_team_report_v3_pre_controlled('' in pg_get_functiondef(''public.request_team_report_v3(uuid,text)''::regprocedure))>0 or position(''private.require_controlled_team('' in pg_get_functiondef(''public.request_team_report_v3(uuid,text)''::regprocedure))>0 then';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_active_guard_drift';end if;
 execute replace(d,old_fragment,new_fragment);
end $$;
commit;
