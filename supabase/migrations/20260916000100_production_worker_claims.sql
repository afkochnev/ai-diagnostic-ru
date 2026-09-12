-- Stage 9C: atomic, kind-specific claims for the production worker.
-- The max-attempt and lease arguments are deliberately explicit so the
-- runner can keep operational policy outside the browser.
create or replace function public.claim_scoring_jobs(
  p_limit integer default 1,
  p_max_attempts integer default 3,
  p_lease_seconds integer default 300
)
returns table(job_id uuid, diagnostic_id uuid, lease_token uuid, attempt_count integer, deduplication_key text)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return query
  with candidates as (
    select j.id as candidate_job_id
    from public.jobs as j
    where j.kind = 'score_diagnostic'
      and j.attempts < greatest(1, p_max_attempts)
      and (
        (j.status in ('queued', 'failed') and j.available_at <= now())
        or (j.status = 'running' and j.lease_expires_at <= now())
      )
    order by j.available_at, j.created_at, j.id
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 100))
  ), claimed as (
    update public.jobs as j
    set status = 'running',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => greatest(1, p_lease_seconds)),
        attempts = j.attempts + 1,
        started_at = coalesce(j.started_at, now())
    from candidates as c
    where j.id = c.candidate_job_id
    returning j.id, j.diagnostic_id, j.lease_token, j.attempts, j.deduplication_key
  )
  select c.id, c.diagnostic_id, c.lease_token, c.attempts, c.deduplication_key
  from claimed as c;
end;
$$;

create or replace function public.claim_ai_report_jobs(
  p_limit integer default 1,
  p_max_attempts integer default 3,
  p_lease_seconds integer default 300
)
returns table(job_id uuid, diagnostic_id uuid, lease_token uuid, attempt_count integer, deduplication_key text)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  return query
  with candidates as (
    select j.id as candidate_job_id
    from public.jobs as j
    where j.kind = 'ai_report'
      and j.attempts < greatest(1, p_max_attempts)
      and (
        (j.status in ('queued', 'failed') and j.available_at <= now())
        or (j.status = 'running' and j.lease_expires_at <= now())
      )
    order by j.available_at, j.created_at, j.id
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 100))
  ), claimed as (
    update public.jobs as j
    set status = 'running',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => greatest(1, p_lease_seconds)),
        attempts = j.attempts + 1,
        started_at = coalesce(j.started_at, now())
    from candidates as c
    where j.id = c.candidate_job_id
    returning j.id, j.diagnostic_id, j.lease_token, j.attempts, j.deduplication_key
  )
  select c.id, c.diagnostic_id, c.lease_token, c.attempts, c.deduplication_key
  from claimed as c;
end;
$$;

revoke all on function public.claim_scoring_jobs(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_ai_report_jobs(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_scoring_jobs(integer, integer, integer) to service_role;
grant execute on function public.claim_ai_report_jobs(integer, integer, integer) to service_role;

create index if not exists jobs_scoring_claim_idx
  on public.jobs(kind, status, available_at, created_at)
  where kind = 'score_diagnostic';
create index if not exists jobs_ai_claim_idx
  on public.jobs(kind, status, available_at, created_at)
  where kind = 'ai_report';

-- The AI/consultation migrations replaced the old diagnostic-only uniqueness
-- with kind-scoped deduplication. Keep submit idempotency aligned with it.
create or replace function public.submit_diagnostic(p_diagnostic_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.diagnostics%rowtype; missing jsonb; j public.jobs%rowtype;
begin
  select * into d from public.diagnostics where id = p_diagnostic_id and created_by_user_id = (select auth.uid());
  if d.id is null then raise exception 'not_found'; end if;
  if d.status <> 'in_progress' then
    select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default';
    return jsonb_build_object('ok', true, 'status', d.status, 'job_id', j.id);
  end if;
  if d.revision <> p_expected_revision then raise exception 'conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.id, 'block_id', q.block_id, 'position', q.position)), '[]'::jsonb) into missing
  from public.questions q left join public.answers a on a.diagnostic_id = d.id and a.question_id = q.id
  where q.version_id = d.version_id and q.is_active and q.is_required
    and ((q.answer_type = 'scale_0_4' and a.numeric_value is null) or (q.answer_type = 'text' and nullif(btrim(a.text_value), '') is null));
  if jsonb_array_length(missing) > 0 then return jsonb_build_object('ok', false, 'missing', missing, 'status', d.status); end if;
  insert into public.diagnostic_company_snapshots(diagnostic_id, company_id, profile_revision, profile_data)
    select d.id, c.id, c.revision, to_jsonb(c) from public.company_profiles c where c.id = d.company_id on conflict do nothing;
  update public.diagnostics set status = 'submitted', submitted_at = now(), revision = revision + 1 where id = d.id and status = 'in_progress' and revision = p_expected_revision;
  insert into public.jobs(kind, diagnostic_id, deduplication_key) values ('score_diagnostic', d.id, 'default')
    on conflict (kind, diagnostic_id, deduplication_key) do nothing returning * into j;
  if j.id is null then select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default'; end if;
  return jsonb_build_object('ok', true, 'status', 'submitted', 'job_id', j.id);
end; $$;
grant execute on function public.submit_diagnostic(uuid, integer) to authenticated;
