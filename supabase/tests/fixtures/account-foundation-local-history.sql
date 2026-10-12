-- Disposable PostgreSQL fixture only. No production data or external services.
-- Includes owner, other owner, user without company, global administrator and
-- unverified identity; each must retain a distinct legacy account mapping.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'account-fixture-' || n || '@example.test',
       case when n=5 then null else '2026-09-20 12:00:00+00'::timestamptz end,
       jsonb_build_object('full_name','Account fixture ' || n,
         'data_processing_consent',true,'marketing_consent',false,
         'data_processing_version','temporary-ru-v1','marketing_version','temporary-ru-v1')
from generate_series(1,5) n;
update public.user_roles set role='administrator'
where user_id='10000000-0000-4000-8000-000000000004';

insert into public.company_profiles(
  id,owner_user_id,name,industry_key,country,products,customer_segments,
  sales_channels,employee_count,annual_revenue_key,company_age_years,
  management_levels,key_problems,main_goals,revision,created_at,updated_at
)
select ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
       'Historical company ' || n,'consulting','Россия','Products','Customers',
       'Sales',12,'up_to_10m',7,2,'Problems','Goals',7,
       '2026-09-20 12:00:00+00','2026-09-21 13:00:00+00'
from unnest(array[1,2,4,5]) n;

insert into public.diagnostics(
  id,company_id,created_by_user_id,version_id,status,revision,
  started_at,last_saved_at,submitted_at,completed_at
)
select ('30000000-0000-4000-8000-' || lpad(x.id::text,12,'0'))::uuid,
       ('20000000-0000-4000-8000-' || lpad(x.owner::text,12,'0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(x.owner::text,12,'0'))::uuid,
       v.id,x.status,9,'2026-09-22 12:00:00+00','2026-09-23 12:00:00+00',
       case when x.status='completed' then '2026-09-23 12:00:00+00'::timestamptz end,
       case when x.status='completed' then '2026-09-23 13:00:00+00'::timestamptz end
from (values (1,1,4,'completed'),(2,1,4,'in_progress'),(3,2,4,'completed'),
             (4,4,4,'completed'),(5,5,4,'completed'),(6,1,3,'completed')) x(id,owner,version,status)
join public.diagnostic_versions v on v.version_number=x.version
join public.diagnostic_definitions def on def.id=v.definition_id and def.key='manageability';

insert into public.answers(diagnostic_id,version_id,question_id,numeric_value,revision,created_at)
select d.id,d.version_id,q.id,3,4,'2026-09-23 12:00:00+00'
from public.diagnostics d join lateral (
 select q.id from public.questions q where q.version_id=d.version_id
   and q.answer_type='scale_0_4' order by q.key limit 2
) q on true;
insert into public.answers(diagnostic_id,version_id,question_id,text_value,revision,created_at)
select d.id,d.version_id,q.id,'Preserve confidential historical text',3,'2026-09-23 12:00:00+00'
from public.diagnostics d join lateral (
 select q.id from public.questions q where q.version_id=d.version_id
   and q.answer_type='text' order by q.key limit 1
) q on true;
insert into public.diagnostic_mutations(diagnostic_id,mutation_id,resulting_revision,created_at)
select id,gen_random_uuid(),revision,'2026-09-23 12:00:00+00' from public.diagnostics;

insert into public.diagnostic_company_snapshots(diagnostic_id,company_id,profile_revision,profile_data,captured_at)
select d.id,c.id,c.revision,to_jsonb(c),'2026-09-23 12:00:00+00'
from public.diagnostics d join public.company_profiles c on c.id=d.company_id where d.status='completed';
insert into public.diagnostic_results(
 diagnostic_id,version_id,raw_manageability_index,display_manageability_index,
 maturity_level_id,calculation_version,input_hash,created_at
)
select d.id,d.version_id,75,75,
       (select m.id from public.maturity_levels m where m.version_id=d.version_id and m.key='mature'),
       'v1-fixture','preserved-' || d.id,'2026-09-23 13:00:00+00'
from public.diagnostics d where d.status='completed';
insert into public.diagnostic_block_results(result_id,block_id,version_id,raw_score,display_score,question_count,created_at)
select r.id,b.id,r.version_id,75,75,10,'2026-09-23 13:00:00+00'
from public.diagnostic_results r join public.diagnostic_blocks b on b.version_id=r.version_id and b.weight>0;

insert into public.ai_reports(
 diagnostic_id,version,prompt_version,schema_version,model,status,
 input_snapshot,input_hash,structured_content,provider_request_id,created_at,completed_at
)
select d.id,n,'RU-' || n,'1','local-fixture','completed',
 jsonb_build_object('historical',d.id,'revision',n),'ai-preserved-' || d.id || '-' || n,
 jsonb_build_object('fixture','historical report','revision',n),'mock-' || d.id || '-' || n,
 '2026-09-23 14:00:00+00','2026-09-23 14:01:00+00'
from public.diagnostics d cross join generate_series(1,2) n where d.status='completed';
insert into public.report_artifacts(
 report_id,ai_report_version,format,template_version,status,storage_path,
 content_base64,checksum,generated_at
)
select id,version,'pdf','local-v1','ready','local/' || id || '.pdf',
 'JVBERi1sb2NhbC1maXh0dXJl','preserved-checksum-' || id,'2026-09-23 14:02:00+00'
from public.ai_reports;
insert into public.email_deliveries(
 user_id,diagnostic_id,ai_report_id,ai_report_version,pdf_artifact_id,
 recipient_email,status,provider,provider_message_id,sent_at,created_at,updated_at
)
select d.created_by_user_id,d.id,r.id,r.version,a.id,u.email,'sent','fixture',
 'preserved-email-' || r.id,'2026-09-23 14:03:00+00','2026-09-23 14:02:30+00','2026-09-23 14:03:00+00'
from public.ai_reports r join public.diagnostics d on d.id=r.diagnostic_id
join public.report_artifacts a on a.report_id=r.id join auth.users u on u.id=d.created_by_user_id;

insert into public.lead_requests(
 user_id,company_id,diagnostic_id,report_id,name,email,status,idempotency_key,
 comment,created_at,updated_at
)
select d.created_by_user_id,d.company_id,d.id,r.id,'Historical requester',u.email,
 'closed',gen_random_uuid(),'Preserved comment','2026-09-23 15:00:00+00','2026-09-23 15:01:00+00'
from public.ai_reports r join public.diagnostics d on d.id=r.diagnostic_id
join auth.users u on u.id=d.created_by_user_id where r.version=2;
insert into public.jobs(kind,diagnostic_id,status,deduplication_key,attempts,completed_at)
select 'consultation_notification',diagnostic_id,'completed','lead:' || id,1,'2026-09-23 15:02:00+00'
from public.lead_requests;
insert into public.consultation_notification_deliveries(lead_request_id,job_id,status,provider,provider_message_id,attempt_count,sent_at)
select l.id,j.id,'sent','fixture','preserved-notification-' || l.id,1,'2026-09-23 15:02:00+00'
from public.lead_requests l join public.jobs j on j.deduplication_key='lead:' || l.id;
insert into public.feedback(user_id,company_id,diagnostic_id,rating,useful,improve,created_at,updated_at)
select created_by_user_id,company_id,id,4,'Preserved useful','Preserved improve',
 '2026-09-24 12:00:00+00','2026-09-24 12:00:00+00'
from public.diagnostics where status='completed';
insert into public.jobs(kind,diagnostic_id,status,deduplication_key,attempts,completed_at)
select 'score_diagnostic',id,'completed','score:v1',1,'2026-09-23 13:00:00+00'
from public.diagnostics where status='completed';
