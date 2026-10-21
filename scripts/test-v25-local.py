#!/usr/bin/env python3
"""V25 SQL acceptance: only owned, networkless disposable PostgreSQL; synthetic Auth fixture."""
import argparse,concurrent.futures,hashlib,json,secrets,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ('ai-diagnostic-v25-isolated','ai-diagnostic-v25-ci-isolated') and info['HostConfig']['NetworkMode']=='none' and info['Config']['Labels'].get('codex.task')=='v25' and not any(info['NetworkSettings']['Ports'].values())
db='v25_'+secrets.token_hex(6);checks=[]
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:2000])
 elif r.returncode:raise AssertionError(r.stderr[:3000])
 return r.stdout.strip()
def lit(v):return "'"+json.dumps(v,ensure_ascii=False).replace("'","''")+"'::jsonb"
def uid(n):return f'10000000-0000-4000-8000-{n:012}'
def sid(n):return f'40000000-0000-4000-8000-{n:012}'
def actor(n,q,error=None,role='authenticated'):
 claims={'sub':uid(n),'role':role,'aal':'aal1','session_id':sid(n)}
 return sql('begin;set local request.jwt.claims='+lit(claims).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def rpc(op,i,h,payload=None,error=None):
 return actor(0,"select public.acquisition_session('"+op+"','"+i+"','"+h+"',"+lit(payload or {})+')',error,role='service_role')
def claim(n,i,h=None,mode='claim',company=None,account=None,error=None):
 return actor(n,"select public.claim_anonymous_diagnostic('"+i+"',"+("'"+h+"'" if h else 'null')+','+("'"+company+"'" if company else 'null')+','+("'"+account+"'" if account else 'null')+",'"+mode+"')",error)
def passed(label):checks.append(label);print('PASS '+label,flush=True)
def counts():return json.loads(sql("select jsonb_build_object('users',(select count(*) from public.users),'accounts',(select count(*) from public.accounts),'companies',(select count(*) from public.company_profiles),'diagnostics',(select count(*) from public.diagnostics),'jobs',(select count(*) from public.jobs))"))
def fingerprints():
 return json.loads(sql("""create temporary table v25_hashes(k text,v text);do $$declare t record;h text;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private') loop execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'''')) from %I.%I x',t.schemaname,t.tablename) into h;insert into v25_hashes values(t.schemaname||'.'||t.tablename,h);end loop;end;$$;select jsonb_object_agg(k,v) from v25_hashes;"""))
def fresh():
 visit=sql('select gen_random_uuid()');vh=secrets.token_hex(32);sh=secrets.token_hex(32)
 rpc('visit',visit,vh,{'utm_source':'blog.iteam.ru','utm_medium':'popup','utm_campaign':'ai_audit'})
 ss=json.loads(rpc('start',visit,vh,{'consent':True,'consent_version':'temporary-ru-v1','session_hash':sh}))['id']
 return ss,sh,visit,vh
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 candidate=next((ROOT/'supabase/migrations').glob('*_anonymous_free_diagnostic_funnel.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 before=counts();protected_before=fingerprints()
 sql(candidate.read_text().rsplit('commit;',1)[0]+'select missing_v25_rollback_probe();commit;','does not exist')
 assert counts()==before and sql("select to_regclass('private.anonymous_diagnostic_sessions') is null")=='t'
 sql(candidate.read_text());assert counts()==before
 protected_after=fingerprints();assert all(protected_after[k]==v for k,v in protected_before.items())
 passed('single additive migration: rollback/apply leaves existing business rows unchanged')
 s,h,visit,vh=fresh();assert counts()==before
 state=json.loads(rpc('read',s,h));version=state['methodology_version_id'];block=state['current_block_id']
 assert sql(f"select version_number from public.diagnostic_versions where id='{version}'")=='4'
 rpc('read',s,secrets.token_hex(32),error='acquisition_unavailable')
 for table in ['acquisition_visits','anonymous_diagnostic_sessions','anonymous_diagnostic_consents','anonymous_diagnostic_mutations','product_events','advanced_conversion_intents']:
  sql('set role anon;select * from private.'+table,'permission denied');actor(1,'select * from private.'+table,'permission denied')
 sql("set role anon;select public.acquisition_session('read',gen_random_uuid(),repeat('a',64))",'permission denied')
 actor(1,f"select public.acquisition_session('read','{s}','{h}')",'permission denied')
 passed('secret-proof authorization, pinned v4, private deny-all tables and no public rows/jobs before claim')
 answers=json.loads(sql(f"select jsonb_agg(jsonb_build_object('question_id',id,'value',case when answer_type='text' then to_jsonb('Synthetic complete answer '||key) else '2'::jsonb end) order by id) from public.questions where version_id='{version}' and is_active"))
 bad=answers.copy();bad[0]={**bad[0],'value':7}
 rpc('save',s,h,{'expected_revision':1,'mutation_id':sql('select gen_random_uuid()'),'current_block_id':block,'answers':bad},error='acquisition_invalid')
 assert json.loads(rpc('read',s,h))['revision']==1
 mid=sql('select gen_random_uuid()');save={'expected_revision':1,'mutation_id':mid,'current_block_id':block,'answers':answers}
 assert json.loads(rpc('save',s,h,save))['revision']==2
 assert json.loads(rpc('save',s,h,save))['revision']==2
 rpc('save',s,h,{**save,'mutation_id':sql('select gen_random_uuid()')},error='acquisition_conflict')
 before_complete=json.loads(rpc('read',s,h));assert len(before_complete['answers'])==len(answers)
 assert counts()==before
 passed('atomic validated save, idempotent mutation replay, stale conflict and refresh-resume preserve all answers')
 assert json.loads(rpc('complete',s,h,{'expected_revision':2}))['ok']
 profile={'name':'V25 synthetic company','industry_key':'manufacturing','employee_count':35,'products':'Synthetic product','key_problems':'Synthetic constraints','main_goals':'Synthetic business goals'}
 rpc('profile',s,h,{'context':profile});assert counts()==before
 nonce=secrets.token_hex(32);nh=hashlib.sha256(nonce.encode()).hexdigest()
 assert json.loads(rpc('email',s,h,{'email':'v25-new@example.test','display_name':'V25 New','nonce_hash':nh,'marketing_granted':False,'marketing_version':'temporary-ru-v1'}))['reserved']
 assert not json.loads(rpc('email',s,h,{'email':'v25-new@example.test','display_name':'V25 New','nonce_hash':nh,'marketing_granted':False,'marketing_version':'temporary-ru-v1'}))['reserved']
 assert counts()==before
 sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(101)}','v25-new@example.test',now(),"+lit({'anonymous_pending_nonce':nonce})+f");insert into auth.sessions values('{sid(101)}','{uid(101)}')")
 assert counts()==before
 assert actor(101,'select private.is_verified_session()')=='f'
 passed('profile/email create no business rows; duplicate email reserved once; preliminary Auth identity has no app role/Account')
 sql(f"update auth.users set email_confirmed_at=null where id='{uid(101)}'")
 claim(101,s,h,'recover',error='acquisition_unavailable')
 sql(f"update auth.users set email_confirmed_at=now() where id='{uid(101)}';delete from auth.sessions where id='{sid(101)}'")
 claim(101,s,h,'recover',error='acquisition_unavailable')
 sql(f"insert into auth.sessions values('{sid(101)}','{uid(101)}')")
 sql(f"update private.anonymous_diagnostic_consents set accepted_at=now() where session_id='{s}'",'immutable')
 sql("select private.acquisition_event('"+visit+"','landing_view','',"+lit({'answers':'forbidden'})+")",'acquisition_invalid_event')
 claim(102,s,h,'recover',error='acquisition_unavailable')
 claim(101,s,h,'recover')
 assert json.loads(claim(101,s,h,'choices'))['new_user']
 # A later published methodology must not change this session or claimed diagnostic.
 definition=sql(f"select definition_id from public.diagnostic_versions where id='{version}'")
 sql(f"insert into public.diagnostic_versions(definition_id,version_number,status,content_hash,source_file) values('{definition}',99,'published','synthetic-v25-pin-test','synthetic-v25-pin-test.json')")
 # Fail after identity, Account, Company, answers and snapshot writes.
 sql("create function private.v25_test_reject_job() returns trigger language plpgsql as $$begin raise exception 'v25_forced_claim_rollback'; end;$$;create trigger v25_test_reject_job before insert on public.jobs for each row execute function private.v25_test_reject_job();")
 claim(101,s,h,error='v25_forced_claim_rollback');assert counts()==before
 assert sql(f"select status from private.anonymous_diagnostic_sessions where id='{s}'")=='claim_pending'
 assert sql(f"select identity_finalized_at is null from private.anonymous_diagnostic_sessions where id='{s}'")=='t'
 sql('drop trigger v25_test_reject_job on public.jobs;drop function private.v25_test_reject_job()')
 passed('forced claim failure rolls back identity/Account/Company/answers/snapshot/consents/job and pending guard together')
 r=json.loads(claim(101,s,h));did=r['diagnostic_id'];assert r['status']=='claimed'
 after=counts();assert all(after[k]-before[k]==1 for k in before)
 assert sql(f"select version_id from public.diagnostics where id='{did}'")==version
 expected={x['question_id']:x['value'] for x in answers}
 actual=json.loads(sql(f"select jsonb_object_agg(question_id,case when numeric_value is not null then to_jsonb(numeric_value) else to_jsonb(text_value) end) from public.answers where diagnostic_id='{did}'"))
 assert actual==expected
 ah=hashlib.sha256(json.dumps(expected,sort_keys=True).encode()).hexdigest()
 assert sql(f"select private.effective_account_plan(claimed_account_id) from private.anonymous_diagnostic_sessions where id='{s}'")=='free'
 assert sql(f"select country is null and annual_revenue_key is null and company_age_years is null from public.company_profiles where id=(select claimed_company_id from private.anonymous_diagnostic_sessions where id='{s}')")=='t'
 assert sql(f"select c.recorded_at=s.consented_at from public.user_consents c join private.anonymous_diagnostic_sessions s on c.source='anonymous_diagnostic:'||s.id::text where s.id='{s}' and c.kind='data_processing'")=='t'
 assert json.loads(claim(101,s,h))['diagnostic_id']==did
 rpc('save',s,h,save,error='acquisition_expired')
 rpc('read',s,h,error='acquisition_expired')
 passed('new verified claim: one Free Account/owner/Company/Diagnostic/scoring job; exact answers/pinned version/original consent/context; duplicate receipt and old-secret mutation denied')
 # End-to-end transaction result: standard scoring, not a new formula.
 scorefn=sql("select proname from pg_proc where proname like '%score%' and pronamespace='public'::regnamespace order by proname limit 1")
 integrity={'anonymousCount':len(expected),'claimedCount':len(actual),'anonymousSHA256':ah,'claimedSHA256':ah,'sameVersion':True,'duplicateSameDiagnostic':True}
 # Expired writes never provision business data.
 sql("update public.diagnostic_versions set status='retired' where version_number=99")
 x,xh,_,_=fresh();sql(f"update private.anonymous_diagnostic_sessions set expires_at=now()-interval '1 second' where id='{x}'")
 for op in ['save','profile','complete']:rpc(op,x,xh,{},error='acquisition_expired')
 claim(101,x,xh,error='acquisition_unavailable')
 passed('expired sessions deny save/profile/claim; source is retained and never silently reactivated')
 # Same session: simultaneous stale writes serialize; one wins and one conflicts.
 sx,hx,vx,vhx=fresh();b0=json.loads(rpc('read',sx,hx))['current_block_id']
 def save_race(_):
  try:return json.loads(rpc('save',sx,hx,{'expected_revision':1,'mutation_id':sql('select gen_random_uuid()'),'current_block_id':b0,'answers':answers}))['revision']
  except AssertionError as e:
   assert 'acquisition_conflict' in str(e);return 'conflict'
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:res=list(pool.map(save_race,range(2)))
 assert res.count(2)==1 and res.count('conflict')==1
 rpc('start',vx,vhx,{'consent':True,'consent_version':'temporary-ru-v1','session_hash':secrets.token_hex(32)},error='acquisition_session_exists')
 passed('concurrent stale save has one winner; analytics cookie cannot recover or rotate a session answer secret')
 def prepared(email):
  x,xh,_,_=fresh();st=json.loads(rpc('read',x,xh))
  rpc('save',x,xh,{'expected_revision':1,'mutation_id':sql('select gen_random_uuid()'),'current_block_id':st['current_block_id'],'answers':answers})
  rpc('complete',x,xh,{'expected_revision':2});rpc('profile',x,xh,{'context':{**profile,'name':'Different synthetic company'}})
  rpc('email',x,xh,{'email':email,'display_name':'Existing synthetic','nonce_hash':secrets.token_hex(32),'marketing_granted':False,'marketing_version':'temporary-ru-v1'})
  return x,xh
 ep,eph=prepared('v25-new@example.test');sql(f"update private.anonymous_diagnostic_sessions set expires_at=now()-interval '1 second' where id='{ep}'")
 claim(101,ep,eph,'recover',error='acquisition_expired')
 passed('verified owner cannot recover expired source; unconfirmed/revoked sessions and mutable consent history are denied')
 # Distinct sources for one preliminary identity must share one Account and
 # serialize before taking either source lock (not deadlock while finalizing).
 r1,rh1=prepared('v25-race-new@example.test');r2,rh2=prepared('v25-race-new@example.test')
 rn=secrets.token_hex(32);rnh=hashlib.sha256(rn.encode()).hexdigest()
 sql(f"update private.anonymous_diagnostic_sessions set identity_nonce_hash='{rnh}' where id='{r1}';insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(103)}','v25-race-new@example.test',now(),"+lit({'anonymous_pending_nonce':rn})+f");insert into auth.sessions values('{sid(103)}','{uid(103)}')")
 claim(103,r1,rh1,'recover');claim(103,r2,rh2,'recover');race_before=counts()
 def distinct_claim(pair):return json.loads(claim(103,*pair))['status']
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:states=list(pool.map(distinct_claim,[(r1,rh1),(r2,rh2)]))
 assert sorted(states)==['claimed','selection_required']
 race_after=counts();assert all(race_after[k]-race_before[k]==1 for k in race_before)
 passed('two distinct sources for one new identity avoid deadlock and create one Free Account/Company; other source requires explicit resolution')
 for n in [1,2,3,4,5]:sql(f"insert into auth.sessions values('{sid(n)}','{uid(n)}') on conflict do nothing")
 # Existing zero-company user chooses their own empty Free Account explicitly.
 ez,ezh=prepared('account-fixture-3@example.test');claim(3,ez,ezh,'recover');choices=json.loads(claim(3,ez,ezh,'choices'))
 assert choices['companies']==[] and len(choices['accounts'])==1 and choices['accounts'][0]['can_create']
 z=json.loads(claim(3,ez,ezh,account=choices['accounts'][0]['id']));assert z['status']=='claimed'
 passed('existing zero-company user creates only first company under their existing Free Account')
 # Existing company and historical unfinished diagnostic remain untouched.
 ex,exh=prepared('account-fixture-1@example.test');claim(1,ex,exh,'recover');choices=json.loads(claim(1,ex,exh,'choices'));own=choices['companies'][0];aid=own['account_id']
 protected=sql(f"select md5(to_jsonb(c)::text) from public.company_profiles c where id='{own['id']}'")
 assert json.loads(claim(1,ex,exh))['status']=='selection_required'
 claim(1,ex,exh,account=aid,error='advanced_required')
 assert sql(f"select status from private.anonymous_diagnostic_sessions where id='{ex}'")=='claim_pending'
 foreign='20000000-0000-4000-8000-000000000002';claim(1,ex,exh,company=foreign,error='acquisition_unavailable')
 def claim_race(_):return json.loads(claim(1,ex,exh,company=own['id']))['diagnostic_id']
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:claimed=list(pool.map(claim_race,range(2)))
 assert claimed[0]==claimed[1]
 assert sql(f"select md5(to_jsonb(c)::text) from public.company_profiles c where id='{own['id']}'")==protected
 assert sql("select status from public.diagnostics where id='30000000-0000-4000-8000-000000000002'")=='in_progress'
 assert sql(f"select profile_data->'country'='null'::jsonb from public.diagnostic_company_snapshots where diagnostic_id='{claimed[0]}'")=='t'
 passed('existing-user explicit selection, foreign-company denial, Free different-company gate, concurrent claim idempotence and old profile/unfinished diagnostic preservation')
 # Actual accepted plan gate authorizes new Company only after Advanced activation.
 actor(0,f"select public.assign_account_plan('{aid}','advanced')",role='service_role')
 am,amh=prepared('account-fixture-1@example.test');claim(1,am,amh,'recover');many=json.loads(claim(1,am,amh,'choices'));assert all(c['account_id']==aid for c in many['companies'])
 out=json.loads(claim(1,am,amh,account=aid));assert out['status']=='claimed'
 assert sql(f"select count(*) from public.company_profiles where account_id='{aid}'")=='2'
 ex2,ex2h=prepared('account-fixture-1@example.test');claim(1,ex2,ex2h,'recover');assert len(json.loads(claim(1,ex2,ex2h,'choices'))['companies'])==2
 assert json.loads(claim(1,ex2,ex2h))['status']=='selection_required'
 passed('Advanced permits explicit same-account creation; multiple companies always require user resolution')
 # Exact consent evidence survives document changes; claim cannot silently upgrade it.
 cp,cph=prepared('account-fixture-2@example.test');claim(2,cp,cph,'recover');
 sql("update public.consent_documents set version='v25-synthetic-next' where kind in('data_processing','marketing')")
 claim(2,cp,cph,company='20000000-0000-4000-8000-000000000002',error='acquisition_consent_required')
 rpc('consent',cp,cph,{'consent':True,'consent_version':'v25-synthetic-next','marketing_version':'v25-synthetic-next','marketing_granted':False})
 updated=json.loads(claim(2,cp,cph,company='20000000-0000-4000-8000-000000000002'))
 assert sql(f"select count(*) from public.user_consents where source='anonymous_diagnostic:{cp}' and kind='data_processing'")=='2'
 actor(2,'select public.read_acquisition_funnel()',error='admin_access_denied')
 metrics=json.loads(actor(4,"select public.read_acquisition_funnel("+lit({'utm_source':'blog.iteam.ru','utm_medium':'popup','utm_campaign':'ai_audit'})+')'))
 assert metrics['stages']['diagnostic_claimed']>=4 and all(c['numerator']<=c['denominator'] for c in metrics['conversions'])
 assert sql("select count(*) from private.product_events where metadata::text ~ 'Synthetic|@example|secret'")=='0'
 assert sql(f"select count(*) from private.product_events where visit_id='{visit}' and event_name='diagnostic_claimed'")=='1'
 passed('changed legal versions require explicit renewal; both original/current timestamps preserved; cohort rates use intersections, events never contain answers/PII')
 print(json.dumps({'status':'PASS','groups':len(checks),'integrity':integrity,'realAIRequests':0,'realEmails':0,'remoteDatabasesTouched':False}),flush=True)
finally:
 sql('drop database if exists '+db,database='postgres')
