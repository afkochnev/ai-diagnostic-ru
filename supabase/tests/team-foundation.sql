-- Runs ONLY inside scripts/test-v22a-local.py disposable PostgreSQL.
-- Auth JWT claims are local stubs; this tests SQL authorization, not GoTrue.
create function pg_temp.assert_true(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.denied(query text,expected text) returns void language plpgsql as $$
begin
 begin execute query; exception when others then
  if position(expected in sqlerrm)>0 then return; end if;
  raise;
 end;
 raise exception 'Expected denial: %',expected;
end; $$;
create temp table fixture(k text primary key,v text);
grant select,insert on fixture to authenticated;
insert into fixture values('old_jobs',(select count(*)::text from public.jobs)),('old_individual_answers',(select count(*)::text from public.answers));

set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
set role authenticated;
insert into fixture select 'team',public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Local confidential team')::text;
select pg_temp.assert_true((select count(*)=0 from public.team_participants),'owner not auto participant');
insert into fixture select 'participant',public.invite_team_participant((select v::uuid from fixture where k='team'),'account-fixture-2@example.test','Participant A',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'))::text;
insert into fixture select 'participant_b',public.invite_team_participant((select v::uuid from fixture where k='team'),'account-fixture-3@example.test','Participant B',encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'))::text;
select public.invite_team_participant((select v::uuid from fixture where k='team'),'account-fixture-5@example.test','Unconfirmed',encode(sha256(convert_to(repeat('e',64),'UTF8')),'hex'));
select pg_temp.denied($q$select public.invite_team_participant((select v::uuid from fixture where k='team'),'account-fixture-2@example.test','Duplicate',repeat('0',64))$q$,'team_already_invited');
select pg_temp.denied($q$select public.create_team_diagnostic('20000000-0000-4000-8000-000000000002','Foreign company')$q$,'team_not_found');
select pg_temp.denied($q$select * from private.team_responses$q$,'permission denied');
select pg_temp.denied($q$select * from private.team_invitations$q$,'permission denied');
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select public.accept_team_invitation(repeat('a',64))$q$,'team_invitation_unavailable');
reset role;

-- Unconfirmed users cannot accept even a correct email-bound invitation.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.denied($q$select public.accept_team_invitation(repeat('e',64))$q$,'team_invitation_unavailable');
select pg_temp.assert_true((select count(*)=0 from public.team_diagnostics),'unconfirmed sees no owner metadata');
reset role;

-- Global administrator has no confidential-answer bypass, including AAL2.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}';
set role authenticated;
select pg_temp.assert_true((select count(*)=0 from public.team_diagnostics),'global admin has no team bypass');
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select * from private.team_responses$q$,'permission denied');
reset role;

-- Participant A is also another company owner. Invitation gives no company or owner metadata access.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.assert_true(public.accept_team_invitation(repeat('a',64))=(select v::uuid from fixture where k='participant'),'email-bound acceptance');
select pg_temp.assert_true(public.accept_team_invitation(repeat('a',64))=(select v::uuid from fixture where k='participant'),'same actor acceptance idempotent');
select pg_temp.assert_true((select count(*)=0 from public.team_diagnostics),'participant cannot read owner metadata');
select pg_temp.assert_true((select count(*)=0 from public.company_profiles where id='20000000-0000-4000-8000-000000000001'),'participant cannot read company profile');
select pg_temp.denied($q$select public.accept_team_invitation(repeat('b',64))$q$,'team_invitation_unavailable');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),0,'{}',true)$q$,'team_required_answers_missing');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),0,'{"unknown_question":4}',false)$q$,'team_invalid_answers');
insert into fixture select 'q',q->>'id' from jsonb_array_elements(public.read_team_response((select v::uuid from fixture where k='participant'))->'questions') q where q->>'answer_type'='scale_0_4' limit 1;
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),0,jsonb_build_object((select v from fixture where k='q'),8),false)$q$,'team_invalid_answers');
select pg_temp.assert_true(public.save_team_response((select v::uuid from fixture where k='participant'),0,jsonb_build_object((select v from fixture where k='q'),3),false)->>'status'='started','save begins participant');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),0,'{}',false)$q$,'team_revision_conflict');
select pg_temp.assert_true((public.read_team_response((select v::uuid from fixture where k='participant'))->'answers'->>(select v from fixture where k='q'))='3','participant can resume own copy');
-- Complete with one valid value per required frozen question.
select pg_temp.assert_true(public.save_team_response((select v::uuid from fixture where k='participant'),1,
 (select jsonb_object_agg(q->>'id',case when q->>'answer_type'='scale_0_4' then q->'options'->0->'value' else '"Confidential local text"'::jsonb end)
  from jsonb_array_elements(public.read_team_response((select v::uuid from fixture where k='participant'))->'questions') q),true)->>'status'='completed','valid submit completes');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),2,'{}',false)$q$,'team_response_completed');
reset role;

-- Participant B cannot read A, and has an independent response copy.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';
set role authenticated;
select public.accept_team_invitation(repeat('b',64));
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),2,'{}',false)$q$,'team_response_unavailable');
select pg_temp.assert_true(public.read_team_response((select v::uuid from fixture where k='participant_b'))->'answers'='{}'::jsonb,'copies are separate');
reset role;

-- Check administrator denial again while another participant's answers exist.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2"}';
set role authenticated;
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select * from private.team_responses$q$,'permission denied');
reset role;

-- Owner can only see metadata; answers remain hidden after completion.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.assert_true((select status='completed' from public.team_participants where id=(select v::uuid from fixture where k='participant')),'owner sees completed');
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select public.save_team_response((select v::uuid from fixture where k='participant'),2,'{}',false)$q$,'team_response_unavailable');
select public.renew_team_invitation((select v::uuid from fixture where k='participant'),encode(sha256(convert_to(repeat('c',64),'UTF8')),'hex'));
select public.revoke_team_participant((select v::uuid from fixture where k='participant_b'));
reset role;
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant_b'))$q$,'team_response_unavailable');
select pg_temp.denied($q$select public.accept_team_invitation(repeat('b',64))$q$,'team_invitation_unavailable');
reset role;

-- Rotation invalidates old token, preserving the existing answer copy and binding.
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.denied($q$select public.accept_team_invitation(repeat('a',64))$q$,'team_invitation_unavailable');
select pg_temp.assert_true(public.accept_team_invitation(repeat('c',64))=(select v::uuid from fixture where k='participant'),'renewed link accepted');
select pg_temp.assert_true(public.read_team_response((select v::uuid from fixture where k='participant'))->>'revision'='2','rotation preserves completed answers');
select pg_temp.denied($q$update public.team_participants set status='completed'$q$,'permission denied');
reset role;
-- Expiry, inactive account, anonymous access and legacy isolation.
update private.team_invitations set expires_at=now()-interval '1 second';
set request.jwt.claims='{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}';
set role authenticated;
select pg_temp.denied($q$select public.accept_team_invitation(repeat('c',64))$q$,'team_invitation_unavailable');
reset role;
update public.accounts set status='archived' where legacy_origin_user_id='10000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.denied($q$select public.read_team_response((select v::uuid from fixture where k='participant'))$q$,'team_response_unavailable');
reset role;
set role anon;
select pg_temp.denied($q$select public.accept_team_invitation(repeat('a',64))$q$,'permission denied');
select pg_temp.denied($q$select * from public.team_participants$q$,'permission denied');
reset role;
select pg_temp.assert_true((select count(*)::text from public.jobs)=(select v from fixture where k='old_jobs'),'no worker/AI jobs enqueued');
select pg_temp.assert_true((select count(*)::text from public.answers)=(select v from fixture where k='old_individual_answers'),'no individual answer changes');
