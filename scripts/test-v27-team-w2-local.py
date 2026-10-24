#!/usr/bin/env python3
"""Controlled Team guard contracts in disposable networkless PostgreSQL, no cloud credentials."""
import argparse,subprocess,json,secrets,hashlib,datetime,concurrent.futures
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
i=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert ((a.container in ['ai-diagnostic-v27-team-w2-local','ai-diagnostic-v27-team-w2-ci'] and i['Config']['Labels'].get('codex.task')=='v27-team-w2') or(a.container=='ai-diagnostic-v27-team-guard-local' and i['Config']['Labels'].get('codex.task')=='v27-team-guard')) and i['Config']['Image']=='postgres:17-alpine' and i['HostConfig']['NetworkMode']=='none' and not any(i['NetworkSettings']['Ports'].values())
db='v27_team_w2_'+secrets.token_hex(5);checks=[]
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
 run=sql('select gen_random_uuid()');mails=['w2-p'+str(n)+'@example.test' for n in range(3)];emails='array['+','.join("'"+x+"'" for x in mails)+']'
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
 historical=rows();root_pre=sql(f"select to_jsonb(x) from private.controlled_team_runs x where id='{run}'")
 effects_pre=sql(f"select jsonb_agg(to_jsonb(x) order by id) from private.controlled_team_effects x where run_id='{run}'")
 sql(candidate.read_text().rsplit('commit;',1)[0]+'select absent_w2_rollback_probe();commit;','does not exist')
 assert rows()==historical
 drift_setup="begin;do $$declare d text;begin d:=pg_get_functiondef('public.claim_controlled_team_job(uuid,text,text,uuid)'::regprocedure);execute replace(d,'if p_kind=''team_aggregate'' and p_report_id is not null then','if (p_kind=''team_aggregate'') and p_report_id is not null then');end $$;"
 sql(drift_setup+candidate.read_text(),'controlled_team_w2_source_drift')
 assert rows()==historical
 sql(candidate.read_text());after=rows()
 for table,rs in historical.items():
  for row in rs:assert any(all(v.get(k)==x for k,x in row.items()) for v in after[table]),table
 sql(candidate.read_text(),'already exists')
 assert sql('select count(*) from private.controlled_team_windows')=='0'
 legacy=json.loads(probe(f"update private.controlled_team_runs set status='active',expires_at=clock_timestamp()+interval '20 minutes' where id='{run}'",f"select public.controlled_team_context('{company}',null,null,null)"))
 assert legacy['run_id']==run and legacy['window_id'] is None and legacy['continuation_window_id'] is None

 service(f"select public.controlled_team_context('{company}',null,null,null)",'controlled_team_unavailable')
 ok('transactional additive migration keeps all historical rows/fields, root receipts and stopped default; reapply fails')
 for role in ['anon','authenticated','service_role']:
  sql('set role '+role+';select * from private.controlled_team_windows','permission denied')
  sql('set role '+role+';select * from private.controlled_team_verifications','permission denied')
  sql('set role '+role+";select private.configure_controlled_team_w2(null,null,null,null)",'permission denied')
 assert sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and(p.proname like '%w2%' or p.proname='require_controlled_team_window') and(has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE'))")=='0'
 ok('private W2/operator/hash-finalizer helpers lack API grants; authenticated cannot use service-only access')
 window=sql('select gen_random_uuid()');plan='a'*64
 sql(f"select private.configure_controlled_team_w2('{window}','{run}','{subscription}','{plan}')",'controlled_team_w2_target_changed')
 sql(f"select private.configure_controlled_team_w2('{window}','{run}','{restored}','{plan}')")
 assert sql(f"select armed_at is null and expires_at is null and status='prepared' from private.controlled_team_windows where id='{window}'")=='t'
 service(f"select public.controlled_team_context('{company}',null,null,null)",'controlled_team_unavailable')
 auth(f"select public.admin_assign_account_plan('{account}','advanced','Denied unarmed','free')",admin,'controlled_team_unavailable')
 sql(f"update private.controlled_team_runs set status='active' where id='{run}'",'controlled_team_root_immutable')
 sql(f"select private.arm_controlled_team_w2('{window}',repeat('b',64))",'controlled_team_w2_unavailable')
 probe('update private.launch_controls set team_creation_enabled=true',f"select private.arm_controlled_team_w2('{window}','{plan}')",role='postgres',error='controlled_team_not_quiescent')
 p0=participants[0]
 probe(f"update auth.users set raw_user_meta_data='{{}}' where id='{p0['uid']}'",f"select private.arm_controlled_team_w2('{window}','{plan}')",role='postgres',error='controlled_team_w2_unavailable')
 sql(f"select private.arm_controlled_team_w2('{window}','{plan}')")
 sql(f"select private.arm_controlled_team_w2('{window}','{plan}')",'controlled_team_w2_unavailable')
 sql(f"update private.controlled_team_windows set expires_at=expires_at+interval '1 minute' where id='{window}'",'controlled_team_window_immutable')
 expired_setup=f"alter table private.controlled_team_windows disable trigger controlled_team_window_immutable;update private.controlled_team_windows set armed_at=armed_at-interval '2 hours',expires_at=expires_at-interval '2 hours',personal_deadline_at=personal_deadline_at-interval '2 hours' where id='{window}'"
 personal_setup=f"alter table private.controlled_team_windows disable trigger controlled_team_window_immutable;update private.controlled_team_windows set armed_at=armed_at-interval '25 minutes',expires_at=expires_at-interval '25 minutes',personal_deadline_at=personal_deadline_at-interval '25 minutes' where id='{window}'"
 probe(expired_setup,f"select public.controlled_team_context('{company}',null,null,null)",error='controlled_team_unavailable')
 grant=json.loads(auth(f"select public.admin_assign_account_plan('{account}','advanced','W2 exact CAS','free')",admin))
 for source_kind in ['manual','provider']:
  intervention=f"update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where id='{grant['subscription_id']}';insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from) select '{account}',id,'active','{source_kind}',clock_timestamp() from public.plans where key='advanced'"
  probe(intervention,f"select public.admin_assign_account_plan('{account}','free','Denied intervening plan','advanced')",admin,'authenticated','controlled_team_subscription_changed')
 auth(f"select public.create_team_diagnostic('{company}','Denied second Team')",owner,'controlled_team_w2_dedicated_path_required')
 auth(f"select public.invite_team_participant('{team}','fourth@example.test','Fourth',repeat('b',64))",owner,'controlled_team_w2_dedicated_path_required')
 auth(f"select public.renew_team_invitation('{participants[0]['pid']}',repeat('c',64))",owner,'controlled_team_renewal_denied')
 auth(f"select public.revoke_team_participant('{participants[0]['pid']}')",owner,'controlled_team_mutation_denied')
 auth(f"select public.finalize_team_invitation_identity('{participants[0]['token']}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",participants[0]['uid'],'controlled_team_w2_dedicated_path_required')
 ok('prepare has no timer; arm is once60m/T+20; immutable root/expiry; new audited grant; generic create/invite/renew denied')
 for n,p in enumerate(participants):
  pid,uid,h=p['pid'],p['uid'],p['hash']
  service(f"select public.reserve_controlled_team_effect('{team}','auth_link','{pid}',null)",'controlled_team_window_mismatch')
  service(f"select public.reserve_team_invitation_identity('{h}',repeat('d',64))",'controlled_team_w2_dedicated_path_required')
  resolved=json.loads(service(f"select public.resolve_team_invitation_auth('{h}')"))
  assert resolved['create_user'] is False and resolved['user_id']==uid and resolved['window_id']==window
  auth(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','reauth_link')",owner,'permission denied')
  probe(personal_setup,f"select public.reserve_controlled_team_w2_access('{window}','{pid}','reauth_link')",error='controlled_team_w2_access_denied')
  probe(f"update private.team_invitations set token_hash=repeat('f',64) where participant_id='{pid}'",f"select public.resolve_team_invitation_auth('{h}')",error='controlled_team_unavailable')
  issuance=json.loads((race if n==0 else service)(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','reauth_link')"))
  assert issuance['recipient_email']==mails[n] and issuance['user_id']==uid
  service(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','access_email')",'controlled_team_prior_effect_unresolved')
  service(f"select public.complete_controlled_team_effect('{issuance['reservation_id']}','succeeded','fake-fresh-auth')")
  service(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','reauth_link')",'controlled_team_budget_consumed')
  send=json.loads(service(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','access_email')"))
  service(f"select public.complete_controlled_team_effect('{send['reservation_id']}','succeeded','fake-fresh-email')")
  service(f"select public.reserve_controlled_team_w2_access('{window}','{pid}','access_email')",'controlled_team_budget_consumed')
  probe(personal_setup,f"select public.reserve_controlled_team_w2_verification('{window}','{pid}','{h}')",error='controlled_team_personal_deadline')
  vid=json.loads((race if n==0 else service)(f"select public.reserve_controlled_team_w2_verification('{window}','{pid}','{h}')"))['verification_id']
  p['vid']=vid
  service(f"select public.reserve_controlled_team_w2_verification('{window}','{pid}','{h}')",'controlled_team_verification_consumed')
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{vid}','{h}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",foreign,'controlled_team_verification_denied')
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{vid}','{h}',false,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",uid,'controlled_team_verification_denied')
  sql(f"update auth.users set email_confirmed_at=clock_timestamp() where id='{uid}'")
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{vid}','{h}',true,'temporary-ru-v1','marketing-consent-ru-v1')",uid,'team_policy_changed')
  assert auth(f"select public.finalize_controlled_team_w2_identity('{window}','{vid}','{h}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",uid)==pid
  auth(f"select public.finalize_controlled_team_w2_identity('{window}','{vid}','{h}',true,'data-processing-consent-ru-v1','marketing-consent-ru-v1')",uid,'controlled_team_verification_denied')
  assert sql(f"select granted from public.user_consents where user_id='{uid}' and kind='marketing'")=='f'
  q=json.loads(auth(f"select public.read_team_response('{pid}')",uid))['questions']
  answers={x['id']:2 if x['answer_type']=='scale_0_4' else 'Synthetic process evidence for group '+str(n) for x in q}
  auth(f"select public.save_team_response('{pid}',0,"+lit(answers)+',true)',uid)
  auth(f"select public.read_team_response('{pid}')",owner,'team_response_unavailable')
  if n<2:auth(f"select public.request_team_report_v3('{team}','openai')",owner,'team_threshold')
 ok('root-shared3extra links/mail only; races once; exact pendingUID; no nonce/hash replacement; genuine click reservation; current personal consent/false marketing; privacy threshold')
 source=sql(f"select fingerprint from private.team_source('{team}')")
 for fn in ['claim_team_jobs','claim_team_jobs_v2','claim_team_jobs_v3']:assert service(f"select count(*) from public.{fn}(1,600)")=='0'
 assert sql(f"select count(*) from private.team_jobs where controlled_run_id='{run}' and controlled_window_id='{window}'")=='1'
 service(f"select public.claim_controlled_team_job('{run}','team_aggregate','{source}',null)",'controlled_team_window_mismatch')
 service(f"select public.claim_controlled_team_window_job('{run}',gen_random_uuid(),'team_aggregate','{source}',null)",'controlled_team_window_mismatch')
 # Safe target cancellation is finite and reversible only inside this test transaction.
 agg_id=sql(f"select id from private.team_jobs where controlled_run_id='{run}' and kind='team_aggregate'")
 stop_setup=f"update private.controlled_team_windows set status='stopped',stopped_at=clock_timestamp(),stop_reason='fixture_stop' where id='{window}'"
 assert probe(stop_setup,f"select public.terminalize_controlled_team_window_job('{run}','{window}','{agg_id}','closed_window')")
 probe(stop_setup,f"select public.terminalize_controlled_team_window_job('{run}','{window}',gen_random_uuid(),'closed_window')",error='controlled_team_terminalize_denied')
 agg=json.loads(race(f"select public.claim_controlled_team_window_job('{run}','{window}','team_aggregate','{source}',null)"))
 assert agg['window_id']==window and agg['approved_plan_hash']==plan
 assert service(f"select public.process_team_aggregate('{agg['job_id']}','{agg['lease_token']}')")=='completed'
 service(f"select public.claim_controlled_team_window_job('{run}','{window}','team_aggregate','{source}',null)",'controlled_team_claim_consumed')
 report=auth(f"select public.request_team_report_v3('{team}','openai')",owner)
 late_setup=f"alter table private.controlled_team_windows disable trigger controlled_team_window_immutable;update private.controlled_team_windows set armed_at=armed_at-interval '49 minutes',expires_at=expires_at-interval '49 minutes',personal_deadline_at=personal_deadline_at-interval '49 minutes' where id='{window}'"
 probe(late_setup,f"select public.claim_controlled_team_window_job('{run}','{window}','team_ai_report','{source}','{report}')",error='controlled_team_window_dispatch_late')
 claim=json.loads(service(f"select public.claim_controlled_team_window_job('{run}','{window}','team_ai_report','{source}','{report}')"))
 jid,lease=claim['job_id'],claim['lease_token']
 assert json.loads(service(f"select public.prepare_team_report_job('{jid}','{lease}')"))['controlled_window_id']==window
 service(f"select public.reserve_controlled_team_ai_call('{run}','{jid}','{lease}','model_get',0,0)",'controlled_team_window_mismatch')
 completed_setup=f"update public.team_ai_reports set status='completed',model='gpt-5.6-sol',completed_at=clock_timestamp(),structured_content='{{}}'::jsonb where id='{report}'"
 artifact=f"insert into public.team_report_artifacts(team_report_id,team_report_version,template_version,status,storage_path,content_base64,checksum) values('{report}',1,'team-report-v3','ready','fixture.pdf','JVBERi0=',repeat('0',64))"
 reserve_pdf=f"select public.reserve_controlled_team_window_effect('{run}','{window}','{team}','pdf',null,'{report}')"
 probe(completed_setup,artifact,error='controlled_team_pdf_not_reserved')
 probe(completed_setup,reserve_pdf+';'+artifact)
 probe(completed_setup,reserve_pdf+';'+artifact+';'+artifact,error='duplicate key value')
 probe(completed_setup,reserve_pdf+';'+reserve_pdf,error='controlled_team_prior_effect_unresolved')
 probe(completed_setup,reserve_pdf+';'+artifact.replace("'team-report-v3'","'wrong-template'"),error='controlled_team_pdf_not_reserved')
 assert sql(f"select count(*) from public.team_report_artifacts where team_report_id='{report}'")=='0'
 service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','synthesis',100,6000)",'controlled_team_preflight_required')
 get=json.loads(service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','model_get',0,0)"))
 assert get['window_id']==window and get['approved_plan_hash']==plan
 service(f"select public.complete_controlled_team_effect('{get['reservation_id']}','succeeded','fake-model')")
 service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','model_get',0,0)",'controlled_team_budget_consumed')
 service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','synthesis',131073,6000)",'controlled_team_dispatch_denied')
 syn=json.loads(service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','synthesis',100,6000)"))
 service(f"select public.complete_controlled_team_effect('{syn['reservation_id']}','unknown',null)")
 first_stop=sql(f"select jsonb_build_array(stopped_at,stop_reason) from private.controlled_team_windows where id='{window}'")
 assert sql(f"select status from private.controlled_team_windows where id='{window}'")=='stopped'
 service(f"select public.reserve_controlled_team_window_ai_call('{run}','{window}','{jid}','{lease}','synthesis',100,6000)",'controlled_team_unavailable')
 service(f"select public.terminalize_controlled_team_window_job('{run}','{window}','{jid}','closed_window')",'controlled_team_terminalize_denied')
 service(f"select public.fail_team_job('{jid}',gen_random_uuid(),'team_processing_failed',false)",'controlled_team_lease_invalid')
 service(f"select public.fail_team_job('{jid}','{lease}','team_processing_failed',false)")
 assert sql(f"select status='failed' and attempts=3 and lease_token is null and lease_expires_at is null from private.team_jobs where id='{jid}'")=='t'
 assert sql(f"select jsonb_build_array(stopped_at,stop_reason) from private.controlled_team_windows where id='{window}'")==first_stop
 service(f"select public.stop_controlled_team_window('{run}','{window}','already_stopped')")
 sql(f"update private.controlled_team_windows set status='active' where id='{window}'",'controlled_team_window_immutable')
 sql(f"delete from private.controlled_team_windows where id='{window}'",'controlled_team_window_immutable')
 sql(f"delete from private.controlled_team_verifications where window_id='{window}'",'controlled_team_verification_immutable')
 sql(f"delete from private.controlled_team_effects where window_id='{window}'",'controlled_team_receipt_immutable')
 free=json.loads(auth(f"select public.admin_assign_account_plan('{account}','free','W2 restoration','advanced')",admin))
 assert free['subscription_id']!=restored
 assert json.loads(auth(f"select public.admin_assign_account_plan('{account}','free','W2 duplicate','advanced')",admin))['status']=='unchanged'
 assert sql(f"select count(*) from private.admin_plan_changes where account_id='{account}'")=='4'
 assert sql(f"select private.effective_account_plan('{account}')")=='free'
 assert sql(f"select to_jsonb(x) from private.controlled_team_runs x where id='{run}'")==root_pre
 assert sql(f"select jsonb_agg(to_jsonb(x)-'window_id' order by id) from private.controlled_team_effects x where run_id='{run}' and window_id is null")==effects_pre
 assert sql(f"select count(*) from private.controlled_team_effects where run_id='{run}' and effect in('reauth_link','access_email')")=='6'
 assert sql(f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
 assert sql(f"select count(*) from public.team_participants where team_diagnostic_id='{team}'")=='3'
 after_smoke=rows();participant_ids={p['pid'] for p in participants};participant_uids={p['uid'] for p in participants}
 for table,rs in historical.items():
  for row in rs:
   allowed=set()
   if table=='auth.users' and row.get('id') in participant_uids:allowed={'email_confirmed_at'}
   elif table=='public.team_participants' and row.get('id') in participant_ids:allowed={'status','started_at','completed_at'}
   elif table=='private.team_invitations' and row.get('participant_id') in participant_ids:allowed={'redeemed_at'}
   elif table=='private.team_identity_reservations' and row.get('user_id') in participant_uids:allowed={'finalized_at'}
   elif table=='private.account_subscriptions' and row.get('id')==restored:allowed={'status','effective_until','updated_at'}
   assert any(all(v.get(k)==x for k,x in row.items() if k not in allowed) for v in after_smoke[table]),(table,row.get('id'),allowed)
 ok('every pre-existing local row preserved outside finite exact UID/participant/redemption/finalization/new-grant field allowlist; old roles/memberships/consent/legal remain exact')
 ok('expiry, personal deadline, cohort drift, intervention CAS, late report cutoff, finite queued cancellation, PDF insertion/once/template, immutable history adverse probes')
 ok('strict root+window claims and jobs; original AI stages/bytes/tokens/budgets; ambiguity stopsW2; ownlease terminal only; exact CAS compensation; all historical root/effects full exact')
 print(json.dumps({'status':'PASS','checks':checks,'count':len(checks),'preExistingTables':len(historical),'preExistingRows':sum(len(v) for v in historical.values()),'realProviderCalls':0,'productionTouched':False,'stagingTouched':False}),flush=True)
finally:sql('drop database if exists '+db+' with(force)',database='postgres')
