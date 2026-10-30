-- Read-only own result. Does not persist participant scores or change Team reporting.
begin;

create function public.read_team_participant_result(p_participant_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 p public.team_participants;
 response private.team_responses;
 team_title text;
 snap jsonb;
 scored_blocks jsonb;
 overall_score numeric;
 maturity_label text;
begin
 -- Authorize before returning any lifecycle or methodology information.
 select tp.* into p from public.team_participants tp
 where tp.id=p_participant_id and tp.revoked_at is null
 and private.is_verified_session()
 and exists(select 1 from private.team_responses r join auth.users u on u.id=r.user_id
   where r.participant_id=tp.id and r.user_id=auth.uid()
     and lower(u.email)=tp.email and u.email_confirmed_at is not null)
 and exists(select 1 from public.team_diagnostics d
   join public.company_profiles c on c.id=d.company_id
   join public.accounts a on a.id=c.account_id and a.status='active'
   where d.id=tp.team_diagnostic_id);
 if p.id is null then raise exception 'team_response_unavailable'; end if;
 select * into strict response from private.team_responses where participant_id=p.id;
 if p.status<>'completed' or p.completed_at is null or response.completed_at is null then
   raise exception 'team_result_incomplete';
 end if;

 -- Completed participants retain their own result after collection closes.
 -- Use the same immutable policy/questions/weights/reverses pinned for Team aggregation.
 select s.snapshot,d.title into snap,team_title
 from private.team_scoring_snapshots s join public.team_diagnostics d on d.id=s.team_diagnostic_id
 where s.team_diagnostic_id=p.team_diagnostic_id;
 if snap is null or snap->>'algorithm' is distinct from 'individual-weighted-scale-v1' then
   raise exception 'team_result_unavailable';
 end if;
 if exists(select 1 from jsonb_array_elements(snap->'questions') q
   where q->>'answer_type'='scale_0_4' and (
     not(response.answers ? (q->>'id'))
     or jsonb_typeof(response.answers->(q->>'id')) is distinct from 'number'
     or case when jsonb_typeof(response.answers->(q->>'id'))='number' then
       (response.answers->>(q->>'id'))::numeric not between 0 and 4
       or (response.answers->>(q->>'id'))::numeric<>trunc((response.answers->>(q->>'id'))::numeric)
       else true end)) then raise exception 'team_result_unavailable'; end if;

 with blocks as (
   select b->>'id' block_id,b->>'title' title,(b->>'position')::integer position,
     (b->>'weight')::numeric block_weight,count(q)::integer question_count,
     case when coalesce(sum((q->>'weight')::numeric),0)=0 then 0::numeric else
       sum((case when (q->>'reverse_score')::boolean
         then 4-(response.answers->>(q->>'id'))::numeric
         else (response.answers->>(q->>'id'))::numeric end)*(q->>'weight')::numeric)
       /sum(4*(q->>'weight')::numeric)*100 end raw_score
   from jsonb_array_elements(snap->'blocks') b
   left join lateral jsonb_array_elements(snap->'questions') q
     on q->>'block_id'=b->>'id' and q->>'answer_type'='scale_0_4'
   where (b->>'weight')::numeric>0
   group by b->>'id',b->>'title',b->>'position',b->>'weight'
 )
 select jsonb_agg(jsonb_build_object('block_id',block_id,'title',title,'position',position,
     'raw_score',raw_score,'display_score',round(raw_score,1),'question_count',question_count)
     order by position,block_id),sum(raw_score*block_weight)/sum(block_weight)
 into scored_blocks,overall_score from blocks;
 if scored_blocks is null or overall_score is null then raise exception 'team_result_unavailable'; end if;
 select m->>'label' into maturity_label from jsonb_array_elements(snap->'maturity') m
 where overall_score>=(m->'config'->>'min')::numeric
   and overall_score<(m->'config'->>'max')::numeric
 order by (m->>'position')::integer limit 1;
 if nullif(maturity_label,'') is null then raise exception 'team_result_unavailable'; end if;

 return jsonb_build_object('participant_id',p.id,'display_name',p.display_name,
   'team_title',team_title,'status','completed','completed_at',response.completed_at,
   'overall_raw',overall_score,'overall_display',round(overall_score,1),
   'maturity_label',maturity_label,'blocks',scored_blocks);
end;
$$;

revoke all on function public.read_team_participant_result(uuid) from public,anon,authenticated;
grant execute on function public.read_team_participant_result(uuid) to authenticated;
comment on function public.read_team_participant_result(uuid) is
 'Self-only numerical result from the immutable Team scoring snapshot. No owner/admin override, answers, Team aggregate or AI.';
commit;
