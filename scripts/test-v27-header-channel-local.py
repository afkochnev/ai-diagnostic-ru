#!/usr/bin/env python3
"""Synthetic header-channel SQL contracts in owned networkless PostgreSQL only."""
import argparse, datetime, hashlib, hmac, json, pathlib, re, secrets, subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);p.add_argument('--evidence-dir');a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ['ai-diagnostic-v27-header-channel-local','ai-diagnostic-v27-header-channel-ci'] and info['Config']['Labels'].get('codex.task')=='v27-header-channel' and info['Config']['Image']=='postgres:17-alpine' and info['HostConfig']['NetworkMode']=='none' and not info['HostConfig'].get('Binds') and not any(info['NetworkSettings']['Ports'].values())
DB='header_channel_'+secrets.token_hex(5);checks=[];calls=0
SIG='public.inspect_controlled_team_auth_header_channels(uuid,uuid,uuid,uuid,text,uuid,text,text)'
SCOPE=['00000000-0000-4000-8000-0000000000d1',None,'00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000d3','capability',None]
PROBE=secrets.token_hex(32);CHALLENGE=secrets.token_hex(32);assert PROBE!=CHALLENGE
MESSAGE='aca-w2-header-channel-diagnostic-v2\nchallenge\n'+SCOPE[0]+'\n-\n'+SCOPE[2]+'\n'+SCOPE[3]+'\ncapability\n-\n'+CHALLENGE
MAC=hmac.new(PROBE.encode(),MESSAGE.encode(),hashlib.sha256).hexdigest()
KEYS={'authorization_class','apikey_class','authorization_payload_equals_apikey','jwt_role_is_service_role','authorization_present','apikey_present','custom_probe_matched'}
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or DB],input=q,text=True,capture_output=True,timeout=45)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:1500])
 elif r.returncode:raise AssertionError(r.stderr[:1500])
 return r.stdout.strip()
def literal(x):return 'null' if x is None else "'"+str(x).replace("'","''")+"'"
def json_setting(x):return literal(json.dumps(x,separators=(',',':')))
def extract(path,start):
 s=path.read_text();n=s.index(start);return s[n:s.index('end $$;',n)+len('end $$;')]
def functions():
 return json.loads(sql("select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),'acl',p.proacl,'config',p.proconfig,'owner',p.proowner,'volatility',p.provolatile,'security',p.prosecdef) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('auth','public','private') and p.prokind='f'"))
def rows():
 return json.loads(sql("create temp table result(k text,v jsonb);do $$declare t record;v jsonb;begin for t in select schemaname,tablename from pg_tables where schemaname in('auth','public','private','storage','supabase_migrations') loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %I.%I x',t.schemaname,t.tablename) into v;insert into result values(t.schemaname||'.'||t.tablename,v);end loop;end $$;select jsonb_object_agg(k,v) from result"))
def ok(name):checks.append(name);print('PASS '+name,flush=True)
def call(headers=None,claims=None,role='service_role',scope=None,challenge=CHALLENGE,mac=MAC,error=None,raw_headers=None,raw_claims=None):
 global calls
 calls+=1
 hdr=literal(raw_headers) if raw_headers is not None else json_setting(headers or {})
 jwt=literal(raw_claims) if raw_claims is not None else json_setting({'role':'service_role'} if claims is None else claims)
 args=(SCOPE if scope is None else scope)+[challenge,mac]
 q='begin isolation level repeatable read read only;set local request.headers='+hdr+';set local request.jwt.claims='+jwt+';set local role '+role+';select public.inspect_controlled_team_auth_header_channels('+','.join(map(literal,args))+');rollback;'
 result=sql(q,error)
 if error:return
 result=json.loads(result);assert set(result)==KEYS and result['authorization_class'] in ['absent','bearer_jwt','bearer_sb_secret','bearer_other','non_bearer'] and result['apikey_class'] in ['absent','jwt','sb_secret','sb_publishable','other']
 assert all(type(result[k]) is bool for k in KEYS-{'authorization_class','apikey_class'})
 assert all(secret not in json.dumps(result) for secret in [PROBE,CHALLENGE,MAC])
 return result
try:
 sql('create database '+DB,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('create schema private;create schema extensions;create schema storage;create schema supabase_migrations;create extension pgcrypto with schema extensions;create table public.fixture(id int primary key,value text);insert into public.fixture values(1,\'synthetic unchanged\');create table private.fixture(id int primary key,value jsonb);insert into private.fixture values(1,\'{"consent":"temporary-ru-v1"}\');create table storage.objects(id int primary key,metadata jsonb);insert into storage.objects values(1,\'{"synthetic":true}\');create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations select lpad(n::text,14,\'0\'),\'synthetic-local-not-hosted-ledger\',array[]::text[] from generate_series(1,55)n')
 sql(extract(ROOT/'supabase/migrations/20261023180524_controlled_team_smoke_guard.sql','create function private.controlled_team_service()'))
 sql(extract(ROOT/'supabase/migrations/20261024205401_controlled_team_auth_wire_evidence.sql','create function private.controlled_team_auth_mac('))
 sql('revoke all on function private.controlled_team_service(),private.controlled_team_auth_mac(text) from public,anon,authenticated,service_role')
 first=next((ROOT/'supabase/migrations').glob('*_controlled_team_apikey_capability_diagnostic.sql'));sql(first.read_text())
 migration=next((ROOT/'supabase/migrations').glob('*_controlled_team_header_channel_diagnostic.sql'));source=migration.read_text();before=rows();old_functions=functions()
 sql(source.rsplit('commit;',1)[0]+'select missing_channel_rollback_probe();commit;',error='does not exist')
 assert functions()==old_functions and rows()==before and sql("select to_regprocedure('"+SIG+"')")==''
 sql(source);new_functions=functions();added=[x for x in new_functions if x['name']=='inspect_controlled_team_auth_header_channels'];assert len(added)==1
 assert [x for x in new_functions if x['name']!='inspect_controlled_team_auth_header_channels']==old_functions and rows()==before
 assert added[0]['volatility']=='s' and added[0]['security'] is True and added[0]['config']==['search_path=""']
 for role in ['anon','authenticated','service_role']:
  assert sql("select has_function_privilege('"+role+"','"+SIG+"','EXECUTE')")==('t' if role=='service_role' else 'f')
 ok('additive transactional migration preserves all loaded canonical helpers/prior paired RPC definitions/ACLs and every fixture row including ledger55; exactly one service-only STABLE function')
 # Classification is syntactic only. No JWT decoding or claims derived from
 # header text; exactly three nonempty unpadded base64url segments are required.
 for value,expected,present in [(None,'absent',False),(123,'absent',False),(False,'absent',False),({},'absent',False),('','non_bearer',True),('Basic opaque','non_bearer',True),('bearer a.b.c','non_bearer',True),(' Bearer a.b.c','non_bearer',True),('Bearer a.b.c','bearer_jwt',True),('Bearer sb_secret_valid_9-X','bearer_sb_secret',True),('Bearer opaque','bearer_other',True),('Bearer ','bearer_other',True),('Bearer sb_publishable_value','bearer_other',True),('Bearer sb_secret_','bearer_other',True)]:
  r=call({'authorization':value});assert r['authorization_class']==expected and r['authorization_present'] is present and r['apikey_class']=='absent' and r['authorization_payload_equals_apikey'] is False
 for value,expected,present in [(None,'absent',False),(123,'absent',False),([], 'absent',False),('', 'other',True),('a.b.c','jwt',True),('sb_secret_valid_9-X','sb_secret',True),('sb_publishable_valid_9-X','sb_publishable',True),('opaque','other',True),('sb_secret_','other',True),(' sb_secret_value','other',True)]:
  r=call({'apikey':value});assert r['apikey_class']==expected and r['apikey_present'] is present and r['authorization_class']=='absent' and r['authorization_payload_equals_apikey'] is False
 for malformed in ['a..c','.b.c','a.b.','a.b.c.d','a.b.c=','a+b.c.d','a.b.é','a.b.c\n','a.b.c ']:
  r=call({'authorization':'Bearer '+malformed,'apikey':malformed});assert r['authorization_class']=='bearer_other' and r['apikey_class']=='other' and r['authorization_payload_equals_apikey'] is True
 ok('all conservative Authorization/apikey classes, empty-string presence and strict compact-JWT shape; no trim/case-fold/decode or value/length/hash output')
 for auth,key,equal in [('Bearer a.b.c','a.b.c',True),('Bearer opaque','opaque',True),('Bearer ','',True),('opaque','opaque',False),('bearer opaque','opaque',False),('Bearer opaque ','opaque',False),('Bearer opaque','OPAQUE',False),('Bearer opaque',None,False),(None,None,False)]:
  r=call({'authorization':auth,'apikey':key});assert r['authorization_payload_equals_apikey'] is equal
 for bad in ['not-json','null','[]']:
  r=call(raw_headers=bad);assert r['authorization_class']==r['apikey_class']=='absent' and not r['authorization_present'] and not r['apikey_present'] and not r['authorization_payload_equals_apikey']
 ok('payload equality uses exact payload only after exact Bearer prefix; absent values never equal and malformed headers reveal only absent classifications')
 r=call({'authorization':'Bearer opaque','apikey':'opaque','x-aca-w2-probe':PROBE});assert r['custom_probe_matched'] is True and r['jwt_role_is_service_role'] is True
 for probe in [None,123,False,{},PROBE+'x',PROBE[:-1],'A'*64,PROBE+'\n',' '+PROBE,'é'*64,PROBE[:-1]+('0' if PROBE[-1]!='0' else '1')]:
  r=call({'x-aca-w2-probe':probe});assert r['custom_probe_matched'] is False
 for challenge,mac in [(None,MAC),('',MAC),('a'*63,MAC),('z'*64,MAC),(CHALLENGE,None),(CHALLENGE,'z'*64),(CHALLENGE,'f'*64)]:
  assert call({'x-aca-w2-probe':PROBE},challenge=challenge,mac=mac)['custom_probe_matched'] is False
 old_domain=hmac.new(PROBE.encode(),MESSAGE.replace('aca-w2-header-channel-diagnostic-v2','aca-w2-auth-evidence-v1').encode(),hashlib.sha256).hexdigest()
 assert call({'x-aca-w2-probe':PROBE},mac=old_domain)['custom_probe_matched'] is False
 ok('custom header challenge proves only exact forwarded random64hex via separate v2 domain; missing/malformed/rewritten/domain-mismatched custom key fails closed with seven safe fields only')
 for role in ['anon','authenticated']:call({'x-aca-w2-probe':PROBE},role=role,error='permission denied')
 for claims in [{},{'role':'authenticated'},{'role':None},{'role':123},{'role':['service_role']},[],False]:call(claims=claims,error='controlled_team_service_required')
 for raw in ['not-json','null','[]','{"role":true}']:call(raw_claims=raw,error='controlled_team_service_required')
 call(role='postgres',error='controlled_team_service_required')
 for index,bad in [(0,'e3623f1d-2da0-4dfe-b600-d747f529c5fc'),(0,None),(2,None),(3,None),(1,'00000000-0000-4000-8000-0000000000d4'),(5,'00000000-0000-4000-8000-0000000000d4'),(4,'issue'),(4,'verify'),(4,None)]:
  scoped=SCOPE.copy();scoped[index]=bad;call(scope=scoped,error='controlled_team_auth_scope_denied')
 assert rows()==before and [x for x in functions() if x['name']!='inspect_controlled_team_auth_header_channels']==old_functions
 ok('service authority comes from strict JWT role plus unchanged guard, not SECURITY DEFINER current_user; anon/auth, malformed claims and all non-synthetic/window/reservation/issue/verify scopes denied without mutations')
 expected=json.loads(sql("select jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'prosecdef',p.prosecdef,'provolatile',p.provolatile,'proconfig',p.proconfig,'acl',p.proacl::text,'definitionSHA256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),'sourceSHA256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid='"+SIG+"'::regprocedure"))
 tag='$aca_channel_source$';assert tag not in source
 expected.update(signature=SIG,migrationSHA256=hashlib.sha256(source.encode()).hexdigest(),ledgerVersion=migration.name[:14],ledgerName=migration.stem[15:],ledgerStatementCount=1,ledgerStatementsSHA256=sql("select encode(sha256(convert_to(ARRAY["+tag+source+tag+"]::text,'UTF8')),'hex')"),ledgerSerialization='Exact single-element ARRAY[full raw migration UTF8 including BEGIN/COMMIT/final newline]::text; not CLI parser serialization.')
 result={'status':'PASS','checks':len(checks),'localRPCInvocations':calls,'network':'none','realHeaderOrCredentialsUsed':False,'hostedCalls':0,'productionMutations':0,'rawHeadersProbesChallengesMACsOrFixtureRowsExported':False,'migrationSHA256':expected['migrationSHA256'],'testSHA256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'expectedFunctionDefinitionSHA256':expected['definitionSHA256'],'expectedLedgerStatementsSHA256':expected['ledgerStatementsSHA256'],'qualification':'Minimal synthetic SQL fixture, loaded source-exact old service/Auth helpers and prior paired diagnostic; no hosted header behavior or complete production schema claim.'}
 if a.evidence_dir:
  dest=pathlib.Path(a.evidence_dir);assert dest.is_absolute() and dest.name=='local-mock' and dest.parent.name=='phase2-team-w2-header-channel-diagnostic';dest.mkdir(parents=True,exist_ok=True)
  for name,obj in [('sql-summary.json',result),('expected-diagnostic-function-and-ledger.json',expected)]:
   with (dest/name).open('x') as f:json.dump(obj,f,indent=2);f.write('\n')
 print(json.dumps(result),flush=True)
finally:sql('drop database if exists '+DB+' with(force)',database='postgres')
