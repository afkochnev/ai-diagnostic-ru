#!/usr/bin/env python3
"""Isolated PostgreSQL only: preservation, billing authority, races and downgrade continuity."""
import argparse
import concurrent.futures
import json
import secrets
import subprocess
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--container', required=True)
args = p.parse_args()
info = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
assert args.container.startswith('ai-diagnostic-v23-') and info['Config']['Image'] == 'postgres:17-alpine'
assert info['HostConfig']['NetworkMode'] == 'none' and not any(info['NetworkSettings']['Ports'].values())
assert info['Config']['Labels'].get('codex.task') == 'v23'
database = 'v23_' + secrets.token_hex(6)
checks = []


def execute(q, db=None):
    return subprocess.run(['docker', 'exec', '-i', args.container, 'psql', '-X', '-qAt', '-v',
                           'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db or database], input=q,
                          text=True, capture_output=True)


def sql(q, error=None, db=None):
    r = execute(q, db)
    if error:
        assert r.returncode and error in r.stderr, (error, r.stderr)
    elif r.returncode:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


def uid(n): return f'10000000-0000-4000-8000-{n:012}'
def lit(x): return "'" + json.dumps(x, ensure_ascii=False).replace("'", "''") + "'::jsonb"
def account(n): return sql(f"select id from public.accounts where legacy_origin_user_id='{uid(n)}'")
def statement(n, q):
    claims = {'sub': uid(n), 'role': 'authenticated', 'aal': 'aal2' if n == 4 else 'aal1'}
    return "begin;set local request.jwt.claims='" + json.dumps(claims) + "';set local role authenticated;" + q + ';commit;'
def actor(n, q, error=None): return sql(statement(n, q), error)
def service_statement(q): return "begin;set local request.jwt.claims='{\"role\":\"service_role\"}';set local role service_role;" + q + ';commit;'
def service(q, error=None): return sql(service_statement(q), error)
def assign(n, plan): return service(f"select public.assign_account_plan('{account(n)}','{plan}')")
def plan(n): return json.loads(actor(n, f"select public.read_account_plan('{account(n)}')"))
def passed(label): checks.append(label); print('PASS ' + label, flush=True)


def company_insert(n, name, aid=None):
    return f"""insert into public.company_profiles(owner_user_id,account_id,name,industry_key,country,products,
    customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals)
    values('{uid(n)}','{aid or account(n)}','{name}','consulting','Россия','Products','Customers','Sales',12,'up_to_10m',7,2,'Problems','Goals') returning id"""


def add_user(n):
    meta = {'full_name': f'V23 synthetic {n}', 'data_processing_consent': True, 'marketing_consent': False,
            'data_processing_version': 'temporary-ru-v1', 'marketing_version': 'temporary-ru-v1'}
    sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(n)}','v23-{n}@example.test',now(),{lit(meta)})")


def claim(): return json.loads(service("select coalesce(jsonb_agg(j),'[]') from public.claim_team_jobs() j"))
def jobargs(j): return f"'{j['id']}','{j['lease_token']}'"


try:
    sql('create database ' + database, db='postgres')
    sql((ROOT / 'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    candidate = next(x for x in migrations if 'plans_entitlements_billing_foundation' in x.name)
    for m in migrations:
        if m == candidate: continue
        if m.name == '20261013000100_account_foundation.sql':
            sql((ROOT / 'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
        if 'team_aggregation_report' in m.name:
            sql((ROOT / 'supabase/tests/team-foundation.sql').read_text())
            sql("update public.accounts set status='active'")
        sql(m.read_text())
    # A pre-existing multi-company Account must not lose any resource at backfill.
    extra = actor(1, company_insert(1, 'Pre-existing additional company'))
    tables = json.loads(sql("select jsonb_agg(schemaname||'.'||tablename) from pg_tables where schemaname in('public','private','auth')"))
    def snapshot():
        return {t: sql("select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) from " + t + ' r') for t in tables}
    before = snapshot()
    sql(candidate.read_text().rsplit('commit;', 1)[0] + 'select deliberately_invalid_v23();commit;', 'does not exist')
    assert sql("select to_regclass('public.plans') is null") == 't' and before == snapshot()
    sql(candidate.read_text()); assert before == snapshot()
    sql(candidate.read_text(), 'already exists'); assert before == snapshot()
    passed('atomic additive migration, forced rollback, duplicate denial; every existing business row unchanged')
    assert sql("select count(*) from private.account_subscriptions where status='active'") == sql('select count(*) from public.accounts')
    assert sql("select count(*) from public.accounts a where private.effective_account_plan(a.id)<>'free'") == '0'
    assert json.loads(sql("select jsonb_object_agg(p.key,jsonb_build_object('multi_company',m.enabled,'team_diagnostics',t.enabled)) from public.plans p join private.plan_entitlements m on m.plan_id=p.id and m.entitlement_key='multi_company' join private.plan_entitlements t on t.plan_id=p.id and t.entitlement_key='team_diagnostics'")) == {'free': {'multi_company': False, 'team_diagnostics': False}, 'advanced': {'multi_company': True, 'team_diagnostics': True}}
    assert actor(1, 'select count(*) from public.company_profiles') == '2'
    actor(1, company_insert(1, 'Denied third'), 'advanced_required')
    passed('exact two-plan/two-entitlement matrix, default-Free backfill; historical extra Companies remain accessible')
    add_user(6); assert plan(6)['plan'] == 'free'
    assert sql(f"select count(*) from public.company_profiles where account_id='{account(6)}'") == '0'
    first = actor(3, company_insert(3, 'Free first company'))
    actor(3, company_insert(3, 'Free second company'), 'advanced_required')
    passed('new personal Account automatically Free; first Company allowed, second denied in database')
    for table in ['private.account_subscriptions', 'private.plan_entitlements', 'private.entitlement_definitions']:
        actor(1, f'select * from {table}', 'permission denied')
    actor(1, "update public.plans set display_name='Forged'", 'permission denied')
    actor(1, f"select public.assign_account_plan('{account(1)}','advanced')", 'permission denied')
    actor(4, f"select public.assign_account_plan('{account(4)}','advanced')", 'permission denied')
    actor(2, f"select public.read_account_plan('{account(1)}')", 'not_found')
    actor(4, f"select public.read_account_plan('{account(1)}')", 'not_found')
    sql(f"set role anon;select public.read_account_plan('{account(1)}')", 'permission denied')
    # A forged role claim cannot make authenticated execute a service-only write.
    sql(f"begin;set local request.jwt.claims='{{\"role\":\"service_role\",\"sub\":\"{uid(1)}\"}}';set local role authenticated;select public.assign_account_plan('{account(1)}','advanced');commit;", 'permission denied')
    safe = plan(1); assert set(safe) == {'plan', 'display_name', 'entitlements'}
    assert not any(k.startswith('provider') for k in safe)
    passed('private internals/write denial, safe RPC, foreign Account/admin/anon/forged claims do not grant access')
    free_count = sql('select count(*) from public.team_diagnostics')
    actor(1, "select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Free forbidden')", 'advanced_required')
    actor(4, "select public.create_team_diagnostic('20000000-0000-4000-8000-000000000004','Admin forbidden')", 'advanced_required')
    assert sql('select count(*) from public.team_diagnostics') == free_count
    assign(1, 'advanced'); assert all(plan(1)['entitlements'].values())
    another = actor(1, company_insert(1, 'Advanced additional company'))
    team = actor(1, f"select public.create_team_diagnostic('{another}','V23 downgrade continuity')")
    actor(2, company_insert(2, 'Foreign Advanced account', account(1)), 'company account must have the recorded creator as active owner')
    actor(2, company_insert(1, 'Forged recorded creator', account(1)), 'not_found')
    assert plan(2)['plan'] == 'free'
    passed('Free Team/admin gate, immediate upgrade unlocks additional Company and Team; no cross-Account entitlement inheritance')
    participants = []
    for n in [2, 3, 6]:
        token = secrets.token_hex(32)
        email = f'v23-{n}@example.test' if n == 6 else f'account-fixture-{n}@example.test'
        pid = actor(1, f"select public.invite_team_participant('{team}','{email}','Synthetic participant {n}',encode(sha256(convert_to('{token}','UTF8')),'hex'))")
        participants.append((n, pid, token))
    assign(1, 'free')
    assert actor(1, 'select count(*) from public.company_profiles') == '3'
    actor(1, company_insert(1, 'Denied after downgrade'), 'advanced_required')
    actor(1, f"select public.invite_team_participant('{team}','new-v23@example.test','New participant',repeat('0',64))", 'advanced_required')
    renewed = secrets.token_hex(32)
    n, pid, _ = participants[0]
    actor(1, f"select public.renew_team_invitation('{pid}',encode(sha256(convert_to('{renewed}','UTF8')),'hex'))")
    participants[0] = (n, pid, renewed)
    for n, pid, token in participants:
        actor(n, f"select public.accept_team_invitation('{token}')")
        data = json.loads(actor(n, f"select public.read_team_response('{pid}')"))
        answers = {q['id']: 2 if q['answer_type'] == 'scale_0_4' else 'Private synthetic source used only in the disposable database.' for q in data['questions']}
        assert json.loads(actor(n, f"select public.save_team_response('{pid}',0,{lit(answers)},true)"))['status'] == 'completed'
        assert plan(n)['plan'] == 'free'
        actor(1, f"select public.read_team_response('{pid}')", 'team_response_unavailable')
    passed('downgrade preserves Companies, renewals and already-invited Free participants accepting/completing; new expansion denied, answers confidential')
    # Existing queued work must survive downgrade; no billing check in workers.
    while True:
        jobs = claim()
        if not jobs: break
        for j in jobs:
            assert j['kind'] == 'team_aggregate'
            assert service('select public.process_team_aggregate(' + jobargs(j) + ')') in ('completed', 'superseded')
    result = json.loads(actor(1, f"select public.read_team_results('{team}')"))
    assert result['status'] == 'ready'
    rid = actor(1, f"select public.request_team_report('{team}')")
    j = claim()[0]; prepared = json.loads(service('select public.prepare_team_report_job(' + jobargs(j) + ')'))
    summary = {'themes': [], 'strengths': [], 'risks': [], 'alignment_signals': [], 'divergence_signals': []}
    service('select public.store_team_synthesis(' + jobargs(j) + ',' + lit(summary) + ",'mock','v23-local')")
    content = {'participant_count': 3, 'executive_summary': 'Обобщённый результат проверки.', 'maturity': 'Командное среднее.',
               **{k: [] for k in ['strongest_blocks', 'weakest_blocks', 'agreement', 'disagreement', 'qualitative_themes', 'risks', 'priorities', 'next_steps']}}
    service('select public.publish_team_report(' + jobargs(j) + ',' + lit(content) + ",'v23-local')")
    assert actor(1, f"select status from public.team_ai_reports where id='{rid}'") == 'completed'
    actor(1, f"select public.close_team_diagnostic('{team}')")
    assert actor(1, f"select status from public.team_diagnostics where id='{team}'") == 'closed'
    assert actor(1, f"select count(*) from public.team_ai_reports where id='{rid}'") == '1'
    passed('queued aggregate/report completes after downgrade; Free owner requests/reads report and closes existing Team')
    assert sql(f"select count(*) from private.account_subscriptions where account_id='{account(1)}'") == '3'
    assert sql(f"select count(*) from private.account_subscriptions where account_id='{account(1)}' and status='active'") == '1'
    sql("update private.account_subscriptions set source='provider' where status='ended'", 'subscription_history_immutable')
    sql('delete from private.account_subscriptions', 'subscription_history_immutable')
    passed('Free → Advanced → Free preserves immutable history with one active assignment')
    # Two independent sessions, first insert holds the Account lock until commit.
    barrier = threading.Barrier(2)
    def race_company(i):
        barrier.wait()
        return execute(statement(6, company_insert(6, 'Concurrent first ' + str(i)) + ';select pg_sleep(0.2)'))
    with concurrent.futures.ThreadPoolExecutor(2) as pool: raced = list(pool.map(race_company, [1, 2]))
    assert sum(r.returncode == 0 for r in raced) == 1
    assert sum('advanced_required' in r.stderr for r in raced) == 1
    assert sql(f"select count(*) from public.company_profiles where account_id='{account(6)}'") == '1'
    passed('concurrent Free first-Company creates: exactly one commit and one advanced_required')
    aid = account(3); barrier = threading.Barrier(2)
    def race_plan(key):
        barrier.wait()
        return execute(service_statement(f"select public.assign_account_plan('{aid}','{key}');select pg_sleep(0.2)"))
    with concurrent.futures.ThreadPoolExecutor(2) as pool: changed = list(pool.map(race_plan, ['advanced', 'free']))
    assert all(r.returncode == 0 for r in changed), [r.stderr for r in changed]
    assert sql(f"select count(*) from private.account_subscriptions where account_id='{aid}' and status='active'") == '1'
    assert sql(f"select count(*) from private.account_subscriptions where account_id='{aid}'") == '3'
    assert sql(f"select count(*) from private.account_subscriptions a join private.account_subscriptions b on a.account_id=b.account_id and a.id<>b.id and a.effective_from<b.effective_from where a.account_id='{aid}' and (a.effective_until is null or a.effective_until>b.effective_from)") == '0'
    passed('two concurrent plan changes serialize; history intervals coherent, exactly one active plan')
    assign(3, 'advanced')
    assert sql(f"select private.account_has_entitlement('{aid}','unknown')") == 'f'
    service(f"select public.assign_account_plan('{aid}','invalid')", 'invalid_plan')
    assert sql("select private.effective_account_plan(gen_random_uuid())") == 'free'
    # Corruption simulations stay inside rolled-back transactions.
    for change in [
        f"update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where account_id='{aid}' and status='active'",
        "update public.plans set status='archived' where key='advanced'",
        f"alter table private.account_subscriptions disable trigger account_subscription_history;delete from private.account_subscriptions where account_id='{aid}'",
    ]:
        assert sql(f"begin;{change};select private.account_has_entitlement('{aid}','multi_company');rollback;") == 'f'
    sql(f"insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from) select '{aid}',id,'active','manual',clock_timestamp() from public.plans where key='free'", 'account_subscriptions_one_active')
    passed('unknown/missing/ended/invalid plan fail closed; duplicate active assignment prevented by DB invariant')
    # V1 resources remain visible on Free, with original user/account policies.
    assert actor(1, "select count(*) from public.diagnostics where company_id='20000000-0000-4000-8000-000000000001'") != '0'
    assert actor(1, f"select name from public.company_profiles where id='{extra}'") == 'Pre-existing additional company'
    assert plan(1)['plan'] == 'free'
    passed('Free historical V1 diagnostics and previously extra Companies remain usable')
    print(json.dumps({'status': 'PASS', 'checks': len(checks), 'labels': checks, 'realEmails': 0, 'realAICalls': 0, 'remoteDatabasesTouched': False}))
finally:
    execute('drop database if exists ' + database + ' with (force)', db='postgres')
