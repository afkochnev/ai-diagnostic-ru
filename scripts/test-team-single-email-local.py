#!/usr/bin/env python3
"""Disposable PostgreSQL/RLS checks only; Auth issuance is tested separately."""
import argparse
import json
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', required=True)
args = parser.parse_args()
info = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
if (not args.container.startswith('ai-diagnostic-v22b-single-email-')
        or info['Config']['Image'] != 'postgres:17-alpine'
        or info['HostConfig']['NetworkMode'] != 'none'
        or any(info['NetworkSettings']['Ports'].values())
        or info['Config']['Labels'].get('codex.task') != 'v22b'):
    raise SystemExit('isolated task container required')
database = 'single_email_' + secrets.token_hex(6)
checks = []


def sql(query, error=None, db=None):
    result = subprocess.run(['docker', 'exec', '-i', args.container, 'psql', '-X', '-qAt',
                             '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db or database],
                            input=query, text=True, capture_output=True)
    if error:
        assert result.returncode and error in result.stderr, (error, result.stderr)
    elif result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


def uid(n):
    return f'10000000-0000-4000-8000-{n:012}'


def actor(n, query, error=None, role='authenticated', aal='aal1'):
    claims = {'sub': uid(n), 'role': role, 'aal': aal}
    return sql("begin;set local request.jwt.claims='" + json.dumps(claims) + "';set local role "
               + role + ';' + query + ';commit;', error)


def service(query, error=None):
    return actor(0, query, error, role='service_role')


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def passed(label):
    checks.append(label)
    print('PASS ' + label, flush=True)


try:
    sql('create database ' + database, db='postgres')
    sql((ROOT / 'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
    migrations = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    candidate = next(p for p in migrations if 'team_single_email_consent' in p.name)
    for migration in migrations:
        if 'plans_entitlements_billing_foundation' in migration.name: continue
        if migration == candidate:
            continue
        if 'account_foundation.sql' in migration.name:
            sql((ROOT / 'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
        if 'team_aggregation_report' in migration.name:
            sql((ROOT / 'supabase/tests/team-foundation.sql').read_text())
        sql(migration.read_text())
    sql("update public.accounts set status='active'")
    tables = json.loads(sql("select jsonb_agg(schemaname||'.'||tablename) from pg_tables where schemaname in('public','private','auth')"))

    def snapshot():
        return {t: sql("select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) from " + t + ' r') for t in tables}

    before = snapshot()
    sql(candidate.read_text().rsplit('commit;', 1)[0] + 'select deliberately_invalid_single_email();commit;', 'does not exist')
    assert sql("select to_regclass('private.team_identity_reservations') is null") == 't'
    assert before == snapshot()
    sql(candidate.read_text())
    assert before == snapshot()
    sql(candidate.read_text(), 'already exists')
    passed('transactional migration, no baseline row changes, duplicate apply fails')

    billing = next((p for p in migrations if 'plans_entitlements_billing_foundation' in p.name), None)
    if billing:
        preserved = snapshot(); sql(billing.read_text()); assert preserved == snapshot()
        owner_account = sql("select id from public.accounts where legacy_origin_user_id='" + uid(1) + "'")
        service("select public.assign_account_plan('" + owner_account + "','advanced')")
        passed('V2.3 current-schema onboarding regression: inviter Advanced, participant personal Account remains Free')

    team = actor(1, "select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Single email fixture')")
    token = secrets.token_hex(32)
    token_hash = sql(f"select encode(sha256(convert_to('{token}','UTF8')),'hex')")
    nonce = secrets.token_hex(32)
    nonce_hash = sql(f"select encode(sha256(convert_to('{nonce}','UTF8')),'hex')")
    email = 'single-new@example.test'
    participant = actor(1, f"select public.invite_team_participant('{team}','{email}','New pending participant','{token_hash}')")
    reserve = f"select public.reserve_team_invitation_identity('{token_hash}','{nonce_hash}')"
    actor(1, reserve, 'permission denied')
    actor(1, reserve, 'permission denied', role='anon')
    actor(1, "select public.finalize_team_invitation_identity('invalid',true,'v','v')", 'permission denied', role='anon')
    service("select count(*) from private.team_identity_reservations", 'permission denied')
    target = json.loads(service(reserve))
    assert target['create_user'] and target['email'] == email
    passed('only service can reserve a validated invitation; reservation creates no Auth user')

    auth_insert = f"insert into auth.users(id,email,raw_user_meta_data) values('{uid(99)}','{email}',"
    sql(auth_insert + literal({'team_pending_nonce': 'wrong'}) + ')', 'Data processing consent is required')
    sql(auth_insert + literal({'team_pending_nonce': nonce}) + ')')

    def no_app_identity():
        return sql(f"select (select count(*) from public.users where id='{uid(99)}')+(select count(*) from public.user_roles where user_id='{uid(99)}')+(select count(*) from public.user_consents where user_id='{uid(99)}')+(select count(*) from public.accounts where legacy_origin_user_id='{uid(99)}')+(select count(*) from public.account_memberships where user_id='{uid(99)}')") == '0'

    assert no_app_identity()
    assert sql(f"select count(*) from private.team_identity_reservations where user_id='{uid(99)}' and finalized_at is null") == '1'
    passed('trusted reservation defers profile/role/consents/Account/membership; forged metadata alone rejected')
    finalize = f"select public.finalize_team_invitation_identity('{token}',true,'temporary-ru-v1','temporary-ru-v1')"
    actor(99, finalize, 'team_invitation_unavailable')
    sql(f"update auth.users set email_confirmed_at=now() where id='{uid(99)}'")
    assert actor(99, 'select private.is_verified_session()') == 'f'
    actor(99, f"select public.accept_team_invitation('{token}')", 'team_invitation_unavailable')
    actor(99, "select count(*) from private.team_identity_reservations", 'permission denied')
    actor(99, finalize.replace(',true,', ',false,'), 'team_invitation_unavailable')
    actor(99, finalize.replace("'temporary-ru-v1'", "'old'"), 'team_policy_changed')
    actor(2, finalize, 'team_invitation_unavailable')
    assert no_app_identity()
    passed('unverified, missing consent, stale policy, wrong recipient denied; pending verified Auth cannot bypass application gate')

    sql(f"update public.team_diagnostics set status='closed' where id='{team}'")
    actor(99, finalize, 'team_invitation_unavailable')
    assert no_app_identity()
    sql(f"update public.team_diagnostics set status='open' where id='{team}'")
    sql(f"update public.team_participants set revoked_at=now() where id='{participant}'")
    actor(99, finalize, 'team_invitation_unavailable')
    assert no_app_identity()
    sql(f"update public.team_participants set revoked_at=null where id='{participant}'")
    passed('closed and revoked invitations cannot provision identity; failed acceptance rolls back all writes')

    assert actor(99, finalize) == participant
    assert actor(99, finalize) == participant
    assert actor(99, 'select private.is_verified_session()') == 't'
    assert sql(f"select count(*) from public.user_consents where user_id='{uid(99)}' and source='team_invitation'") == '2'
    assert sql(f"select count(*) from public.user_consents where user_id='{uid(99)}' and kind='marketing' and granted") == '0'
    assert sql(f"select count(*) from public.accounts where legacy_origin_user_id='{uid(99)}'") == '1'
    assert sql(f"select count(*) from public.account_memberships where user_id='{uid(99)}'") == '1'
    assert sql(f"select count(*) from public.company_profiles where owner_user_id='{uid(99)}'") == '0'
    assert sql(f"select user_id from private.team_responses where participant_id='{participant}'") == uid(99)
    actor(1, f"select public.read_team_response('{participant}')", 'team_response_unavailable')
    assert json.loads(actor(99, f"select public.read_team_response('{participant}')"))['participant_id'] == participant
    passed('consent provisions once, binds personal response, no Company or inviter membership; owner answer denial')

    old_auth = sql(f"select md5(to_jsonb(u)::text) from auth.users u where id='{uid(2)}'")
    token2 = secrets.token_hex(32)
    hash2 = sql(f"select encode(sha256(convert_to('{token2}','UTF8')),'hex')")
    p2 = actor(1, f"select public.invite_team_participant('{team}','account-fixture-2@example.test','Preserve existing name','{hash2}')")
    assert actor(2, finalize.replace(token, token2)) == p2
    assert old_auth == sql(f"select md5(to_jsonb(u)::text) from auth.users u where id='{uid(2)}'")
    passed('existing identity metadata untouched by consent/acceptance')

    sql(f"insert into auth.users(id,email) values('{uid(98)}','ordinary@example.test')", 'Data processing consent is required')
    metadata = {'full_name': 'Normal signup', 'data_processing_consent': True, 'marketing_consent': False,
                'data_processing_version': 'temporary-ru-v1', 'marketing_version': 'temporary-ru-v1'}
    sql(f"insert into auth.users(id,email,raw_user_meta_data) values('{uid(98)}','ordinary@example.test',{literal(metadata)})")
    assert sql(f"select count(*) from public.accounts where legacy_origin_user_id='{uid(98)}'") == '1'
    passed('ordinary signup retains original explicit-consent provisioning')

    admin_token = secrets.token_hex(32)
    actor(1, f"select public.invite_team_participant('{team}','account-fixture-4@example.test','Administrator recipient',encode(sha256(convert_to('{admin_token}','UTF8')),'hex'))")
    actor(4, finalize.replace(token, admin_token), 'team_invitation_unavailable')
    passed('new finalization RPC does not bypass existing administrator assurance requirement')

    disabled_token = secrets.token_hex(32)
    disabled_hash = sql(f"select encode(sha256(convert_to('{disabled_token}','UTF8')),'hex')")
    disabled_nonce = secrets.token_hex(32)
    disabled_nonce_hash = sql(f"select encode(sha256(convert_to('{disabled_nonce}','UTF8')),'hex')")
    actor(1, f"select public.invite_team_participant('{team}','pending-disable@example.test','Pending disable','{disabled_hash}')")
    service(f"select public.reserve_team_invitation_identity('{disabled_hash}','{disabled_nonce_hash}')")
    sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(97)}','pending-disable@example.test',now(),{literal({'team_pending_nonce':disabled_nonce})})")
    sql((ROOT / 'supabase/rollbacks/team-single-email-disable.sql').read_text())
    assert actor(97, 'select private.is_verified_session()') == 'f'
    assert actor(2, 'select private.is_verified_session()') == 't'
    service(reserve, 'permission denied')
    actor(97, finalize.replace(token, disabled_token), 'permission denied')
    assert sql(f"select count(*) from private.team_identity_reservations where user_id='{uid(97)}' and finalized_at is null") == '1'
    passed('non-destructive disable preserves pending guard/data and ordinary verified identities')
    print(json.dumps({'status': 'PASS', 'groups': len(checks), 'remoteAccess': False}))
finally:
    sql('drop database if exists ' + database + ' with (force)', db='postgres')
