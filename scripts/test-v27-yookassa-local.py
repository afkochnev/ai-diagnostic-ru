#!/usr/bin/env python3
"""Production-mode contracts with fake financial events in networkless local PostgreSQL only."""
import argparse,subprocess,json,secrets,hashlib,datetime,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
i=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ['ai-diagnostic-v27-yookassa-local','ai-diagnostic-v27-yookassa-ci'] and i['Config']['Image']=='postgres:17-alpine' and i['HostConfig']['NetworkMode']=='none' and i['Config']['Labels'].get('codex.task')=='v27' and not any(i['NetworkSettings']['Ports'].values())
base='v27_live_'+secrets.token_hex(5);db=base;owned=[base];checks=[]
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:1800])
 elif r.returncode:raise AssertionError(r.stderr[:3000])
 return r.stdout.strip()
def jlit(x):return "'"+json.dumps(x).replace("'","''")+"'::jsonb"
def actor(q,user=None,role='service_role',error=None):return sql('begin;set local request.jwt.claims='+jlit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def ok(t):checks.append(t);print('PASS '+t,flush=True)
def rows():return json.loads(sql("""create temporary table h(k text,v jsonb);do $$declare t record;v jsonb;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private','auth') loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %I.%I x',t.schemaname,t.tablename) into v;insert into h values(t.schemaname||'.'||t.tablename,v);end loop;end;$$;select jsonb_object_agg(k,v) from h;"""))
try:
 sql('create database '+base,database='postgres');sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text());sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 migration=next((ROOT/'supabase/migrations').glob('*_yookassa_production_mode_readiness.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==migration:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 before=rows();sql(migration.read_text().rsplit('commit;',1)[0]+'select rollback_probe_v27_live();commit;','does not exist');assert rows()==before
 sql(migration.read_text());after=rows()
 for t,rs in before.items():
  for r in rs:assert any(all(v.get(k)==x for k,x in r.items()) for v in after[t]),t
 assert sql('select not yookassa_enabled and yookassa_test_mode and not yookassa_live_approved and not yookassa_reconciliation_enabled from private.billing_configuration')=='t'
 ok('additive migration rollback/apply preserves every prior column/row; all production/creation/reconciliation defaults remain OFF')
 for role in ['anon','authenticated']:
  sql('set role '+role+';select * from private.billing_configuration','permission denied')
  sql('set role '+role+";select private.billing_yookassa_ready(false)",'permission denied')
  sql('set role '+role+";select public.billing_process_verified_event('{}','x')",'permission denied')
 ok('new readiness config/helper are private; financial processor remains service-only')
 for mode in ['test','production']:
  db=base+'_'+mode;owned.append(db);sql('create database '+db+' template '+base,database='postgres')
  sql('update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true')
  test=mode=='test';merchant='123456' if test else '654321';flag='true' if test else 'false'
  u=sql('select gen_random_uuid()');meta={'full_name':'Synthetic live capability','data_processing_consent':True,'marketing_consent':False,'data_processing_version':'data-processing-consent-ru-v1','marketing_version':'marketing-consent-ru-v1'}
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{u}','v27-{mode}@example.test',now(),"+jlit(meta)+f");insert into auth.sessions values('{u}','{u}')")
  account=sql(f"select id from public.accounts where legacy_origin_user_id='{u}'");company=actor(f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,products,employee_count,key_problems,main_goals) values('{u}','{account}','Synthetic','manufacturing','Synthetic',20,'Synthetic','Synthetic') returning id",u,'authenticated')
  terms=sql("select content_sha256 from public.commercial_legal_documents where version='advanced-terms-ru-v1'")
  def start(error=None):return actor(f"select public.billing_start_yookassa_checkout('{account}','{company}','advanced-terms-ru-v1','{terms}',true)",u,'authenticated',error)
  start('billing_unavailable')
  sql(f"update private.billing_configuration set yookassa_shop_id='{merchant}',yookassa_test_mode={flag}")
  if not test:
   sql("update private.billing_configuration set yookassa_enabled=true",'yookassa_live_requires_approval')
   sql("update private.billing_configuration set yookassa_reconciliation_enabled=true",'yookassa_live_requires_approval')
   start('billing_unavailable')
  sql(f"update private.billing_configuration set yookassa_live_approved={str(not test).lower()},yookassa_enabled=true")
  # An offer for the opposite mode cannot be reserved.
  sql(f"update private.billing_offers set status='active',test_mode={str(not test).lower()} where provider_key='yookassa'");start('billing_unavailable')
  sql(f"update private.billing_offers set test_mode={flag} where provider_key='yookassa'")
  c=start();assert start()==c
  ctx=json.loads(actor(f"select public.billing_yookassa_owner_context('{c}')",u,'authenticated'));assert ctx['provider_test_mode']==test and ctx['merchant_ref']==merchant
  sql(f"update private.billing_offers set test_mode={str(not test).lower()} where provider_key='yookassa'",'billing_offer_in_use')
  def bind(checkout):
   ref=sql('select gen_random_uuid()');actor(f"select public.billing_bind_yookassa_payment('{checkout}','{ref}')");return ref
  def event(checkout,ref):return {'provider':'yookassa','event_ref':ref+'-succeeded','type':'payment_succeeded','checkout_id':checkout,'subscription_ref':'annual-'+checkout,'payment_ref':ref,'customer_ref':'account-'+account,'occurred_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'amount_minor':48000,'currency':'RUB'}
  def process(e):return json.loads(actor('select public.billing_process_verified_event('+jlit(e)+",'"+hashlib.sha256(json.dumps(e).encode()).hexdigest()+"')"))
  def plan():return sql(f"select private.effective_account_plan('{account}')")
  def until():return sql(f"select effective_until from private.account_subscriptions where account_id='{account}' and status='active'")
  ref=bind(c);assert plan()=='free'
  # Stop new purchases, retain explicit reconciliation for a bound in-flight payment.
  sql('update private.billing_configuration set yookassa_enabled=false,yookassa_reconciliation_enabled=true');start('billing_unavailable')
  e=event(c,ref);assert process(e)['status']=='processed' and plan()=='advanced';paiduntil=until();assert process(e)['duplicate'] and until()==paiduntil
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:assert all(x['duplicate'] for x in pool.map(lambda _:process(e),range(2)))
  assert until()==paiduntil
  ok(mode+': exact merchant/mode reservation, opposite offer denied, historical mode immutable; independent reconciliation activates once with creation OFF')
  sql('update private.billing_configuration set yookassa_enabled=true');c2=start();ref2=bind(c2);e2=event(c2,ref2);assert process(e2)['status']=='processed'
  assert sql(f"select effective_until='{paiduntil}'::timestamptz+interval '1 year' from private.account_subscriptions where account_id='{account}' and status='active'")=='t'
  assert sql(f"select count(*) from private.account_subscriptions where account_id='{account}' and status='active'")=='1'
  team=actor(f"select public.create_team_diagnostic('{company}','Synthetic paid Team')",u,'authenticated')
  original_evidence=sql(f"select md5(string_agg(to_jsonb(x)::text,',' order by checkout_id)) from private.billing_checkout_terms x where account_id='{account}'")
  # A configuration mode change cannot reprocess an old payment under a different merchant/mode.
  c3=start();ref3=bind(c3);e3=event(c3,ref3);sql(f"update private.billing_configuration set yookassa_test_mode={str(not test).lower()},yookassa_live_approved=true")
  assert process(e3)['error']=='reference_mismatch'
  sql(f"update private.billing_configuration set yookassa_test_mode={flag}")
  # Receipt projection remains authenticated/allowlisted and adds no entitlement.
  actor(f"select public.billing_record_yookassa_receipt('{c2}','{ref2}','succeeded')")
  historical=sql(f"select md5(string_agg(to_jsonb(x)::text,',' order by id)) from public.user_consents x where user_id='{u}'")
  refund=sql('select gen_random_uuid()')
  def returned(status='succeeded'):
   return json.loads(actor(f"select public.billing_record_verified_refund('{c2}','{ref2}','{refund}','{status}',48000,'RUB',now(),'succeeded')"))
  returned('pending');assert plan()=='advanced';returned('canceled');assert plan()=='advanced';assert returned()['status']=='processed' and plan()=='free'
  assert sql(f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
  assert sql(f"select md5(string_agg(to_jsonb(x)::text,',' order by id)) from public.user_consents x where user_id='{u}'")==historical
  assert sql(f"select md5(string_agg(to_jsonb(x)::text,',' order by checkout_id)) from private.billing_checkout_terms x where account_id='{account}' and checkout_id in('{c}','{c2}')")==original_evidence
  actor(f"select public.create_team_diagnostic('{company}','Denied')",u,'authenticated','advanced_required')
  # Finalize the deliberately rejected pending fixture to permit a new purchase.
  sql(f"update private.billing_checkout_sessions set status='cancelled' where id='{c3}'")
  c4=start();ref4=bind(c4);assert process(event(c4,ref4))['status']=='processed';later=until();assert returned()['duplicate'] and until()==later and plan()=='advanced'
  admin=sql('select gen_random_uuid()');sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{admin}','admin-{mode}@example.test',now(),"+jlit(meta)+f");insert into auth.sessions values('{admin}','{admin}');update public.user_roles set role='administrator' where user_id='{admin}'")
  view=json.loads(actor('select public.billing_admin_read('+jlit({'account':account})+')',admin,'authenticated'));assert any(x['test_mode']==test and x['amount_minor']==48000 and x['annual_access'] and not x['auto_renewal'] for x in view['rows'])
  assert all(x not in json.dumps(view) for x in ['secret_key','raw_payload','card_number'])
  ok(mode+': annual renewal retains time, one active subscription; full refund restores Free/history, and replay preserves later repurchase')
 print(json.dumps({'status':'PASS','checks':checks,'count':len(checks),'realProviderCalls':0,'productionTouched':False,'stagingTouched':False}),flush=True)
finally:
 for name in reversed(owned):sql('drop database if exists '+name+' with(force)',database='postgres')
