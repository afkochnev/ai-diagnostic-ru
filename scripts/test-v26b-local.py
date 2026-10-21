#!/usr/bin/env python3
"""Networkless disposable V2.6B SQL acceptance. Never accepts a remote database."""
import argparse,concurrent.futures,hashlib,json,secrets,subprocess,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ('ai-diagnostic-v26b-isolated','ai-diagnostic-v26b-ci-isolated') and info['HostConfig']['NetworkMode']=='none' and info['Config']['Labels'].get('codex.task')=='v26b' and not any(info['NetworkSettings']['Ports'].values())
db='v26b_'+secrets.token_hex(6);checks=[]
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
 candidate=next((ROOT/'supabase/migrations').glob('*_yookassa_annual_billing.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 def rows_snapshot():return json.loads(sql("""create temporary table snapshot_rows(k text,v jsonb);do $$declare t record;v jsonb;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private') loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %I.%I x',t.schemaname,t.tablename) into v;insert into snapshot_rows values(t.schemaname||'.'||t.tablename,v);end loop;end;$$;select jsonb_object_agg(k,v) from snapshot_rows;"""))
 before_rows=rows_snapshot()
 before=hashes();sql(candidate.read_text().rsplit('commit;',1)[0]+'select missing_v26b_rollback_probe();commit;','does not exist')
 assert hashes()==before
 assert sql("select to_regprocedure('public.billing_start_yookassa_checkout(uuid,uuid)') is null")=='t'
 sql(candidate.read_text())
 after_rows=rows_snapshot();preserved_rows=0
 for table,rows in before_rows.items():
  for row in rows:
   assert any(all(r.get(k)==v for k,v in row.items()) for r in after_rows[table]),table
   preserved_rows+=1
 passed('single additive migration rollback preserves all existing rows; disabled defaults and no real offer')
 assert sql('select yookassa_enabled from private.billing_configuration')=='f'
 assert sql("select count(*) from private.billing_offers where provider_key='yookassa' and status='active'")=='0'
 accounts={};companies={}
 for n in range(1,9):
  metadata={'full_name':'V26B Synthetic '+str(n),'data_processing_consent':True,'marketing_consent':False,'data_processing_version':'temporary-ru-v1','marketing_version':'temporary-ru-v1'}
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(n)}','v26b-{n}@example.test',now(),"+lit(metadata)+f");insert into auth.sessions values('{uid(n+100)}','{uid(n)}')")
  accounts[n]=sql(f"select id from public.accounts where legacy_origin_user_id='{uid(n)}'")
  companies[n]=actor(n,f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,products,employee_count,key_problems,main_goals) values('{uid(n)}','{accounts[n]}','V26B fixture {n}','manufacturing','Synthetic',20,'Synthetic','Synthetic') returning id")
 def reserve(n=1,company=None):return actor(n,f"select public.billing_start_yookassa_checkout('{accounts[n]}','{company or companies[n]}')")
 def bind(c,nref):
  pid=f'27000000-0000-5000-9000-{nref:012}'
  actor(0,f"select public.billing_bind_yookassa_payment('{c}','{pid}')",role='service_role');return pid
 def yoo(c,ref,kind='payment_succeeded',**extra):
  aid=sql(f"select account_id from private.billing_checkout_sessions where id='{c}'")
  return {'provider':'yookassa','event_ref':ref+('-succeeded' if kind=='payment_succeeded' else '-canceled'),'type':kind,'checkout_id':c,'subscription_ref':'annual-'+c,'payment_ref':ref,'customer_ref':'account-'+aid,'occurred_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'amount_minor':48000,'currency':'RUB',**extra}
 def until(n):return sql(f"select effective_until from private.account_subscriptions where account_id='{accounts[n]}' and status='active'")
 actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'billing_unavailable')
 sql("update private.billing_configuration set yookassa_enabled=true,yookassa_shop_id='123456'")
 actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'billing_unavailable')
 sql("update private.billing_offers set status='active' where provider_key='yookassa'")
 for t in ['billing_configuration','billing_offers','billing_checkout_sessions','billing_events','billing_event_attempts','billing_payments','billing_plan_audit']:
  actor(1,'select * from private.'+t,'permission denied')
 actor(1,"select public.billing_yookassa_payment_context('unknown')",'permission denied')
 actor(1,'select public.billing_expire_yookassa_entitlements(100)','permission denied')
 passed('draft offer and independent DB gate; private deny-all and service-only financial APIs')
 c=reserve();assert plan(1)=='free';assert reserve()==c
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert list(pool.map(lambda _:reserve(),range(2)))==[c,c]
 actor(2,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'billing_not_found')
 actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}','{companies[2]}')",'billing_not_found')
 actor(2,f"select public.billing_yookassa_owner_context('{c}')",'billing_not_found')
 actor(1,f"select public.create_team_diagnostic('{companies[1]}','Unpaid')",'advanced_required')
 passed('owner/context authorization, concurrent checkout reuse and unpaid Free entitlements')
 ref=bind(c,1);assert bind(c,1)==ref
 actor(0,f"select public.billing_bind_yookassa_payment('{c}','27000000-0000-5000-9000-000000000999')",'billing_checkout_reconciliation_required',role='service_role')
 context=json.loads(actor(1,f"select public.billing_yookassa_owner_context('{c}')"));assert context['merchant_ref']=='123456' and context['amount_minor']==48000
 actor(1,f"select public.billing_read_checkout('{c}',true)");assert plan(1)=='free'
 passed('provider binding is immutable/idempotent; browser return does not activate')
 e=yoo(c,ref);r=process(e);assert r['status']=='processed' and plan(1)=='advanced'
 first_until=until(1)
 assert sql(f"select effective_until>now()+interval '364 days' and effective_until<now()+interval '367 days' from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='t'
 for _ in range(10):assert process(e)['duplicate']
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert all(r['duplicate'] for r in pool.map(lambda _:process(e),range(2)))
 assert until(1)==first_until
 assert sql(f"select count(*) from private.billing_plan_audit where account_id='{accounts[1]}'")=='1'
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='1'
 team=actor(1,f"select public.create_team_diagnostic('{companies[1]}','Annual paid Team')")
 passed('verified annual activation, same Company Team, x10 duplicate and concurrent delivery extend only once')
 c2=reserve();ref2=bind(c2,2);r=process(yoo(c2,ref2));assert r['status']=='processed'
 assert sql(f"select effective_until='{first_until}'::timestamptz+interval '1 year' from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='t'
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='1'
 assert sql(f"select count(*) from private.billing_plan_audit where account_id='{accounts[1]}'")=='2'
 actor(0,f"select public.assign_account_plan('{accounts[1]}','free')",'billing_provider_managed',role='service_role')
 passed('manual annual renewal preserves remaining paid time, one active plan and financial audit; unsafe downgrade denied')
 assert process({**e,'amount_minor':1})['error']=='event_identity_conflict'
 assert until(1)==sql(f"select paid_until_after from private.billing_plan_audit where account_id='{accounts[1]}' order by created_at desc limit 1")
 for n,patch in [(2,{'amount_minor':47999}),(3,{'currency':'USD'}),(4,{'customer_ref':'wrong'}),(5,{'subscription_ref':'wrong'})]:
  c3=reserve(n);ref3=bind(c3,n+10);r=process(yoo(c3,ref3,**patch));assert r['status']=='rejected' and plan(n)=='free'
 passed('amount/currency/Account and subscription mismatches never activate')
 # Pending cancellation has no entitlement effect and repeated notification is harmless.
 c6=reserve(6);ref6=bind(c6,6);cancel=yoo(c6,ref6,'checkout_cancelled');assert process(cancel)['status']=='processed';assert plan(6)=='free';assert process(cancel)['duplicate']
 assert process(yoo(c6,ref6))['status']=='ignored';assert plan(6)=='free'
 assert reserve(6)!=c6
 passed('confirmed cancellation, repeat, out-of-order success and safe fresh checkout')
 # Distinct purchases can race after a local timeout; verified late success must retain both terms.
 oldc=sql(f"select id from private.billing_checkout_sessions where account_id='{accounts[2]}' and status='pending'")
 oldref=sql(f"select provider_payment_ref from private.billing_payments where checkout_id='{oldc}'")
 assert process(yoo(oldc,oldref,'checkout_cancelled'))['status']=='processed'
 ca=reserve(2);ra=bind(ca,21)
 sql(f"update private.billing_checkout_sessions set status='expired' where id='{ca}'")
 cb=reserve(2);rb=bind(cb,22)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert all(x['status']=='processed' for x in pool.map(process,[yoo(ca,ra),yoo(cb,rb)]))
 assert sql(f"select effective_until>now()+interval '729 days' and effective_until<now()+interval '733 days' from private.account_subscriptions where account_id='{accounts[2]}' and status='active'")=='t'
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[2]}' and status='active'")=='1'
 passed('concurrent distinct paid purchases preserve both annual terms without duplicate active plans')
 # Manually granted Advanced can deliberately transition to annual paid access, never two active plans.
 mc=sql(f"select id from private.billing_checkout_sessions where account_id='{accounts[4]}' and status='pending'")
 mr=sql(f"select provider_payment_ref from private.billing_payments where checkout_id='{mc}'")
 assert process(yoo(mc,mr,'checkout_cancelled'))['status']=='processed'
 actor(0,f"select public.assign_account_plan('{accounts[4]}','advanced')",role='service_role')
 mc=reserve(4);mr=bind(mc,24);assert process(yoo(mc,mr))['status']=='processed'
 assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[4]}' and status='active'")=='1'
 assert sql(f"select source from private.account_subscriptions where account_id='{accounts[4]}' and status='active'")=='provider'
 actor(4,f"select public.billing_bind_yookassa_payment('{mc}','{mr}')",'permission denied')
 passed('explicit manual-to-provider transition and authenticated callers denied privileged binding')

 # Fault injection after plan/payment changes demonstrates savepoint rollback and durable retry receipt.
 c7=reserve(7);ref7=bind(c7,7);e7=yoo(c7,ref7)
 sql(f"create function private.v26b_fail() returns trigger language plpgsql as $$begin if new.account_id='{accounts[7]}' then raise exception 'forced';end if;return new;end $$;create trigger v26b_fail before insert on private.billing_plan_audit for each row execute function private.v26b_fail()")
 assert process(e7)['status']=='retryable' and plan(7)=='free'
 assert sql(f"select status from private.billing_payments where checkout_id='{c7}'")=='pending'
 sql('drop trigger v26b_fail on private.billing_plan_audit;drop function private.v26b_fail()')
 assert process(e7)['status']=='processed' and plan(7)=='advanced'
 passed('atomic rollback leaves Free and pending payment; same durable event safely retries once')
 # Seed a historical annual term on a synthetic Account; original history guard is never disabled.
 actor(0,f"select public.assign_account_plan('{accounts[8]}','advanced')",role='service_role')
 oldteam=actor(8,f"select public.create_team_diagnostic('{companies[8]}','Preserved expired Team')")
 sql(f"update private.account_subscriptions set status='ended',effective_until=now() where account_id='{accounts[8]}' and status='active';insert into private.account_subscriptions(account_id,plan_id,status,source,provider_key,provider_customer_ref,provider_subscription_ref,effective_from,effective_until) select '{accounts[8]}',id,'active','provider','yookassa','synthetic-history','annual-history',now()-interval '2 years',now()-interval '1 day' from public.plans where key='advanced'")
 assert plan(8)=='free'
 actor(8,f"select public.create_team_diagnostic('{companies[8]}','Denied expired')",'advanced_required')
 actor(8,f"select public.invite_team_participant('{oldteam}','denied@example.test','Denied',repeat('a',64))",'advanced_required')
 assert actor(8,f"select count(*) from public.team_diagnostics where id='{oldteam}'")=='1'
 assert actor(0,'select public.billing_expire_yookassa_entitlements(100)',role='service_role')=='1'
 assert actor(0,'select public.billing_expire_yookassa_entitlements(100)',role='service_role')=='0'
 assert plan(8)=='free'
 c8=reserve(8);ref8=bind(c8,8);assert process(yoo(c8,ref8))['status']=='processed';assert plan(8)=='advanced'
 assert sql(f"select effective_until<now()+interval '367 days' from private.account_subscriptions where account_id='{accounts[8]}' and status='active'")=='t'
 passed('expiry denies expansion immediately without worker, preserves resources; bounded idempotent cleanup and lapsed renewal')
 sql(f"update public.user_roles set role='administrator' where user_id='{uid(8)}'")
 admin=json.loads(actor(8,"select public.billing_admin_read('{\"provider\":\"yookassa\"}')"))
 assert admin['total']>0 and any(r['amount_minor']==48000 and r['currency']=='RUB' and r['annual_access'] and not r['auto_renewal'] for r in admin['rows'])
 for forbidden in ['secret_key','card_number','receipt','raw_payload','customer_email']:assert forbidden not in json.dumps(admin)
 actor(1,"select public.billing_admin_read('{}')",'admin_access_denied')
 passed('Admin YooKassa filter, annual dates/amount/no-renewal and safe projection; ordinary owner denied Admin')
 sql("update private.billing_configuration set mock_enabled=true,provider_key='mock'")
 cm=start(3);assert process(event(cm))['status']=='processed'
 sql("update private.billing_configuration set yookassa_enabled=false")
 assert plan(1)=='advanced' and actor(1,f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
 actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'billing_unavailable')
 sql("update private.billing_offers set test_mode=false where provider_key='yookassa'",'billing_offer_shape')
 passed('accepted V2.6A mock processor regresses cleanly; provider outage preserves paid features; real offer remains forbidden')
 sql("update private.billing_plan_audit set new_plan='free'",'diagnostic results are immutable')
 sql("delete from private.billing_events where provider_key='yookassa'",'diagnostic results are immutable')
 passed('financial journal and prior subscription history remain immutable')
 print(json.dumps({'status':'PASS','groups':len(checks),'checks':checks,'scope':'networkless isolated local PostgreSQL; synthetic identities only','preExistingRowsPreserved':preserved_rows,'realYooKassaCalls':0,'stagingTouched':False,'productionTouched':False}),flush=True)
finally:sql('drop database if exists '+db+' with(force)',database='postgres')
