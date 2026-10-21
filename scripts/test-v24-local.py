#!/usr/bin/env python3
"""V2.4 integration tests: only the disposable, networkless task container."""
import argparse, concurrent.futures, hashlib, json, secrets, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--container',required=True);a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container=='ai-diagnostic-v24-isolated' and info['Config']['Image']=='postgres:17-alpine'
assert info['HostConfig']['NetworkMode']=='none' and not any(info['NetworkSettings']['Ports'].values()) and info['Config']['Labels'].get('codex.task')=='v24'
db='v24_'+secrets.token_hex(6);checks=[]
def execute(q,database=None):return subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
def sql(q,error=None,database=None):
 r=execute(q,database)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:400])
 elif r.returncode:raise AssertionError(r.stderr[:1000])
 return r.stdout.strip()
def uid(n):return f'10000000-0000-4000-8000-{n:012}'
def sid(n):return f'40000000-0000-4000-8000-{n:012}'
def literal(x):return "'"+json.dumps(x,ensure_ascii=False).replace("'","''")+"'::jsonb"
def actor(n,q,error=None,aal='aal1',session=True):
 claims={'sub':uid(n),'role':'authenticated','aal':aal,'session_id':sid(n) if session else sid(999)}
 return sql('begin;set local request.jwt.claims='+literal(claims).removesuffix('::jsonb')+';set local role authenticated;'+q+';commit;',error)
def read(n,section,id=None,filters=None,error=None):return actor(n,"select public.read_admin_console('"+section+"',"+("'"+id+"'::uuid" if id else 'null')+','+literal(filters or {})+')',error)
def account(n):return sql(f"select id from public.accounts where legacy_origin_user_id='{uid(n)}'")
def change(n,aid,target,reason='Synthetic V24 acceptance',expected='free',error=None):return actor(n,f"select public.admin_assign_account_plan('{aid}','{target}','{reason}','{expected}')",error)
def passed(name):checks.append(name);print('PASS '+name,flush=True)
def protected():
 tables=json.loads(sql("select jsonb_agg(schemaname||'.'||tablename) from pg_tables where schemaname in('public','private','auth')"))
 parts=["select '"+t+"' name,md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) checksum from "+t+' r' for t in tables]
 return json.loads(sql('select jsonb_object_agg(name,checksum) from ('+' union all '.join(parts)+') snapshots'))
def new_company(n,aid,name):return f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals) values('{uid(n)}','{aid}','{name}','consulting','Россия','P','C','S',10,'up_to_10m',3,1,'K','G') returning id"
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 candidate=next((ROOT/'supabase/migrations').glob('*_v24_admin_console_and_plan_audit.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m.name>=candidate.name:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 for n in [1,2,3,4,5]:sql(f"insert into auth.sessions values('{sid(n)}','{uid(n)}') on conflict do nothing")
 before=protected()
 sql(candidate.read_text().rsplit('commit;',1)[0]+'select deliberately_missing_v24_probe();commit;','does not exist')
 assert protected()==before and sql("select to_regclass('private.admin_plan_changes') is null")=='t'
 sql(candidate.read_text());after=protected();assert all(after[t]==v for t,v in before.items())
 passed('one additive migration: forced rollback and apply preserve every pre-existing row')
 # Exercise every one of the 19 advisor-listed authenticated RPCs on the final schema.
 foreign="'99999999-9999-4999-8999-999999999999'::uuid"
 probes={
  'accept_team_invitation':("repeat('f',64)",'team_invitation_unavailable'),
  'close_team_diagnostic':(foreign,'team_not_found'),
  'create_feedback':(foreign+",3,'Useful','Improve'",'diagnostic_not_owned_or_completed'),
  'create_lead_request':(foreign+','+foreign+",'Synthetic lead',null,null,null,"+foreign,'diagnostic_not_owned_or_completed'),
  'create_team_diagnostic':(foreign+",'Foreign company'",'team_not_found'),
  'finalize_team_invitation_identity':("repeat('f',64),true,'temporary-ru-v1','temporary-ru-v1'",'team_invitation_unavailable'),
  'invite_team_participant':(foreign+",'foreign@example.test','Synthetic',repeat('a',64)",'team_not_found'),
  'read_account_plan':(foreign,'not_found'),
  'read_team_pdf_source':(foreign,'team_not_found'),
  'read_team_response':(foreign,'team_response_unavailable'),
  'read_team_results':(foreign,'team_not_found'),
  'refresh_team_results':(foreign,'team_not_found'),
  'renew_team_invitation':(foreign+",repeat('a',64)",'team_not_found'),
  'request_team_report':(foreign,'team_not_found'),
  'request_team_report_v3':(foreign+",'mock'",'team_not_found'),
  'revoke_team_participant':(foreign,'team_not_found'),
  'save_diagnostic_block':(foreign+',0,'+foreign+','+foreign+",'[]',false",'not_found'),
  'save_team_response':(foreign+",0,'{}',false",'team_response_unavailable'),
  'submit_diagnostic':(foreign+',0','not_found')}
 names=','.join("'"+n+"'" for n in probes)
 surface=json.loads(sql("select jsonb_agg(jsonb_build_object('name',p.proname,'empty_path',p.proconfig=array['search_path=\"\"'],'anon',has_function_privilege('anon',p.oid,'execute'),'authenticated',has_function_privilege('authenticated',p.oid,'execute'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in("+names+")"))
 assert len(surface)==19 and all(x['empty_path'] and not x['anon'] and x['authenticated'] for x in surface)
 for name,(args,denial) in probes.items():
  query='select public.'+name+'('+args+')'
  sql('set role anon;'+query,'permission denied')
  actor(1,query,error=denial)
 passed('all 19 advisor RPCs: fixed empty search_path, minimal anon grants, foreign-ID denial and unchanged actor checks')
 for section in ['identity','overview','accounts','users','companies','diagnostics','leads','feedback','metrics','system']:
  read(1,section,error='admin_access_denied')
  assert read(4,section)
 sql("set role anon;select public.read_admin_console('overview')",'permission denied')
 actor(4,"select public.read_admin_console('overview')",error='admin_access_denied',session=False)
 # User 5 is deliberately unconfirmed in the inherited fixture.
 sql(f"update public.user_roles set role='administrator' where user_id='{uid(5)}'")
 read(5,'overview',error='admin_access_denied')
 passed('all admin resources deny anon, ordinary, unconfirmed and revoked sessions; confirmed administrator aal1 is allowed')
 aid=account(1);foreign=json.loads(read(4,'accounts',aid));assert foreign['item']['id']==aid
 actor(4,f"select public.read_account_plan('{aid}')",error='not_found')
 assert actor(4,f"select count(*) from public.company_profiles where account_id='{aid}'",aal='aal2')=='0'
 for t in ['private.team_responses','private.team_qualitative_syntheses','private.admin_plan_changes']:
  actor(4,'select * from '+t,error='permission denied')
 passed('administrator administrative visibility does not grant ordinary foreign Account access or private Team table access')
 change(1,aid,'advanced',error='admin_access_denied')
 change(4,aid,'invented',error='admin_invalid_plan')
 change(4,aid,'advanced',reason='x',error='admin_invalid_reason')
 change(4,'99999999-9999-4999-8999-999999999999','advanced',error='admin_not_found')
 assert sql('select count(*) from private.admin_plan_changes')=='0'
 result=json.loads(change(4,aid,'advanced'));assert result['status']=='changed'
 assert json.loads(actor(1,f"select public.read_account_plan('{aid}')"))['entitlements']=={'multi_company':True,'team_diagnostics':True}
 assert sql("select count(*) from private.admin_plan_changes where old_plan='free' and new_plan='advanced' and source='manual'")=='1'
 change(4,aid,'free',expected='free',error='admin_plan_changed_refresh')
 assert json.loads(change(4,aid,'advanced'))['status']=='unchanged'
 assert sql('select count(*) from private.admin_plan_changes')=='1'
 passed('plan authority, validation, stale state, idempotence, derived entitlements and atomic audit')
 extra=actor(1,new_company(1,aid,'V24 preserved extra company'))
 team=actor(1,f"select public.create_team_diagnostic('{extra}','V24 preserved Team')")
 token=secrets.token_hex(32)
 participant=actor(1,f"select public.invite_team_participant('{team}','account-fixture-3@example.test','Synthetic participant',encode(sha256(convert_to('{token}','UTF8')),'hex'))")
 resource_before=sql(f"select md5(to_jsonb(c)::text) from public.company_profiles c where id='{extra}'")
 assert json.loads(change(4,aid,'free',expected='advanced'))['status']=='changed'
 assert actor(1,f"select count(*) from public.company_profiles where account_id='{aid}'")=='2'
 assert resource_before==sql(f"select md5(to_jsonb(c)::text) from public.company_profiles c where id='{extra}'")
 assert actor(1,f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
 actor(1,new_company(1,aid,'Denied expansion'),error='advanced_required')
 actor(1,f"select public.create_team_diagnostic('{extra}','Denied Team')",error='advanced_required')
 actor(1,f"select public.invite_team_participant('{team}','new@example.test','Denied participant',repeat('a',64))",error='advanced_required')
 assert actor(3,f"select public.accept_team_invitation('{token}')")==participant
 passed('downgrade preserves companies/Team/history and invited participation while denying new expansion')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(lambda _:json.loads(change(4,aid,'advanced'))['status'],range(2)))
 assert sorted(results)==['changed','unchanged']
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{aid}' and status='active'")=='1'
 assert sql(f"select count(*) from private.admin_plan_changes where account_id='{aid}'")=='3'
 sql("update private.admin_plan_changes set reason='changed'",'team_immutable')
 sql('delete from private.admin_plan_changes','team_immutable')
 passed('concurrent duplicate transition has one active plan and one audit event; audit history immutable')
 detail=json.loads(read(4,'team',team));payload=json.dumps(detail)
 for forbidden in ['answers','numeric_value','text_value','lease_token','raw_user_meta_data','structured_summary','privacy_corpus']:
  assert forbidden not in payload,forbidden
 assert detail['result'] is None and detail['report'] is None
 assert json.loads(read(4,'accounts',aid))['plan_history']
 assert len(json.loads(read(4,'accounts',filters={'q':"%' or true --"}))['rows'])==0
 read(4,'accounts',filters={'page':'not-a-page'},error='invalid input syntax')
 read(4,'accounts',filters={'plan':'invented'},error='admin_invalid_filter')
 read(4,'team_pdf','99999999-9999-4999-8999-999999999999')
 passed('support projection contains no raw Team values; search bound parameters and invalid filter denial')
 # Exact DB counts are not limited by the Auth Admin API's first 1000 rows.
 sql("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) select gen_random_uuid(),'v24-count-'||g||'@example.test',now(),jsonb_build_object('full_name','V24 count fixture','data_processing_consent',true,'marketing_consent',false,'data_processing_version','temporary-ru-v1','marketing_version','temporary-ru-v1') from generate_series(1,1001) g")
 metrics=json.loads(read(4,'metrics'));assert metrics['application_users']>1000 and metrics['auth_identities']>1000
 assert metrics['application_users']==int(sql('select count(*) from public.users'))
 assert metrics['individual_started']==int(sql('select count(*) from public.diagnostics'))
 assert metrics['team_diagnostics']==int(sql('select count(*) from public.team_diagnostics'))
 page=json.loads(read(4,'users',filters={'q':'V24 count fixture','page':2}));assert len(page['rows'])==25 and page['total']==1001
 passed('exact application/Auth counts above 1000; individual/Team semantics separate; bounded pagination')
 manifest={'status':'PASS','checks':checks,'externalAIRequests':0,'emailsSent':0,'productionTouched':False,'scope':'isolated PostgreSQL 17 without network or published ports'}
 target=ROOT.parent/'artifacts/v24-production-readiness/isolated-admin-acceptance.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');target.chmod(0o600)
 print(json.dumps(manifest,ensure_ascii=False),flush=True)
finally:
 sql('drop database if exists '+db+' with(force)',database='postgres')
