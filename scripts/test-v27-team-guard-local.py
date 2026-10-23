#!/usr/bin/env python3
"""Controlled Team guard contracts in disposable networkless PostgreSQL, no cloud credentials."""
import argparse,subprocess,json,secrets,hashlib,datetime,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
i=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ['ai-diagnostic-v27-team-guard-local','ai-diagnostic-v27-team-guard-ci'] and i['Config']['Image']=='postgres:17-alpine' and i['HostConfig']['NetworkMode']=='none' and i['Config']['Labels'].get('codex.task')=='v27-team-guard' and not any(i['NetworkSettings']['Ports'].values())
db='v27_team_guard_'+secrets.token_hex(5);checks=[]
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:2500])
 elif r.returncode:raise AssertionError(r.stderr[:4000])
 return r.stdout.strip()
def lit(x):return "'"+json.dumps(x,ensure_ascii=False).replace("'","''")+"'::jsonb"
def actor(q,user=None,role='service_role',error=None):return sql('begin;set local request.jwt.claims='+lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def auth(q,user,error=None):return actor(q,user,'authenticated',error)
def service(q,error=None):return actor(q,error=error)
def probe(setup,q,user=None,role='service_role',error=None):
 claims=lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')
 return sql('begin;'+setup+';set local request.jwt.claims='+claims+';set local role '+role+';'+q+';rollback;',error)
def race(q,user=None,role='service_role'):
 claims=lit({'role':role,'sub':user,'aal':'aal1','session_id':user}).removesuffix('::jsonb')
 body='begin;set local request.jwt.claims='+claims+';set local role '+role+';'+q+';commit;'
 def call(_):return subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input=body,text=True,capture_output=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(call,range(2)))
 assert sum(x.returncode==0 for x in results)==1,[x.stderr for x in results]
 return next(x.stdout.strip() for x in results if x.returncode==0)
def ok(t):checks.append(t);print('PASS '+t,flush=True)
def rows():
 return json.loads(sql("create temporary table h(k text,v jsonb);do $$declare t record;v jsonb;begin for t in select schemaname,tablename from pg_tables where schemaname in('public','private','auth') loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %I.%I x',t.schemaname,t.tablename) into v;insert into h values(t.schemaname||'.'||t.tablename,v);end loop;end;$$;select jsonb_object_agg(k,v) from h;"))
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 candidate=next((ROOT/'supabase/migrations').glob('*_controlled_team_smoke_guard.sql'))
 bootstrap=[]
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:bootstrap.append((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:bootstrap.append((ROOT/'supabase/tests/team-foundation.sql').read_text()+"update public.accounts set status='active';")
  bootstrap.append(m.read_text()+'\nRESET ROLE; RESET request.jwt.claims;')
 sql('\n'.join(bootstrap))
 before=rows()
 sql(candidate.read_text().rsplit('commit;',1)[0]+'select controlled_guard_rollback_probe();commit;','does not exist')
 assert rows()==before
 sql(candidate.read_text());after=rows()
 for table,rs in before.items():
  for row in rs:assert any(all(v.get(k)==x for k,x in row.items()) for v in after[table]),table
 sql(candidate.read_text(),'already exists')
 assert sql('select run_id is null from private.controlled_team_policy')=='t'
 ok('transactional additive migration preserves every old column/row; selected run defaults closed; repeat migration fails')
 for role in ['anon','authenticated','service_role']:
  sql('set role '+role+';select * from private.controlled_team_runs','permission denied')
  sql('set role '+role+";select private.configure_controlled_team_run(null,null,null,null,null,null,null)",'permission denied')
 assert sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname like '%pre_controlled' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))")=='0'
 ok('private state/operator config/renamed legacy helpers have no API grants')
 meta={'full_name':'Synthetic controlled Team','data_processing_consent':True,'marketing_consent':False,'data_processing_version':'data-processing-consent-ru-v1','marketing_version':'marketing-consent-ru-v1'}
 def user(label):
  u=sql('select gen_random_uuid()');mail=label+'@example.test'
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{u}','{mail}',now(),"+lit(meta)+f");insert into auth.sessions values('{u}','{u}')")
  return u,mail
 owner,_=user('guard-owner');admin,_=user('guard-admin');foreign,_=user('guard-foreign');participants=[user('guard-p'+str(n)) for n in range(3)]
 sql(f"update public.user_roles set role='administrator' where user_id='{admin}'")
 account=sql(f"select id from public.accounts where legacy_origin_user_id='{owner}'")
 company=auth(f"insert into public.company_profiles(owner_user_id,account_id,name,industry_key,products,employee_count,key_problems,main_goals) values('{owner}','{account}','Synthetic Team guard','manufacturing','Synthetic',20,'Synthetic','Synthetic') returning id",owner)
 subscription=sql(f"select id from private.account_subscriptions where account_id='{account}' and status='active'")
 sql('update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true')
 auth(f"select public.create_team_diagnostic('{company}','Denied closed')",owner,'controlled_team_unavailable')
 sql('update private.launch_controls set team_creation_enabled=false,team_invitations_enabled=false')
 run=sql('select gen_random_uuid()');emails='array['+','.join("'"+x[1]+"'" for x in participants)+']'
 sql(f"select private.configure_controlled_team_run('{run}','{account}','{company}','{owner}',{emails},null,'{subscription}')",'controlled_team_invalid_window')
 sql(f"select private.configure_controlled_team_run('{run}','{account}','{company}','{owner}',array['a@example.test','b@example.test',null],clock_timestamp()+interval '45 minutes','{subscription}')",'controlled_team_invalid_participants')
 sql("begin;update public.jobs set status='running',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()-interval '1 second' where id=(select id from public.jobs limit 1);"+f"select private.configure_controlled_team_run('{run}','{account}','{company}','{owner}',{emails},clock_timestamp()+interval '45 minutes','{subscription}');commit;",'controlled_team_not_quiescent')
 sql(f"select private.configure_controlled_team_run('{run}','{account}','{company}','{owner}',{emails},clock_timestamp()+interval '45 minutes','{subscription}')")
 service("select public.controlled_team_context('00000000-0000-4000-8000-000000000000',null,null,null)",'controlled_team_unavailable')
 probe(f"update private.controlled_team_runs set expires_at=clock_timestamp()-interval '1 second' where id='{run}'",f"select public.controlled_team_context('{company}',null,null,null)",error='controlled_team_unavailable')
 ok('malformed operator configuration and expired/wrong-company admission fail closed without changing state')

 service(f"select public.controlled_team_context('{company}',null,null,null)")
 grant=json.loads(auth(f"select public.admin_assign_account_plan('{account}','advanced','Controlled Team temporary','free')",admin))
 assert grant['status']=='changed'
 sql('update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true')
 auth(f"select public.create_team_diagnostic('{company}','Foreign denied')",foreign,'controlled_team_unavailable')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  created=list(pool.map(lambda _:subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input="begin;set local request.jwt.claims='"+json.dumps({'role':'authenticated','sub':owner,'aal':'aal1','session_id':owner})+"';set local role authenticated;select public.create_team_diagnostic('"+company+"','One Team');commit;",text=True,capture_output=True),range(2)))
 assert sum(x.returncode==0 for x in created)==1
 team=sql(f"select team_id from private.controlled_team_runs where id='{run}'")
 assert sql(f"select count(*) from public.team_diagnostics where company_id='{company}'")=='1'
 auth(f"select public.create_team_diagnostic('{company}','Second denied')",owner,'controlled_team_unavailable')
 ok('default closed direct RPC; owner/company binding and concurrent create-once; temporary Advanced audited')
 pids=[];tokens=[]
 for n,(u,mail) in enumerate(participants):
  token=secrets.token_hex(32);tokens.append(token);h=hashlib.sha256(token.encode()).hexdigest()
  pid=auth(f"select public.invite_team_participant('{team}','{mail}','Synthetic {n}','{h}')",owner);pids.append(pid)
  auth(f"select public.renew_team_invitation('{pid}',repeat('a',64))",owner,'controlled_team_renewal_denied')
  probe('update private.launch_controls set team_invitations_enabled=false',f"select public.reserve_controlled_team_effect('{team}','auth_link','{pid}',null)",error='team_invitations_paused')
  effect=json.loads((race if n==0 else service)(f"select public.reserve_controlled_team_effect('{team}','auth_link','{pid}',null)"));assert effect['recipient_email']==mail and effect['invitation_hash']==h
  service(f"select public.reserve_controlled_team_effect('{team}','invitation_email','{pid}',null)",'controlled_team_prior_effect_unresolved')
  service(f"select public.complete_controlled_team_effect('{effect['reservation_id']}','succeeded','fake-auth',"+lit({})+')')
  send=json.loads(service(f"select public.reserve_controlled_team_effect('{team}','invitation_email','{pid}',null)"))
  service(f"select public.complete_controlled_team_effect('{send['reservation_id']}','succeeded','fake-email',"+lit({})+')')
  service(f"select public.reserve_controlled_team_effect('{team}','invitation_email','{pid}',null)",'controlled_team_budget_consumed')
 auth(f"select public.invite_team_participant('{team}','fourth@example.test','Fourth',repeat('b',64))",owner,'controlled_team_unavailable')
 ok('three exact recipients only; current invitation binding; durable auth/send once; unresolved effect blocks dispatch; renew/fourth denied')
 for n,((u,mail),pid,token) in enumerate(zip(participants,pids,tokens)):
  auth(f"select public.accept_team_invitation('{token}')",u,'controlled_team_consent_required')
  auth(f"select public.finalize_team_invitation_identity('{token}',false,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",u,'team_invitation_unavailable')
  auth(f"select public.finalize_team_invitation_identity('{token}',true,'temporary-ru-v1','marketing-consent-ru-v1')",u,'team_policy_changed')
  auth(f"select public.finalize_team_invitation_identity('{token}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",foreign,'team_invitation_unavailable')
  assert sql(f"select redeemed_at is null from private.team_invitations where participant_id='{pid}'")=='t'
  auth(f"select public.finalize_team_invitation_identity('{token}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",u)

  q=json.loads(auth(f"select public.read_team_response('{pid}')",u))['questions']
  answers={x['id']:2 if x['answer_type']=='scale_0_4' else 'Synthetic process evidence without identity '+str(n) for x in q}
  auth(f"select public.save_team_response('{pid}',0,"+lit(answers)+',true)',u)
  if n<2:auth(f"select public.request_team_report_v3('{team}','openai')",owner,'team_threshold')
  auth(f"select public.read_team_response('{pid}')",owner,'team_response_unavailable')
 source=sql(f"select fingerprint from private.team_source('{team}')")
 foreign_job_setup="update public.jobs set status='running',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '1 minute' where id=(select id from public.jobs limit 1)"
 assert sql('select count(*) from public.jobs')!='0'
 probe(foreign_job_setup,f"select public.claim_controlled_team_job('{run}','team_aggregate','{source}',null)",error='controlled_team_foreign_work')
 service(f"select public.claim_controlled_team_job(null,'team_aggregate','{source}',null)",'controlled_team_target_changed')
 for fn in ['claim_team_jobs','claim_team_jobs_v2','claim_team_jobs_v3']:assert service(f"select count(*) from public.{fn}(1,600)")=='0'
 service(f"select public.claim_controlled_team_job('{run}','team_aggregate','{source}',gen_random_uuid())",'controlled_team_target_changed')
 agg=json.loads(race(f"select public.claim_controlled_team_job('{run}','team_aggregate','{source}',null)"))
 assert service(f"select public.process_team_aggregate('{agg['job_id']}','{agg['lease_token']}')")=='completed'
 service(f"select public.claim_controlled_team_job('{run}','team_aggregate','{source}',null)",'controlled_team_claim_consumed')
 auth(f"select public.request_team_report('{team}')",owner,'controlled_team_legacy_denied')
 report=auth(f"select public.request_team_report_v3('{team}','openai')",owner)
 assert auth(f"select public.request_team_report_v3('{team}','openai')",owner)==report
 claim=json.loads(service(f"select public.claim_controlled_team_job('{run}','team_ai_report','{source}','{report}')"))
 jid,lease=claim['job_id'],claim['lease_token']
 deadline=sql(f"select generation_deadline from private.controlled_team_runs where id='{run}'")
 service(f"select public.fail_team_job('{jid}',gen_random_uuid(),'team_processing_failed',false)",'controlled_team_lease_invalid')
 probe(f"update private.team_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='{jid}'",f"select public.fail_team_job('{jid}','{lease}','team_processing_failed',false)",error='controlled_team_lease_invalid')
 assert sql(f"select lease_token::text from private.team_jobs where id='{jid}'")==lease
 probe(f"update private.team_jobs set lease_expires_at=lease_expires_at+interval '5 minutes' where id='{jid}'",f"select public.claim_controlled_team_job('{run}','team_ai_report','{source}','{report}')",error='controlled_team_claim_consumed')
 assert sql(f"select generation_deadline from private.controlled_team_runs where id='{run}'")==deadline
 probe(f"update private.controlled_team_runs set generation_deadline=clock_timestamp()-interval '1 second' where id='{run}'",f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','model_get',0,0)",error='controlled_team_dispatch_denied')
 service(f"select public.publish_team_report('{jid}','{lease}','{{}}','gpt-5.6-sol')",'controlled_team_receipt_required')
 ok('concurrent claim once; immutable first-claim deadline cannot reset through claim/lease renewal; wrong/expired lease never clears owned live lease; unreceipted publication denied')

 service(f"select public.claim_controlled_team_job('{run}','team_ai_report','{source}','{report}')",'controlled_team_claim_consumed')
 assert json.loads(service(f"select public.prepare_team_report_job('{jid}','{lease}')"))['controlled_run_id']==run
 # Protected fixture only: exercise insertion/read authorization without a provider-generated narrative.
 completed_setup=f"update public.team_ai_reports set status='completed',model='gpt-5.6-sol',completed_at=clock_timestamp(),structured_content='{{}}'::jsonb where id='{report}'"
 artifact=f"insert into public.team_report_artifacts(team_report_id,team_report_version,template_version,status,storage_path,content_base64,checksum) values('{report}',1,'team-report-v3','ready','fixture.pdf','JVBERi0=',repeat('0',64))"
 probe(completed_setup,artifact,error='controlled_team_pdf_not_reserved')
 reserve_pdf=f"select public.reserve_controlled_team_effect('{team}','pdf',null,'{report}')"
 probe(completed_setup,reserve_pdf+';'+artifact)
 probe(completed_setup,reserve_pdf+';'+artifact.replace("'team-report-v3'","'wrong-template'"),error='controlled_team_pdf_not_reserved')
 probe(completed_setup,reserve_pdf+';'+artifact+';'+artifact,error='duplicate key value')
 probe(completed_setup,reserve_pdf+';'+reserve_pdf,error='controlled_team_prior_effect_unresolved')
 probe(completed_setup+f";update private.controlled_team_runs set expires_at=clock_timestamp()-interval '1 second' where id='{run}'",f"select public.read_team_pdf_source('{report}')",owner,'authenticated')
 assert sql(f"select count(*) from public.team_report_artifacts where team_report_id='{report}'")=='0'
 ok('PDF new insertion requires once reservation/exact report/template; duplicate insert denied; expired smoke does not hide authorized historical completed PDF source')
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','synthesis',100,6000)",'controlled_team_preflight_required')
 probe(foreign_job_setup,f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','model_get',0,0)",error='controlled_team_foreign_work')
 service(f"select public.reserve_controlled_team_ai_call(null,'{jid}','{lease}','model_get',0,0)",'controlled_team_dispatch_denied')
 get=json.loads(service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','model_get',0,0)"))
 service(f"select public.complete_controlled_team_effect('{get['reservation_id']}','succeeded','fake-model',"+lit({'http_status':200})+')')
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','model_get',0,0)",'controlled_team_budget_consumed')
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','synthesis',131073,6000)",'controlled_team_dispatch_denied')
 syn=json.loads(service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','synthesis',100,6000)"))
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','main_report',100,14000)",'controlled_team_run_failed')
 service(f"select public.complete_controlled_team_effect('{syn['reservation_id']}','unknown',null,"+lit({})+')')
 assert sql(f"select status from private.controlled_team_runs where id='{run}'")=='stopped'
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','synthesis',100,6000)",'controlled_team_unavailable')
 service(f"select public.fail_team_job('{jid}','{lease}','team_processing_failed',true)")
 assert sql(f"select attempts=3 and status='failed' and lease_token is null from private.team_jobs where id='{jid}'")=='t'
 for fn in ['claim_team_jobs','claim_team_jobs_v2','claim_team_jobs_v3']:assert service(f"select count(*) from public.{fn}(1,600)")=='0'
 ok('personal consent/current versions required before binding; foreign/false/stale/direct accept never consume proof; three-response privacy threshold; sole controlled aggregate/AI claims; ordinary legacy claimers never consume target; durable GET/input/token/stage caps and stop on ambiguity')
 # Expected-subscription CAS blocks same-plan replacement and provider intervention without changing audit.
 audit_before=sql(f"select count(*) from private.admin_plan_changes where account_id='{account}'")
 for source_kind in ['manual','provider']:
  setup=f"update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where account_id='{account}' and status='active';insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from) select '{account}',id,'active','{source_kind}',clock_timestamp() from public.plans where key='advanced'"
  probe(setup,f"select public.admin_assign_account_plan('{account}','free','CAS denial','advanced')",admin,'authenticated','controlled_team_subscription_changed')
  assert sql(f"select count(*) from private.admin_plan_changes where account_id='{account}'")==audit_before
 # A stopped unresolved grant cannot be abandoned by switching the selected run.
 sql('update private.launch_controls set team_creation_enabled=false,team_invitations_enabled=false')
 sql(f"select private.configure_controlled_team_run(gen_random_uuid(),'{account}','{company}','{owner}',{emails},clock_timestamp()+interval '45 minutes','{subscription}')",'controlled_team_not_quiescent')
 ok('exact-subscription CAS denies manual/provider intervention without audit; operator cannot bypass unresolved grant by switching run')
 # Expired/stopped admission cannot trap the exact temporary grant; compensation is audited append-only.
 sql(f"update private.controlled_team_runs set expires_at=clock_timestamp()-interval '1 second' where id='{run}'")
 restored=json.loads(auth(f"select public.admin_assign_account_plan('{account}','free','Controlled Team complete','advanced')",admin))
 assert restored['status']=='changed' and restored['subscription_id']!=subscription
 assert sql(f"select count(*) from private.admin_plan_changes where account_id='{account}'")=='2'
 assert sql(f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
 assert sql(f"select private.effective_account_plan('{account}')")=='free'
 assert json.loads(auth(f"select public.admin_assign_account_plan('{account}','free','Controlled Team duplicate','advanced')",admin))['status']=='unchanged'
 assert sql(f"select count(*) from private.admin_plan_changes where account_id='{account}'")=='2'
 ok('safe terminal failure after stop clears only own valid lease; expired exact grant compensation creates new Free audit; duplicate does not rewrite history')
 print(json.dumps({'status':'PASS','checks':checks,'count':len(checks),'realProviderCalls':0,'productionTouched':False,'stagingTouched':False}),flush=True)
finally:sql('drop database if exists '+db+' with(force)',database='postgres')
