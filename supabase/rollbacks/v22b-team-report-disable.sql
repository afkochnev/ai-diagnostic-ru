-- Operational disable only. Preserve all team/individual history, snapshots, reports and jobs.
-- Restore the previously reviewed web/worker commits separately; no destructive down migration.
begin;
revoke execute on function public.read_team_results(uuid),public.request_team_report(uuid),public.refresh_team_results(uuid),public.close_team_diagnostic(uuid) from authenticated;
revoke select on public.team_results,public.team_block_results,public.team_question_statistics,public.team_ai_reports from authenticated;
revoke execute on function public.claim_team_jobs(integer,integer),public.process_team_aggregate(uuid,uuid),public.prepare_team_report_job(uuid,uuid),public.store_team_synthesis(uuid,uuid,jsonb,text,text),public.publish_team_report(uuid,uuid,jsonb,text),public.fail_team_job(uuid,uuid,text,boolean) from service_role;
commit;
