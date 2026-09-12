begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
('00000000-0000-4000-8000-000000000003','diag-a@example.test',now(),'{"full_name":"Diagnostic A","data_processing_consent":true,"marketing_consent":false,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1"}'),
('00000000-0000-4000-8000-000000000004','diag-b@example.test',now(),'{"full_name":"Diagnostic B","data_processing_consent":true,"marketing_consent":false,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1"}');
insert into public.company_profiles(owner_user_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals)
values
('00000000-0000-4000-8000-000000000003','Diagnostic A','software_development','Россия','P','C','S',4,'up_to_10m',2,1,'K','G'),
('00000000-0000-4000-8000-000000000004','Diagnostic B','software_development','Россия','P','C','S',4,'up_to_10m',2,1,'K','G');
create temp table test_ids (diagnostic_id uuid, version_id uuid, company_id uuid, block_id uuid);
grant all on test_ids to authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
insert into public.diagnostics(company_id,created_by_user_id,version_id,current_block_id)
select c.id,auth.uid(),v.id,b.id from public.company_profiles c, public.diagnostic_versions v, public.diagnostic_blocks b
where c.owner_user_id=auth.uid() and v.status='published' and b.version_id=v.id and b.position=1
returning id,version_id,company_id,current_block_id;
insert into test_ids select id,version_id,company_id,current_block_id from public.diagnostics where created_by_user_id=auth.uid();
select is((select count(*)::int from public.diagnostics where created_by_user_id=auth.uid()),1,'User can create a diagnostic');
select throws_ok($$insert into public.diagnostics(company_id,created_by_user_id,version_id,current_block_id) select company_id,auth.uid(),version_id,block_id from test_ids$$,'23505',null,'Only one in-progress diagnostic per company');
insert into public.answers(diagnostic_id,version_id,question_id,numeric_value)
select t.diagnostic_id,t.version_id,q.id,4 from test_ids t join public.questions q on q.version_id=t.version_id and q.answer_type='scale_0_4' limit 1;
select is((select numeric_value::int from public.answers),4,'Scale answer stores internal zero-to-four score');
select throws_ok($$insert into public.answers(diagnostic_id,version_id,question_id,numeric_value) select diagnostic_id,version_id,gen_random_uuid(),4 from test_ids$$,'P0001','question does not belong to pinned methodology','Question must belong to pinned version');
update public.diagnostics set current_block_id=(select block_id from test_ids),revision=2 where id=(select diagnostic_id from test_ids);
select is((select revision from public.diagnostics),2,'Current block update advances revision');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select is((select count(*)::int from public.diagnostics),0,'User cannot read another diagnostic');
update public.diagnostics set revision=99 where id=(select diagnostic_id from test_ids);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
select is((select revision from public.diagnostics),2,'User cannot update another diagnostic');
reset role;
select throws_ok($$update public.diagnostic_versions set content_hash='tampered' where status='published'$$,'P0001','published methodology is immutable','Published methodology cannot be changed');
select * from finish();
rollback;
