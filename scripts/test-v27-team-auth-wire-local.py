#!/usr/bin/env python3
"""Auth wire evidence SQL contracts in disposable networkless PostgreSQL. No cloud credentials/providers."""
import argparse,subprocess,json,secrets,hashlib,hmac,datetime,concurrent.futures,re,os,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--capture-output');a=p.parse_args()
i=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ('ai-diagnostic-v27-team-auth-evidence-local','ai-diagnostic-v27-team-auth-evidence-ci') and i['Config']['Labels'].get('codex.task')=='v27-team-auth-evidence' and i['Config']['Image']=='postgres:17-alpine' and i['HostConfig']['NetworkMode']=='none' and not any(i['NetworkSettings']['Ports'].values())
db='v27_auth_wire_'+secrets.token_hex(5);checks=[];capture_timings=[]
def sql(q,error=None,database=None):
 started=time.monotonic()
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if 'select public.capture_controlled_team_w2_preservation()' in q:
  elapsed=round(time.monotonic()-started,3);capture_timings.append({'elapsedSeconds':elapsed,'exitCode':r.returncode});print(json.dumps({'localCaptureTiming':capture_timings[-1]}),flush=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:2500])
 elif r.returncode:raise AssertionError(r.stderr[:4000])
 return r.stdout.strip()
def lit(x):return "'"+json.dumps(x,ensure_ascii=False).replace("'","''")+"'::jsonb"
HEADER='Bearer local-existing-service-role-'+('k'*40)
def actor(q,user=None,role='service_role',error=None):return sql('begin;set local request.headers='+lit({'authorization':HEADER}).removesuffix('::jsonb')+';set local request.jwt.claims='+lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def auth(q,user,error=None):return actor(q,user,'authenticated',error)
def service(q,error=None):return actor(q,error=error)
def probe(setup,q,user=None,role='service_role',error=None):
 claims=lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')
 return sql('begin;'+setup+';set local request.headers='+lit({'authorization':HEADER}).removesuffix('::jsonb')+';set local request.jwt.claims='+claims+';set local role '+role+';'+q+';rollback;',error)
def race(q,user=None,role='service_role'):
 claims=lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')
 body='begin;set local request.headers='+lit({'authorization':HEADER}).removesuffix('::jsonb')+';set local request.jwt.claims='+claims+';set local role '+role+';'+q+';commit;'
 def call(_):return subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input=body,text=True,capture_output=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(call,range(2)))
 assert sum(x.returncode==0 for x in results)==1,[x.stderr for x in results]
 return next(x.stdout.strip() for x in results if x.returncode==0)
def ok(t):checks.append(t);print('PASS '+t,flush=True)
def rows():
 return json.loads(sql("create temporary table h(k text,v jsonb);do $$declare t record;v jsonb;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private','auth','storage','supabase_migrations') loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %I.%I x',t.schemaname,t.tablename) into v;insert into h values(t.schemaname||'.'||t.tablename,v);end loop;end;$$;select jsonb_object_agg(k,v) from h;"))
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql("create schema extensions;create extension pgcrypto with schema extensions;alter table auth.users add column recovery_token text not null default '',add column confirmation_token text not null default '';")
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 # Security-column names/types are test-only schema shape, not a hosted Auth
 # engine emulator or proof of the deployed provider schema/behavior.
 auth_shape={**dict.fromkeys('aud role phone email_change phone_change encrypted_password phone_change_token email_change_token_new reauthentication_token email_change_token_current'.split(),'text'),**dict.fromkeys('deleted_at invited_at updated_at banned_until confirmed_at last_sign_in_at recovery_sent_at phone_confirmed_at confirmation_sent_at email_change_sent_at phone_change_sent_at reauthentication_sent_at'.split(),'timestamptz'),**dict.fromkeys('is_sso_user is_anonymous is_super_admin'.split(),'boolean'),'instance_id':'uuid','raw_app_meta_data':'jsonb','email_change_confirm_status':'smallint'}
 for column,kind in auth_shape.items():sql('alter table auth.users add column '+column+' '+kind)
 sql('create table auth.identities(id uuid primary key,email text,user_id uuid,provider text,created_at timestamptz,updated_at timestamptz,provider_id text,identity_data jsonb,last_sign_in_at timestamptz)')
 candidate=next((ROOT/'supabase/migrations').glob('*_controlled_team_w2_continuation.sql'))
 bootstrap=[]
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:bootstrap.append((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:bootstrap.append((ROOT/'supabase/tests/team-foundation.sql').read_text()+"update public.accounts set status='active';")
  bootstrap.append(m.read_text()+'\nRESET ROLE; RESET request.jwt.claims;')
 sql('\n'.join(bootstrap))
 meta={'full_name':'Synthetic W2','data_processing_consent':True,'marketing_consent':False,'data_processing_version':'data-processing-consent-ru-v1','marketing_version':'marketing-consent-ru-v1'}
 def user(label):
  u=sql('select gen_random_uuid()');mail=label+'@example.test'
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{u}','{mail}',now(),"+lit(meta)+f");insert into auth.sessions values('{u}','{u}')")
  return u,mail
 owner,_=user('w2-owner');admin,_=user('w2-admin');foreign,_=user('w2-foreign')
 sql(f"update public.user_roles set role='administrator' where user_id='{admin}'")
 account=sql(f"select id from public.accounts where legacy_origin_user_id='{owner}'")
 company=auth(f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,products,employee_count,key_problems,main_goals) values('{owner}','{account}','W2 synthetic','manufacturing','Synthetic',20,'Synthetic','Synthetic') returning id",owner)
 subscription=sql(f"select id from private.account_subscriptions where account_id='{account}' and status='active'")
 run='e3623f1d-2da0-4dfe-b600-d747f529c5fc';mails=['w2-p'+str(n)+'@example.test' for n in range(3)];emails='array['+','.join("'"+x+"'" for x in mails)+']'
 sql(f"select private.configure_controlled_team_run('{run}','{account}','{company}','{owner}',{emails},clock_timestamp()+interval '45 minutes','{subscription}')")
 auth(f"select public.admin_assign_account_plan('{account}','advanced','W1 synthetic','free')",admin)
 sql('update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true')
 team=auth(f"select public.create_team_diagnostic('{company}','Same historical Team')",owner)
 participants=[]
 for n,mail in enumerate(mails):
  token=secrets.token_hex(32);h=hashlib.sha256(token.encode()).hexdigest();nonce=secrets.token_hex(32)
  pid=auth(f"select public.invite_team_participant('{team}','{mail}','Synthetic {n}','{h}')",owner)
  effect=json.loads(service(f"select public.reserve_controlled_team_effect('{team}','auth_link','{pid}',null)"))
  service(f"select public.reserve_team_invitation_identity('{h}','{hashlib.sha256(nonce.encode()).hexdigest()}')")
  uid=sql('select gen_random_uuid()')
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid}','{mail}',null,"+lit({'team_pending_nonce':nonce})+f");insert into auth.sessions values('{uid}','{uid}')")
  for e in [effect,json.loads(service(f"select public.complete_controlled_team_effect('{effect['reservation_id']}','succeeded','fake-auth');select public.reserve_controlled_team_effect('{team}','invitation_email','{pid}',null)" ).splitlines()[-1])]:
   if e!=effect:service(f"select public.complete_controlled_team_effect('{e['reservation_id']}','succeeded','fake-email')")
  participants.append({'uid':uid,'pid':pid,'hash':h,'token':token})
 sql("update private.team_identity_reservations set expires_at=clock_timestamp()-interval '1 minute' where email=any("+emails+")")
 sql('update private.launch_controls set team_creation_enabled=false,team_invitations_enabled=false')
 service(f"select public.stop_controlled_team_run('{run}','original_window_expired')")
 restored=json.loads(auth(f"select public.admin_assign_account_plan('{account}','free','W1 restoration','advanced')",admin))['subscription_id']
 old_rows=rows();sql(candidate.read_text())

 wire_migration=next((ROOT/'supabase/migrations').glob('*_controlled_team_auth_wire_evidence.sql'))
 # Hosted-only Auth/storage tables are empty test-only skeletons. Their real
 # schemas are never inferred here; the production fixed inventory is explicit.
 capture_tables=set(re.findall(r"select '([a-z_]+[.][a-z_]+)' name,to_jsonb",wire_migration.read_text()));assert len(capture_tables)==116
 sql("create schema storage;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations select 'local-networkless-'||lpad(n::text,2,'0'),'synthetic-not-hosted-migrations',array[]::text[] from generate_series(1,54)n")
 for t in sorted(capture_tables-{'private.controlled_team_auth_wire'}):
  if not sql("select to_regclass('"+t+"')"):
   assert t.startswith(('auth.','storage.')),t
   sql('create table '+t+'(id uuid primary key)')
 pre=rows()
 # The source SHA guard rejects unknown canonical function bodies even when
 # every replacement needle remains present; the whole migration rolls back.
 for signature in ['public.complete_controlled_team_effect(uuid,text,text,jsonb)','public.finalize_controlled_team_w2_identity(uuid,uuid,text,boolean,text,text)']:
  prior=sql("select prosrc from pg_proc where oid='"+signature+"'::regprocedure")
  drift="begin;do $$declare d text;begin d:=pg_get_functiondef('"+signature+"'::regprocedure);execute replace(d,'AS $function$',E'AS $function$\\n');end $$;"
  sql(drift+wire_migration.read_text(),'controlled_team_auth_definition_drift')
  assert rows()==pre and sql("select prosrc from pg_proc where oid='"+signature+"'::regprocedure")==prior
 sql(wire_migration.read_text().rsplit('commit;',1)[0]+'select missing_auth_wire_rollback_probe();commit;','does not exist');assert rows()==pre
 sql(wire_migration.read_text());after=rows()
 for table,rs in pre.items():assert rs==after[table],table
 assert sql('select count(*) from private.controlled_team_auth_wire')=='0'
 ok('additive transactional migration preserves every historical row and starts with zero traces')
 for role in ['anon','authenticated','service_role']:
  sql('set role '+role+';select * from private.controlled_team_auth_wire','permission denied')
  for sig in ['private.controlled_team_auth_mac(text)','private.controlled_team_auth_scope(uuid,uuid,uuid,uuid,text,uuid)','private.controlled_team_auth_wire_immutable()','private.controlled_team_preservation_hmac(text,jsonb)','private.controlled_team_preservation_facts(text,jsonb)','private.controlled_team_preservation_output_valid(text,jsonb)']:
   assert sql(f"select has_function_privilege('{role}','{sig}','EXECUTE')")=='f'
 for role in ['anon','authenticated']:
  actor("select public.check_controlled_team_auth_evidence_key(null,null,null,null,'capability',null,null,null)",role=role,error='permission denied')
 for sig in ['public.check_controlled_team_auth_evidence_key(uuid,uuid,uuid,uuid,text,uuid,text,text)','public.begin_controlled_team_auth_wire(uuid,uuid,uuid,uuid,text,uuid,text,text,text)','public.finish_controlled_team_auth_wire(uuid,timestamptz,timestamptz,integer,text,text,boolean)','public.capture_controlled_team_w2_preservation()']:
  for role in ['anon','authenticated','service_role']:
   assert sql(f"select has_function_privilege('{role}','{sig}','EXECUTE')")==('t' if role=='service_role' else 'f')
 assert sql("select relrowsecurity from pg_class where oid='private.controlled_team_auth_wire'::regclass")=='t'
 ok('RLS and private no-grants; exactly constrained service RPC boundary')
 window=sql('select gen_random_uuid()');plan='a'*64
 def mac(message):return hmac.new(HEADER.encode(),message.encode(),hashlib.sha256).hexdigest()
 def args(p,op,res,challenge=None,window_override=window):
  challenge=challenge or secrets.token_hex(32);msg='aca-w2-auth-evidence-v1\nchallenge\n'+run+'\n'+(window_override or '-')+'\n'+p['pid']+'\n'+p['uid']+'\n'+op+'\n'+(res or '-')+'\n'+challenge
  values=[run,window_override,p['pid'],p['uid'],op,res,challenge,mac(msg)]
  return ','.join('null'if v is None else "'"+v+"'"for v in values)
 def credential(p,token):return mac('aca-w2-auth-evidence-v1\ncredential\n'+run+'\n'+window+'\n'+p['pid']+'\n'+p['uid']+'\n'+token)
 cap=service('select public.check_controlled_team_auth_evidence_key('+args(participants[0],'capability',None,window_override=None)+')');assert json.loads(cap)['matched'] is True
 assert json.loads(cap)['approved_plan_hash'] is None
 assert rows()==after
 wrong=probe('',"set local request.headers='{}';select public.check_controlled_team_auth_evidence_key("+args(participants[0],'capability',None,window_override=None)+')');assert json.loads(wrong)['matched'] is False
 rewritten=lit({'authorization':HEADER+'x'}).removesuffix('::jsonb')
 wrong=probe('',"set local request.headers="+rewritten+";select public.check_controlled_team_auth_evidence_key("+args(participants[0],'capability',None,window_override=None)+')');assert json.loads(wrong)['matched'] is False
 assert rows()==after
 ok('same-header domain-separated capability is read-only; missing/rewritten header fails closed')
 # Additive paired diagnostic: synthetic UUID domain only, so staging needs no
 # production cohort, W2 row or invitation. The real admission RPC stays exact.
 diagnostic_migration=next((ROOT/'supabase/migrations').glob('*_controlled_team_apikey_capability_diagnostic.sql'))
 signature='public.check_controlled_team_auth_header_capability(uuid,uuid,uuid,uuid,text,uuid,text,text,text)'
 def functions():
  return json.loads(sql("select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'config',p.proconfig,'owner',p.proowner,'volatile',p.provolatile,'securityDefiner',p.prosecdef) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prokind='f'"))
 old_functions=functions();diagnostic_rows=rows()
 sql(diagnostic_migration.read_text().rsplit('commit;',1)[0]+'select missing_apikey_diagnostic_rollback_probe();commit;','does not exist')
 assert rows()==diagnostic_rows and functions()==old_functions and sql("select to_regprocedure('"+signature+"')") == ''
 sql(diagnostic_migration.read_text())
 new_functions=functions();added=[x for x in new_functions if x['name']=='check_controlled_team_auth_header_capability']
 assert len(added)==1 and added[0]['volatile']=='s' and added[0]['securityDefiner'] is True and added[0]['config']==['search_path=""']
 assert [x for x in new_functions if x['name']!='check_controlled_team_auth_header_capability']==old_functions and rows()==diagnostic_rows
 for role in ['anon','authenticated','service_role']:
  assert sql(f"select has_function_privilege('{role}','{signature}','EXECUTE')")==('t' if role=='service_role' else 'f')
 assert sql("select not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='"+signature+"'::regprocedure and a.grantee=0)")=='t'
 ok('paired diagnostic migration is additive/transactional/service-only STABLE; all old function definitions/ACLs and every full row including storage/ledger remain exact')
 diag_run='00000000-0000-4000-8000-0000000000d1';diag_pid='00000000-0000-4000-8000-0000000000d2';diag_uid='00000000-0000-4000-8000-0000000000d3'
 api_key='local-service-role-'+('p'*40);authorization=HEADER;challenge='c'*64
 message='aca-w2-auth-evidence-v1\nchallenge\n'+diag_run+'\n-\n'+diag_pid+'\n'+diag_uid+'\ncapability\n-\n'+challenge
 authorization_mac=hmac.new(authorization.encode(),message.encode(),hashlib.sha256).hexdigest();apikey_mac=hmac.new(api_key.encode(),message.encode(),hashlib.sha256).hexdigest()
 diag_values=[diag_run,None,diag_pid,diag_uid,'capability',None,challenge,authorization_mac,apikey_mac]
 def diag(headers,values=None,error=None,role='service_role'):
  assignment="'not-json'" if headers=='MALFORMED_JSON' else lit(headers).removesuffix('::jsonb')
  values=diag_values if values is None else values
  q='set local request.headers='+assignment+';select public.check_controlled_team_auth_header_capability('+','.join('null' if v is None else "'"+str(v).replace("'","''")+"'" for v in values)+')'
  result=probe('set transaction read only',q,role=role,error=error)
  assert rows()==diagnostic_rows
  return None if error else json.loads(result)
 both=diag({'authorization':authorization,'apikey':api_key})
 assert set(both)=={'authorization_matched','apikey_matched','run_id','window_id','participant_id','user_id','operation','reservation_id','diagnostic_only','server_now'}
 assert both['authorization_matched'] is True and both['apikey_matched'] is True and both['diagnostic_only'] is True and both['run_id']==diag_run and both['participant_id']==diag_pid and both['user_id']==diag_uid and both['window_id'] is None and both['reservation_id'] is None
 assert all(secret not in json.dumps(both) for secret in [authorization,api_key,authorization_mac,apikey_mac,challenge])
 diagnostic_rewritten=diag({'authorization':authorization+'x','apikey':api_key});assert diagnostic_rewritten['authorization_matched'] is False and diagnostic_rewritten['apikey_matched'] is True
 diagnostic_rewritten=diag({'authorization':authorization,'apikey':api_key+'x'});assert diagnostic_rewritten['authorization_matched'] is True and diagnostic_rewritten['apikey_matched'] is False
 swapped=diag({'authorization':authorization,'apikey':api_key},diag_values[:-2]+[apikey_mac,authorization_mac]);assert swapped['authorization_matched'] is False and swapped['apikey_matched'] is False
 missing=diag({'apikey':api_key});assert missing['authorization_matched'] is False and missing['apikey_matched'] is True
 missing=diag({'authorization':authorization});assert missing['authorization_matched'] is True and missing['apikey_matched'] is False
 ok('one paired read-only RPC independently distinguishes Authorization and raw apikey; exact domain, scope, key bytes and no secret/MAC/challenge output')
 for malformed in [None,False,123,{},[],api_key+' ', ' '+api_key,'Bearer '+api_key,'short','x'*4097,api_key+'\n',api_key+'é']:
  result=diag({'authorization':authorization,'apikey':malformed});assert result['authorization_matched'] is True and result['apikey_matched'] is False
 for headers in [{},[],None,'MALFORMED_JSON']:
  result=diag(headers);assert result['authorization_matched'] is False and result['apikey_matched'] is False
 for field in [6,7,8]:
  for malformed in [None,'','z'*64,'a'*63,'A'*64]:
   values=diag_values.copy();values[field]=malformed;result=diag({'authorization':authorization,'apikey':api_key},values)
   assert result['authorization_matched'] is (False if field in [6,7] else True) and result['apikey_matched'] is (False if field in [6,8] else True)
 ok('missing/malformed/non-string/whitespace/Bearer-prefixed/non-ASCII/oversized raw apikey and malformed challenge/MAC fail closed without fallback or header normalization')
 for role in ['anon','authenticated']:diag({'authorization':authorization,'apikey':api_key},error='permission denied',role=role)
 for index,bad in [(0,run),(0,None),(2,participants[0]['pid']),(2,None),(3,participants[0]['uid']),(3,None),(1,window),(5,'00000000-0000-4000-8000-0000000000d4'),(4,'issue'),(4,'verify'),(4,None)]:
  values=diag_values.copy();values[index]=bad;diag({'authorization':authorization,'apikey':api_key},values,error='controlled_team_auth_scope_denied')
 assert json.loads(service('select public.check_controlled_team_auth_evidence_key('+args(participants[0],'capability',None,window_override=None)+')'))['matched'] is True
 assert [x for x in functions() if x['name']!='check_controlled_team_auth_header_capability']==old_functions and rows()==diagnostic_rows
 assert sql('select count(*) from private.controlled_team_windows')=='0' and sql('select count(*) from private.controlled_team_auth_wire')=='0' and sql('select count(*) from private.controlled_team_verifications')=='0'
 assert sql("select count(*) from private.controlled_team_effects where run_id='"+run+"'")=='6'
 ok('diagnostic denies API roles and every real/foreign/null/issue/verify/window/reservation scope; old Authorization admission remains exact and all six effects/window0/wire0/verification0/full rows are preserved')
 # PostgREST GET uses a read-only transaction. The argless fixed-source RPC
 # must work there, deny writes/missing headers, and return only commitments.
 capture=json.loads(service('set transaction read only;select public.capture_controlled_team_w2_preservation()'))
 assert capture['format']=='ACA_W2_PRESERVATION_HMAC_V1' and capture['transactionReadOnly']=='on' and len(capture['tables'])==116 and capture['wireTraces']==[]
 key_json=json.dumps({'id':owner})
 owner_key=mac('aca-w2-preservation-v1\nkey\nauth.users\n'+key_json)
 captured_owner=next(x for x in capture['tables']['auth.users']['rows'] if x['key']==owner_key)
 assert set(captured_owner)=={'key','full','fields','facts'} and captured_owner['facts'] is None
 assert all(x['facts'] is None for x in capture['tables']['public.users']['rows']), 'unrelated rows must have no typed facts even when scope columns are absent'
 expected_email=mac('aca-w2-preservation-v1\ncell\nauth.users\n'+key_json+'\nemail\n'+json.dumps('w2-owner@example.test'))
 assert captured_owner['fields']['email']==expected_email
 assert HEADER not in json.dumps(capture) and 'w2-owner@example.test' not in json.dumps(capture) and 'credential_mac' not in json.dumps(capture['wireTraces'])
 service('select public.capture_controlled_team_w2_preservation()','controlled_team_capture_denied')
 service("set transaction read only;set local request.headers='{}';select public.capture_controlled_team_w2_preservation()",'controlled_team_capture_denied')
 for role in ['anon','authenticated']:
  actor('set transaction read only;select public.capture_controlled_team_w2_preservation()',role=role,error='permission denied')
 assert rows()==after
 sql('alter table private.controlled_team_auth_wire disable trigger controlled_team_auth_wire_immutable')
 disabled=json.loads(service('set transaction read only;select public.capture_controlled_team_w2_preservation()'))
 assert disabled['catalogue']!=capture['catalogue'] and disabled['tables']==capture['tables']
 sql('alter table private.controlled_team_auth_wire enable trigger controlled_team_auth_wire_immutable')
 sql('create table public.w2_unexpected_inventory(id uuid primary key)')
 service('set transaction read only;select public.capture_controlled_team_w2_preservation()','controlled_team_capture_denied')
 sql('drop table public.w2_unexpected_inventory')
 assert rows()==after
 # Privilege changes that leave data/table ACLs untouched must still alter
 # the complete security catalogue commitment. All probes are local-only.
 probes=[('grant select(full_name) on public.users to anon','revoke select(full_name) on public.users from anon'),('grant select(version) on supabase_migrations.schema_migrations to anon','revoke select(version) on supabase_migrations.schema_migrations from anon'),('grant usage on schema private to anon','revoke usage on schema private from anon'),('alter default privileges in schema private grant select on tables to anon','alter default privileges in schema private revoke select on tables from anon'),('alter role postgres nobypassrls','alter role postgres bypassrls'),('grant anon to authenticated','revoke anon from authenticated')]
 for change,restore in probes:
  sql(change)
  try:
   changed=json.loads(service('set transaction read only;select public.capture_controlled_team_w2_preservation()'))
   assert changed['catalogue']!=capture['catalogue'] and changed['tables']==capture['tables'],change
  finally:sql(restore)
 assert rows()==after
 ok('column/ledger grants, schema grants, default privileges, owner-role security flags and role memberships alter security commitments without ignoring unchanged data')
 if a.capture_output:
  out=Path(a.capture_output);assert out.is_absolute() and out.parent.resolve()==Path('/private/tmp') and out.name.startswith('aca-v27-w2-sql-preservation-') and out.suffix=='.json'
  fd=os.open(out,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f:json.dump(capture,f,ensure_ascii=False,separators=(',',':'));f.write('\n');f.flush();os.fsync(f.fileno())
  print(json.dumps({'localSQLCapture':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'hostedProviderAttestation':False}),flush=True)
 ok('argless snapshot is read-only service-only full116table HMAC capture; independently verified cell/key domains; no credential/key values escape')
 # Force every scoped facts branch to compile against the canonical local app
 # schema. Empty hosted Auth skeletons do not pretend to attest hosted schema.
 # The temporary SECURITY DEFINER bridge exists only in this rolled-back test.
 facts_input={'id':'b7cc06c7-056c-4fd8-b445-eeaf187cec7c','root_run_id':run,'team_diagnostic_id':'8383647f-10d9-45f9-8c76-f22cf357074b','account_id':'af1b67c8-5c92-4300-92e2-d666ca75c3cd','user_id':'b7cc06c7-056c-4fd8-b445-eeaf187cec7c','participant_id':'0ae17418-e97a-46c7-9000-c13580f72506','legacy_origin_user_id':'b7cc06c7-056c-4fd8-b445-eeaf187cec7c','kind':'data_processing','version':'data-processing-consent-ru-v1','answers':{},'key':'team-results:56ff8470-db76-4b56-b9da-4d4a7a382db1','locale':'ru','content_base64':'U3ludGhldGlj','checksum':hashlib.sha256(b'Synthetic').hexdigest(),'raw_user_meta_data':{'team_pending_nonce':'synthetic'},'raw_app_meta_data':{'provider':'email','providers':['email']}}
 fact_tables=['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.one_time_tokens','public.users','public.accounts','public.user_consents','public.team_block_results','public.team_question_statistics','private.controlled_team_effects','private.account_subscriptions','private.team_identity_reservations','private.team_responses','private.team_jobs','public.team_ai_reports','private.team_qualitative_syntheses','public.team_report_artifacts','public.rate_limit_windows','private.audit_events']
 bridge="create temp table bridge_marker(i integer);create function pg_temp.w2_facts(t text,j jsonb) returns jsonb language sql stable security definer set search_path='' as $$select private.controlled_team_preservation_facts(t,j)$$"
 values=','.join("('"+t+"',"+lit(facts_input)+')' for t in fact_tables)
 branch_facts=json.loads(probe(bridge,"select jsonb_object_agg(t,pg_temp.w2_facts(t,j)) from(values"+values+") x(t,j)"))
 assert set(branch_facts)==set(fact_tables) and all(v is not None for v in branch_facts.values())
 assert branch_facts['auth.users']['emailVerifiedPresent'] is False and branch_facts['public.user_consents']['currentApprovedVersion'] is True and branch_facts['public.team_report_artifacts']['checksumMatchesContent'] is True
 ok('all twenty scoped safe-facts branches compile against canonical local schema; current legal/profile/privacy/PDF predicates return only safe facts')
 sql(f"select private.configure_controlled_team_w2('{window}','{run}','{restored}','{plan}');select private.arm_controlled_team_w2('{window}','{plan}')")
 auth(f"select public.admin_assign_account_plan('{account}','advanced','Auth evidence synthetic','free')",admin)
 initial=rows();historical_effects=sql(f"select jsonb_agg(to_jsonb(e) order by id) from private.controlled_team_effects e where run_id='{run}'")
 for n,p in enumerate(participants):
  p['token']=('T'+str(n))*32;p['cmac']=credential(p,p['token'])
  p['eid']=json.loads(service(f"select public.reserve_controlled_team_w2_access('{window}','{p['pid']}','reauth_link')"))['reservation_id']
  service(f"select public.complete_controlled_team_effect('{p['eid']}','succeeded')",'controlled_team_auth_wire_required')
  start='select public.begin_controlled_team_auth_wire('+args(p,'issue',p['eid'])+',null)'
  if n==0:
   pre=rows();probe('',start,user=owner,role='authenticated',error='permission denied');assert rows()==pre
   key_blocked=json.loads(probe('',"set local request.headers="+rewritten+';'+start));assert key_blocked['admitted'] is False and key_blocked['status']=='blocked'
   assert rows()==pre
   p['trace']=json.loads(race(start))['trace_id']
  else:p['trace']=json.loads(service(start))['trace_id']
  service(start,'controlled_team_auth_wire_consumed')
  sql(f"update auth.users set recovery_token='{p['token']}',confirmation_token=repeat('c',64) where id='{p['uid']}'")
  p['finish']=f"select public.finish_controlled_team_auth_wire('{p['trace']}',clock_timestamp(),clock_timestamp(),200,'succeeded','{p['cmac']}',true)"
  if n==0:
   # All fault injections are local rolled-back SQL, never an Auth retry.
   for q in [p['finish'].replace(p['cmac'],'f'*64),p['finish'].replace(',200,',',401,'),p['finish'].replace("'succeeded'","'unknown'"),p['finish'].replace(',true)',',false)'),p['finish'].replace('clock_timestamp(),clock_timestamp()',"clock_timestamp()+interval '16 seconds',clock_timestamp()")]:
    result=json.loads(probe('',q));assert result['status'] in('failed','unknown') and result['credential_match'] is False
   stopped_setup=f"update private.controlled_team_windows set status='stopped',stopped_at=clock_timestamp(),stop_reason='synthetic-stop' where id='{window}'"
   result=json.loads(probe(stopped_setup,p['finish']));assert result['status']=='failed'
   result=json.loads(probe(stopped_setup,p['finish'].replace("'succeeded'","'unknown'")));assert result['status']=='unknown'
   nonce_drift=f"update auth.users set raw_user_meta_data=raw_user_meta_data||'{{\"team_pending_nonce\":\"foreign\"}}'::jsonb where id='{p['uid']}'"
   result=json.loads(probe(nonce_drift,p['finish']));assert result['status']=='failed'
   ok('failed/mismatched/ambiguous/invalid-order/stopped/cohort-drift wire outcomes persist terminal evidence without success or replay')
  receipt=json.loads(service(p['finish']));assert receipt['status']=='succeeded' and receipt['credential_match'] is True
  service(p['finish'],'controlled_team_auth_trace_immutable')
  service(f"select public.complete_controlled_team_effect('{p['eid']}','succeeded')")
  send=json.loads(service(f"select public.reserve_controlled_team_w2_access('{window}','{p['pid']}','access_email')"))['reservation_id'];service(f"select public.complete_controlled_team_effect('{send}','succeeded')")
  p['vid']=json.loads(service(f"select public.reserve_controlled_team_w2_verification('{window}','{p['pid']}','{p['hash']}')"))['verification_id']
 ok('three issuance slots: durable begin races once; recovery keyed-MAC equality; immutable finish and no completion bypass')
 # Wrong scope/different proof/expired window are tested in rolled-back probes:
 # successful paths and historical evidence are never reset or repaired.
 p=participants[0]
 begin='select public.begin_controlled_team_auth_wire('+args(p,'verify',p['vid'])+f",'{p['cmac']}')"
 probe(f"update auth.users set email_confirmed_at=clock_timestamp() where id='{p['uid']}'",begin,error='controlled_team_auth_scope_denied')
 bad='select public.begin_controlled_team_auth_wire('+args(p,'verify',p['vid'])+",repeat('f',64))"
 blocked=json.loads(probe('',bad));assert blocked['admitted'] is False and blocked['status']=='blocked' and blocked['credential_match'] is False
 # Probe executes begin then checks the sticky stop and trace evidence in SAME
 # rolled-back local transaction; no external effect or retry ever occurs.
 stopped=probe('',bad+f";reset role;select status from private.controlled_team_windows where id='{window}'");assert stopped.splitlines()[-1]=='stopped'
 ok('wrong proof commitment returns durable blocked evidence instead of raising/rolling back; confirmed-user bypass denied')
 for p in participants:
  begin='select public.begin_controlled_team_auth_wire('+args(p,'verify',p['vid'])+f",'{p['cmac']}')"
  p['verify_trace']=json.loads((race if p is participants[0] else service)(begin))['trace_id']
  service(begin,'controlled_team_auth_wire_consumed')
  # A personally verified Auth response is simulated with local SQL only.
  # The real Auth provider is absent from this networkless contract test.
  setup=f"update auth.users set email_confirmed_at=clock_timestamp(),recovery_token='',confirmation_token='',raw_user_meta_data=raw_user_meta_data||'{{\"email_verified\":true}}'::jsonb where id='{p['uid']}'"
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{p['vid']}','{p['hash']}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",p['uid'],'controlled_team_auth_wire_required')
  sql(setup)
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{p['vid']}','{p['hash']}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",p['uid'],'controlled_team_auth_wire_required')
  finish=f"select public.finish_controlled_team_auth_wire('{p['verify_trace']}',clock_timestamp(),clock_timestamp(),200,'succeeded','{p['cmac']}',true)"
  result=json.loads(service(finish));assert result['status']=='succeeded' and result['credential_match'] is True
  service(finish,'controlled_team_auth_trace_immutable')
  assert auth(f"select public.finalize_controlled_team_w2_identity('{window}','{p['vid']}','{p['hash']}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",p['uid'])==p['pid']
  assert sql(f"select granted from public.user_consents where user_id='{p['uid']}' and kind='marketing'")=='f'
 ok('same-UID personally consented verification needs wire trace +consumed credential, then canonical finalizer creates only ordinary identities/false marketing')
 assert sql("select count(*) from private.controlled_team_auth_wire")=='6'
 for q in ["delete from private.controlled_team_auth_wire", "update private.controlled_team_auth_wire set status='reserved'", "update private.controlled_team_auth_wire set credential_mac=repeat('a',64)"]:
  sql(q,'controlled_team_auth_trace_immutable')
 assert historical_effects==sql(f"select jsonb_agg(to_jsonb(e) order by id) from private.controlled_team_effects e where run_id='{run}' and effect in('auth_link','invitation_email')")
 assert sql("select count(*) from private.controlled_team_auth_wire where credential_mac is not null")=='3'
 assert sql("select count(*) from pg_attribute where attrelid='private.controlled_team_auth_wire'::regclass and attname in('token','token_hash','secret','authorization','key') and not attisdropped")=='0'
 final_capture=json.loads(service('set transaction read only;select public.capture_controlled_team_w2_preservation()'))
 assert len(final_capture['wireTraces'])==6 and all('credential_mac' not in x for x in final_capture['wireTraces'])
 assert final_capture['catalogue']==capture['catalogue'], 'all local counterfactual security probes restored exactly'
 rendered=json.dumps(final_capture)
 assert HEADER not in rendered and all(x['cmac'] not in rendered and x['token'] not in rendered for x in participants)
 ok('all six original spent rows exact; private receipts immutable, only keyed opaque issuance commitments persist, no token/key column')
 print(json.dumps({'status':'PASS','checks':len(checks),'network':'none','realAuthProviderCalls':0,'newProductionWindows':0,'captureTimings':capture_timings}))
finally:
 sql('drop database if exists '+db+' with(force)',database='postgres')
