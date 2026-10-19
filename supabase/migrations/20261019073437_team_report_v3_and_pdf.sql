-- V2.2C.3. One additive forward migration; historical report/synthesis rows remain immutable.
begin;
alter table public.team_ai_reports add column provider_mode text check(provider_mode in ('mock','openai'));
alter table public.team_ai_reports add column pdf_snapshot jsonb;
alter table private.team_jobs add column provider_mode text check(provider_mode in ('mock','openai'));
alter table private.team_jobs drop constraint team_pipeline_valid;
alter table private.team_jobs add constraint team_pipeline_valid check(
 (kind='team_aggregate' and (pipeline_version is null or pipeline_version='AGG-V1')) or
 (kind='team_ai_report' and (pipeline_version is null or pipeline_version in ('TEAM-RU-1','TEAM-RU-2','TEAM-RU-3'))));
alter table public.team_ai_reports add constraint team_v3_provider_required check(prompt_version<>'TEAM-RU-3' or provider_mode is not null);
alter table private.team_jobs add constraint team_v3_job_provider_required check(pipeline_version is distinct from 'TEAM-RU-3' or provider_mode is not null);
alter table public.team_ai_reports drop constraint team_report_pipeline_unique;
create unique index team_report_provider_unique on public.team_ai_reports(team_diagnostic_id,source_fingerprint,prompt_version,(coalesce(provider_mode,'legacy')));
drop index private.team_job_pipeline_unique;
create unique index team_job_pipeline_unique on private.team_jobs(kind,team_diagnostic_id,source_fingerprint,(coalesce(pipeline_version,case when kind='team_aggregate' then 'AGG-V1' else 'TEAM-RU-1' end)),(coalesce(provider_mode,'legacy')));
alter table public.team_ai_reports add constraint team_report_version_identity unique(id,version);


create function private.prepare_team_report_job_before_v3(p_job_id uuid,p_lease_token uuid) returns jsonb
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

create function private.store_team_synthesis_before_v3(p_job_id uuid,p_lease_token uuid,p_summary jsonb,p_provider text,p_model text) returns text
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

create function private.publish_team_report_before_v3(p_job_id uuid,p_lease_token uuid,p_content jsonb,p_model text) returns text
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

create function private.fail_team_job_before_v3(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; code text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 code:=case when p_error_code in('team_privacy_rejected','team_schema_rejected','team_numeric_integrity','team_provider_retryable','team_aggregate_pending') then p_error_code else 'team_processing_failed' end;
 update private.team_jobs set status='failed',lease_token=null,lease_expires_at=null,last_error_code=code,last_error_message='Team processing failed',
 attempts=case when p_retryable then attempts else 3 end,available_at=now()+interval '30 seconds' where id=j.id;
 if j.kind='team_ai_report' then update public.team_ai_reports set status='failed',error_code=code where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=coalesce(j.pipeline_version,'TEAM-RU-1') and status<>'completed'; end if;
end; $$;

create or replace function public.claim_team_jobs_v2(p_limit integer default 1,p_lease_seconds integer default 300) returns setof private.team_jobs
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'team_worker_only'; end if;
 return query with candidates as (
 select id from private.team_jobs where pipeline_version is distinct from 'TEAM-RU-3' and attempts<3 and available_at<=now() and
 (status in('queued','failed') or (status='running' and lease_expires_at<=now())) order by created_at,id for update skip locked limit least(greatest(p_limit,1),2)
 ) update private.team_jobs j set status='running',attempts=j.attempts+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),600)),started_at=now()
 from candidates c where j.id=c.id returning j.*;
end; $$;

create function public.claim_team_jobs_v3(p_limit integer default 1,p_lease_seconds integer default 300) returns setof private.team_jobs
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

create or replace function public.request_team_report_v3(p_team_id uuid,p_provider text default 'mock') returns uuid language plpgsql security definer set search_path='' as $$
declare s record; rid uuid; ctx jsonb;
begin
 if p_provider not in ('mock','openai') then raise exception 'team_invalid_input';end if;
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then raise exception 'team_threshold'; end if;
 if not exists(select 1 from public.team_results where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint) then perform private.enqueue_team_aggregate(p_team_id);return null;end if;
 select id into rid from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint and prompt_version='TEAM-RU-3' and provider_mode=p_provider;
 if rid is null then
  -- A same-source V1 snapshot remains the authority if one already exists.
  select company_context_snapshot into ctx from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint order by version desc limit 1;
  if ctx is null then
   select jsonb_build_object('company_name',c.name,'industry',c.industry_key,'country',c.country,'products',c.products,'customers',c.customer_segments,
    'sales_channels',c.sales_channels,'employees_count',c.employee_count,'annual_revenue',c.annual_revenue_key,'company_age_years',c.company_age_years,
    'management_levels',c.management_levels,'key_problems',c.key_problems,'main_goals',c.main_goals) into ctx
   from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id where d.id=p_team_id;
  end if;
  insert into public.team_ai_reports(team_diagnostic_id,version,source_fingerprint,completed_participant_count,company_context_snapshot,prompt_version,provider_mode,pdf_snapshot)
  values(p_team_id,(select coalesce(max(version),0)+1 from public.team_ai_reports where team_diagnostic_id=p_team_id),s.fingerprint,s.completed_count,ctx,'TEAM-RU-3',p_provider,(select jsonb_build_object('team_title',d.title,'overall',e->'overall','blocks',e->'blocks') from public.team_diagnostics d cross join lateral (select private.team_numeric_evidence_v2(p_team_id) e) x where d.id=p_team_id)) returning id into rid;
 end if;
 insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint,pipeline_version,provider_mode) values('team_ai_report',p_team_id,s.fingerprint,'TEAM-RU-3',p_provider) on conflict do nothing;
 update private.team_jobs set status='queued',available_at=now(),attempts=0,last_error_code=null,last_error_message=null
 where team_diagnostic_id=p_team_id and kind='team_ai_report' and source_fingerprint=s.fingerprint and pipeline_version='TEAM-RU-3' and provider_mode=p_provider and status='failed';
 update public.team_ai_reports set status='queued',error_code=null where id=rid and status='failed';
 return rid;
end; $$;

alter table private.team_qualitative_syntheses drop constraint team_qualitative_syntheses_pkey;

create unique index team_synthesis_provider_unique on private.team_qualitative_syntheses(team_diagnostic_id,source_fingerprint,prompt_version,provider);

create or replace function public.prepare_team_report_job(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; rpt public.team_ai_reports; evidence jsonb; groups jsonb; input jsonb; ctx jsonb;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if j.pipeline_version is distinct from 'TEAM-RU-3' then return private.prepare_team_report_job_before_v3(p_job_id,p_lease_token);end if;
 if not private.team_job_current(j) then return jsonb_build_object('status','superseded');end if;
 select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-RU-3' and provider_mode=j.provider_mode;
 if rpt.status='completed' then
  update private.team_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null where id=j.id;
  return jsonb_build_object('status','completed','pipeline_version','TEAM-RU-3');
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
 return jsonb_build_object('status','generating','pipeline_version','TEAM-RU-3','provider_mode',j.provider_mode,'synthesis_version','TEAM-SYNTHESIS-RU-3',
  'report_input',input,'qualitative_input',jsonb_build_object('company_context',ctx,'block_aggregates',evidence->'blocks','groups',groups),
  'synthesis',(select structured_summary from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-SYNTHESIS-RU-3' and provider=j.provider_mode));
end; $$;

create or replace function public.store_team_synthesis(p_job_id uuid,p_lease_token uuid,p_summary jsonb,p_provider text,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;n integer;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.pipeline_version is distinct from 'TEAM-RU-3' then return private.store_team_synthesis_before_v3(p_job_id,p_lease_token,p_summary,p_provider,p_model);end if;
 if j.kind<>'team_ai_report' or p_provider is distinct from j.provider_mode then raise exception 'team_provider_mismatch';end if;
 if not private.team_job_current(j) then return 'superseded';end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 perform private.validate_team_synthesis_v2(j.team_diagnostic_id,p_summary,n);
 if exists(select 1 from private.team_questionnaires tq cross join jsonb_array_elements(tq.questions) q cross join private.team_completed(j.team_diagnostic_id) c
   where tq.team_diagnostic_id=j.team_diagnostic_id and q->>'answer_type'='text' and nullif(btrim(c.answers->>(q->>'id')),'') is not null group by q having count(*)>=3)
 and not exists(select 1 from jsonb_each(p_summary) e cross join lateral jsonb_array_elements(e.value) x where e.key in ('themes','strengths','problem_patterns','growth_constraints','risks','opportunities','management_implications') and length(case when jsonb_typeof(x)='string' then x#>>'{}' else x->>'summary' end)>=24) then raise exception 'team_qualitative_insufficient';end if;
 perform private.validate_team_output(j.team_diagnostic_id,p_summary);
 insert into private.team_qualitative_syntheses(team_diagnostic_id,source_fingerprint,completed_participant_count,structured_summary,provider,model,prompt_version)
 values(j.team_diagnostic_id,j.source_fingerprint,n,p_summary,p_provider,p_model,'TEAM-SYNTHESIS-RU-3') on conflict do nothing;
 return 'stored';
end; $$;

create or replace function public.publish_team_report(p_job_id uuid,p_lease_token uuid,p_content jsonb,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;n integer;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.pipeline_version is distinct from 'TEAM-RU-3' then return private.publish_team_report_before_v3(p_job_id,p_lease_token,p_content,p_model);end if;
 if j.kind<>'team_ai_report' or (p_model like 'team-mock-%') is distinct from (j.provider_mode='mock') then raise exception 'team_provider_mismatch';end if;
 if not private.team_job_current(j) then return 'superseded';end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 perform private.validate_team_report_v2(p_content,n);
 if not exists(select 1 from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-SYNTHESIS-RU-3' and provider=j.provider_mode) then raise exception 'team_synthesis_missing';end if;
 perform private.validate_team_output(j.team_diagnostic_id,p_content);
 update public.team_ai_reports set status='completed',structured_content=p_content,model=p_model,completed_at=now(),error_code=null
 where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version='TEAM-RU-3' and provider_mode=j.provider_mode and status<>'completed';
 update private.team_jobs set status='completed',lease_token=null,lease_expires_at=null,completed_at=now(),last_error_code=null,last_error_message=null where id=j.id;
 return 'completed';
end; $$;

create or replace function public.fail_team_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; code text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.pipeline_version is distinct from 'TEAM-RU-3' then perform private.fail_team_job_before_v3(p_job_id,p_lease_token,p_error_code,p_retryable);return;end if;
 code:=case when p_error_code in('team_privacy_rejected','team_schema_rejected','team_numeric_integrity','team_provider_retryable','team_aggregate_pending','team_qualitative_insufficient','team_quality_rejected','team_provider_mismatch') then p_error_code else 'team_processing_failed' end;
 update private.team_jobs set status='failed',lease_token=null,lease_expires_at=null,last_error_code=code,last_error_message='Team processing failed',
 attempts=case when p_retryable then attempts else 3 end,available_at=now()+interval '30 seconds' where id=j.id;
 if j.kind='team_ai_report' then update public.team_ai_reports set status='failed',error_code=code where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and prompt_version=coalesce(j.pipeline_version,'TEAM-RU-1') and provider_mode=j.provider_mode and status<>'completed'; end if;
end; $$;

create or replace function public.get_team_synthesis_privacy_corpus(p_job_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; result jsonb;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' or coalesce(j.pipeline_version,'') not in ('TEAM-RU-2','TEAM-RU-3')
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

-- Dedicated Team artifact identity. Never overload individual report_artifacts.
create table public.team_report_artifacts(
 id uuid primary key default gen_random_uuid(),team_report_id uuid not null,team_report_version integer not null,
 format text not null default 'pdf' check(format='pdf'),template_version text not null,
 status text not null check(status in ('ready','failed')),storage_path text,content_base64 text,checksum text,
 generated_at timestamptz not null default now(),
 foreign key(team_report_id,team_report_version) references public.team_ai_reports(id,version) on delete restrict,
 unique(team_report_id,format,template_version),
 check(status<>'ready' or (content_base64 is not null and length(content_base64)>0 and checksum ~ '^[0-9a-f]{64}$' and storage_path is not null))
);
alter table public.team_report_artifacts enable row level security;
create policy team_artifact_owner_read on public.team_report_artifacts for select to authenticated using (
 exists(select 1 from public.team_ai_reports r where r.id=team_report_id));
revoke all on public.team_report_artifacts from public,anon,authenticated;
grant select on public.team_report_artifacts to authenticated;
grant select,insert on public.team_report_artifacts to service_role;
create function private.team_artifact_immutable() returns trigger language plpgsql set search_path='' as $$
begin if tg_op='DELETE' or old.status='ready' then raise exception 'team_artifact_immutable';end if;return new;end; $$;
create trigger team_artifact_immutable before update or delete on public.team_report_artifacts for each row execute function private.team_artifact_immutable();
create function public.read_team_pdf_source(p_report_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.team_ai_reports; d public.team_diagnostics;s jsonb;result jsonb;
begin
 select * into r from public.team_ai_reports where id=p_report_id;
 if r.id is null or not private.team_owner(r.team_diagnostic_id) then raise exception 'team_not_found';end if;
 if r.status<>'completed' or r.prompt_version not in ('TEAM-RU-2','TEAM-RU-3') then raise exception 'team_pdf_not_ready';end if;
 select * into strict d from public.team_diagnostics where id=r.team_diagnostic_id;
 s:=r.pdf_snapshot;
 if s is null then
  if r.source_fingerprint is distinct from (select fingerprint from private.team_source(d.id)) then raise exception 'team_pdf_not_ready';end if;
  select jsonb_build_object('team_title',d.title,'overall',e->'overall','blocks',e->'blocks') into s from (select private.team_numeric_evidence_v2(d.id) e) x;
 end if;
 result:=jsonb_build_object('report_id',r.id,'version',r.version,'pipeline',r.prompt_version,'model',r.model,'completed_at',r.completed_at,
  'company_name',r.company_context_snapshot->>'company_name','team_title',s->>'team_title','participant_count',r.completed_participant_count,'overall',s->'overall','blocks',s->'blocks','content',r.structured_content);
 -- Cover metadata also passes the unchanged confidential-corpus DB validator.
 perform private.validate_team_output(d.id,result-'report_id'-'completed_at');
 return result;
end; $$;
revoke all on function public.read_team_pdf_source(uuid) from public,anon;
grant execute on function public.read_team_pdf_source(uuid) to authenticated;
revoke all on function public.request_team_report_v3(uuid,text) from public,anon;
grant execute on function public.request_team_report_v3(uuid,text) to authenticated;
revoke all on function public.claim_team_jobs_v3(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_team_jobs_v3(integer,integer) to service_role;


revoke all on function private.prepare_team_report_job_before_v3(uuid,uuid) from public,anon,authenticated;

revoke all on function private.store_team_synthesis_before_v3(uuid,uuid,jsonb,text,text) from public,anon,authenticated;

revoke all on function private.publish_team_report_before_v3(uuid,uuid,jsonb,text) from public,anon,authenticated;

revoke all on function private.fail_team_job_before_v3(uuid,uuid,text,boolean) from public,anon,authenticated;

revoke all on function private.team_artifact_immutable() from public,anon,authenticated;
commit;
