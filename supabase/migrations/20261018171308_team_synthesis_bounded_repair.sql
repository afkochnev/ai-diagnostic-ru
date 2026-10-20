begin;
-- Separate, lease-fenced worker-only inspection channel. Never an AI evidence input.
-- Includes all private text sources (also incomplete/revoked) like validate_team_output.
create function public.get_team_synthesis_privacy_corpus(p_job_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; result jsonb;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' or j.pipeline_version is distinct from 'TEAM-RU-2'
 or not private.team_job_current(j) then raise exception 'team_privacy_corpus_unavailable';end if;
 select jsonb_build_object('threshold',32,
  'answers',coalesce((select jsonb_agg(jsonb_build_object('question_index',q.pos,'text',e.value#>>'{}') order by q.pos,random())
   from private.team_responses r join public.team_participants p on p.id=r.participant_id
   cross join lateral jsonb_each(r.answers) e
   join private.team_questionnaires tq on tq.team_diagnostic_id=p.team_diagnostic_id
   cross join lateral jsonb_array_elements(tq.questions) with ordinality q(item,pos)
   where p.team_diagnostic_id=j.team_diagnostic_id and jsonb_typeof(e.value)='string'
   and q.item->>'id'=e.key and q.item->>'answer_type'='text'),'[]'::jsonb),
  'identifiers',coalesce((select jsonb_agg(distinct identity_value) from public.team_participants p
   left join private.team_responses r on r.participant_id=p.id
   cross join lateral (values(p.display_name),(p.email),(p.id::text),(r.user_id::text)) ids(identity_value)
   where p.team_diagnostic_id=j.team_diagnostic_id and nullif(identity_value,'') is not null),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.get_team_synthesis_privacy_corpus(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_team_synthesis_privacy_corpus(uuid,uuid) to service_role;
comment on function public.get_team_synthesis_privacy_corpus(uuid,uuid) is
 'Confidential worker memory only. Never log/persist/pass to synthesis, repair, main report, owner, or participant.';
commit;
