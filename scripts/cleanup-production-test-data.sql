-- Production test-data cleanup.
-- Safe default: DRY_RUN. Nothing is deleted unless invoked with:
--   psql ... -v test_emails='test1@example.com,test2@example.com' -v execute=1 -f scripts/cleanup-production-test-data.sql
-- Run only with a service-role database connection. Never use TRUNCATE or disable constraints.
\set ON_ERROR_STOP on
\if :{?test_emails}
\else
  \echo 'ERROR: provide -v test_emails="email1,email2"'
  \quit 2
\endif

begin;
create temporary table _cleanup_emails(email text primary key) on commit drop;
insert into _cleanup_emails(email)
select lower(btrim(value))
from regexp_split_to_table(:'test_emails', ',') as value
where btrim(value) <> '';

-- Refuse blank, malformed, duplicate, unknown, or administrator targets.
do $$
declare n integer;
begin
  select count(*) into n from _cleanup_emails;
  if n = 0 then raise exception 'TEST_EMAILS is empty'; end if;
  if exists (select 1 from _cleanup_emails where email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'TEST_EMAILS contains an invalid email'; end if;
  if exists (select 1 from _cleanup_emails e join auth.users au on lower(au.email)=e.email join public.user_roles r on r.user_id=au.id and r.role='administrator') then raise exception 'administrator target refused'; end if;
  if exists (select 1 from _cleanup_emails e left join auth.users au on lower(au.email)=e.email where au.id is null) then raise exception 'one or more TEST_EMAILS do not exist in auth.users'; end if;
end $$;

create temporary table _cleanup_users on commit drop as
select au.id user_id, lower(au.email) email
from auth.users au join _cleanup_emails e on lower(au.email)=e.email;
create unique index on _cleanup_users(user_id);
create temporary table _cleanup_companies on commit drop as
select cp.id company_id
from public.company_profiles cp join _cleanup_users u on u.user_id=cp.owner_user_id;
create unique index on _cleanup_companies(company_id);
create temporary table _cleanup_diagnostics on commit drop as
select d.id diagnostic_id, d.company_id, d.created_by_user_id
from public.diagnostics d join _cleanup_users u on u.user_id=d.created_by_user_id
join _cleanup_companies c on c.company_id=d.company_id;
create unique index on _cleanup_diagnostics(diagnostic_id);

-- Never remove a company/diagnostic that is linked to a non-target owner.
do $$
begin
  if exists (select 1 from public.diagnostics d join _cleanup_companies c on c.company_id=d.company_id left join _cleanup_users u on u.user_id=d.created_by_user_id where u.user_id is null) then raise exception 'target company has a diagnostic owned by a non-target user'; end if;
  if exists (select 1 from public.feedback f join _cleanup_diagnostics d on d.diagnostic_id=f.diagnostic_id left join _cleanup_users u on u.user_id=f.user_id where u.user_id is null) then raise exception 'target diagnostic has feedback owned by a non-target user'; end if;
  if exists (select 1 from public.lead_requests l join _cleanup_diagnostics d on d.diagnostic_id=l.diagnostic_id left join _cleanup_users u on u.user_id=l.user_id where u.user_id is null) then raise exception 'target diagnostic has lead owned by a non-target user'; end if;
end $$;

-- Complete read-only inventory before any optional deletion.
select 'users' entity, count(*) count from _cleanup_users
union all select 'companies', count(*) from _cleanup_companies
union all select 'diagnostics', count(*) from _cleanup_diagnostics
union all select 'answers', count(*) from public.answers a join _cleanup_diagnostics d on d.diagnostic_id=a.diagnostic_id
union all select 'diagnostic_mutations', count(*) from public.diagnostic_mutations m join _cleanup_diagnostics d on d.diagnostic_id=m.diagnostic_id
union all select 'diagnostic_company_snapshots', count(*) from public.diagnostic_company_snapshots s join _cleanup_diagnostics d on d.diagnostic_id=s.diagnostic_id
union all select 'diagnostic_results', count(*) from public.diagnostic_results r join _cleanup_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'diagnostic_block_results', count(*) from public.diagnostic_block_results br join public.diagnostic_results r on r.id=br.result_id join _cleanup_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'ai_reports', count(*) from public.ai_reports r join _cleanup_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'report_artifacts', count(*) from public.report_artifacts a join public.ai_reports r on r.id=a.report_id join _cleanup_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'email_deliveries', count(*) from public.email_deliveries e join _cleanup_diagnostics d on d.diagnostic_id=e.diagnostic_id
union all select 'lead_requests', count(*) from public.lead_requests l join _cleanup_diagnostics d on d.diagnostic_id=l.diagnostic_id
union all select 'consultation_notification_deliveries', count(*) from public.consultation_notification_deliveries c join public.lead_requests l on l.id=c.lead_request_id join _cleanup_diagnostics d on d.diagnostic_id=l.diagnostic_id
union all select 'jobs', count(*) from public.jobs j join _cleanup_diagnostics d on d.diagnostic_id=j.diagnostic_id
union all select 'feedback', count(*) from public.feedback f join _cleanup_diagnostics d on d.diagnostic_id=f.diagnostic_id
union all select 'user_consents', count(*) from public.user_consents c join _cleanup_users u on u.user_id=c.user_id
union all select 'user_roles', count(*) from public.user_roles r join _cleanup_users u on u.user_id=r.user_id
union all select 'private.audit_events', count(*) from private.audit_events e join _cleanup_users u on u.user_id=e.actor_id or u.user_id=e.subject_id;

\if :{?execute}
  do $$
  begin
    delete from public.email_deliveries e using _cleanup_diagnostics d where e.diagnostic_id=d.diagnostic_id;
    delete from public.consultation_notification_deliveries c using public.lead_requests l, _cleanup_diagnostics d where c.lead_request_id=l.id and l.diagnostic_id=d.diagnostic_id;
    delete from public.feedback f using _cleanup_diagnostics d where f.diagnostic_id=d.diagnostic_id;
    delete from public.report_artifacts a using public.ai_reports r, _cleanup_diagnostics d where a.report_id=r.id and r.diagnostic_id=d.diagnostic_id;
    delete from public.diagnostic_block_results br using public.diagnostic_results r, _cleanup_diagnostics d where br.result_id=r.id and r.diagnostic_id=d.diagnostic_id;
    delete from public.diagnostic_results r using _cleanup_diagnostics d where r.diagnostic_id=d.diagnostic_id;
    delete from public.ai_reports r using _cleanup_diagnostics d where r.diagnostic_id=d.diagnostic_id;
    delete from public.lead_requests l using _cleanup_diagnostics d where l.diagnostic_id=d.diagnostic_id;
    delete from public.diagnostic_company_snapshots s using _cleanup_diagnostics d where s.diagnostic_id=d.diagnostic_id;
    delete from public.answers a using _cleanup_diagnostics d where a.diagnostic_id=d.diagnostic_id;
    delete from public.diagnostic_mutations m using _cleanup_diagnostics d where m.diagnostic_id=d.diagnostic_id;
    delete from public.jobs j using _cleanup_diagnostics d where j.diagnostic_id=d.diagnostic_id;
    delete from public.diagnostics d using _cleanup_diagnostics x where d.id=x.diagnostic_id;
    delete from public.company_profiles c using _cleanup_companies x where c.id=x.company_id;
    delete from private.audit_events e using _cleanup_users u where e.actor_id=u.user_id or e.subject_id=u.user_id;
    delete from public.user_consents c using _cleanup_users u where c.user_id=u.user_id;
    delete from public.user_roles r using _cleanup_users u where r.user_id=u.user_id;
    delete from public.users u using _cleanup_users x where u.id=x.user_id;
    delete from auth.users au using _cleanup_users x where au.id=x.user_id;
  end $$;

  select 'AFTER users' entity, count(*) count from auth.users au join _cleanup_users u on u.user_id=au.id
  union all select 'AFTER companies', count(*) from public.company_profiles c join _cleanup_companies x on x.company_id=c.id
  union all select 'AFTER diagnostics', count(*) from public.diagnostics d join _cleanup_diagnostics x on x.diagnostic_id=d.id;
  commit;
\else
  rollback;
\endif
