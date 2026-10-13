-- A pinned diagnostic belongs to the first user; the second user must not see
-- retired methodology on the basis of another user's historical diagnostic.
insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'retirement-owner@example.test', now(),
   '{"full_name":"Retirement owner","data_processing_consent":true,"marketing_consent":false,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1"}'),
  ('10000000-0000-4000-8000-000000000002', 'retirement-other@example.test', now(),
   '{"full_name":"Retirement other","data_processing_consent":true,"marketing_consent":false,"data_processing_version":"temporary-ru-v1","marketing_version":"temporary-ru-v1"}');
insert into public.company_profiles (
  id, owner_user_id, name, industry_key, country, products, customer_segments,
  sales_channels, employee_count, annual_revenue_key, company_age_years,
  management_levels, key_problems, main_goals
) values (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'Retirement history', 'consulting', 'Россия', 'P', 'C', 'S', 4,
  'up_to_10m', 2, 1, 'K', 'G'
);
insert into public.diagnostics(id, company_id, created_by_user_id, version_id, status)
select '30000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000001', v.id, 'completed'
from public.diagnostic_versions v join public.diagnostic_definitions d on d.id = v.definition_id
where d.key = 'manageability' and v.version_number = 3;
insert into public.answers(diagnostic_id, version_id, question_id, numeric_value)
select d.id, d.version_id, q.id, 3 from public.diagnostics d
join public.questions q on q.version_id = d.version_id and q.answer_type = 'scale_0_4'
where d.id = '30000000-0000-4000-8000-000000000001' order by q.key limit 1;
insert into public.diagnostic_company_snapshots(diagnostic_id, company_id, profile_revision, profile_data)
select d.id, c.id, c.revision, to_jsonb(c) from public.diagnostics d
join public.company_profiles c on c.id = d.company_id
where d.id = '30000000-0000-4000-8000-000000000001';
insert into public.diagnostic_results(diagnostic_id, version_id, raw_manageability_index,
  display_manageability_index, calculation_version, input_hash)
select id, version_id, 75, 75, 'local-retirement-fixture', 'local-retirement-fixture'
from public.diagnostics where id = '30000000-0000-4000-8000-000000000001';
