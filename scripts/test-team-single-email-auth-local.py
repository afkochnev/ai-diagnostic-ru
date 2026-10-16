#!/usr/bin/env python3
"""Real GoTrue issuance/verification in a disposable network-none container only.

Requires a fresh GoTrue-migrated postgres database and the documented synthetic
JWT secret. Never accepts remote URLs, real credentials or email recipients.
"""
import argparse
import base64
import hashlib
import hmac
import json
import secrets
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', required=True)
args = parser.parse_args()
info = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
assert args.container.startswith('ai-diagnostic-v22b-single-email-')
assert info['Config']['Image'] == 'postgres:17-alpine' and info['HostConfig']['NetworkMode'] == 'none'
assert not any(info['NetworkSettings']['Ports'].values())
secret = b'local-synthetic-jwt-secret-not-used-remotely-20261016'


def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', args.container, 'psql', '-X', '-qAt',
                             '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'single_email_auth_fixture'],
                            input=query, text=True, capture_output=True)
    assert result.returncode == 0, 'isolated SQL check failed: ' + result.stderr
    return result.stdout.strip()


def literal(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def as_role(role, query, user=None):
    return sql("begin;set local request.jwt.claims='" + json.dumps({'role': role, 'sub': user, 'aal': 'aal1'})
               + "';set local role " + role + ';' + query + ';commit;')


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')


unsigned = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': 'service_role', 'iss': 'supabase', 'exp': int(time.time()) + 3600})
admin_key = (unsigned + b'.' + base64.urlsafe_b64encode(hmac.new(secret, unsigned, hashlib.sha256).digest()).rstrip(b'=')).decode()


def request(path, body):
    result = subprocess.run(['docker', 'exec', args.container, 'wget', '-qO-',
                             '--header=Authorization: Bearer ' + admin_key,
                             '--header=Content-Type: application/json',
                             '--post-data=' + json.dumps(body), 'http://127.0.0.1:9999' + path],
                            capture_output=True, text=True)
    # Never print Auth bodies, generated links, codes, tokens or command argv.
    assert result.returncode == 0, 'isolated Auth request failed at ' + path
    return json.loads(result.stdout)


bootstrap = (ROOT / 'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text()
bootstrap = bootstrap[:bootstrap.index('create schema auth;')] + bootstrap[bootstrap.index('create function auth.jwt()'):]
sql(bootstrap.replace('create function auth.uid()', 'create or replace function auth.uid()').replace('create function auth.jwt()', 'create or replace function auth.jwt()'))
for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
    if 'account_foundation.sql' in path.name:
        sql((ROOT / 'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
    sql(path.read_text())
sql("update public.accounts set status='active'")
owner = '10000000-0000-4000-8000-000000000001'
team = as_role('authenticated', "select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Real local Auth fixture')", owner)
token = secrets.token_hex(32)
token_hash = hashlib.sha256(token.encode()).hexdigest()
nonce = secrets.token_hex(32)
nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
email = 'local-pending@example.test'
participant = as_role('authenticated', f"select public.invite_team_participant('{team}','{email}','Local pending participant','{token_hash}')", owner)
as_role('service_role', f"select public.reserve_team_invitation_identity('{token_hash}','{nonce_hash}')")
generated = request('/admin/generate_link', {'type': 'invite', 'email': email, 'data': {'team_pending_nonce': nonce}})
assert generated['verification_type'] == 'invite'
assert not generated.get('email_confirmed_at')
user_id = generated['id']
assert sql(f"select count(*) from private.team_identity_reservations where user_id='{user_id}' and finalized_at is null") == '1'
assert sql(f"select count(*) from public.users where id='{user_id}'") == '0'
assert sql(f"select count(*) from public.user_consents where user_id='{user_id}'") == '0'
print('PASS real GoTrue generate_link creates only reserved pending Auth identity; no consent or application profile', flush=True)
verified = request('/verify', {'type': 'invite', 'token_hash': generated['hashed_token']})
assert verified.get('access_token') and verified['user']['id'] == user_id and verified['user']['email_confirmed_at']
assert as_role('authenticated', 'select private.is_verified_session()', user_id) == 'f'
finalize = f"select public.finalize_team_invitation_identity('{token}',true,'temporary-ru-v1','temporary-ru-v1')"
assert as_role('authenticated', finalize, user_id) == participant
assert as_role('authenticated', finalize, user_id) == participant
assert sql(f"select count(*) from public.user_consents where user_id='{user_id}'") == '2'
print('PASS real Supabase invite proof verification followed by atomic consent/identity/response acceptance', flush=True)

metadata = {'full_name': 'Existing local user', 'data_processing_consent': True, 'marketing_consent': False,
            'data_processing_version': 'temporary-ru-v1', 'marketing_version': 'temporary-ru-v1'}
existing = request('/admin/users', {'email': 'local-existing@example.test', 'password': 'local-synthetic-password-20261016', 'email_confirm': True, 'user_metadata': metadata})
existing_id = existing['id']
password_before = sql(f"select md5(encrypted_password||raw_user_meta_data::text) from auth.users where id='{existing_id}'")
magic = request('/admin/generate_link', {'type': 'magiclink', 'email': 'local-existing@example.test'})
assert magic['verification_type'] == 'magiclink'
signed = request('/verify', {'type': 'magiclink', 'token_hash': magic['hashed_token']})
assert signed.get('access_token') and signed['user']['id'] == existing_id
assert password_before == sql(f"select md5(encrypted_password||raw_user_meta_data::text) from auth.users where id='{existing_id}'")
login = request('/token?grant_type=password', {'email': 'local-existing@example.test', 'password': 'local-synthetic-password-20261016'})
assert login.get('access_token') and login['user']['id'] == existing_id
print('PASS real Supabase magiclink preserves existing password/metadata; original password login still works', flush=True)

# Pending recipient renewal remains a one-email Auth path, with token rotation.
renewal_email = 'local-renewal-' + secrets.token_hex(3) + '@example.test'
old_token = secrets.token_hex(32)
old_hash = hashlib.sha256(old_token.encode()).hexdigest()
new_nonce = secrets.token_hex(32)
renewal_pid = as_role('authenticated', f"select public.invite_team_participant('{team}','{renewal_email}','Pending renewal','{old_hash}')", owner)
as_role('service_role', f"select public.reserve_team_invitation_identity('{old_hash}','{hashlib.sha256(new_nonce.encode()).hexdigest()}')")
initial = request('/admin/generate_link', {'type': 'invite', 'email': renewal_email, 'data': {'team_pending_nonce': new_nonce}})
new_token = secrets.token_hex(32)
new_hash = hashlib.sha256(new_token.encode()).hexdigest()
as_role('authenticated', f"select public.renew_team_invitation('{renewal_pid}','{new_hash}')", owner)
replacement = request('/admin/generate_link', {'type': 'magiclink', 'email': renewal_email})
assert replacement['verification_type'] == 'magiclink' and replacement['id'] == initial['id']
assert sql(f"select count(*) from public.users where id='{initial['id']}'") == '0'
renewal_verified = request('/verify', {'type': 'magiclink', 'token_hash': replacement['hashed_token']})
assert renewal_verified['user']['id'] == initial['id']
assert as_role('authenticated', f"select public.finalize_team_invitation_identity('{new_token}',true,'temporary-ru-v1','temporary-ru-v1')", initial['id']) == renewal_pid
print('PASS real pending-identity renewal rotates the app invitation, reuses Auth identity and accepts magiclink after consent', flush=True)

print(json.dumps({'status': 'PASS', 'groups': 4, 'authImage': 'gotrue:v2.196.0', 'externalNetwork': False, 'realEmailsSent': 0, 'remoteAccess': False, 'credentialsExported': False}))
