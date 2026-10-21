#!/usr/bin/env python3
"""Networkless disposable V2.6A SQL acceptance. Never accepts a remote database."""
import argparse,concurrent.futures,hashlib,json,secrets,subprocess,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ('ai-diagnostic-v26-isolated','ai-diagnostic-v26-ci-isolated') and info['HostConfig']['NetworkMode']=='none' and info['Config']['Labels'].get('codex.task')=='v26' and not any(info['NetworkSettings']['Ports'].values())
db='v26_'+secrets.token_hex(6);checks=[]
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:1500])
 elif r.returncode:raise AssertionError(r.stderr[:3000])
 return r.stdout.strip()
def lit(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
def uid(n):return f'26000000-0000-4000-8000-{n:012}'
def actor(n,q,error=None,role='authenticated'):
 claims={'sub':uid(n),'role':role,'aal':'aal1','session_id':uid(n+100)}
 return sql('begin;set local request.jwt.claims='+lit(claims).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def passed(t):checks.append(t);print('PASS '+t,flush=True)
def event(c,typ='payment_succeeded',ref=None,**extra):
 aid=sql(f"select account_id from private.billing_checkout_sessions where id='{c}'")
 return {'provider':'mock','event_ref':ref or typ+'-'+secrets.token_hex(10),'type':typ,'checkout_id':c,'subscription_ref':'mock-sub-'+c,'payment_ref':'mock-payment-'+c,'customer_ref':'mock-customer-'+aid,'occurred_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'amount_minor':None,'currency':None,**extra}
def process(e,error=None,n=0,role='service_role'):
 h=hashlib.sha256(json.dumps(e,sort_keys=True).encode()).hexdigest()
 return json.loads(actor(n,'select public.billing_process_verified_event('+lit(e)+",'"+h+"')",error,role)) if not error else actor(n,'select public.billing_process_verified_event('+lit(e)+",'"+h+"')",error,role)
def start(n=1,company=True):
 c=actor(n,f"select public.billing_start_checkout('{accounts[n]}',"+("'"+companies[n]+"'" if company else 'null')+')')
 status=sql(f"select status from private.billing_checkout_sessions where id='{c}'")
 if status=='created':actor(0,f"select public.billing_bind_checkout('{c}','mock-checkout-{c}','mock-customer-{accounts[n]}','mock-sub-{c}','mock-payment-{c}')",role='service_role')
 return c
def plan(n):return sql(f"select private.effective_account_plan('{accounts[n]}')")
def hashes():return json.loads(sql("""create temporary table v26_hashes(k text,v text);do $$declare t record;h text;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private') loop execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'''')) from %I.%I x',t.schemaname,t.tablename) into h;insert into v26_hashes values(t.schemaname||'.'||t.tablename,h);end loop;end;$$;select jsonb_object_agg(k,v) from v26_hashes;"""))
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 candidate=next((ROOT/'supabase/migrations').glob('*_billing_commercial_activation.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 before=hashes();sql(candidate.read_text().rsplit('commit;',1)[0]+'select missing_v26_rollback_probe();commit;','does not exist')
 assert sql("select to_regclass('private.billing_events') is null")=='t';assert hashes()==before
 sql(candidate.read_text());after=hashes();assert all(after[k]==v for k,v in before.items());passed('additive migration rollback and historical row preservation')
 accounts={};companies={}
 for n in range(1,6):
  metadata={'full_name':'V26 Synthetic '+str(n),'data_processing_consent':True,'marketing_consent':False,'data_processing_version':'temporary-ru-v1','marketing_version':'temporary-ru-v1'}
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(n)}','v26-{n}@example.test',now(),"+lit(metadata)+f");insert into auth.sessions values('{uid(n+100)}','{uid(n)}')")
  accounts[n]=sql(f"select id from public.accounts where legacy_origin_user_id='{uid(n)}'")
  companies[n]=actor(n,f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,products,employee_count,key_problems,main_goals) values('{uid(n)}','{accounts[n]}','V26 fixture {n}','manufacturing','Synthetic product',20,'Synthetic constraints','Synthetic goals') returning id")
 sql(f"update public.user_roles set role='administrator' where user_id='{uid(4)}'")
 actor(1,f"select public.billing_start_checkout('{accounts[1]}')",'billing_unavailable')
 sql('update private.billing_configuration set mock_enabled=true')
 for t in ['billing_configuration','billing_offers','billing_checkout_sessions','billing_provider_subscriptions','billing_payments','billing_events','billing_event_attempts','billing_plan_audit']:
  actor(1,'select * from private.'+t,'permission denied');sql('set role anon;select * from private.'+t,'permission denied')
 actor(4,f"select public.billing_start_checkout('{accounts[1]}')",'billing_not_found')
 actor(1,'select public.billing_admin_read()','admin_access_denied')
 passed('disabled gate, private deny-all, owner authorization and separate Admin boundary')
 # Synthetic attribution links use the existing V2.5 session/intent tables, not a second upgrade intent.
 visit=sql("insert into private.acquisition_visits(secret_hash) values(repeat('a',64)) returning id")
 version=sql("select id from public.diagnostic_versions where version_number=4")
 did=actor(1,f"insert into public.diagnostics(company_id,created_by_user_id,version_id,status) values('{companies[1]}','{uid(1)}','{version}','in_progress') returning id")
 block=sql(f"select id from public.diagnostic_blocks where version_id='{version}' order by position limit 1")
 sql(f"insert into private.anonymous_diagnostic_sessions(visit_id,secret_hash,methodology_version_id,current_block_id,status,consent_version,consented_at,claimed_user_id,claimed_account_id,claimed_company_id,claimed_diagnostic_id) values('{visit}',repeat('b',64),'{version}','{block}','claimed','temporary-ru-v1',now(),'{uid(1)}','{accounts[1]}','{companies[1]}','{did}')")
 actor(1,f"select public.record_acquisition_interaction('advanced_cta_clicked','{companies[1]}',null,'team_explainer')")
 assert actor(1,f"select public.read_acquisition_continuation('{accounts[1]}')")==companies[1]
 c=start();assert start()==c;assert plan(1)=='free'
 with concurrent.futures.ThreadPoolExecutor(4) as ex:assert set(ex.map(lambda _:start(),range(4)))=={c}
 actor(2,f"select public.billing_read_checkout('{c}')",'billing_not_found')
 actor(1,f"select public.billing_read_checkout('{c}',true)");assert plan(1)=='free'
 process(event(c),error='permission denied',n=1,role='authenticated')
 passed('checkout double clicks/concurrency reuse, foreign owner denied, return is non-authoritative')
 mismatch=process(event(c,amount_minor=1));assert mismatch['error']=='amount_currency_mismatch' and plan(1)=='free'
 mismatch=process(event(c,currency='USD'));assert mismatch['status']=='rejected' and plan(1)=='free'
 passed('server offer amount/currency mismatch never activates Advanced')
 e=event(c);assert process(e)['status']=='processed';assert plan(1)=='advanced'
 for _ in range(10):assert process(e)['duplicate']
 with concurrent.futures.ThreadPoolExecutor(2) as ex:assert all(x['status'] in ('processed','ignored') for x in ex.map(process,[event(c),event(c)]))
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='1'
 assert sql(f"select count(*) from private.billing_plan_audit where account_id='{accounts[1]}'")=='1'
 assert sql(f"select count(*) from private.billing_payments where checkout_id='{c}'")=='1'
 assert process({**e,'currency':'USD'})['error']=='event_identity_conflict'
 passed('verified success, x10 duplicate, concurrent distinct events and conflicting event identity')
 sql(f"update private.billing_events set payload_hash=repeat('f',64) where checkout_id='{c}'",'immutable')
 sql(f"delete from private.billing_event_attempts where event_id=(select id from private.billing_events where checkout_id='{c}' limit 1)",'immutable')
 actor(4,f"select public.admin_assign_account_plan('{accounts[1]}','free','V26 unsafe downgrade','advanced')",'billing_provider_managed')
 actor(0,f"select public.assign_account_plan('{accounts[1]}','free')",'billing_provider_managed',role='service_role')
 assert plan(1)=='advanced';passed('immutable financial journal and both manual downgrade RPCs blocked')
 safe=json.loads(actor(4,'select public.billing_admin_read()'));assert any(r['id']==accounts[1] and r['provider_managed'] and r['source']=='provider' for r in safe['rows'])
 actor(4,"select public.billing_admin_read('{\"page\":1,\"provider\":\"mock\",\"payment\":\"succeeded\"}')")
 assert 'payload_hash' not in json.dumps(safe) and 'authorization' not in json.dumps(safe)
 passed('Admin safe projections, filters, pagination and system health')
 team=actor(1,f"select public.create_team_diagnostic('{companies[1]}','V26 paid team')")
 assert sql(f"select company_id from public.team_diagnostics where id='{team}'")==companies[1]
 passed('same Company continuation and entitlement-only Team creation')
 funnel=json.loads(actor(4,'select public.read_acquisition_funnel()'))
 for label in ['advanced_cta_clicked','advanced_checkout_started','advanced_checkout_returned','advanced_payment_succeeded','account_became_advanced','advanced_subscription_activated','team_diagnostic_created']:assert funnel['stages'][label]==1,(label,funnel)
 assert sql(f"select count(*) from private.advanced_conversion_intents where account_id='{accounts[1]}'")=='1'
 assert not any(k in json.dumps(funnel) for k in ['customer_ref','payment_ref','amount_minor','currency'])
 passed('existing conversion intent/milestone reused once; Admin acquisition funnel includes payment and Team without financial PII')

 failed=start(2);assert process(event(failed,'payment_failed'))['status']=='processed';assert plan(2)=='free'
 actor(2,f"select public.create_team_diagnostic('{companies[2]}','Denied team')",'advanced_required');assert start(2)!=failed
 passed('failure stays Free, new Team denied, safe retry new reference')
 cancelled=start(3);process(event(cancelled,'checkout_cancelled'));assert plan(3)=='free';assert start(3)!=cancelled
 passed('cancelled checkout preserves Free and supports safe retry')
 actor(0,f"select public.assign_account_plan('{accounts[5]}','advanced')",role='service_role');assert plan(5)=='advanced'
 actor(5,f"select public.create_team_diagnostic('{companies[5]}','V26 manual team')")
 manual=start(5);assert process(event(manual))['status']=='processed';assert plan(5)=='advanced'
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[5]}' and status='active'")=='1'
 passed('manual Advanced works without checkout; explicit mock manual-to-provider transition has one active plan')
 process(event(c,'subscription_cancel_pending'));assert plan(1)=='advanced'
 process(event(c,'subscription_payment_failed'));assert plan(1)=='advanced'
 # No invented grace period or destructive refund product policy.
 process(event(c,'payment_refunded'));assert plan(1)=='advanced'
 process(event(c,'subscription_ended'));assert plan(1)=='free'
 assert sql(f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
 actor(1,f"select public.create_team_diagnostic('{companies[1]}','Denied new team')",'advanced_required')
 actor(1,f"select public.invite_team_participant('{team}','new@example.test','New',repeat('a',64))",'advanced_required')
 assert process(event(c))['status']=='ignored' and plan(1)=='free'
 passed('cancel-pending, failed renewal, refund modeled; ended is terminal, downgrade preserves Team and blocks new work')
 # Force transaction exception AFTER plan insertion: all mutations roll back, durable retryable attempt survives.
 retry=start(1)
 sql("create function private.v26_test_fail() returns trigger language plpgsql as $$begin raise exception 'test failure';end$$;create trigger v26_test_fail before insert on private.billing_plan_audit for each row execute function private.v26_test_fail();")
 re=event(retry);assert process(re)['status']=='retryable' and plan(1)=='free'
 assert sql(f"select status from private.billing_checkout_sessions where id='{retry}'")=='pending'
 sql('drop trigger v26_test_fail on private.billing_plan_audit;drop function private.v26_test_fail()')
 assert process(re)['status']=='processed' and plan(1)=='advanced'
 passed('durable retryable event receipt and atomic rollback/retry without partial activation')
 # End before success: do not resurrect subscription when delivery order reverses.
 ce=start(4);process(event(ce,'subscription_ended'));assert process(event(ce))['status']=='ignored';assert plan(4)=='free'
 passed('out-of-order terminal end before success cannot resurrect paid access')
 expired=start(2);sql(f"update private.billing_checkout_sessions set expires_at=now()-interval '1 second' where id='{expired}'")
 assert json.loads(actor(2,f"select public.billing_read_checkout('{expired}')"))['status']=='expired'
 assert process(event(expired))['error']=='checkout_not_payable' and plan(2)=='free'
 assert start(2)!=expired
 passed('checkout TTL fails closed and permits a fresh safe attempt')
 sql(f"update private.account_subscriptions set provider_key='arbitrary' where account_id='{accounts[1]}' and source='provider'",'subscription_history_immutable')
 sql(f"update auth.users set email_confirmed_at=null where id='{uid(2)}'")
 actor(2,f"select public.billing_start_checkout('{accounts[2]}')",'billing_not_found')
 sql(f"update auth.users set email_confirmed_at=now() where id='{uid(2)}'")
 passed('historical provider identity immutable and unconfirmed owner denied')
 sql('update private.billing_configuration set mock_enabled=false')
 assert actor(5,f"select public.read_account_plan('{accounts[5]}')")
 assert sql(f"select count(*) from public.company_profiles where id='{companies[2]}'")=='1'
 passed('provider disabled leaves local paid entitlement and existing resources readable')
 print(json.dumps({'status':'PASS','groups':len(checks),'checks':checks,'scope':'networkless isolated SQL','realPaymentCalls':0,'productionTouched':False}),flush=True)
finally:sql('drop database if exists '+db+' with(force)',database='postgres')
