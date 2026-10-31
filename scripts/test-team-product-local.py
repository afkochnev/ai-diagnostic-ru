#!/usr/bin/env python3
"""Ordinary Team RPC flow in a disposable local database; no remote or provider calls."""
import argparse
import json
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--container', required=True, choices=['supabase_db_aca-v25-local-e2e', 'supabase_db_ai-diagnostic-ru'])
a = p.parse_args()
info = json.loads(subprocess.check_output(['docker', 'inspect', a.container]))[0]
if not info['Config']['Image'].startswith('public.ecr.aws/supabase/postgres:'):
    raise SystemExit('Local Supabase PostgreSQL required')
database = 'team_product_' + secrets.token_hex(6)


def sql(query, error=None, db=None):
    r = subprocess.run(['docker', 'exec', '-i', a.container, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db or database], input=query, text=True, capture_output=True)
    if error:
        assert r.returncode and error in r.stderr, (error, r.stderr)
    elif r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def uid(n):
    return f'10000000-0000-4000-8000-{n:012}'


def actor(n, query, error=None, role='authenticated'):
    claims = {'sub': uid(n), 'role': role, 'aal': 'aal2' if n == 4 else 'aal1'}
    return sql('begin;set local request.jwt.claims=' + literal(claims).removesuffix('::jsonb') + ';set local role ' + role + ';' + query + ';commit;', error)


def service(query, error=None):
    return actor(0, query, error, 'service_role')


def claim():
    return json.loads(service("select coalesce(jsonb_agg(j),'[]') from public.claim_team_jobs_v3(1,600) j"))


def identity(job):
    return "'" + job['id'] + "','" + job['lease_token'] + "'"


def publish(report_id):
    job = claim()[0]
    assert job['kind'] == 'team_ai_report' and job['team_report_id'] == report_id
    prepared = json.loads(service('select public.prepare_team_report_job(' + identity(job) + ')'))
    service('select public.get_team_synthesis_privacy_corpus(' + identity(job) + ')')
    code = """import {mockTeamSynthesisV3,mockTeamReportV3} from './src/server/team/report-v3-provider.ts';
import {mainTeamReportInputV3} from './src/server/team/report-v3-contracts.ts';
let text='';for await(const chunk of process.stdin)text+=chunk;const p=JSON.parse(text);
const synthesis=p.synthesis??mockTeamSynthesisV3(p.qualitative_input);
process.stdout.write(JSON.stringify({synthesis,report:mockTeamReportV3(mainTeamReportInputV3(p.report_input,synthesis))}));"""
    payload = json.loads(subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps(prepared), text=True, capture_output=True, check=True).stdout)
    if not prepared['synthesis']:
        assert service('select public.store_team_synthesis(' + identity(job) + ',' + literal(payload['synthesis']) + ",'openai','gpt-5.6-sol')") == 'stored'
    assert service('select public.publish_team_report(' + identity(job) + ',' + literal(payload['report']) + ",'gpt-5.6-sol')") == 'completed'
    return job


try:
    sql('create database ' + database, db='postgres')
    sql((ROOT / 'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
    sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));create schema extensions;create extension pgcrypto with schema extensions;')
    for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if migration.name > '20261031164322_ordinary_team_product_access.sql' or 'advanced_promo_codes' in migration.name:
            continue
        if 'account_foundation.sql' in migration.name:
            sql((ROOT / 'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
        sql(migration.read_text())
    company = '20000000-0000-4000-8000-000000000001'
    other_company = '20000000-0000-4000-8000-000000000002'
    account = sql(f"select account_id from public.company_profiles where id='{company}'")
    assert sql('select enabled from private.team_product_release') == 'f'
    actor(1, 'select public.activate_team_product_access()', 'permission denied')
    actor(1, f"select public.create_team_diagnostic('{company}','Before activation')", 'controlled_team_unavailable')
    service('select public.activate_team_product_access()')
    actor(1, f"select public.create_team_diagnostic('{company}','Free owner denied')", 'advanced_required')
    service(f"select public.assign_account_plan('{account}','advanced')")
    actor(2, f"select public.create_team_diagnostic('{company}','Foreign company denied')", 'team_not_found')
    actor(2, f"select public.create_team_diagnostic('{other_company}','Free company denied')", 'advanced_required')
    team = actor(1, f"select public.create_team_diagnostic('{company}','Ordinary product Team')")
    print('PASS default closed, service-only activation, verified owner + Advanced required', flush=True)
    policy = json.loads(sql('select jsonb_object_agg(kind,version) from public.consent_documents'))
    meta = {'full_name': 'Product participant', 'data_processing_consent': True, 'marketing_consent': False, **{k + '_version': v for k, v in policy.items()}}
    sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(6)}','account-fixture-6@example.test',now(),{literal(meta)})")
    participants = []
    for n in (2, 3, 6):
        token = secrets.token_hex(32)
        token_hash = sql(f"select encode(sha256(convert_to('{token}','UTF8')),'hex')")
        pid = actor(1, f"select public.invite_team_participant('{team}','account-fixture-{n}@example.test','Product participant {n}','{token_hash}')")
        assert json.loads(service(f"select public.resolve_team_invitation_auth('{token_hash}')"))['email'] == f'account-fixture-{n}@example.test'
        service(f"select public.reserve_team_invitation_identity('{token_hash}','{'b'*64}')")
        finalize = f"select public.finalize_team_invitation_identity('{token}',true,'{policy['data_processing']}','{policy['marketing']}')"
        actor(1, finalize, 'team_invitation_unavailable')
        actor(n, finalize.replace(',true,', ',false,'), 'team_invitation_unavailable')
        assert actor(n, finalize) == pid
        response = json.loads(actor(n, f"select public.read_team_response('{pid}')"))
        answers = {q['id']: n % 5 if q['answer_type'] == 'scale_0_4' else f'Каждое решение требует утверждения собственника и задерживает передачу задач между руководителями. Вариант {n}' for q in response['questions']}
        actor(1, f"select public.save_team_response('{pid}',0,{literal(answers)},false)", 'team_response_unavailable')
        actor(n, f"select public.save_team_response('{pid}',0,{literal(answers)},true)")
        participants.append((n, pid))
    own = json.loads(actor(2, f"select public.read_team_participant_result('{participants[0][1]}')"))
    assert len(own['blocks']) == 8
    actor(1, f"select public.read_team_participant_result('{participants[0][1]}')", 'team_response_unavailable')
    print('PASS normal invitation identity/consent and participant submit; own result stays private', flush=True)
    while jobs := claim():
        j = jobs[0]
        assert j['kind'] == 'team_aggregate'
        service(f"select public.process_team_aggregate('{j['id']}','00000000-0000-4000-8000-000000000000')", 'team_lease_lost')
        service('select public.process_team_aggregate(' + identity(j) + ')')
    assert json.loads(actor(1, f"select public.read_team_results('{team}')"))['status'] == 'ready'
    actor(2, f"select public.read_team_results('{team}')", 'team_not_found')
    print('PASS ordinary claim/lease/aggregation and foreign result denial', flush=True)
    report = actor(1, f"select public.request_team_report_v3('{team}','openai')")
    publish(report)
    old = sql(f"select md5(structured_content::text) from public.team_ai_reports where id='{report}'")
    pdf = f"insert into public.team_report_artifacts(team_report_id,team_report_version,format,template_version,status,storage_path,content_base64,checksum) values('{report}',1,'pdf','team-report-v3-dispersion-percent-v2','ready','local/product.pdf','JVBERi1zeW50aGV0aWM=','{'a'*64}')"
    service(pdf)
    assert actor(1, f"select count(*) from public.team_report_artifacts where team_report_id='{report}'") == '1'
    assert actor(2, f"select count(*) from public.team_report_artifacts where team_report_id='{report}'") == '0'
    newer = actor(1, f"select public.regenerate_team_report_v3('{team}','{report}','openai')")
    assert newer != report
    assert actor(1, f"select public.regenerate_team_report_v3('{team}','{report}','openai')") == newer
    publish(newer)
    assert sql(f"select md5(structured_content::text) from public.team_ai_reports where id='{report}'") == old
    assert sql(f"select count(*) from public.team_ai_reports where team_diagnostic_id='{team}' and status='completed'") == '2'
    service(f"insert into public.team_report_artifacts(team_report_id,team_report_version,format,template_version,status,storage_path,content_base64,checksum) values('{newer}',2,'pdf','team-report-v3-dispersion-percent-v2','ready','local/product-v2.pdf','JVBERi1zeW50aGV0aWM=','{'b'*64}')")
    print('PASS report/synthesis/publish, explicit versioned regeneration and immutable private PDF inserts', flush=True)
    # Fixture only: a stopped historical binding must never join ordinary workers.
    historical = actor(1, f"select public.create_team_diagnostic('{company}','Historical binding fixture')")
    run_id = '90000000-0000-4000-8000-000000000001'
    subscription = sql(f"select id from private.account_subscriptions where account_id='{account}' and status='active'")
    sql(f"insert into private.controlled_team_runs(id,account_id,company_id,owner_user_id,participant_emails,expires_at,status,team_id,expected_subscription_id,stopped_at) values('{run_id}','{account}','{company}','{uid(1)}',array['a@example.test','b@example.test','c@example.test'],now()-interval '1 day','stopped','{historical}','{subscription}',now())")
    sql(f"insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint) values('team_aggregate','{historical}','{'c'*64}')")
    before = sql(f"select md5(to_jsonb(r)::text) from private.controlled_team_runs r where id='{run_id}'")
    actor(1, f"select public.invite_team_participant('{historical}','extra@example.test','Historical denied','{'d'*64}')", 'controlled_team_unavailable')
    assert claim() == []
    assert sql(f"select attempts from private.team_jobs where team_diagnostic_id='{historical}'") == '0'
    sql(f"update private.team_jobs set controlled_run_id=null,controlled_window_id=null where team_diagnostic_id='{historical}'")
    assert claim()==[]
    assert sql(f"select attempts=0 and lease_token is null and lease_expires_at is null from private.team_jobs where team_diagnostic_id='{historical}'")=='t'
    assert sql(f"select md5(to_jsonb(r)::text) from private.controlled_team_runs r where id='{run_id}'") == before
    service('select public.activate_team_product_access()')
    assert sql(f"select md5(to_jsonb(r)::text) from private.controlled_team_runs r where id='{run_id}'") == before
    claims=literal({'sub':uid(0),'role':'service_role'}).removesuffix('::jsonb')
    def blocked_activation(setup):
        sql("begin;"+setup+";set local request.jwt.claims="+claims+";set local role service_role;select public.activate_team_product_access();commit;",'team_product_not_quiescent')
    blocked_activation(f"update private.controlled_team_runs set status='active',expires_at=now()+interval '1 hour' where id='{run_id}'")
    blocked_activation(f"update private.controlled_team_runs set expires_at=now()+interval '1 hour' where id='{run_id}';insert into private.controlled_team_effects(run_id,effect,slot) values('{run_id}','pdf','live-fixture')")
    blocked_activation(f"update private.team_jobs set status='running',lease_token=gen_random_uuid(),lease_expires_at=now()+interval '5 minutes' where team_diagnostic_id='{team}'")
    assert sql(f"select md5(to_jsonb(r)::text) from private.controlled_team_runs r where id='{run_id}'") == before
    # A historical company is still usable for a genuinely NEW ordinary Team.
    fresh=actor(1, f"select public.create_team_diagnostic('{company}','New ordinary Team in same company')")
    assert fresh != historical
    window='90000000-0000-4000-8000-000000000002'
    sql(f"insert into private.controlled_team_windows(id,root_run_id,approved_plan_hash,cohort_fingerprint,expected_subscription_id) values('{window}','{run_id}','{'e'*64}','fixture','{subscription}')")
    fenced_job=sql(f"insert into private.team_jobs(kind,team_diagnostic_id,source_fingerprint) values('team_aggregate','{fresh}','{'f'*64}') returning id")
    sql(f"update private.team_jobs set controlled_window_id='{window}' where id='{fenced_job}'")
    assert claim()==[]
    assert sql(f"select attempts from private.team_jobs where id='{fenced_job}'")=='0'
    print('PASS live run/effect/lease prevent activation; expired history and fenced window never block ordinary launch',flush=True)
    actor(1, f"select public.close_team_diagnostic('{team}')")
    assert json.loads(actor(2, f"select public.read_team_participant_result('{participants[0][1]}')")) == own
    print('PASS historical controlled job/target fenced; new same-company Team and closed own-result remain usable', flush=True)
finally:
    sql('drop database if exists ' + database + ' with(force)', db='postgres')
