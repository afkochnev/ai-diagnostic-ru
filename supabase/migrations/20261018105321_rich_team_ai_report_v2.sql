-- V2.2C: one transactional forward migration. Historical row values are not rewritten.
begin;
alter table public.team_ai_reports drop constraint team_ai_reports_team_diagnostic_id_source_fingerprint_key;
alter table public.team_ai_reports add constraint team_report_pipeline_unique unique(team_diagnostic_id,source_fingerprint,prompt_version);
alter table private.team_qualitative_syntheses drop constraint team_qualitative_syntheses_pkey;
alter table private.team_qualitative_syntheses add primary key(team_diagnostic_id,source_fingerprint,prompt_version);
-- NULL keeps old job rows byte-for-byte in their original columns: aggregate=AGG-V1, report=TEAM-RU-1.
alter table private.team_jobs add column pipeline_version text;
alter table private.team_jobs add constraint team_pipeline_valid check(
 (kind='team_aggregate' and (pipeline_version is null or pipeline_version='AGG-V1')) or
 (kind='team_ai_report' and (pipeline_version is null or pipeline_version in('TEAM-RU-1','TEAM-RU-2'))));
alter table private.team_jobs drop constraint team_jobs_kind_team_diagnostic_id_source_fingerprint_key;
create unique index team_job_pipeline_unique on private.team_jobs(kind,team_diagnostic_id,source_fingerprint,
 (coalesce(pipeline_version,case when kind='team_aggregate' then 'AGG-V1' else 'TEAM-RU-1' end)));
create or replace function private.enqueue_team_aggregate(p_team uuid) returns void language plpgsql security definer set search_path='' as $$
declare s record;
begin
 select * into s from private.team_source(p_team);
 if s.completed_count>=3 then insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint)
 values('team_aggregate',p_team,s.fingerprint) on conflict do nothing;end if;
end; $$;
create function private.prepare_team_report_job_v1(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; snap jsonb; groups jsonb; input jsonb; rpt public.team_ai_reports;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return jsonb_build_object('status','superseded'); end if;
 select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-RU-1';
 if rpt.status='completed' then
  update private.team_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=j.id;
  return jsonb_build_object('status','completed');
 end if;
 if not exists(select 1 from public.team_results where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint) then raise exception 'team_aggregate_pending'; end if;
 select snapshot into strict snap from private.team_scoring_snapshots where team_diagnostic_id=j.team_diagnostic_id;
 select coalesce(jsonb_agg(jsonb_build_object('question',prompt,'texts',texts,'response_count',n)),'[]'::jsonb) into groups from (
 select q->>'prompt' prompt,jsonb_agg(private.mask_team_text(j.team_diagnostic_id,r.answers->>(q->>'id')) order by random()) texts,count(*) n
 from private.team_questionnaires tq cross join jsonb_array_elements(tq.questions) q cross join private.team_completed(j.team_diagnostic_id) r
 where tq.team_diagnostic_id=j.team_diagnostic_id and q->>'answer_type'='text' and nullif(btrim(r.answers->>(q->>'id')),'') is not null
 group by q->>'id',q->>'prompt' having count(*)>=3 order by q->>'id') grouped;
 input:=jsonb_build_object('participant_count',rpt.completed_participant_count,'company_context',private.safe_team_json(j.team_diagnostic_id,rpt.company_context_snapshot),
 'overall',(select jsonb_build_object('mean',r.overall_mean,'stddev',r.overall_stddev,'min',r.overall_min,'max',r.overall_max,
 'maturity',(select m->>'label' from jsonb_array_elements(snap->'maturity') m where m->>'id'=r.maturity_level_id::text)) from public.team_results r where r.team_diagnostic_id=j.team_diagnostic_id),
 'blocks',(select jsonb_agg(jsonb_build_object('title',b->>'title','position',(b->>'position')::integer,'mean',r.mean_score,'stddev',r.stddev_score,'min',r.min_score,'max',r.max_score) order by (b->>'position')::integer)
 from public.team_block_results r join jsonb_array_elements(snap->'blocks') b on b->>'id'=r.block_id::text where r.team_diagnostic_id=j.team_diagnostic_id),
 'questions',(select jsonb_agg(jsonb_build_object('question',q->>'prompt','mean',r.mean_score,'stddev',r.stddev_score) order by q->>'id')
 from public.team_question_statistics r join private.team_questionnaires tq on tq.team_diagnostic_id=r.team_diagnostic_id join jsonb_array_elements(tq.questions) q on q->>'id'=r.question_id::text where r.team_diagnostic_id=j.team_diagnostic_id));
 update public.team_ai_reports set status='generating' where id=rpt.id and status<>'completed';
 return jsonb_build_object('status','generating','qualitative_groups',groups,'report_input',input,
 'synthesis',(select structured_summary from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-SYNTHESIS-RU-1'));
end; $$;
create or replace function public.claim_team_jobs(p_limit integer default 1,p_lease_seconds integer default 300) returns setof private.team_jobs
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'team_worker_only'; end if;
 return query with candidates as (
 select id from private.team_jobs where (pipeline_version is null or pipeline_version in('AGG-V1','TEAM-RU-1')) and attempts<3 and available_at<=now() and
 (status in('queued','failed') or (status='running' and lease_expires_at<=now())) order by created_at,id for update skip locked limit least(greatest(p_limit,1),2)
 ) update private.team_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),600)),started_at=now()
 from candidates c where j.id=c.id returning j.*;
end; $$;
create function public.claim_team_jobs_v2(p_limit integer default 1,p_lease_seconds integer default 300) returns setof private.team_jobs
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'team_worker_only'; end if;
 return query with candidates as (
 select id from private.team_jobs where attempts<3 and available_at<=now() and
 (status in('queued','failed') or (status='running' and lease_expires_at<=now())) order by created_at,id for update skip locked limit least(greatest(p_limit,1),2)
 ) update private.team_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),600)),started_at=now()
 from candidates c where j.id=c.id returning j.*;
end; $$;
-- All distributions are marginal per-question counts after the pinned scoring transform.
-- The set-based CTE never returns participant IDs or cross-question respondent vectors.
create function private.team_numeric_evidence_v2(p_team uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snap jsonb; result jsonb; n integer; fp text;
begin
 select snapshot into strict snap from private.team_scoring_snapshots where team_diagnostic_id=p_team;
 select completed_count,fingerprint into n,fp from private.team_source(p_team);
 if n<3 or not exists(select 1 from public.team_results where team_diagnostic_id=p_team and source_fingerprint=fp) then raise exception 'team_aggregate_pending'; end if;
 with normalized as materialized (
  select q->>'id' qid,(q->>'block_id') bid,(q->>'position')::integer pos,(q->>'reverse_score')::boolean reverse_score,
   case when (q->>'reverse_score')::boolean then 4-(r.answers->>(q->>'id'))::numeric else (r.answers->>(q->>'id'))::numeric end value
  from private.team_completed(p_team) r cross join jsonb_array_elements(snap->'questions') q where q->>'answer_type'='scale_0_4'
 ), bins as (
  select qid,bid,pos,reverse_score,count(*) participant_count,avg(value) mean,stddev_pop(value) sd,min(value) lo,max(value) hi,
   jsonb_build_array(count(*) filter(where value=0),count(*) filter(where value=1),count(*) filter(where value=2),count(*) filter(where value=3),count(*) filter(where value=4)) distribution
  from normalized group by qid,bid,pos,reverse_score
 )
 select jsonb_build_object(
  'methodology',jsonb_build_object('version_number',(select version_number from public.diagnostic_versions where id=(select version_id from public.team_diagnostics where id=p_team)),
   'algorithm',snap->>'algorithm','engine_key',snap->'policy'->>'engine_key','engine_version',snap->'policy'->>'engine_version','schema_version',snap->'policy'->>'schema_version'),
  'overall',(select jsonb_build_object('participant_count',n,'mean',r.overall_mean,'stddev_pop',r.overall_stddev,'min',r.overall_min,'max',r.overall_max,
   'maturity',(select m->>'label' from jsonb_array_elements(snap->'maturity') m where m->>'id'=r.maturity_level_id::text)) from public.team_results r where r.team_diagnostic_id=p_team),
  'blocks',(select jsonb_agg(jsonb_build_object('title',b->>'title','position',(b->>'position')::integer,'participant_count',r.participant_count,
   'mean',r.mean_score,'stddev_pop',r.stddev_score,'min',r.min_score,'max',r.max_score) order by (b->>'position')::integer)
   from public.team_block_results r join jsonb_array_elements(snap->'blocks') b on b->>'id'=r.block_id::text where r.team_diagnostic_id=p_team and r.source_fingerprint=fp),
  'questions',(select jsonb_agg(jsonb_build_object('_question_id',x.qid,'question',q->>'prompt','block_title',b->>'title',
   'block_position',(b->>'position')::integer,'question_position',x.pos,'reverse_score',x.reverse_score,'normalized_direction','higher_is_stronger',
   'participant_count',x.participant_count,'mean',x.mean,'stddev_pop',x.sd,'min',x.lo,'max',x.hi,'distribution',x.distribution)
   order by (b->>'position')::integer,x.pos,x.qid)
   from bins x join private.team_questionnaires tq on tq.team_diagnostic_id=p_team join jsonb_array_elements(tq.questions) q on q->>'id'=x.qid
   join jsonb_array_elements(snap->'blocks') b on b->>'id'=x.bid)) into result;
 if jsonb_array_length(result->'blocks') is distinct from 8 or jsonb_array_length(result->'questions') is distinct from 80
 or exists(select 1 from jsonb_array_elements(result->'questions') q where (q->>'participant_count')::integer<>n
   or (select sum(v::integer) from jsonb_array_elements_text(q->'distribution') v)<>n) then raise exception 'team_numeric_integrity'; end if;
 return result;
end; $$;

create or replace function public.request_team_report(p_team_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s record; rid uuid; ctx jsonb;
begin
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then raise exception 'team_threshold'; end if;
 if not exists(select 1 from public.team_results where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint) then perform private.enqueue_team_aggregate(p_team_id);return null;end if;
 select id into rid from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint and prompt_version='TEAM-RU-2';
 if rid is null then
  -- A same-source V1 snapshot remains the authority if one already exists.
  select company_context_snapshot into ctx from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint order by version desc limit 1;
  if ctx is null then
   select jsonb_build_object('company_name',c.name,'industry',c.industry_key,'country',c.country,'products',c.products,'customers',c.customer_segments,
    'sales_channels',c.sales_channels,'employees_count',c.employee_count,'annual_revenue',c.annual_revenue_key,'company_age_years',c.company_age_years,
    'management_levels',c.management_levels,'key_problems',c.key_problems,'main_goals',c.main_goals) into ctx
   from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id where d.id=p_team_id;
  end if;
  insert into public.team_ai_reports(team_diagnostic_id,version,source_fingerprint,completed_participant_count,company_context_snapshot,prompt_version)
  values(p_team_id,(select coalesce(max(version),0)+1 from public.team_ai_reports where team_diagnostic_id=p_team_id),s.fingerprint,s.completed_count,ctx,'TEAM-RU-2') returning id into rid;
 end if;
 insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version) values('team_ai_report',p_team_id,s.fingerprint,'TEAM-RU-2') on conflict do nothing;
 update private.team_jobs set status='queued',available_at=now(),attempts=0,last_error_code=null,last_error_message=null
 where team_diagnostic_id=p_team_id and kind='team_ai_report' and source_fingerprint=s.fingerprint and pipeline_version='TEAM-RU-2' and status='failed';
 update public.team_ai_reports set status='queued',error_code=null where id=rid and status='failed';
 return rid;
end; $$;

create or replace function public.prepare_team_report_job(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; rpt public.team_ai_reports; evidence jsonb; groups jsonb; input jsonb; ctx jsonb;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if coalesce(j.pipeline_version,'TEAM-RU-1')='TEAM-RU-1' then return private.prepare_team_report_job_v1(p_job_id,p_lease_token);end if;
 if not private.team_job_current(j) then return jsonb_build_object('status','superseded');end if;
 select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-RU-2';
 if rpt.status='completed' then
  update private.team_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=j.id;
  return jsonb_build_object('status','completed','pipeline_version','TEAM-RU-2');
 end if;
 evidence:=private.team_numeric_evidence_v2(j.team_diagnostic_id);
 ctx:=private.safe_team_json(j.team_diagnostic_id,rpt.company_context_snapshot);
 input:=jsonb_build_object('participant_count',rpt.completed_participant_count,'company_context',ctx,
  'methodology',evidence->'methodology','overall',evidence->'overall','blocks',evidence->'blocks',
  'questions',(select jsonb_agg(q-'_question_id' order by ord) from jsonb_array_elements(evidence->'questions') with ordinality x(q,ord)));
 -- Question grouping and independent random ordering prevent cross-question linkage.
 select coalesce(jsonb_agg(jsonb_build_object('question',prompt,'question_position',pos,'block_title',block_title,'response_count',n,'texts',texts,'relevant_block',relevant_block) order by qid),'[]') into groups from (
  select q->>'id' qid,pos,q->>'prompt' prompt,q->>'block_title' block_title,count(*) n,
   jsonb_agg(private.mask_team_text(j.team_diagnostic_id,r.answers->>(q->>'id')) order by random()) texts,
   (select b from jsonb_array_elements(evidence->'blocks') b where b->>'title'=q->>'block_title') relevant_block
  from private.team_questionnaires tq cross join jsonb_array_elements(tq.questions) with ordinality qs(q,pos) cross join private.team_completed(j.team_diagnostic_id) r
  where tq.team_diagnostic_id=j.team_diagnostic_id and q->>'answer_type'='text' and nullif(btrim(r.answers->>(q->>'id')),'') is not null
  group by q,pos having count(*)>=3) grouped;
 update public.team_ai_reports set status='generating' where id=rpt.id;
 return jsonb_build_object('status','generating','pipeline_version','TEAM-RU-2','synthesis_version','TEAM-SYNTHESIS-RU-2',
  'report_input',input,'qualitative_input',jsonb_build_object('company_context',ctx,'block_aggregates',evidence->'blocks','groups',groups),
  'synthesis',(select structured_summary from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-SYNTHESIS-RU-2'));
end; $$;

create function private.validate_team_synthesis_v2(p_team uuid,p_summary jsonb,p_count integer) returns void language plpgsql set search_path='' as $$
declare k text; x jsonb; counts jsonb;
begin
 select coalesce(jsonb_object_agg(pos,n),'{}') into counts from (select pos,count(*) n from private.team_questionnaires tq cross join jsonb_array_elements(tq.questions) with ordinality qs(q,pos) cross join private.team_completed(p_team) r where tq.team_diagnostic_id=p_team and q->>'answer_type'='text' and nullif(btrim(r.answers->>(q->>'id')),'') is not null group by pos having count(*)>=3) eligible;
 if jsonb_typeof(p_summary) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_summary))<>11 then raise exception 'team_schema_rejected';end if;
 foreach k in array array['themes','strengths','problem_patterns','growth_constraints','risks','opportunities','alignment_signals','divergence_signals','contradictions','management_implications','discussion_topics'] loop
  if jsonb_typeof(p_summary->k) is distinct from 'array' or jsonb_array_length(p_summary->k)>20 then raise exception 'team_schema_rejected';end if;
  for x in select * from jsonb_array_elements(p_summary->k) loop
   if k='themes' then
    if jsonb_typeof(x) is distinct from 'object' or (select count(*) from jsonb_object_keys(x))<>4
     or jsonb_typeof(x->'question_position') is distinct from 'number' or (x->>'question_position')::numeric<>trunc((x->>'question_position')::numeric)
     or not(counts ? (x->>'question_position')) or (x->>'response_count')::numeric>(counts->>(x->>'question_position'))::numeric
     or jsonb_typeof(x->'title') is distinct from 'string' or length(x->>'title') not between 1 and 12000
     or jsonb_typeof(x->'summary') is distinct from 'string' or length(x->>'summary') not between 1 and 12000
     or jsonb_typeof(x->'response_count') is distinct from 'number' or (x->>'response_count')::numeric<>trunc((x->>'response_count')::numeric)
     or (x->>'response_count')::integer not between 3 and p_count then raise exception 'team_schema_rejected';end if;
   elsif jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 12000 then raise exception 'team_schema_rejected';end if;
  end loop;
 end loop;
end; $$;
create function private.validate_team_report_v2(p_content jsonb,p_count integer) returns void language plpgsql set search_path='' as $$
declare k text; x jsonb; limits jsonb:='{"strengths":[3,5],"key_problem_zones":[3,5],"implementation_risks":[4,6],"first_actions":[4,6],"plan_30_days":[5,7],"plan_60_days":[5,7],"plan_90_days":[5,7]}';
begin
 if jsonb_typeof(p_content) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_content))<>14
  or jsonb_typeof(p_content->'participant_count') is distinct from 'number' or (p_content->>'participant_count')::numeric is distinct from p_count then raise exception 'team_schema_rejected';end if;
 foreach k in array array['summary','main_diagnosis','manageability_index_text','growth_constraint','next_step'] loop
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(p_content->>k) not between 1 and 12000 then raise exception 'team_schema_rejected';end if;
 end loop;
 for k in select jsonb_object_keys(limits) loop
  if jsonb_typeof(p_content->k) is distinct from 'array' or jsonb_array_length(p_content->k) not between (limits->k->>0)::integer and (limits->k->>1)::integer then raise exception 'team_schema_rejected';end if;
  for x in select * from jsonb_array_elements(p_content->k) loop if jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 12000 then raise exception 'team_schema_rejected';end if;end loop;
 end loop;
 if jsonb_typeof(p_content->'team_analysis') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_content->'team_analysis'))<>4 then raise exception 'team_schema_rejected';end if;
 foreach k in array array['alignment','divergence','qualitative_signals','discussion_questions'] loop
  if jsonb_typeof(p_content->'team_analysis'->k) is distinct from 'array'
   or jsonb_array_length(p_content->'team_analysis'->k) not between (case when k='discussion_questions' then 5 when k='alignment' then 1 else 0 end) and (case when k='discussion_questions' then 8 else 12 end) then raise exception 'team_schema_rejected';end if;
  for x in select * from jsonb_array_elements(p_content->'team_analysis'->k) loop if jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 12000 then raise exception 'team_schema_rejected';end if;end loop;
 end loop;
end; $$;

create or replace function public.store_team_synthesis(p_job_id uuid,p_lease_token uuid,p_summary jsonb,p_provider text,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; n integer; ver text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind';end if;
 if not private.team_job_current(j) then return 'superseded';end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 if j.pipeline_version='TEAM-RU-2' then
  perform private.validate_team_synthesis_v2(j.team_diagnostic_id,p_summary,n);ver:='TEAM-SYNTHESIS-RU-2';
 else perform private.validate_team_synthesis(p_summary,n);ver:='TEAM-SYNTHESIS-RU-1';end if;
 perform private.validate_team_output(j.team_diagnostic_id,p_summary);
 insert into private.team_qualitative_syntheses(team_diagnostic_id,source_fingerprint,completed_participant_count,structured_summary,provider,model,prompt_version)
 values(j.team_diagnostic_id,j.source_fingerprint,n,p_summary,p_provider,p_model,ver) on conflict do nothing;
 return 'stored';
end; $$;
create or replace function public.publish_team_report(p_job_id uuid,p_lease_token uuid,p_content jsonb,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; k text; n integer; ver text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return 'superseded'; end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 ver:=coalesce(j.pipeline_version,'TEAM-RU-1');
 if ver='TEAM-RU-2' then perform private.validate_team_report_v2(p_content,n);else
 if jsonb_typeof(p_content)<>'object' or (select count(*) from jsonb_object_keys(p_content))<>11 or (p_content->>'participant_count')::integer is distinct from n then raise exception 'team_schema_rejected'; end if;
 foreach k in array array['executive_summary','maturity'] loop
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(p_content->>k) not between 1 and 5000 then raise exception 'team_schema_rejected'; end if;
 end loop;
 foreach k in array array['strongest_blocks','weakest_blocks','agreement','disagreement','qualitative_themes','risks','priorities','next_steps'] loop
  if jsonb_typeof(p_content->k) is distinct from 'array' or jsonb_array_length(p_content->k)>20 or exists(select 1 from jsonb_array_elements(p_content->k) x where jsonb_typeof(x)<>'string') then raise exception 'team_schema_rejected'; end if;
 end loop;
 end if;
 if not exists(select 1 from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=case when ver='TEAM-RU-2' then 'TEAM-SYNTHESIS-RU-2' else 'TEAM-SYNTHESIS-RU-1' end) then raise exception 'team_synthesis_missing'; end if;
 perform private.validate_team_output(j.team_diagnostic_id,p_content);
 update public.team_ai_reports set status='completed',structured_content=p_content,model=p_model,completed_at=now(),error_code=null
 where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=ver and status<>'completed';
 update private.team_jobs set status='completed',lease_token=null,lease_expires_at=null,completed_at=now(),last_error_code=null,last_error_message=null where id=j.id;
 return 'completed';
end; $$;
create or replace function public.fail_team_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; code text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 code:=case when p_error_code in('team_privacy_rejected','team_schema_rejected','team_numeric_integrity','team_provider_retryable','team_aggregate_pending') then p_error_code else 'team_processing_failed' end;
 update private.team_jobs set status='failed',lease_token=null,lease_expires_at=null,last_error_code=code,last_error_message='Team processing failed',
 attempts=case when p_retryable then attempts else 3 end,available_at=now()+interval '30 seconds' where id=j.id;
 if j.kind='team_ai_report' then update public.team_ai_reports set status='failed',error_code=code where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=coalesce(j.pipeline_version,'TEAM-RU-1') and status<>'completed'; end if;
end; $$;
create or replace function public.read_team_results(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; snap jsonb; result jsonb; evidence jsonb;
begin
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then return jsonb_build_object('status','threshold','completed_count',s.completed_count); end if;
 select snapshot into snap from private.team_scoring_snapshots where team_diagnostic_id=p_team_id;
 select to_jsonb(r) into result from public.team_results r where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint;
 if result is not null and (select count(*) from jsonb_array_elements(snap->'questions') q where q->>'answer_type'='scale_0_4')=80
 and (select count(*) from jsonb_array_elements(snap->'blocks') b where (b->>'weight')::numeric>0)=8 then evidence:=private.team_numeric_evidence_v2(p_team_id);end if;
 return jsonb_build_object('status',case when result is null then 'pending' else 'ready' end,'completed_count',s.completed_count,'fingerprint',s.fingerprint,'overall',result,
 'maturity',(select m->>'label' from jsonb_array_elements(snap->'maturity') m where m->>'id'=result->>'maturity_level_id'),
 'blocks',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('title',b->>'title','position',(b->>'position')::integer) order by (b->>'position')::integer,r.block_id),'[]')
 from public.team_block_results r join jsonb_array_elements(snap->'blocks') b on b->>'id'=r.block_id::text where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint),
 'questions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('prompt',q->>'prompt','position',(sq->>'position')::integer,'block_position',(b->>'position')::integer,'reverse_score',(sq->>'reverse_score')::boolean,'distribution',(select e->'distribution' from jsonb_array_elements(evidence->'questions') e where e->>'_question_id'=r.question_id::text)) order by (b->>'position')::integer,(sq->>'position')::integer,r.question_id),'[]')
 from public.team_question_statistics r join private.team_questionnaires tq on tq.team_diagnostic_id=r.team_diagnostic_id
 join jsonb_array_elements(tq.questions) q on q->>'id'=r.question_id::text join jsonb_array_elements(snap->'questions') sq on sq->>'id'=r.question_id::text
 join jsonb_array_elements(snap->'blocks') b on b->>'id'=sq->>'block_id' where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint),
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)-'company_context_snapshot' order by r.version desc),'[]') from public.team_ai_reports r where r.team_diagnostic_id=p_team_id),
 'aggregate_error',(select last_error_code from private.team_jobs where team_diagnostic_id=p_team_id and kind='team_aggregate' and source_fingerprint=s.fingerprint and status='failed'));
end; $$;
create or replace function private.validate_team_output(p_team uuid,p_output jsonb) returns void language plpgsql stable security definer set search_path='' as $$
declare t text; raw text; x record; i integer;
begin
 select string_agg(v#>>'{}',E'\n') into t from jsonb_path_query(p_output,'$.** ? (@.type() == "string")') v;
 t:=lower(coalesce(t,''));
 if t ~* '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+?[0-9][0-9 ()\-]{7,}[0-9]|https?://|www\.' then raise exception 'team_privacy_rejected'; end if;
 for x in select p.display_name,p.email,r.user_id,p.id from public.team_participants p left join private.team_responses r on r.participant_id=p.id where p.team_diagnostic_id=p_team loop
  if position(lower(x.email) in t)>0 or position(lower(x.display_name) in t)>0 or position(x.id::text in t)>0 or position(x.user_id::text in t)>0 then raise exception 'team_privacy_rejected'; end if;
 end loop;
 -- Reject any verbatim 32-character fragment of any private open answer (including revoked sources).
 for raw in select lower(e.value#>>'{}') from private.team_responses r join public.team_participants p on p.id=r.participant_id
 cross join lateral jsonb_each(r.answers) e join private.team_questionnaires tq on tq.team_diagnostic_id=p.team_diagnostic_id
 where p.team_diagnostic_id=p_team and jsonb_typeof(e.value)='string' and exists(select 1 from jsonb_array_elements(tq.questions) q where q->>'id'=e.key and q->>'answer_type'='text') loop
  for i in 1..greatest(0,length(raw)-31) loop if position(substr(raw,i,32) in t)>0 then raise exception 'team_privacy_rejected'; end if; end loop;
 end loop;
 if t ~* 'ignore[[:space:]]+previous[[:space:]]+instructions|system[[:space:]]+prompt|developer[[:space:]]+message|игнорируй[[:space:]]+предыдущ' then raise exception 'team_privacy_rejected';end if;
 if t ~* 'респондент[[:space:]]*[0-9]|участник[[:space:]]*[0-9]|respondent[[:space:]]*[0-9]' then raise exception 'team_privacy_rejected'; end if;
end; $$;

revoke all on function private.prepare_team_report_job_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function private.team_numeric_evidence_v2(uuid) from public,anon,authenticated;
revoke all on function private.validate_team_synthesis_v2(uuid,jsonb,integer) from public,anon,authenticated;
revoke all on function private.validate_team_report_v2(jsonb,integer) from public,anon,authenticated;
revoke all on function public.claim_team_jobs_v2(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_team_jobs_v2(integer,integer) to service_role;
-- Existing public RPCs retain their reviewed grants via CREATE OR REPLACE.
commit;
