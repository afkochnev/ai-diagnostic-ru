begin;
select plan(9);

-- The fixture uses distinct IDs and is rolled back with this test transaction.
do $$
declare
  v_company uuid;
  v_user uuid;
  v_version uuid;
begin
  select d.company_id, d.created_by_user_id, d.version_id
    into v_company, v_user, v_version
  from public.diagnostics d
  where d.id = '9152284d-1974-4a60-a80f-2adee6bf6fd5';

  insert into public.diagnostics(id, company_id, created_by_user_id, version_id, locale, status)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_company, v_user, v_version, 'ru', 'completed');
  insert into public.ai_reports(id, diagnostic_id, version, prompt_version, schema_version, model, status, input_snapshot, input_hash)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'test', 'test', 'test', 'completed', '{}'::jsonb, 'fixture');
  insert into public.lead_requests(id, user_id, company_id, diagnostic_id, report_id, name, email, status, idempotency_key)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', v_user, v_company, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture Lead', 'fixture@example.test', 'closed', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  insert into public.jobs(id, kind, diagnostic_id, deduplication_key)
  values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'consultation_notification', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fixture');
  insert into public.consultation_notification_deliveries(id, lead_request_id, job_id)
  values ('ffffffff-ffff-4fff-8fff-ffffffffffff', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
end $$;

-- Keep the real development job out of this fixture claim. This update is
-- inside the test transaction and is rolled back below; no real job is claimed.
update public.jobs
set lease_expires_at = now() + interval '1 hour'
where id = (select j.id from public.jobs j join public.consultation_notification_deliveries d on d.job_id = j.id join public.lead_requests l on l.id = d.lead_request_id where l.diagnostic_id = '9152284d-1974-4a60-a80f-2adee6bf6fd5' and j.kind = 'consultation_notification');

create temporary table claim_fixture as
select * from public.claim_consultation_notification_jobs(1);

select is((select count(*) from claim_fixture), 1::bigint, 'fixture job is claimed once');
select is((select lead_request_id from claim_fixture)::text, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'claim returns lead request id, not delivery id');
select ok((select lease_token from claim_fixture) is not null, 'claim returns lease token');
select is((select attempt_count from claim_fixture), 1, 'claim returns incremented attempts');
select ok(exists (select 1 from public.lead_requests l join claim_fixture c on c.lead_request_id = l.id), 'claimed lead lookup succeeds');
select ok(exists (select 1 from public.consultation_notification_deliveries d join claim_fixture c on c.lead_request_id = d.lead_request_id), 'claimed delivery lookup succeeds');
select is((select count(*) from public.claim_consultation_notification_jobs(1)), 0::bigint, 'active lease prevents duplicate claim');

update public.jobs set lease_expires_at = now() - interval '1 minute'
where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
select is((select count(*) from public.claim_consultation_notification_jobs(1)), 1::bigint, 'expired lease is reclaimable');
select is((select attempts from public.jobs where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), 2, 'reclaim increments attempts');

select * from finish();
rollback;
