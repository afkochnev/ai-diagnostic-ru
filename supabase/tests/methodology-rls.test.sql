begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;

select is((select count(*)::int from public.diagnostic_definitions where key = 'manageability'), 1, 'Authenticated users can resolve manageability definition');
select is((select count(*)::int from public.diagnostic_versions v join public.diagnostic_definitions d on d.id = v.definition_id where d.key = 'manageability' and v.status = 'published'), 2, 'Authenticated users can read both published methodology versions');
select is((select count(*)::int from public.diagnostic_versions v join public.diagnostic_definitions d on d.id = v.definition_id where d.key = 'manageability' and v.status = 'draft'), 0, 'Draft methodology versions remain hidden');

reset role;
set local role anon;
select is((select count(*)::int from public.diagnostic_definitions where key = 'manageability'), 0, 'Anonymous definition access remains denied');

select * from finish();
rollback;
