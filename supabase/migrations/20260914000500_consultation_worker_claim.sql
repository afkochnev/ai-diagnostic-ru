create or replace function public.claim_consultation_notification_jobs(p_limit integer default 10)
returns table(job_id uuid, lead_request_id uuid, lease_token uuid, attempt_count integer)
language plpgsql security definer set search_path = public, private as $$
begin
  return query
  with candidates as (
    select j.id, d.id as lead_id
    from public.jobs j
    join public.consultation_notification_deliveries d on d.job_id=j.id
    where j.kind='consultation_notification'
      and ((j.status in ('queued','failed') and j.available_at <= now())
        or (j.status='running' and j.lease_expires_at < now()))
      and d.status <> 'sent'
    order by j.available_at, j.created_at
    for update of j skip locked
    limit greatest(1, least(coalesce(p_limit,10),100))
  ), claimed as (
    update public.jobs j
    set status='running', lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', attempts=j.attempts+1, started_at=coalesce(j.started_at,now())
    from candidates c where j.id=c.id
    returning j.id, c.lead_id, j.lease_token, j.attempts
  )
  select id, lead_id, lease_token, attempts from claimed;
end; $$;
revoke all on function public.claim_consultation_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_consultation_notification_jobs(integer) to service_role;

create index if not exists jobs_consultation_claim_idx
  on public.jobs(kind, status, available_at)
  where kind = 'consultation_notification';
