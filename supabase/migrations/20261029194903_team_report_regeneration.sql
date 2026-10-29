-- Explicitly regenerate a Team V3 report while retaining every report and PDF.
begin;

alter table private.team_jobs add column team_report_id uuid references public.team_ai_reports(id) on delete restrict;
update private.team_jobs j set team_report_id=r.id
from public.team_ai_reports r
where j.kind='team_ai_report' and j.pipeline_version='TEAM-RU-3'
 and r.team_diagnostic_id=j.team_diagnostic_id and r.source_fingerprint=j.source_fingerprint
 and r.prompt_version=j.pipeline_version and r.provider_mode=j.provider_mode;
alter table private.team_jobs add constraint team_v3_job_report_required
 check(pipeline_version is distinct from 'TEAM-RU-3' or team_report_id is not null);
create index team_jobs_report_idx on private.team_jobs(team_report_id) where team_report_id is not null;

drop index public.team_report_provider_unique;
create unique index team_report_provider_unique on public.team_ai_reports
 (team_diagnostic_id,source_fingerprint,prompt_version,(coalesce(provider_mode,'legacy')))
 where prompt_version<>'TEAM-RU-3';
create unique index team_report_v3_active_unique on public.team_ai_reports
 (team_diagnostic_id,source_fingerprint,provider_mode)
 where prompt_version='TEAM-RU-3' and status in('queued','generating');

-- Bind all V3 worker operations to one report. Update the ordinary implementation
-- behind any existing controlled wrapper, leaving its admission checks intact.
do $$
declare sig text; d text; old_fragment text; new_fragment text;
begin
 sig:=case when to_regprocedure('private.request_team_report_v3_pre_controlled(uuid,text)') is null
  then 'public.request_team_report_v3(uuid,text)' else 'private.request_team_report_v3_pre_controlled(uuid,text)' end;
 d:=pg_get_functiondef(sig::regprocedure);
 old_fragment:='select id into rid from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=p_provider;';
 new_fragment:=replace(old_fragment,'provider_mode=p_provider;','provider_mode=p_provider order by version desc limit 1;');
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_request_drift';end if;
 d:=replace(d,old_fragment,new_fragment);
 old_fragment:='insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode) values(''team_ai_report'',p_team_id,s.fingerprint,''TEAM-RU-3'',p_provider) on conflict do nothing;';
 new_fragment:='insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode,team_report_id) values(''team_ai_report'',p_team_id,s.fingerprint,''TEAM-RU-3'',p_provider,rid) on conflict do nothing;';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_request_drift';end if;
 d:=replace(d,old_fragment,new_fragment);
 old_fragment:='update private.team_jobs set status=''queued'',available_at=now(),attempts=0,last_error_code=null,last_error_message=null';
 new_fragment:=old_fragment||',team_report_id=rid,lease_token=null,lease_expires_at=null,started_at=null,completed_at=null';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_request_drift';end if;
 d:=replace(d,old_fragment,new_fragment);
 old_fragment:='and provider_mode=p_provider and status=''failed'';';
 new_fragment:='and provider_mode=p_provider and status=''failed'' and exists(select 1 from public.team_ai_reports where id=rid and status=''failed'');';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_request_drift';end if;
 execute replace(d,old_fragment,new_fragment);

 sig:=case when to_regprocedure('private.prepare_team_report_job_pre_controlled(uuid,uuid)') is null
  then 'public.prepare_team_report_job(uuid,uuid)' else 'private.prepare_team_report_job_pre_controlled(uuid,uuid)' end;
 d:=pg_get_functiondef(sig::regprocedure);
 old_fragment:='select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=j.provider_mode;';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_prepare_drift';end if;
 execute replace(d,old_fragment,replace(old_fragment,'where team_diagnostic_id=','where id=j.team_report_id and team_diagnostic_id='));

 sig:=case when to_regprocedure('private.publish_team_report_pre_controlled(uuid,uuid,jsonb,text)') is null
  then 'public.publish_team_report(uuid,uuid,jsonb,text)' else 'private.publish_team_report_pre_controlled(uuid,uuid,jsonb,text)' end;
 d:=pg_get_functiondef(sig::regprocedure);
 old_fragment:='where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=''TEAM-RU-3'' and provider_mode=j.provider_mode and status<>''completed'';';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_publish_drift';end if;
 execute replace(d,old_fragment,replace(old_fragment,'where team_diagnostic_id=','where id=j.team_report_id and team_diagnostic_id='));

 sig:=case when to_regprocedure('private.fail_team_job_pre_controlled(uuid,uuid,text,boolean)') is null
  then 'public.fail_team_job(uuid,uuid,text,boolean)' else 'private.fail_team_job_pre_controlled(uuid,uuid,text,boolean)' end;
 d:=pg_get_functiondef(sig::regprocedure);
 old_fragment:='where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=coalesce(j.pipeline_version,''TEAM-RU-1'') and provider_mode=j.provider_mode and status<>''completed'';';
 if position(old_fragment in d)=0 then raise exception 'team_regeneration_fail_drift';end if;
 execute replace(d,old_fragment,replace(old_fragment,'where team_diagnostic_id=','where id=j.team_report_id and team_diagnostic_id='));
end $$;

create function public.regenerate_team_report_v3(p_team_id uuid,p_previous_report_id uuid,p_provider text default 'openai')
returns uuid language plpgsql security definer set search_path='' as $$
declare s record; previous public.team_ai_reports; latest public.team_ai_reports; rid uuid; jid uuid;
begin
 -- A controlled deployment must retain the original admission/budget policy.
 if to_regprocedure('private.request_team_report_v3_pre_controlled(uuid,text)') is not null then
  return public.request_team_report_v3(p_team_id,p_provider);
 end if;
 if p_provider is null or p_provider not in('mock','openai') or p_previous_report_id is null then raise exception 'team_invalid_input';end if;
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found';end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then raise exception 'team_threshold';end if;
 if not exists(select 1 from public.team_results where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint) then raise exception 'team_aggregate_pending';end if;
 select * into previous from public.team_ai_reports where id=p_previous_report_id
  and team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint and status='completed';
 if previous.id is null then raise exception 'team_report_changed';end if;
 select * into latest from public.team_ai_reports where team_diagnostic_id=p_team_id
  and source_fingerprint=s.fingerprint and prompt_version='TEAM-RU-3' and provider_mode=p_provider order by version desc limit 1;
 -- The expected current version makes double clicks and stale forms idempotent,
 -- even if the first request has already completed by the time a replay arrives.
 if latest.id is not null and latest.id is distinct from p_previous_report_id then return latest.id;end if;
 if exists(select 1 from public.team_ai_reports where team_diagnostic_id=p_team_id
   and source_fingerprint=s.fingerprint and prompt_version='TEAM-RU-3' and status in('queued','generating')) then
  raise exception 'team_report_in_progress';
 end if;
 select id into jid from private.team_jobs where kind='team_ai_report' and team_diagnostic_id=p_team_id
  and source_fingerprint=s.fingerprint and pipeline_version='TEAM-RU-3' and provider_mode=p_provider for update;
 if jid is not null and exists(select 1 from private.team_jobs where id=jid and status in('queued','running')) then
  raise exception 'team_report_in_progress';
 end if;
 insert into public.team_ai_reports(team_diagnostic_id,version,source_fingerprint,completed_participant_count,
  company_context_snapshot,prompt_version,provider_mode,pdf_snapshot)
 values(p_team_id,(select coalesce(max(version),0)+1 from public.team_ai_reports where team_diagnostic_id=p_team_id),
  s.fingerprint,s.completed_count,previous.company_context_snapshot,'TEAM-RU-3',p_provider,
  (select jsonb_build_object('team_title',d.title,'overall',e->'overall','blocks',e->'blocks')
   from public.team_diagnostics d cross join lateral (select private.team_numeric_evidence_v2(p_team_id) e) x where d.id=p_team_id))
 returning id into rid;
 if jid is null then
  insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode,team_report_id)
  values('team_ai_report',p_team_id,s.fingerprint,'TEAM-RU-3',p_provider,rid);
 else
  -- Only terminal jobs are rotated; the next claim receives a fresh lease token.
  update private.team_jobs set team_report_id=rid,status='queued',attempts=0,available_at=now(),
   lease_token=null,lease_expires_at=null,started_at=null,completed_at=null,last_error_code=null,last_error_message=null where id=jid;
 end if;
 return rid;
end $$;
revoke all on function public.regenerate_team_report_v3(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.regenerate_team_report_v3(uuid,uuid,text) to authenticated;

commit;
