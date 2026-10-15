-- V2.2B. Additive, transactional. No individual tables or methodology mutations.
begin;
create table private.team_scoring_snapshots (
 team_diagnostic_id uuid primary key references public.team_diagnostics(id) on delete restrict,
 version_id uuid not null references public.diagnostic_versions(id),
 snapshot jsonb not null, snapshot_hash text not null, created_at timestamptz not null default now()
);
create function private.team_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'team_immutable'; end; $$;
create trigger team_scoring_immutable before update or delete on private.team_scoring_snapshots for each row execute function private.team_immutable();
create function private.team_snapshot(p_team uuid) returns void language plpgsql security definer set search_path='' as $$
declare v uuid; s jsonb; policy public.scoring_policies; qs jsonb; bs jsonb; ms jsonb;
begin
 select version_id into strict v from public.team_diagnostics where id=p_team;
 select * into strict policy from public.scoring_policies where version_id=v;
 -- The deployed individual engine is weighted scale 0..4 / weighted block mean.
 -- Unsupported future/nonlinear policies fail closed instead of silently changing semantics.
 if policy.engine_key<>'pending_stage_5' or policy.engine_version<>'1' or policy.schema_version<>'1'
    or policy.configuration<>'{}'::jsonb or nullif(policy.policy_hash,'') is null then raise exception 'team_scoring_policy_unsupported'; end if;
 select jsonb_agg(jsonb_build_object('id',q.id,'block_id',q.block_id,'position',q.position,'weight',q.weight,
  'reverse_score',q.reverse_score,'answer_type',q.answer_type,'required',q.is_required) order by b.position,q.position,q.id)
 into qs from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v and q.is_active and b.is_active;
 select jsonb_agg(jsonb_build_object('id',b.id,'weight',b.weight,'position',b.position,'title',bt.title) order by b.position,b.id)
 into bs from public.diagnostic_blocks b join public.diagnostic_block_translations bt on bt.block_id=b.id and bt.locale='ru' where b.version_id=v and b.is_active;
 select jsonb_agg(jsonb_build_object('id',m.id,'key',m.key,'position',m.position,'config',m.classification_config,'label',mt.label) order by m.position)
 into ms from public.maturity_levels m join public.maturity_level_translations mt on mt.maturity_level_id=m.id and mt.locale='ru' where m.version_id=v;
 if qs is null or bs is null or jsonb_array_length(ms) is distinct from 5
 or not exists(select 1 from jsonb_array_elements(bs) b where (b->>'weight')::numeric>0)
 or exists(select 1 from jsonb_array_elements(bs) b where (b->>'weight')::numeric>0 and not exists
  (select 1 from jsonb_array_elements(qs) q where q->>'block_id'=b->>'id' and q->>'answer_type'='scale_0_4' and (q->>'weight')::numeric>0))
 or exists(select 1 from jsonb_array_elements(qs) q where not exists(select 1 from private.team_questionnaires tq,jsonb_array_elements(tq.questions) item where tq.team_diagnostic_id=p_team and item->>'id'=q->>'id' and item->>'answer_type'=q->>'answer_type'))
 or (select count(*) from jsonb_array_elements(qs))<>(select jsonb_array_length(questions) from private.team_questionnaires where team_diagnostic_id=p_team)
 then raise exception 'team_methodology_inconsistent'; end if;
 -- Verify the pinned maturity config matches the individual engine's five cutoffs.
 if exists(select 1 from jsonb_array_elements(ms) m where m->'config' is distinct from
  case m->>'key' when 'critical' then '{"min":0,"max":30}'::jsonb when 'weak' then '{"min":30,"max":50}'::jsonb
  when 'developing' then '{"min":50,"max":70}'::jsonb when 'mature' then '{"min":70,"max":85}'::jsonb
  when 'strong' then '{"min":85,"max":101}'::jsonb else null end) then raise exception 'team_maturity_unsupported'; end if;
 s:=jsonb_build_object('algorithm','individual-weighted-scale-v1','policy',to_jsonb(policy)-'id','questions',qs,'blocks',bs,'maturity',ms);
 insert into private.team_scoring_snapshots values(p_team,v,s,encode(sha256(convert_to(s::text,'UTF8')),'hex'),now());
end; $$;
-- Only this additive backfill touches existing teams. Questionnaire/response bytes stay unchanged.
select private.team_snapshot(id) from public.team_diagnostics order by id;

create table public.team_results (
 team_diagnostic_id uuid primary key references public.team_diagnostics(id), version_id uuid not null references public.diagnostic_versions(id),
 completed_participant_count integer not null check(completed_participant_count>=3), overall_mean numeric not null,overall_stddev numeric not null,
 overall_min numeric not null,overall_max numeric not null,maturity_level_id uuid references public.maturity_levels(id),
 source_fingerprint text not null,computed_at timestamptz not null default now()
);
create table public.team_block_results (
 team_diagnostic_id uuid not null references public.team_diagnostics(id),block_id uuid not null references public.diagnostic_blocks(id),
 participant_count integer not null check(participant_count>=3),mean_score numeric not null,stddev_score numeric not null,min_score numeric not null,max_score numeric not null,
 source_fingerprint text not null, primary key(team_diagnostic_id,block_id)
);
create table public.team_question_statistics (
 team_diagnostic_id uuid not null references public.team_diagnostics(id),question_id uuid not null references public.questions(id),
 participant_count integer not null check(participant_count>=3),mean_score numeric not null,stddev_score numeric not null,min_score numeric not null,max_score numeric not null,
 source_fingerprint text not null,primary key(team_diagnostic_id,question_id)
);
create table public.team_ai_reports (
 id uuid primary key default gen_random_uuid(),team_diagnostic_id uuid not null references public.team_diagnostics(id),version integer not null check(version>0),
 source_fingerprint text not null,completed_participant_count integer not null check(completed_participant_count>=3),
 status text not null default 'queued' check(status in('queued','generating','completed','failed','superseded')),
 structured_content jsonb,company_context_snapshot jsonb not null,model text,prompt_version text not null default 'TEAM-RU-1',
 created_at timestamptz not null default now(),completed_at timestamptz,error_code text,
 unique(team_diagnostic_id,version),unique(team_diagnostic_id,source_fingerprint)
);
create function private.team_report_immutable() returns trigger language plpgsql set search_path='' as $$
begin if tg_op='DELETE' or old.status='completed' then raise exception 'team_report_immutable'; end if; return new; end; $$;
create trigger team_report_immutable before update or delete on public.team_ai_reports for each row execute function private.team_report_immutable();
create table private.team_qualitative_syntheses (
 team_diagnostic_id uuid not null references public.team_diagnostics(id),source_fingerprint text not null,
 completed_participant_count integer not null check(completed_participant_count>=3),structured_summary jsonb not null,
 provider text not null,model text not null,prompt_version text not null,created_at timestamptz not null default now(),
 primary key(team_diagnostic_id,source_fingerprint)
);
create trigger team_synthesis_immutable before update or delete on private.team_qualitative_syntheses for each row execute function private.team_immutable();
create table private.team_jobs (
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in('team_aggregate','team_ai_report')),
 team_diagnostic_id uuid not null references public.team_diagnostics(id),source_fingerprint text not null,
 status text not null default 'queued' check(status in('queued','running','completed','failed','superseded')),
 attempts integer not null default 0,lease_token uuid,lease_expires_at timestamptz,available_at timestamptz not null default now(),
 last_error_code text,last_error_message text,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz,
 unique(kind,team_diagnostic_id,source_fingerprint)
);
create index team_jobs_claim_idx on private.team_jobs(status,available_at,created_at);

-- Never grant this source set to a client. Its identity/revisions remain private.
create function private.team_completed(p_team uuid) returns table(participant_id uuid,revision integer,completed_at timestamptz,answers jsonb)
language sql stable security definer set search_path='' as $$
 select p.id,r.revision,r.completed_at,r.answers from public.team_participants p
 join private.team_responses r on r.participant_id=p.id
 join auth.users u on u.id=r.user_id and lower(u.email)=p.email and u.email_confirmed_at is not null
 join public.team_diagnostics d on d.id=p.team_diagnostic_id
 join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id and a.status='active'
 where d.id=p_team and p.status='completed' and p.revoked_at is null and r.completed_at is not null
$$;
create function private.team_source(p_team uuid) returns table(completed_count integer,fingerprint text)
language sql stable security definer set search_path='' as $$
 select count(x.participant_id)::integer,encode(sha256(convert_to(jsonb_build_object('team',d.id,'version',d.version_id,'snapshot',s.snapshot_hash,
 'responses',coalesce(jsonb_agg(jsonb_build_array(x.participant_id,x.revision,extract(epoch from x.completed_at),true) order by x.participant_id) filter(where x.participant_id is not null),'[]'::jsonb))::text,'UTF8')),'hex')
 from public.team_diagnostics d join private.team_scoring_snapshots s on s.team_diagnostic_id=d.id
 left join private.team_completed(p_team) x on true where d.id=p_team group by d.id,s.snapshot_hash
$$;
create function private.team_owner(p_team uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_verified_session() and exists(select 1 from public.team_diagnostics d where d.id=p_team and private.can_access_company(d.company_id))
$$;
-- RLS does not use administrator or invitation shortcuts. Current aggregates require exact current source.
create function private.team_result_visible(p_team uuid,p_source text,p_historical boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.team_owner(p_team) then return false; end if;
 return exists(select 1 from private.team_source(p_team) s where s.completed_count>=3 and (p_historical or s.fingerprint=p_source));
end; $$;
alter table private.team_scoring_snapshots enable row level security;
revoke all on private.team_scoring_snapshots from public,anon,authenticated;
alter table private.team_qualitative_syntheses enable row level security;
revoke all on private.team_qualitative_syntheses from public,anon,authenticated;
alter table private.team_jobs enable row level security;
revoke all on private.team_jobs from public,anon,authenticated;
alter table public.team_results enable row level security;
revoke all on public.team_results from public,anon,authenticated;
grant select on public.team_results to authenticated;
create policy team_results_owner_read on public.team_results for select to authenticated using(private.team_result_visible(team_diagnostic_id,source_fingerprint,false));
alter table public.team_block_results enable row level security;
revoke all on public.team_block_results from public,anon,authenticated;
grant select on public.team_block_results to authenticated;
create policy team_block_results_owner_read on public.team_block_results for select to authenticated using(private.team_result_visible(team_diagnostic_id,source_fingerprint,false));
alter table public.team_question_statistics enable row level security;
revoke all on public.team_question_statistics from public,anon,authenticated;
grant select on public.team_question_statistics to authenticated;
create policy team_question_statistics_owner_read on public.team_question_statistics for select to authenticated using(private.team_result_visible(team_diagnostic_id,source_fingerprint,false));
alter table public.team_ai_reports enable row level security;
revoke all on public.team_ai_reports from public,anon,authenticated;
grant select on public.team_ai_reports to authenticated;
create policy team_ai_reports_owner_read on public.team_ai_reports for select to authenticated using(private.team_result_visible(team_diagnostic_id,source_fingerprint,true));

create function private.enqueue_team_aggregate(p_team uuid) returns void language plpgsql security definer set search_path='' as $$
declare s record;
begin
 select * into s from private.team_source(p_team);
 if s.completed_count>=3 then insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint)
 values('team_aggregate',p_team,s.fingerprint) on conflict(kind,team_diagnostic_id,source_fingerprint) do nothing; end if;
end; $$;
create function private.team_response_immutable() returns trigger language plpgsql set search_path='' as $$
begin if old.completed_at is not null then raise exception 'team_response_completed'; end if; return new; end; $$;
create trigger team_response_completed_immutable before update or delete on private.team_responses for each row execute function private.team_response_immutable();
create or replace function public.create_team_diagnostic(p_company_id uuid,p_title text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid; t uuid; questionnaire jsonb;
begin
 if not private.can_access_company(p_company_id) then raise exception 'team_not_found'; end if;
 if char_length(btrim(coalesce(p_title,''))) not between 2 and 200 then raise exception 'team_invalid_input'; end if;
 select dv.id into v from public.diagnostic_versions dv join public.diagnostic_definitions dd on dd.id=dv.definition_id
 where dd.key='manageability' and dv.status='published' order by dv.version_number desc limit 1;
 if v is null then raise exception 'team_methodology_missing'; end if;
 select jsonb_agg(jsonb_build_object('id',q.id,'block_id',b.id,'block_title',bt.title,'prompt',qt.prompt,
  'help',qt.help_text,'answer_type',q.answer_type,'required',q.is_required,
  'options',coalesce((select jsonb_agg(jsonb_build_object('value',o.score_value,'label',ot.label) order by o.position)
    from public.question_options o join public.question_option_translations ot on ot.option_id=o.id and ot.locale='ru' where o.question_id=q.id),'[]'::jsonb)) order by b.position,q.position)
 into questionnaire from public.questions q join public.diagnostic_blocks b on b.id=q.block_id
 join public.diagnostic_block_translations bt on bt.block_id=b.id and bt.locale='ru'
 join public.question_translations qt on qt.question_id=q.id and qt.locale='ru'
 where q.version_id=v and q.is_active and b.is_active;
 if questionnaire is null or jsonb_array_length(questionnaire)=0 then raise exception 'team_methodology_missing'; end if;
 insert into public.team_diagnostics(company_id,version_id,created_by_user_id,title) values(p_company_id,v,auth.uid(),btrim(p_title)) returning id into t;
 insert into private.team_questionnaires(team_diagnostic_id,questions) values(t,questionnaire);
 perform private.team_snapshot(t);
 -- Owner is deliberately not auto-enrolled.
 return t;
end; $$;
create or replace function public.save_team_response(p_participant_id uuid,p_expected_revision integer,p_answers jsonb,p_submit boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.team_participants; r private.team_responses; qs jsonb; q jsonb; k text; val jsonb; next_revision integer;
begin
 perform 1 from public.team_diagnostics where id=(select team_diagnostic_id from public.team_participants where id=p_participant_id) for update;
 perform 1 from public.team_participants where id=p_participant_id for update;
 p:=private.require_team_response(p_participant_id);
 if not exists(select 1 from public.team_diagnostics where id=p.team_diagnostic_id and status='open') then raise exception 'team_closed'; end if;
 select * into r from private.team_responses where participant_id=p.id for update;
 if r.revision is distinct from p_expected_revision then raise exception 'team_revision_conflict'; end if;
 if r.completed_at is not null then raise exception 'team_response_completed'; end if;
 if p_submit is null or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>1000000 then raise exception 'team_invalid_answers'; end if;
 select questions into qs from private.team_questionnaires where team_diagnostic_id=p.team_diagnostic_id;
 for k,val in select * from jsonb_each(p_answers) loop
  select item into q from jsonb_array_elements(qs) item where item->>'id'=k;
  if q is null then raise exception 'team_invalid_answers'; end if;
  if val<>'null'::jsonb then
   if q->>'answer_type'='scale_0_4' then
    if jsonb_typeof(val)<>'number' or not exists(select 1 from jsonb_array_elements(q->'options') o where o->'value'=val) then raise exception 'team_invalid_answers'; end if;
   elsif jsonb_typeof(val)<>'string' or char_length(val#>>'{}')>10000 then raise exception 'team_invalid_answers'; end if;
  end if;
 end loop;
 if p_submit and exists(select 1 from jsonb_array_elements(qs) item where (item->>'required')::boolean and
   (not(p_answers ? (item->>'id')) or p_answers->(item->>'id')='null'::jsonb or p_answers->(item->>'id')='""'::jsonb)) then raise exception 'team_required_answers_missing'; end if;
 next_revision:=r.revision+1;
 update private.team_responses set answers=p_answers,revision=next_revision,completed_at=case when p_submit then now() end where participant_id=p.id;
 update public.team_participants set status=case when p_submit then 'completed' else 'started' end,started_at=coalesce(started_at,now()),completed_at=case when p_submit then now() end where id=p.id;
 -- Queue failure must never undo a valid completion. Owner refresh can recover it.
 if p_submit then begin perform private.enqueue_team_aggregate(p.team_diagnostic_id); exception when others then null; end; end if;
 return jsonb_build_object('revision',next_revision,'status',case when p_submit then 'completed' else 'started' end);
end; $$;
create or replace function public.revoke_team_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 perform 1 from public.team_diagnostics where id=(select team_diagnostic_id from public.team_participants where id=p_participant_id) for update;
 select * into p from public.team_participants where id=p_participant_id for update;
 if p.id is null or not exists(select 1 from public.team_diagnostics d where d.id=p.team_diagnostic_id and private.can_access_company(d.company_id)) then raise exception 'team_not_found'; end if;
 update public.team_participants set revoked_at=coalesce(revoked_at,now()) where id=p.id;
 begin perform private.enqueue_team_aggregate(p.team_diagnostic_id); exception when others then null; end;
end; $$;
create or replace function public.renew_team_invitation(p_participant_id uuid,p_token_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 perform 1 from public.team_diagnostics where id=(select team_diagnostic_id from public.team_participants where id=p_participant_id) for update;
 select * into p from public.team_participants where id=p_participant_id for update;
 if p.id is null or p.revoked_at is not null or not exists(select 1 from public.team_diagnostics d where d.id=p.team_diagnostic_id and d.status='open' and private.can_access_company(d.company_id)) then raise exception 'team_not_found'; end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'team_invalid_input'; end if;
 update private.team_invitations set token_hash=p_token_hash,expires_at=now()+interval '7 days',redeemed_at=null where participant_id=p.id;
 -- Existing participant binding and all answers remain untouched.
end; $$;
create or replace function public.accept_team_invitation(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype; inv private.team_invitations%rowtype; actor uuid:=auth.uid();
begin
 if not private.is_verified_session() then raise exception 'team_invitation_unavailable'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'team_invitation_unavailable'; end if;
 perform 1 from public.team_diagnostics where id=(select tp.team_diagnostic_id from public.team_participants tp join private.team_invitations ti on ti.participant_id=tp.id where ti.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) for update;
 -- Team then participant then response.
 select tp.* into p from public.team_participants tp join private.team_invitations ti on ti.participant_id=tp.id
 where ti.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update of tp;
 if p.id is null or p.revoked_at is not null or not exists(select 1 from auth.users u where u.id=actor and lower(u.email)=p.email and u.email_confirmed_at is not null)
 or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id where d.id=p.team_diagnostic_id and d.status='open' and a.status='active') then raise exception 'team_invitation_unavailable'; end if;
 select * into inv from private.team_invitations where participant_id=p.id;
 if inv.expires_at<=now() then raise exception 'team_invitation_unavailable'; end if;
 if exists(select 1 from private.team_responses where participant_id=p.id and user_id<>actor) then raise exception 'team_invitation_unavailable'; end if;
 insert into private.team_responses(participant_id,user_id) values(p.id,actor) on conflict(participant_id) do nothing;
 update private.team_invitations set redeemed_at=coalesce(redeemed_at,now()) where participant_id=p.id;
 return p.id;
end; $$;
create or replace function private.require_team_response(p_participant_id uuid) returns public.team_participants
language plpgsql stable security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 select * into p from public.team_participants where id=p_participant_id;
 if not private.is_verified_session() or p.id is null or p.revoked_at is not null
 or not exists(select 1 from private.team_responses r join auth.users u on u.id=r.user_id where r.participant_id=p.id and r.user_id=auth.uid() and lower(u.email)=p.email and u.email_confirmed_at is not null)
 or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id where d.id=p.team_diagnostic_id and a.status='active') then raise exception 'team_response_unavailable'; end if;
 return p;
end; $$;

create function public.close_team_diagnostic(p_team_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 update public.team_diagnostics set status='closed' where id=p_team_id and status='open';
 perform private.enqueue_team_aggregate(p_team_id);
end; $$;
create function public.refresh_team_results(p_team_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 perform private.enqueue_team_aggregate(p_team_id);
 update private.team_jobs set status='queued',available_at=now(),attempts=0,last_error_code=null,last_error_message=null
 where team_diagnostic_id=p_team_id and kind='team_aggregate' and status='failed'
 and source_fingerprint=(select fingerprint from private.team_source(p_team_id));
end; $$;
create function public.request_team_report(p_team_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s record; rid uuid; ctx jsonb;
begin
 perform 1 from public.team_diagnostics where id=p_team_id for update;
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then raise exception 'team_threshold'; end if;
 if not exists(select 1 from public.team_results where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint) then
  perform private.enqueue_team_aggregate(p_team_id); return null;
 end if;
 select id into rid from public.team_ai_reports where team_diagnostic_id=p_team_id and source_fingerprint=s.fingerprint;
 if rid is null then
  select jsonb_build_object('company_name',c.name,'industry',c.industry_key,'products',c.products,'customers',c.customer_segments,
   'sales_channels',c.sales_channels,'employees_count',c.employee_count,'annual_revenue',c.annual_revenue_key,'company_age_years',c.company_age_years,
   'management_levels',c.management_levels,'key_problems',c.key_problems,'main_goals',c.main_goals)
  into ctx from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id where d.id=p_team_id;
  insert into public.team_ai_reports(team_diagnostic_id,version,source_fingerprint,completed_participant_count,company_context_snapshot)
  values(p_team_id,(select coalesce(max(version),0)+1 from public.team_ai_reports where team_diagnostic_id=p_team_id),s.fingerprint,s.completed_count,ctx) returning id into rid;
 end if;
 insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint) values('team_ai_report',p_team_id,s.fingerprint) on conflict do nothing;
 update private.team_jobs set status='queued',available_at=now(),attempts=0,last_error_code=null,last_error_message=null
 where team_diagnostic_id=p_team_id and kind='team_ai_report' and source_fingerprint=s.fingerprint and status='failed';
 update public.team_ai_reports set status='queued',error_code=null where id=rid and status='failed';
 return rid;
end; $$;
-- Atomic claims, SKIP LOCKED, bounded attempts; no raw answer payload.
create function public.claim_team_jobs(p_limit integer default 1,p_lease_seconds integer default 300) returns setof private.team_jobs
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
create function private.lock_team_job(p_job uuid,p_lease uuid) returns private.team_jobs
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' and coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'team_worker_only'; end if;
 -- Same team-first lock order as submit/revoke/close/report request.
 perform 1 from public.team_diagnostics where id=(select team_diagnostic_id from private.team_jobs where id=p_job) for update;
 select * into j from private.team_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.lease_token is distinct from p_lease or j.lease_expires_at<=now() then raise exception 'team_lease_lost'; end if;
 return j;
end; $$;
create function private.team_job_current(j private.team_jobs) returns boolean language plpgsql security definer set search_path='' as $$
declare s record;
begin
 select * into s from private.team_source(j.team_diagnostic_id);
 if s.completed_count<3 or s.fingerprint is distinct from j.source_fingerprint then
  update private.team_jobs set status='superseded',lease_token=null,lease_expires_at=null,completed_at=now() where id=j.id;
  update public.team_ai_reports set status='superseded' where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and status<>'completed';
  perform private.enqueue_team_aggregate(j.team_diagnostic_id); return false;
 end if; return true;
end; $$;
create function public.process_team_aggregate(p_job_id uuid,p_lease_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; snap jsonb; n integer; ov record; mid uuid;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_aggregate' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return 'superseded'; end if;
 select snapshot into strict snap from private.team_scoring_snapshots where team_diagnostic_id=j.team_diagnostic_id;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 if exists(select 1 from private.team_completed(j.team_diagnostic_id) r cross join jsonb_array_elements(snap->'questions') q
 where q->>'answer_type'='scale_0_4' and (not(r.answers ? (q->>'id')) or jsonb_typeof(r.answers->(q->>'id'))<>'number'
 or (r.answers->>(q->>'id'))::numeric not between 0 and 4)) then raise exception 'team_numeric_integrity'; end if;
 -- Participant scores exist only in this query, never in a persisted result table.
 delete from public.team_question_statistics where team_diagnostic_id=j.team_diagnostic_id;
 insert into public.team_question_statistics
 select j.team_diagnostic_id,(q->>'id')::uuid,n,avg(v),stddev_pop(v),min(v),max(v),j.source_fingerprint
 from private.team_completed(j.team_diagnostic_id) r cross join jsonb_array_elements(snap->'questions') q
 cross join lateral(select case when (q->>'reverse_score')::boolean then 4-(r.answers->>(q->>'id'))::numeric else (r.answers->>(q->>'id'))::numeric end v) val
 where q->>'answer_type'='scale_0_4' group by q->>'id';
 delete from public.team_block_results where team_diagnostic_id=j.team_diagnostic_id;
 insert into public.team_block_results
 with per_person as (
 select r.participant_id,b->>'id' bid,case when coalesce(sum((q->>'weight')::numeric),0)=0 then 0::numeric else
  sum((case when (q->>'reverse_score')::boolean then 4-(r.answers->>(q->>'id'))::numeric else (r.answers->>(q->>'id'))::numeric end)*(q->>'weight')::numeric)/sum(4*(q->>'weight')::numeric)*100 end score
 from private.team_completed(j.team_diagnostic_id) r cross join jsonb_array_elements(snap->'blocks') b
 left join lateral jsonb_array_elements(snap->'questions') q on q->>'block_id'=b->>'id' and q->>'answer_type'='scale_0_4'
 where (b->>'weight')::numeric>0 group by r.participant_id,b->>'id')
 select j.team_diagnostic_id,bid::uuid,n,avg(score),stddev_pop(score),min(score),max(score),j.source_fingerprint from per_person group by bid;
 -- Weighted overall is evaluated per participant before team statistics (future nonlinear engines must add their own audited evaluator).
 with blocks as (
 select r.participant_id,b->>'id' bid,(b->>'weight')::numeric bw,case when coalesce(sum((q->>'weight')::numeric),0)=0 then 0::numeric else
 sum((case when (q->>'reverse_score')::boolean then 4-(r.answers->>(q->>'id'))::numeric else (r.answers->>(q->>'id'))::numeric end)*(q->>'weight')::numeric)/sum(4*(q->>'weight')::numeric)*100 end score
 from private.team_completed(j.team_diagnostic_id) r cross join jsonb_array_elements(snap->'blocks') b
 left join lateral jsonb_array_elements(snap->'questions') q on q->>'block_id'=b->>'id' and q->>'answer_type'='scale_0_4'
 where (b->>'weight')::numeric>0 group by r.participant_id,b->>'id',b->>'weight'),
 people as(select participant_id,sum(score*bw)/sum(bw) score from blocks group by participant_id)
 select avg(score) mean,stddev_pop(score) sd,min(score) lo,max(score) hi into ov from people;
 select (m->>'id')::uuid into mid from jsonb_array_elements(snap->'maturity') m
 where ov.mean>=(m->'config'->>'min')::numeric and ov.mean<(m->'config'->>'max')::numeric order by (m->>'position')::integer limit 1;
 if mid is null then raise exception 'team_maturity_integrity'; end if;
 insert into public.team_results values(j.team_diagnostic_id,(select version_id from public.team_diagnostics where id=j.team_diagnostic_id),n,ov.mean,ov.sd,ov.lo,ov.hi,mid,j.source_fingerprint,now())
 on conflict(team_diagnostic_id) do update set completed_participant_count=excluded.completed_participant_count,overall_mean=excluded.overall_mean,overall_stddev=excluded.overall_stddev,
 overall_min=excluded.overall_min,overall_max=excluded.overall_max,maturity_level_id=excluded.maturity_level_id,source_fingerprint=excluded.source_fingerprint,computed_at=excluded.computed_at;
 update private.team_jobs set status='completed',completed_at=now(),lease_token=null,lease_expires_at=null,last_error_code=null,last_error_message=null where id=j.id;
 return 'completed';
end; $$;
-- The provider gets per-question shuffled texts, never response/user identity or stable respondent order.
create function private.mask_team_text(p_team uuid,p_text text) returns text language plpgsql stable security definer set search_path='' as $$
declare t text:=coalesce(p_text,''); x record; escaped text;
begin
 for x in select display_name,email from public.team_participants where team_diagnostic_id=p_team loop
  foreach escaped in array array[x.display_name,x.email] loop
   escaped:=regexp_replace(escaped,'([.\[\]\\*+?{}()|^$])','\\\1','g');
   t:=regexp_replace(t,escaped,'[скрыто]','gi');
  end loop;
 end loop;
 t:=regexp_replace(t,'[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}','[email скрыт]','gi');
 t:=regexp_replace(t,'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}','[идентификатор скрыт]','gi');
 t:=regexp_replace(t,'https?://[^[:space:]<>]+|www\.[^[:space:]<>]+','[ссылка скрыта]','gi');
 t:=regexp_replace(t,'\+?[0-9][0-9 ()\-]{7,}[0-9]','[телефон скрыт]','g');
 return t;
end; $$;
create function private.safe_team_json(p_team uuid,p_value jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; k text; v jsonb;
begin
 case jsonb_typeof(p_value)
 when 'string' then return to_jsonb(private.mask_team_text(p_team,p_value#>>'{}'));
 when 'array' then select coalesce(jsonb_agg(private.safe_team_json(p_team,x)),'[]'::jsonb) into result from jsonb_array_elements(p_value) x; return result;
 when 'object' then result:='{}'; for k,v in select * from jsonb_each(p_value) loop result:=result||jsonb_build_object(k,private.safe_team_json(p_team,v)); end loop; return result;
 else return p_value; end case;
end; $$;
-- Run inside the database so neither raw text nor forbidden-name dictionaries reach main report code.
create function private.validate_team_output(p_team uuid,p_output jsonb) returns void language plpgsql stable security definer set search_path='' as $$
declare t text; raw text; x record; i integer;
begin
 select string_agg(v#>>'{}',E'\n') into t from jsonb_path_query(p_output,'$.** ? (@.type() == "string")') v;
 t:=lower(coalesce(t,''));
 if t ~* '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+?[0-9][0-9 ()\-]{7,}[0-9]|https?://' then raise exception 'team_privacy_rejected'; end if;
 for x in select p.display_name,p.email,r.user_id,p.id from public.team_participants p left join private.team_responses r on r.participant_id=p.id where p.team_diagnostic_id=p_team loop
  if position(lower(x.email) in t)>0 or position(lower(x.display_name) in t)>0 or position(x.id::text in t)>0 or position(x.user_id::text in t)>0 then raise exception 'team_privacy_rejected'; end if;
 end loop;
 -- Reject any verbatim 32-character fragment of any private open answer (including revoked sources).
 for raw in select lower(e.value#>>'{}') from private.team_responses r join public.team_participants p on p.id=r.participant_id
 cross join lateral jsonb_each(r.answers) e join private.team_questionnaires tq on tq.team_diagnostic_id=p.team_diagnostic_id
 where p.team_diagnostic_id=p_team and jsonb_typeof(e.value)='string' and exists(select 1 from jsonb_array_elements(tq.questions) q where q->>'id'=e.key and q->>'answer_type'='text') loop
  for i in 1..greatest(0,length(raw)-31) loop if position(substr(raw,i,32) in t)>0 then raise exception 'team_privacy_rejected'; end if; end loop;
 end loop;
 if t ~* 'респондент[[:space:]]*[0-9]|участник[[:space:]]*[0-9]|respondent[[:space:]]*[0-9]' then raise exception 'team_privacy_rejected'; end if;
end; $$;
create function public.prepare_team_report_job(p_job_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; snap jsonb; groups jsonb; input jsonb; rpt public.team_ai_reports;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return jsonb_build_object('status','superseded'); end if;
 select * into strict rpt from public.team_ai_reports where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint;
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
 'synthesis',(select structured_summary from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint));
end; $$;
-- Structural validation here complements strict provider schemas; direct worker RPC cannot bypass privacy.
create function private.validate_team_synthesis(p_summary jsonb,p_count integer) returns void language plpgsql set search_path='' as $$
declare x jsonb; k text;
begin
 if jsonb_typeof(p_summary)<>'object' or (select count(*) from jsonb_object_keys(p_summary))<>5 then raise exception 'team_schema_rejected'; end if;
 foreach k in array array['themes','strengths','risks','alignment_signals','divergence_signals'] loop
  if jsonb_typeof(p_summary->k) is distinct from 'array' or jsonb_array_length(p_summary->k)>20 then raise exception 'team_schema_rejected'; end if;
  for x in select * from jsonb_array_elements(p_summary->k) loop
   if k='themes' then
    if jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>3 or jsonb_typeof(x->'title') is distinct from 'string'
    or jsonb_typeof(x->'summary') is distinct from 'string' or jsonb_typeof(x->'response_count') is distinct from 'number'
    or (x->>'response_count')::numeric<>trunc((x->>'response_count')::numeric) or (x->>'response_count')::integer not between 3 and p_count then raise exception 'team_schema_rejected'; end if;
   elsif jsonb_typeof(x)<>'string' then raise exception 'team_schema_rejected'; end if;
  end loop;
 end loop;
end; $$;
create function public.store_team_synthesis(p_job_id uuid,p_lease_token uuid,p_summary jsonb,p_provider text,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; n integer;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return 'superseded'; end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 perform private.validate_team_synthesis(p_summary,n);
 perform private.validate_team_output(j.team_diagnostic_id,p_summary);
 insert into private.team_qualitative_syntheses values(j.team_diagnostic_id,j.source_fingerprint,n,p_summary,p_provider,p_model,'TEAM-SYNTHESIS-RU-1',now()) on conflict do nothing;
 return 'stored';
end; $$;
create function public.publish_team_report(p_job_id uuid,p_lease_token uuid,p_content jsonb,p_model text) returns text
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; k text; n integer;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 if j.kind<>'team_ai_report' then raise exception 'team_job_kind'; end if;
 if not private.team_job_current(j) then return 'superseded'; end if;
 select completed_count into n from private.team_source(j.team_diagnostic_id);
 if jsonb_typeof(p_content)<>'object' or (select count(*) from jsonb_object_keys(p_content))<>11 or (p_content->>'participant_count')::integer is distinct from n then raise exception 'team_schema_rejected'; end if;
 foreach k in array array['executive_summary','maturity'] loop
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(p_content->>k) not between 1 and 5000 then raise exception 'team_schema_rejected'; end if;
 end loop;
 foreach k in array array['strongest_blocks','weakest_blocks','agreement','disagreement','qualitative_themes','risks','priorities','next_steps'] loop
  if jsonb_typeof(p_content->k) is distinct from 'array' or jsonb_array_length(p_content->k)>20 or exists(select 1 from jsonb_array_elements(p_content->k) x where jsonb_typeof(x)<>'string') then raise exception 'team_schema_rejected'; end if;
 end loop;
 if not exists(select 1 from private.team_qualitative_syntheses where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint) then raise exception 'team_synthesis_missing'; end if;
 perform private.validate_team_output(j.team_diagnostic_id,p_content);
 update public.team_ai_reports set status='completed',structured_content=p_content,model=p_model,completed_at=now(),error_code=null
 where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and status<>'completed';
 update private.team_jobs set status='completed',lease_token=null,lease_expires_at=null,completed_at=now(),last_error_code=null,last_error_message=null where id=j.id;
 return 'completed';
end; $$;
create function public.fail_team_job(p_job_id uuid,p_lease_token uuid,p_error_code text,p_retryable boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare j private.team_jobs; code text;
begin
 j:=private.lock_team_job(p_job_id,p_lease_token);
 code:=case when p_error_code in('team_privacy_rejected','team_schema_rejected','team_numeric_integrity','team_provider_retryable','team_aggregate_pending') then p_error_code else 'team_processing_failed' end;
 update private.team_jobs set status='failed',lease_token=null,lease_expires_at=null,last_error_code=code,last_error_message='Team processing failed',
 attempts=case when p_retryable then attempts else 3 end,available_at=now()+interval '30 seconds' where id=j.id;
 if j.kind='team_ai_report' then update public.team_ai_reports set status='failed',error_code=code where team_diagnostic_id=j.team_diagnostic_id and source_fingerprint=j.source_fingerprint and status<>'completed'; end if;
end; $$;
create function public.read_team_results(p_team_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s record; snap jsonb; result jsonb;
begin
 if not private.team_owner(p_team_id) then raise exception 'team_not_found'; end if;
 select * into s from private.team_source(p_team_id);
 if s.completed_count<3 then return jsonb_build_object('status','threshold','completed_count',s.completed_count); end if;
 select snapshot into snap from private.team_scoring_snapshots where team_diagnostic_id=p_team_id;
 select to_jsonb(r) into result from public.team_results r where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint;
 return jsonb_build_object('status',case when result is null then 'pending' else 'ready' end,'completed_count',s.completed_count,'fingerprint',s.fingerprint,'overall',result,
 'maturity',(select m->>'label' from jsonb_array_elements(snap->'maturity') m where m->>'id'=result->>'maturity_level_id'),
 'blocks',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('title',b->>'title','position',(b->>'position')::integer) order by (b->>'position')::integer,r.block_id),'[]')
 from public.team_block_results r join jsonb_array_elements(snap->'blocks') b on b->>'id'=r.block_id::text where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint),
 'questions',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('prompt',q->>'prompt','position',(sq->>'position')::integer,'block_position',(b->>'position')::integer) order by (b->>'position')::integer,(sq->>'position')::integer,r.question_id),'[]')
 from public.team_question_statistics r join private.team_questionnaires tq on tq.team_diagnostic_id=r.team_diagnostic_id
 join jsonb_array_elements(tq.questions) q on q->>'id'=r.question_id::text join jsonb_array_elements(snap->'questions') sq on sq->>'id'=r.question_id::text
 join jsonb_array_elements(snap->'blocks') b on b->>'id'=sq->>'block_id' where r.team_diagnostic_id=p_team_id and r.source_fingerprint=s.fingerprint),
 'reports',(select coalesce(jsonb_agg(to_jsonb(r)-'company_context_snapshot' order by r.version desc),'[]') from public.team_ai_reports r where r.team_diagnostic_id=p_team_id),
 'aggregate_error',(select last_error_code from private.team_jobs where team_diagnostic_id=p_team_id and kind='team_aggregate' and source_fingerprint=s.fingerprint and status='failed'));
end; $$;

revoke all on function private.team_immutable() from public,anon,authenticated;
revoke all on function private.team_snapshot(uuid) from public,anon,authenticated;
revoke all on function private.team_report_immutable() from public,anon,authenticated;
revoke all on function private.team_completed(uuid) from public,anon,authenticated;
revoke all on function private.team_source(uuid) from public,anon,authenticated;
revoke all on function private.team_owner(uuid) from public,anon,authenticated;
revoke all on function private.team_result_visible(uuid,text,boolean) from public,anon,authenticated;
revoke all on function private.enqueue_team_aggregate(uuid) from public,anon,authenticated;
revoke all on function private.team_response_immutable() from public,anon,authenticated;
revoke all on function public.create_team_diagnostic(uuid,text) from public,anon,authenticated;
revoke all on function public.save_team_response(uuid,integer,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.revoke_team_participant(uuid) from public,anon,authenticated;
revoke all on function public.renew_team_invitation(uuid,text) from public,anon,authenticated;
revoke all on function public.accept_team_invitation(text) from public,anon,authenticated;
revoke all on function private.require_team_response(uuid) from public,anon,authenticated;
revoke all on function public.close_team_diagnostic(uuid) from public,anon,authenticated;
revoke all on function public.refresh_team_results(uuid) from public,anon,authenticated;
revoke all on function public.request_team_report(uuid) from public,anon,authenticated;
revoke all on function public.claim_team_jobs(integer,integer) from public,anon,authenticated;
revoke all on function private.lock_team_job(uuid,uuid) from public,anon,authenticated;
revoke all on function private.team_job_current(private.team_jobs) from public,anon,authenticated;
revoke all on function public.process_team_aggregate(uuid,uuid) from public,anon,authenticated;
revoke all on function private.mask_team_text(uuid,text) from public,anon,authenticated;
revoke all on function private.safe_team_json(uuid,jsonb) from public,anon,authenticated;
revoke all on function private.validate_team_output(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.prepare_team_report_job(uuid,uuid) from public,anon,authenticated;
revoke all on function private.validate_team_synthesis(jsonb,integer) from public,anon,authenticated;
revoke all on function public.store_team_synthesis(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.publish_team_report(uuid,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.fail_team_job(uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.read_team_results(uuid) from public,anon,authenticated;
grant execute on function private.team_result_visible(uuid,text,boolean) to authenticated;
grant execute on function public.create_team_diagnostic(uuid,text),public.save_team_response(uuid,integer,jsonb,boolean),public.revoke_team_participant(uuid),public.renew_team_invitation(uuid,text),public.accept_team_invitation(text),public.close_team_diagnostic(uuid),public.refresh_team_results(uuid),public.request_team_report(uuid),public.read_team_results(uuid) to authenticated;
grant execute on function public.claim_team_jobs(integer,integer),public.process_team_aggregate(uuid,uuid),public.prepare_team_report_job(uuid,uuid),public.store_team_synthesis(uuid,uuid,jsonb,text,text),public.publish_team_report(uuid,uuid,jsonb,text),public.fail_team_job(uuid,uuid,text,boolean) to service_role;
commit;
