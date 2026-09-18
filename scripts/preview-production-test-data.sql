-- Read-only preview. Replace the emails in the VALUES clause before running.
with test_emails(email) as (
  values
    ('replace-with-test-email@example.com')
), target_users as (
  select au.id user_id, lower(au.email) email
  from auth.users au join test_emails e on lower(au.email)=lower(e.email)
), target_companies as (
  select cp.id company_id from public.company_profiles cp join target_users u on u.user_id=cp.owner_user_id
), target_diagnostics as (
  select d.id diagnostic_id from public.diagnostics d join target_users u on u.user_id=d.created_by_user_id join target_companies c on c.company_id=d.company_id
)
select 'users' entity, count(*) count from target_users
union all select 'companies', count(*) from target_companies
union all select 'diagnostics', count(*) from target_diagnostics
union all select 'answers', count(*) from public.answers a join target_diagnostics d on d.diagnostic_id=a.diagnostic_id
union all select 'diagnostic_results', count(*) from public.diagnostic_results r join target_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'ai_reports', count(*) from public.ai_reports r join target_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'report_artifacts', count(*) from public.report_artifacts a join public.ai_reports r on r.id=a.report_id join target_diagnostics d on d.diagnostic_id=r.diagnostic_id
union all select 'email_deliveries', count(*) from public.email_deliveries e join target_diagnostics d on d.diagnostic_id=e.diagnostic_id
union all select 'lead_requests', count(*) from public.lead_requests l join target_diagnostics d on d.diagnostic_id=l.diagnostic_id
union all select 'jobs', count(*) from public.jobs j join target_diagnostics d on d.diagnostic_id=j.diagnostic_id
union all select 'feedback', count(*) from public.feedback f join target_diagnostics d on d.diagnostic_id=f.diagnostic_id
union all select 'user_consents', count(*) from public.user_consents c join target_users u on u.user_id=c.user_id
union all select 'user_roles', count(*) from public.user_roles r join target_users u on u.user_id=r.user_id;
