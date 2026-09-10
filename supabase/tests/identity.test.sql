begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
('00000000-0000-4000-8000-000000000001','rls-a@example.test',now(),'{"full_name":"First Test","data_processing_consent":true,"marketing_consent":false,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1","role":"administrator"}'),
('00000000-0000-4000-8000-000000000002','rls-b@example.test',now(),'{"full_name":"Second Test","data_processing_consent":true,"marketing_consent":true,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1"}');
insert into auth.sessions(id, user_id) values
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001');

select is((select role from public.user_roles where user_id='00000000-0000-4000-8000-000000000001'), 'user', 'Signup metadata cannot elevate role');
select is((select count(*)::int from public.user_consents where user_id='00000000-0000-4000-8000-000000000001'), 2, 'Consent records are separate');
select is((select granted from public.user_consents where user_id='00000000-0000-4000-8000-000000000001' and kind='marketing'), false, 'Marketing remains optional');
select throws_ok($$insert into auth.users(id,raw_user_meta_data) values(gen_random_uuid(),'{"full_name":"No consent"}')$$, 'P0001', 'Data processing consent is required', 'Direct Auth signup cannot bypass mandatory consent');

set local role anon;
select throws_ok($$select * from public.user_roles$$, '42501', null, 'Anonymous role cannot read identities');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","session_id":"00000000-0000-4000-8000-000000000011","aal":"aal1","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),1,'Only own profile visible');
select is((select count(*)::int from public.user_consents where user_id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),2,'Only own consents visible');
select throws_ok($$update public.user_roles set role='administrator'$$,'42501',null,'Role updates denied');
select throws_ok($$insert into public.user_roles(user_id,role) values(auth.uid(),'administrator')$$,'42501',null,'Role inserts denied');
select throws_ok($$update public.user_consents set granted=true$$,'42501',null,'Consent history immutable');
select throws_ok($$update public.users set id='00000000-0000-4000-8000-000000000002'$$,'42501',null,'Identity columns cannot be reassigned');
reset role;
update auth.users set raw_user_meta_data='{"role":"administrator"}' where id='00000000-0000-4000-8000-000000000001';
select is((select role from public.user_roles where user_id='00000000-0000-4000-8000-000000000001'),'user','Metadata edits do not change role');
update public.user_roles set role='administrator' where user_id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),1,'Administrator at aal1 cannot read other profiles');
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","session_id":"00000000-0000-4000-8000-000000000011","aal":"aal2","role":"authenticated"}',true);
set local role authenticated;
select is((select count(*)::int from public.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),2,'Administrator at aal2 can read profiles');
reset role;
update public.user_roles set role='user' where user_id='00000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)::int from public.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')),1,'Role revocation immediately applies to old JWT');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","session_id":"00000000-0000-4000-8000-000000000011","aal":"aal1","role":"authenticated"}',true);
insert into public.company_profiles(owner_user_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals)
values (auth.uid(),'First Company','manufacturing','Россия','Products','Clients','Sales',10,'up_to_10m',5,2,'Problems','Goals');
select is((select count(*)::int from public.company_profiles where owner_user_id=auth.uid()),1,'User can create one own company');
select is((select count(*)::int from public.company_profiles where owner_user_id='00000000-0000-4000-8000-000000000001'),1,'User reads own company');
update public.company_profiles set name='Updated Company', revision=2 where owner_user_id=auth.uid();
select is((select name from public.company_profiles where owner_user_id=auth.uid()),'Updated Company','User updates own company');
select throws_ok($$insert into public.company_profiles(owner_user_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals) values(auth.uid(),'Duplicate','manufacturing','Россия','P','C','S',1,'up_to_10m',0,1,'K','G')$$,'23505',null,'Unique primary company constraint prevents duplicate');
select throws_ok($$update public.company_profiles set owner_user_id='00000000-0000-4000-8000-000000000002' where owner_user_id=auth.uid()$$,'P0001','company owner cannot be changed','Owner cannot be changed by client');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","session_id":"00000000-0000-4000-8000-000000000022","aal":"aal1","role":"authenticated"}',true);
select is((select count(*)::int from public.company_profiles),0,'User cannot read another company');
update public.company_profiles set name='Hijacked' where owner_user_id='00000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","session_id":"00000000-0000-4000-8000-000000000011","aal":"aal1","role":"authenticated"}',true);
select is((select name from public.company_profiles where owner_user_id='00000000-0000-4000-8000-000000000001'),'Updated Company','User cannot update another company');
reset role;
select * from finish();
rollback;
