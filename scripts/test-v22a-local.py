#!/usr/bin/env python3
"""Disposable local PostgreSQL only; no URLs, remote refs or credentials accepted."""
import argparse
import json
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container', required=True)
args = parser.parse_args()
if not args.container.startswith('ai-diagnostic-v22a-'):
    raise SystemExit('local container prefix required')
info = json.loads(subprocess.check_output(['docker', 'inspect', args.container]))[0]
if info['Config']['Image'] != 'postgres:17-alpine' or any(info['NetworkSettings']['Ports'].values()) or info['HostConfig']['NetworkMode'] != 'none' or info['Config']['Labels'].get('codex.task') != 'v22a':
    raise SystemExit('isolated task container required')
db = 'v22a_' + secrets.token_hex(6)
def sql(query, database=None, error=None):
    r = subprocess.run(['docker','exec','-i',args.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db], input=query, text=True, capture_output=True)
    if error is not None:
        if r.returncode == 0 or error not in r.stderr: raise AssertionError(r.stderr or 'SQL unexpectedly succeeded')
    elif r.returncode: raise AssertionError(r.stderr)
    return r.stdout.strip()
def user(uid, query):
    return "begin; set local request.jwt.claims='"+json.dumps({'sub':uid,'role':'authenticated','aal':'aal1'})+"'; set local role authenticated; "+query+"; commit;"
try:
    sql('create database '+db+';', 'postgres')
    sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
    migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    for path in migrations:
        if path.name == '20261013000100_account_foundation.sql':
            sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
        if 'team_diagnostic_foundation' in path.name: continue
        sql(path.read_text())
    owner='10000000-0000-4000-8000-000000000001'
    diagnostic='30000000-0000-4000-8000-000000000001'
    report=sql("select id from public.ai_reports where diagnostic_id='"+diagnostic+"' order by version desc limit 1")
    before=int(sql("select count(*) from public.jobs where kind='consultation_notification'"))
    key='40000000-0000-4000-8000-000000000001'
    call="select public.create_lead_request('"+diagnostic+"','"+report+"','Local email fixture',null,null,'Synthetic local only','"+key+"')"
    # Fixture history already contains a lead for this report; close only LOCAL row.
    sql("update public.lead_requests set status='closed' where report_id='"+report+"'")
    a=json.loads(sql(user(owner,call)))
    b=json.loads(sql(user(owner,call)))
    c=json.loads(sql(user(owner,call.replace(key,'40000000-0000-4000-8000-000000000002'))))
    assert a['lead_id']==b['lead_id']==c['lead_id'] and c['duplicate']
    assert int(sql("select count(*) from public.jobs where kind='consultation_notification'"))==before+1
    assert sql("select count(*) from public.consultation_notification_deliveries where lead_request_id='"+a['lead_id']+"'")=='1'
    print('PASS SQL: consultation creates exactly one job and delivery; repeated key and duplicate request create neither additional notification nor job',flush=True)
    team=[p for p in migrations if 'team_diagnostic_foundation' in p.name]
    if team and team[0].read_text().strip():
        legacy_tables=json.loads(sql("select jsonb_agg(schemaname||'.'||tablename order by schemaname,tablename) from pg_tables where schemaname in ('public','private','auth')"))
        def legacy_snapshot():
            return {table:sql("select md5(coalesce(string_agg(to_jsonb(t)::text,',' order by to_jsonb(t)::text),'')) from "+table+" t") for table in legacy_tables}
        preserved=legacy_snapshot()
        old_policies=sql("select md5(string_agg(to_jsonb(p)::text,',' order by to_jsonb(p)::text)) from pg_policies p")
        sql(team[0].read_text())
        assert preserved==legacy_snapshot(), 'Team migration changed legacy rows'
        assert old_policies==sql("select md5(string_agg(to_jsonb(p)::text,',' order by to_jsonb(p)::text)) from pg_policies p where tablename not in ('team_diagnostics','team_participants')"), 'Team migration changed legacy RLS'
        print('PASS SQL: all legacy table values and RLS policies preserved byte-for-byte',flush=True)
        tests=ROOT/'supabase/tests/team-foundation.sql'
        if tests.exists():
            source=tests.read_text()
            sql(source)
            print('PASS SQL: '+str(source.count('select pg_temp.'))+' team authorization/confidentiality assertions',flush=True)
        # Two actual concurrent PostgreSQL sessions race on the same revision.
        sql("update public.accounts set status='active' where legacy_origin_user_id='"+owner+"'")
        tid=sql(user(owner,"select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Concurrent local team')"))
        pid=sql(user(owner,"select public.invite_team_participant('"+tid+"','account-fixture-2@example.test','Concurrent participant',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'))"))
        other='10000000-0000-4000-8000-000000000002'
        sql(user(other,"select public.accept_team_invitation(repeat('d',64))"))
        statement=user(other,"select public.save_team_response('"+pid+"',0,'{}',false)")
        processes=[]
        for _ in range(2):
            process=subprocess.Popen(['docker','exec','-i',args.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            process.stdin.write(statement);process.stdin.close();process.stdin=None
            processes.append(process)
        outcomes=[(process,process.communicate(timeout=20)) for process in processes]
        assert sorted(process.returncode for process,_ in outcomes)==[0,3]
        assert any('team_revision_conflict' in output[1] for _,output in outcomes)
        assert sql("select revision from private.team_responses where participant_id='"+pid+"'")=='1'
        print('PASS SQL: concurrent saves commit once; stale writer receives revision conflict',flush=True)
        responses=sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
        sql((ROOT/'supabase/rollbacks/v22a-team-foundation-disable.sql').read_text())
        sql(user(other,"select public.read_team_response('"+pid+"')"),error='permission denied')
        assert responses==sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
        print('PASS SQL: disable rollback revokes only team API access and preserves every response',flush=True)
finally:
    sql('drop database if exists '+db+' with(force);','postgres')
