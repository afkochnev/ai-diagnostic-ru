-- V2.4: dedicated administrator projections. No ordinary Account RLS changes.
begin;

create table private.admin_plan_changes (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.accounts(id),
 old_plan text not null check(old_plan in ('free','advanced')),
 new_plan text not null check(new_plan in ('free','advanced') and new_plan<>old_plan),
 administrator_user_id uuid not null references public.users(id),
 reason text not null check(char_length(btrim(reason)) between 3 and 500),
 source text not null default 'manual' check(source='manual'),
 subscription_id uuid not null references private.account_subscriptions(id),
 created_at timestamptz not null default clock_timestamp()
);
create index admin_plan_changes_account_history on private.admin_plan_changes(account_id,created_at desc,id);
alter table private.admin_plan_changes enable row level security;
revoke all on private.admin_plan_changes from public,anon,authenticated,service_role;
create trigger admin_plan_changes_immutable before update or delete on private.admin_plan_changes
 for each row execute function private.team_immutable();

create function private.admin_console_actor() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if current_setting('role',true)<>'authenticated'
 or not private.is_verified_session()
 or not exists(select 1 from public.user_roles r where r.user_id=actor and r.role='administrator')
 or not exists(select 1 from auth.sessions s where s.user_id=actor and s.id::text=auth.jwt()->>'session_id')
 then raise exception 'admin_access_denied' using errcode='42501';end if;
 return actor;
end; $$;
revoke all on function private.admin_console_actor() from public,anon,authenticated,service_role;

-- Private, invoker-security views have no client grants. They are reachable
-- only after the dedicated RPC has checked the administrator's live session.
create view private.admin_v24_accounts with(security_invoker=true) as
select a.id,a.name,a.status,a.created_at,private.effective_account_plan(a.id) plan,
 m.user_id owner_id,u.full_name owner_name,au.email owner_email,
 (select count(*) from public.company_profiles c where c.account_id=a.id) companies,
 (select count(*) from public.diagnostics d join public.company_profiles c on c.id=d.company_id where c.account_id=a.id) individual_diagnostics,
 (select count(*) from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id where c.account_id=a.id) team_diagnostics,
 concat_ws(' ',a.id::text,a.name,u.full_name,au.email,(select string_agg(c.name,' ') from public.company_profiles c where c.account_id=a.id)) search_text
from public.accounts a left join public.account_memberships m on m.account_id=a.id and m.role='owner' and m.status='active'
left join public.users u on u.id=m.user_id left join auth.users au on au.id=u.id;

create view private.admin_v24_users with(security_invoker=true) as
select u.id,u.full_name name,u.phone,u.locale,u.created_at,au.email,au.email_confirmed_at,
 coalesce(r.role,'user') global_role,
 (select count(*) from public.account_memberships m where m.user_id=u.id and m.status='active') accounts,
 (select count(*) from public.company_profiles c where exists(select 1 from public.account_memberships m where m.account_id=c.account_id and m.user_id=u.id and m.status='active')) companies,
 (select count(*) from public.diagnostics d where d.created_by_user_id=u.id) individual_diagnostics,
 (select count(*) from public.team_participants p where lower(p.email)=lower(au.email)) team_participations,
 concat_ws(' ',u.id::text,u.full_name,au.email) search_text
from public.users u join auth.users au on au.id=u.id left join public.user_roles r on r.user_id=u.id;

create view private.admin_v24_companies with(security_invoker=true) as
select c.id,c.name,c.account_id,a.name account_name,a.plan,a.owner_name,a.owner_email,c.country,c.industry_key,c.employee_count,c.created_at,
 (select count(*) from public.diagnostics d where d.company_id=c.id) individual_diagnostics,
 (select count(*) from public.team_diagnostics d where d.company_id=c.id) team_diagnostics,
 concat_ws(' ',c.id::text,c.name,a.name,a.owner_name,a.owner_email) search_text
from public.company_profiles c join private.admin_v24_accounts a on a.id=c.account_id;

create view private.admin_v24_diagnostics with(security_invoker=true) as
select d.id,'individual'::text type,c.id company_id,c.name company_name,c.account_id,c.account_name,c.plan,
 d.created_by_user_id creator_id,u.full_name owner_name,c.owner_email,
 'Индивидуальная диагностика'::text title,d.status,d.started_at created_at,d.completed_at,
 (select r.display_manageability_index from public.diagnostic_results r where r.diagnostic_id=d.id) index,
 (select mt.label from public.diagnostic_results r join public.maturity_level_translations mt on mt.maturity_level_id=r.maturity_level_id and mt.locale='ru' where r.diagnostic_id=d.id) maturity,
 0::bigint invited,0::bigint started,0::bigint completed,0::bigint revoked,
 case when d.status='completed' then 'ready' else 'pending' end aggregate_status,
 coalesce((select r.status from public.ai_reports r where r.diagnostic_id=d.id order by r.version desc limit 1),'none') report_status,
 (select max(r.version) from public.ai_reports r where r.diagnostic_id=d.id) report_version,
 exists(select 1 from public.report_artifacts a join public.ai_reports r on r.id=a.report_id where r.diagnostic_id=d.id and a.status='ready') pdf_ready,
 concat_ws(' ',d.id::text,c.name,c.account_name,u.full_name,c.owner_email) search_text
from public.diagnostics d join private.admin_v24_companies c on c.id=d.company_id join public.users u on u.id=d.created_by_user_id
union all
select d.id,'team',c.id,c.name,c.account_id,c.account_name,c.plan,d.created_by_user_id,u.full_name,c.owner_email,
 d.title,d.status,d.created_at,null::timestamptz,r.overall_mean,mt.label,
 (select count(*) from public.team_participants p where p.team_diagnostic_id=d.id and p.revoked_at is null),
 (select count(*) from public.team_participants p where p.team_diagnostic_id=d.id and p.started_at is not null and p.revoked_at is null),
 (select count(*) from public.team_participants p where p.team_diagnostic_id=d.id and p.status='completed' and p.revoked_at is null),
 (select count(*) from public.team_participants p where p.team_diagnostic_id=d.id and p.revoked_at is not null),
 case when (select count(*) from public.team_participants p where p.team_diagnostic_id=d.id and p.status='completed' and p.revoked_at is null)<3 then 'threshold' when r.team_diagnostic_id is null then 'pending' else 'ready' end,
 coalesce((select x.status from public.team_ai_reports x where x.team_diagnostic_id=d.id and x.source_fingerprint=source.fingerprint order by x.version desc limit 1),'none'),
 (select max(x.version) from public.team_ai_reports x where x.team_diagnostic_id=d.id and x.source_fingerprint=source.fingerprint),
 exists(select 1 from public.team_report_artifacts a join public.team_ai_reports x on x.id=a.team_report_id where x.team_diagnostic_id=d.id and x.source_fingerprint=source.fingerprint and a.status='ready'),
 concat_ws(' ',d.id::text,d.title,c.name,c.account_name,u.full_name,c.owner_email)
from public.team_diagnostics d join private.admin_v24_companies c on c.id=d.company_id join public.users u on u.id=d.created_by_user_id
cross join lateral private.team_source(d.id) source
left join public.team_results r on r.team_diagnostic_id=d.id and r.source_fingerprint=source.fingerprint left join public.maturity_level_translations mt on mt.maturity_level_id=r.maturity_level_id and mt.locale='ru';

create view private.admin_v24_leads with(security_invoker=true) as
select l.id,l.name,l.email,l.user_id,l.company_id,c.name company_name,c.account_id,c.account_name,
 l.diagnostic_id,'individual'::text diagnostic_type,l.status,l.created_at,l.contact_type,l.contact_value,l.comment,
 coalesce(n.status,'none') notification_status,concat_ws(' ',l.name,l.email,c.name,c.account_name) search_text
from public.lead_requests l join private.admin_v24_companies c on c.id=l.company_id
left join public.consultation_notification_deliveries n on n.lead_request_id=l.id;

create view private.admin_v24_feedback with(security_invoker=true) as
select f.id,u.full_name name,au.email,f.user_id,f.company_id,c.name company_name,c.account_id,c.account_name,
 f.diagnostic_id,f.rating,f.useful,f.improve,f.created_at,'recorded'::text status,
 concat_ws(' ',u.full_name,au.email,c.name,c.account_name) search_text
from public.feedback f join public.users u on u.id=f.user_id join auth.users au on au.id=u.id join private.admin_v24_companies c on c.id=f.company_id;

revoke all on private.admin_v24_accounts,private.admin_v24_users,private.admin_v24_companies,
 private.admin_v24_diagnostics,private.admin_v24_leads,private.admin_v24_feedback from public,anon,authenticated,service_role;

create function private.admin_v24_metrics(p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
with cohort as(select id,status,completed_at from public.diagnostics where (p_from is null or started_at>=p_from) and(p_to is null or started_at<=p_to))
select jsonb_build_object(
 'application_users',(select count(*) from public.users where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'auth_identities',(select count(*) from auth.users where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'confirmed_auth_identities',(select count(*) from auth.users where email_confirmed_at is not null and(p_from is null or email_confirmed_at>=p_from) and(p_to is null or email_confirmed_at<=p_to)),
 'pending_team_identities',(select count(*) from private.team_identity_reservations where finalized_at is null),
 'accounts',(select count(*) from public.accounts),
 'free_accounts',(select count(*) from public.accounts where private.effective_account_plan(id)='free'),
 'advanced_accounts',(select count(*) from public.accounts where private.effective_account_plan(id)='advanced'),
 'companies',(select count(*) from public.company_profiles where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'individual_started',(select count(*) from cohort),
 'individual_completed',(select count(*) from public.diagnostics where status='completed' and(p_from is null or completed_at>=p_from) and(p_to is null or completed_at<=p_to)),
 'individual_reports',(select count(distinct diagnostic_id) from public.ai_reports where status='completed' and(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'individual_report_versions',(select count(*) from public.ai_reports where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'individual_pdfs',(select count(*) from public.report_artifacts where status='ready' and(p_from is null or generated_at>=p_from) and(p_to is null or generated_at<=p_to)),
 'team_diagnostics',(select count(*) from public.team_diagnostics where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'team_open',(select count(*) from public.team_diagnostics where status='open'),
 'team_closed',(select count(*) from public.team_diagnostics where status='closed'),
 'participants_invited',(select count(*) from public.team_participants where revoked_at is null),
 'participants_started',(select count(*) from public.team_participants where started_at is not null and revoked_at is null),
 'participants_completed',(select count(*) from public.team_participants where status='completed' and revoked_at is null),
 'team_reports',(select count(*) from public.team_ai_reports where status='completed'),
 'team_pdfs',(select count(*) from public.team_report_artifacts where status='ready'),
 'email_requests',(select count(*) from public.email_deliveries where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'email_sent',(select count(*) from public.email_deliveries where status='sent' and(p_from is null or sent_at>=p_from) and(p_to is null or sent_at<=p_to)),
 'leads',(select count(*) from public.lead_requests where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'feedback',(select count(*) from public.feedback where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'average_rating',(select avg(rating) from public.feedback where(p_from is null or created_at>=p_from) and(p_to is null or created_at<=p_to)),
 'failed_jobs',(select count(*) from public.jobs where status='failed')+(select count(*) from private.team_jobs where status='failed'),
 'funnel',jsonb_build_object('started',(select count(*) from cohort),'completed',(select count(*) from cohort where status='completed' and completed_at is not null),
 'reports',(select count(distinct r.diagnostic_id) from public.ai_reports r join cohort c on c.id=r.diagnostic_id where r.status='completed'),
 'leads',(select count(distinct l.diagnostic_id) from public.lead_requests l join cohort c on c.id=l.diagnostic_id),
 'feedback',(select count(distinct f.diagnostic_id) from public.feedback f join cohort c on c.id=f.diagnostic_id)))
$$;
revoke all on function private.admin_v24_metrics(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.read_admin_console(p_section text,p_id uuid default null,p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid; result jsonb; payload jsonb; v_page integer; q text; p_plan text; p_status text; p_type text; p_account uuid; p_company uuid; p_user uuid; p_delivery text; p_rating text; date_from timestamptz;date_to timestamptz; table_name text;
begin
 actor:=private.admin_console_actor();
 if p_section='identity' then return jsonb_build_object('administrator',true);end if;
 if jsonb_typeof(p_filters)<>'object' or octet_length(p_filters::text)>4000 then raise exception 'admin_invalid_filter';end if;
 v_page:=greatest(1,least(coalesce((p_filters->>'page')::integer,1),10000));
 q:=left(btrim(coalesce(p_filters->>'q','')),100);p_plan:=nullif(p_filters->>'plan','');p_status:=nullif(p_filters->>'status','');p_type:=nullif(p_filters->>'type','');
 p_account:=nullif(p_filters->>'account','')::uuid;p_company:=nullif(p_filters->>'company','')::uuid;p_user:=nullif(p_filters->>'user','')::uuid;p_delivery:=nullif(p_filters->>'delivery','');p_rating:=nullif(p_filters->>'rating','');
 if (p_delivery is not null and p_delivery not in('queued','sending','sent','failed')) or (p_rating is not null and p_rating not in('1','2','3','4','5')) then raise exception 'admin_invalid_filter';end if;
 if p_plan is not null and p_plan not in('free','advanced') then raise exception 'admin_invalid_filter';end if;
 if p_type is not null and p_type not in('individual','team') then raise exception 'admin_invalid_filter';end if;
 date_from:=nullif(p_filters->>'from','')::date::timestamp at time zone 'UTC';
 date_to:=(nullif(p_filters->>'to','')::date+time '23:59:59.999') at time zone 'UTC';
 if p_section in('overview','metrics') then return private.admin_v24_metrics(date_from,date_to);end if;
 if p_section='system' then
  return jsonb_build_object(
   'public_jobs',(select coalesce(jsonb_agg(x),'[]') from(select kind,status,count(*) count from public.jobs group by kind,status)x),
   'team_jobs',(select coalesce(jsonb_agg(x),'[]') from(select kind,status,count(*) count from private.team_jobs group by kind,status)x),
   'active_leases',(select count(*) from public.jobs where status='running' and lease_expires_at>now())+(select count(*) from private.team_jobs where status='running' and lease_expires_at>now()),
   'email_failures',(select count(*) from public.email_deliveries where status='failed'),
   'invitation_failures',null,
   'consultation_failures',(select count(*) from public.consultation_notification_deliveries where status='failed'),
   'last_worker_activity',greatest((select max(coalesce(completed_at,started_at)) from public.jobs),(select max(coalesce(completed_at,started_at)) from private.team_jobs)),
   'recent_failures',(select coalesce(jsonb_agg(x),'[]') from(
    select id,kind,status,created_at,case when last_error_code in('team_privacy_rejected','team_numeric_integrity','team_qualitative_insufficient','provider_unavailable','timeout','invalid_payload') then last_error_code else 'processing_failed' end error_code from public.jobs where status='failed'
    union all select id,kind,status,created_at,case when last_error_code in('team_privacy_rejected','team_numeric_integrity','team_qualitative_insufficient','provider_unavailable','timeout','invalid_payload') then last_error_code else 'processing_failed' end from private.team_jobs where status='failed'
    order by created_at desc,id limit 25 offset (v_page-1)*25)x),'page',v_page);
 end if;
 if p_section='team' then
  select to_jsonb(v)-'search_text' into payload from private.admin_v24_diagnostics v where v.id=p_id and v.type='team';
  if payload is null then return null;end if;
  result:=jsonb_build_object('item',payload,'result',null,'report',null,
   'pdfs',(select coalesce(jsonb_agg(x),'[]') from(select a.id,a.team_report_id,a.template_version,a.generated_at,a.checksum from public.team_report_artifacts a join public.team_ai_reports r on r.id=a.team_report_id where r.team_diagnostic_id=p_id and r.status='completed' and r.completed_participant_count>=3 and r.prompt_version in('TEAM-RU-2','TEAM-RU-3') and r.source_fingerprint=(select fingerprint from private.team_source(p_id)) and a.status='ready' order by a.generated_at desc limit 25)x));
  if (payload->>'completed')::integer>=3 then
   select jsonb_build_object('overall',to_jsonb(r),'blocks',(select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('title',tr.title) order by db.position),'[]') from public.team_block_results b join public.diagnostic_blocks db on db.id=b.block_id join public.diagnostic_block_translations tr on tr.block_id=b.block_id and tr.locale='ru' where b.team_diagnostic_id=p_id and b.source_fingerprint=r.source_fingerprint)) into payload
    from public.team_results r where r.team_diagnostic_id=p_id and r.source_fingerprint=(select fingerprint from private.team_source(p_id));
   result:=jsonb_set(result,'{result}',coalesce(payload,'null'));
   select jsonb_build_object('id',r.id,'version',r.version,'pipeline',r.prompt_version,'model',r.model,'content',r.structured_content) into payload from public.team_ai_reports r where r.team_diagnostic_id=p_id and r.status='completed' and r.source_fingerprint=(select fingerprint from private.team_source(p_id)) order by case r.prompt_version when 'TEAM-RU-3' then 3 when 'TEAM-RU-2' then 2 else 1 end desc,(r.provider_mode='openai') desc nulls last,r.version desc limit 1;
   result:=jsonb_set(result,'{report}',coalesce(payload,'null'));
  end if;
  return result;
 end if;
 if p_section='team_pdf' then
  select jsonb_build_object('content_base64',a.content_base64,'checksum',a.checksum,'version',r.version) into result
   from public.team_report_artifacts a join public.team_ai_reports r on r.id=a.team_report_id
   where a.id=p_id and a.status='ready' and r.status='completed' and r.completed_participant_count>=3 and r.prompt_version in('TEAM-RU-2','TEAM-RU-3') and r.source_fingerprint=(select fingerprint from private.team_source(r.team_diagnostic_id));
  return result;
 end if;
 if p_section not in('accounts','users','companies','diagnostics','leads','feedback') then raise exception 'admin_invalid_section';end if;
 table_name:='admin_v24_'||p_section;
 -- Only the table identifier comes from the fixed allow-list above. All search
 -- text, UUIDs, dates and filters are bound parameters, never SQL fragments.
 if p_id is not null then
  execute format('select to_jsonb(v)-''search_text'' from private.%I v where id=$1',table_name) into payload using p_id;
  if payload is null then return null;end if;
  result:=jsonb_build_object('item',payload);
  if p_section='accounts' then
   return result||jsonb_build_object(
    'memberships',(select coalesce(jsonb_agg(x),'[]') from(select m.user_id,u.full_name,au.email,m.role,m.status from public.account_memberships m join public.users u on u.id=m.user_id join auth.users au on au.id=u.id where m.account_id=p_id order by m.joined_at limit 25)x),
    'plan_history',(select coalesce(jsonb_agg(x),'[]') from(select s.id,p.key plan,s.status,s.source,s.effective_from,s.effective_until,a.old_plan,a.new_plan,a.reason,a.administrator_user_id,a.created_at changed_at from private.account_subscriptions s join public.plans p on p.id=s.plan_id left join private.admin_plan_changes a on a.subscription_id=s.id where s.account_id=p_id order by s.effective_from desc,s.id limit 25)x),
    'report_counts',(select jsonb_build_object('individual',(select count(*) from public.ai_reports r join public.diagnostics d on d.id=r.diagnostic_id join public.company_profiles c on c.id=d.company_id where c.account_id=p_id),'team',(select count(*) from public.team_ai_reports r join public.team_diagnostics d on d.id=r.team_diagnostic_id join public.company_profiles c on c.id=d.company_id where c.account_id=p_id))),
    'pdf_counts',jsonb_build_object('individual',(select count(*) from public.report_artifacts a join public.ai_reports r on r.id=a.report_id join public.diagnostics d on d.id=r.diagnostic_id join public.company_profiles c on c.id=d.company_id where c.account_id=p_id),'team',(select count(*) from public.team_report_artifacts a join public.team_ai_reports r on r.id=a.team_report_id join public.team_diagnostics d on d.id=r.team_diagnostic_id join public.company_profiles c on c.id=d.company_id where c.account_id=p_id)));
  elsif p_section='users' then
   return result||jsonb_build_object('memberships',(select coalesce(jsonb_agg(x),'[]') from(select a.id account_id,a.name,m.role,m.status from public.account_memberships m join public.accounts a on a.id=m.account_id where m.user_id=p_id order by a.name limit 25)x),
    'participation_statuses',(select coalesce(jsonb_agg(x),'[]') from(select p.status,count(*) count from public.team_participants p join auth.users u on lower(u.email)=p.email where u.id=p_id group by p.status)x));
  elsif p_section='companies' then
   result:=result||jsonb_build_object(
    'memberships',(select coalesce(jsonb_agg(x),'[]') from(select m.user_id,u.full_name,au.email,m.role,m.status from public.company_profiles c join public.account_memberships m on m.account_id=c.account_id join public.users u on u.id=m.user_id join auth.users au on au.id=u.id where c.id=p_id order by m.joined_at limit 25)x),
    'report_counts',jsonb_build_object('individual',(select count(*) from public.ai_reports r join public.diagnostics d on d.id=r.diagnostic_id where d.company_id=p_id),'team',(select count(*) from public.team_ai_reports r join public.team_diagnostics d on d.id=r.team_diagnostic_id where d.company_id=p_id)),
    'pdf_counts',jsonb_build_object('individual',(select count(*) from public.report_artifacts a join public.ai_reports r on r.id=a.report_id join public.diagnostics d on d.id=r.diagnostic_id where d.company_id=p_id),'team',(select count(*) from public.team_report_artifacts a join public.team_ai_reports r on r.id=a.team_report_id join public.team_diagnostics d on d.id=r.team_diagnostic_id where d.company_id=p_id)));
   return result||jsonb_build_object('profile',(select jsonb_build_object('industry',coalesce((select name from public.industry_translations it where it.industry_key=c.industry_key and it.locale='ru'),c.industry_key),'annual_revenue',coalesce((select name from public.revenue_range_translations rt where rt.revenue_key=c.annual_revenue_key and rt.locale='ru'),c.annual_revenue_key),'country',country,'employee_count',employee_count,'company_age_years',company_age_years,'management_levels',management_levels,'products',products,'customer_segments',customer_segments,'sales_channels',sales_channels,'main_goals',main_goals,'key_problems',key_problems) from public.company_profiles c where c.id=p_id));
  end if;
  return result;
 end if;
 execute format($query$
 with filtered as(select to_jsonb(v)-'search_text' payload,v.created_at,v.id from private.%I v where
 ($1='' or v.search_text ilike '%%'||$1||'%%')
 and($2 is null or to_jsonb(v)->>'plan'=$2) and($3 is null or to_jsonb(v)->>'status'=$3)
 and($4 is null or to_jsonb(v)->>'type'=$4)
 and($5 is null or to_jsonb(v)->>'account_id'=$5::text)
 and($6 is null or to_jsonb(v)->>'company_id'=$6::text)
 and($10 is null or (case when $11='companies' then exists(select 1 from public.account_memberships m where m.account_id=(to_jsonb(v)->>'account_id')::uuid and m.user_id=$10 and m.status='active') when $11='diagnostics' then to_jsonb(v)->>'creator_id'=$10::text and to_jsonb(v)->>'type'='individual' else false end))
 and($12 is null or to_jsonb(v)->>'notification_status'=$12) and($13 is null or to_jsonb(v)->>'rating'=$13)
 and($7 is null or v.created_at>=$7) and($8 is null or v.created_at<=$8))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(x.payload) from(select payload from filtered order by created_at desc,id limit 25 offset ($9-1)*25)x),'[]'),
 'total',(select count(*) from filtered),'page',$9,'page_size',25,'summary',jsonb_build_object('average',(select avg((payload->>'rating')::numeric) from filtered)))
 $query$,table_name) into result using q,p_plan,p_status,p_type,p_account,p_company,date_from,date_to,v_page,p_user,p_section,p_delivery,p_rating;
 return result;
end; $$;
revoke all on function public.read_admin_console(text,uuid,jsonb) from public,anon,service_role;
grant execute on function public.read_admin_console(text,uuid,jsonb) to authenticated;

create function public.admin_assign_account_plan(p_account_id uuid,p_target_plan text,p_reason text,p_expected_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; previous text; plan_id uuid; subscription uuid; changed_at timestamptz:=clock_timestamp();
begin
 actor:=private.admin_console_actor();
 if p_target_plan not in('free','advanced') or p_expected_plan not in('free','advanced') or p_target_plan is null or p_expected_plan is null then raise exception 'admin_invalid_plan';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then raise exception 'admin_invalid_reason';end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found then raise exception 'admin_not_found';end if;
 previous:=private.effective_account_plan(p_account_id);
 if previous=p_target_plan then return jsonb_build_object('status','unchanged','plan',previous);end if;
 if previous<>p_expected_plan then raise exception 'admin_plan_changed_refresh';end if;
 select id into plan_id from public.plans where key=p_target_plan and status='active';
 if plan_id is null then raise exception 'admin_invalid_plan';end if;
 update private.account_subscriptions set status='ended',effective_until=changed_at where account_id=p_account_id and status='active';
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 values(p_account_id,plan_id,'active','manual',changed_at) returning id into subscription;
 insert into private.admin_plan_changes(account_id,old_plan,new_plan,administrator_user_id,reason,subscription_id)
 values(p_account_id,previous,p_target_plan,actor,btrim(p_reason),subscription);
 insert into private.audit_events(actor_id,subject_id,action) values(actor,p_account_id,'account_plan_changed');
 return jsonb_build_object('status','changed','old_plan',previous,'plan',p_target_plan,'subscription_id',subscription);
end; $$;
revoke all on function public.admin_assign_account_plan(uuid,text,text,text) from public,anon,service_role;
grant execute on function public.admin_assign_account_plan(uuid,text,text,text) to authenticated;
-- Reviewed legacy RPC bodies use qualified application objects and pg_catalog
-- built-ins only. Empty search_path removes ambient public/private/pg_temp lookup.
alter function public.create_feedback(uuid,integer,text,text) set search_path='';
alter function public.create_lead_request(uuid,uuid,text,text,text,text,uuid) set search_path='';
alter function public.save_diagnostic_block(uuid,integer,uuid,uuid,jsonb,boolean) set search_path='';
alter function public.submit_diagnostic(uuid,integer) set search_path='';
commit;
