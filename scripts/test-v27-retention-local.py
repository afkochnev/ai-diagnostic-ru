#!/usr/bin/env python3
"""V27 retention acceptance. Networkless disposable local PostgreSQL only; no cloud credentials."""
import argparse,json,secrets,subprocess,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--container',required=True);a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
assert a.container in ('ai-diagnostic-v27-retention-local','ai-diagnostic-v27-retention-ci') and info['Config']['Image']=='postgres:17-alpine' and info['HostConfig']['NetworkMode']=='none' and info['Config']['Labels'].get('codex.task')=='v27' and not any(info['NetworkSettings']['Ports'].values())
db='v27_'+secrets.token_hex(6);checks=[]
def sql(q,error=None,database=None):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-XqAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
 if error:assert r.returncode and error in r.stderr,(error,r.stderr[:1500])
 elif r.returncode:raise AssertionError(r.stderr[:2500])
 return r.stdout.strip()
def lit(v):return "'"+json.dumps(v).replace("'","''")+"'::jsonb"
def actor(q,user=None,role='service_role',error=None):
 claims={'role':role,'sub':user,'aal':'aal1','session_id':user}
 return sql('begin;set local request.jwt.claims='+lit(claims).removesuffix('::jsonb')+';set local role '+role+';'+q+';commit;',error)
def ok(t):checks.append(t);print('PASS '+t,flush=True)
def hashes():
 return json.loads(sql("""create temporary table h(k text,v text);do $$declare t record;v text;begin for t in select schemaname,tablename from pg_tables where schemaname in ('public','private','auth') loop execute format('select md5(coalesce(string_agg((to_jsonb(x)-''retention_purged_at''-''retention_minimized_at'')::text,chr(10) order by (to_jsonb(x)-''retention_purged_at''-''retention_minimized_at'')::text),'''')) from %I.%I x',t.schemaname,t.tablename) into v;insert into h values(t.schemaname||'.'||t.tablename,v);end loop;end;$$;select jsonb_object_agg(k,v) from h;"""))
def cleanup(dry=True,batch=100,scope=None):
 return json.loads(actor('select public.run_retention_maintenance('+('true' if dry else 'false')+','+str(batch)+','+(lit(scope) if scope is not None else 'null')+')'))
def fresh():
 visit=sql('select gen_random_uuid()');h=secrets.token_hex(32)
 actor("select public.acquisition_session('visit','"+visit+"','"+h+"')")
 ss=json.loads(actor("select public.acquisition_session('start','"+visit+"','"+h+"',"+lit({'consent':True,'consent_version':current,'session_hash':h})+")"))['id']
 return ss,h,visit
try:
 sql('create database '+db,database='postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 sql('alter table auth.users add column created_at timestamptz not null default now();create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));')
 candidate=next((ROOT/'supabase/migrations').glob('*_operational_retention_and_marketing_withdrawal.sql'))
 for m in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if m==candidate:break
  if 'account_foundation.sql' in m.name:sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  if 'team_aggregation_report' in m.name:sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
  sql(m.read_text())
 before=hashes();sql(candidate.read_text().rsplit('commit;',1)[0]+'select missing_retention_rollback();commit;','does not exist');assert hashes()==before
 sql(candidate.read_text());after=hashes();assert all(after[k]==v for k,v in before.items())
 assert sql('select count(*) from public.privacy_legal_documents')=='0'
 ok('additive migration rollback/apply preserves every old row; final legal registry remains empty')
 evidence_migration=next((ROOT/'supabase/migrations').glob('*_team_existing_identity_consent_evidence.sql'))
 evidence_before=hashes();sql(evidence_migration.read_text());assert hashes()==evidence_before
 ok('existing Team identity evidence migration is additive and does not mutate any old row')
 for role in ['anon','authenticated']:
  sql('set role '+role+';select public.run_retention_maintenance()',error='permission denied')
  for table in ['retention_holds','retention_runs','marketing_preferences','marketing_withdrawals']:
   sql('set role '+role+';select * from private.'+table,error='permission denied')
 actor('select public.run_retention_maintenance(false,501)',error='retention_invalid')
 actor("select public.run_retention_maintenance(false,100,'{\"product_events\":null}')",error='retention_invalid')
 ok('maintenance/private-state deny anon/authenticated; invalid batch and malformed scope fail closed')
 sql('update private.launch_controls set anonymous_start_enabled=true,team_creation_enabled=true,team_invitations_enabled=true')
 current='temporary-ru-v1';s,h,v=fresh();active,_,_=fresh();held,_,_=fresh()
 sql("update private.anonymous_diagnostic_sessions set answers='{\"synthetic\":\"private payload\"}',company_context_draft='{\"name\":\"Synthetic\"}',target_email='synthetic@example.test',display_name='Synthetic',identity_nonce_hash=repeat('a',64),expires_at=now()-interval '1 second' where id in ('"+s+"','"+held+"')")
 sql(f"insert into private.retention_holds values('anonymous_sessions','{held}','legal_claim',now()+interval '1 day',now())")
 actor("select public.acquisition_session('read','"+s+"','"+h+"')",error='acquisition_expired')
 # Existing local fixture provides protected Company/Team/report data; no dependency must be deleted.
 owner=sql('select id from public.users order by id limit 1');company=sql('select id from public.company_profiles order by id limit 1');account=sql(f"select account_id from public.company_profiles where id='{company}'")
 diag=sql(f"insert into public.diagnostics(company_id,created_by_user_id,version_id,status) select '{company}','{owner}',id,'completed' from public.diagnostic_versions where version_number=4 returning id")
 claimed,_,_=fresh();sql(f"update private.anonymous_diagnostic_sessions set status='claimed',claimed_diagnostic_id='{diag}',claimed_user_id='{owner}',claimed_company_id='{company}',claimed_account_id='{account}',claimed_at=now(),expires_at=now()-interval '1 day' where id='{claimed}'")
 report=sql(f"insert into public.ai_reports(diagnostic_id,version,prompt_version,schema_version,model,status,input_snapshot,input_hash) values('{diag}',1,'synthetic-retention','synthetic','mock','failed','{{}}','synthetic') returning id")
 artifact=sql(f"insert into public.report_artifacts(report_id,ai_report_version,format,template_version,status,storage_path,content_base64,checksum) values('{report}',1,'pdf','synthetic-retention','failed','synthetic','U1lOVEhFVElD','synthetic') returning id")
 deliveries=[]
 for i in range(4):
  old="now()-interval '13 months'" if i!=1 else 'now()'
  deliveries.append(sql(f"insert into public.email_deliveries(user_id,diagnostic_id,ai_report_id,ai_report_version,pdf_artifact_id,recipient_email,status,provider,provider_message_id,last_error_message,created_at,updated_at,sent_at) values('{owner}','{diag}','{report}',1,'{artifact}','synthetic@example.test','{'sending' if i==2 else 'sent'}','mock','synthetic-provider-id','synthetic detail',{old},{old},{old}) returning id"))
 sql(f"insert into private.retention_holds values('email_deliveries','{deliveries[3]}','statutory_evidence',now()+interval '1 day',now())")
 lead=sql(f"insert into public.lead_requests(user_id,company_id,diagnostic_id,report_id,name,email,idempotency_key) values('{owner}','{company}','{diag}','{report}','Synthetic','synthetic@example.test',gen_random_uuid()) returning id")
 job=sql(f"insert into public.jobs(kind,diagnostic_id,status) values('consultation_notification','{diag}','completed') returning id")
 consult=sql(f"insert into public.consultation_notification_deliveries(lead_request_id,job_id,status,provider_message_id,last_error_message,created_at,updated_at) values('{lead}','{job}','sent','synthetic-id','synthetic-detail',now()-interval '13 months',now()-interval '13 months') returning id")
 events=[]
 for i in range(3):
  events.append(sql(f"insert into private.product_events(visit_id,event_name,entity_key,occurred_at) values('{v}','landing_view','synthetic-{i}',"+("now()" if i==1 else "now()-interval '13 months'")+") returning id"))
 sql(f"insert into private.retention_holds values('product_events','{events[2]}','legal_claim',now()+interval '1 day',now())")
 protected=hashes();dry=cleanup();assert dry['candidate_counts']=={'anonymous_sessions':1,'product_events':1,'email_deliveries':1,'consultation_deliveries':1};assert hashes()==protected
 assert all(n==0 for n in cleanup(False,scope={})['affected_counts'].values())
 ok('exact dry-run counts, zero writes; empty scope cannot broaden; holds/active/recent/claimed rows excluded')
 result=cleanup(False);assert result['affected_counts']==dry['candidate_counts']
 assert sql(f"select answers='{{}}' and company_context_draft is null and target_email is null and display_name is null and identity_nonce_hash is null and pending_auth_user_id is null and retention_purged_at is not null and secret_hash<>'{h}' from private.anonymous_diagnostic_sessions where id='{s}'")=='t'
 assert sql(f"select attribution='{{}}' from private.acquisition_visits where id='{v}'")=='t'
 assert sql(f"select recipient_email='redacted@invalid.invalid' and provider_message_id is null and last_error_message is null and retention_minimized_at is not null from public.email_deliveries where id='{deliveries[0]}'")=='t'
 assert sql(f"select provider_message_id is null and last_error_message is null from public.consultation_notification_deliveries where id='{consult}'")=='t'
 assert all(n==0 for n in cleanup(False)['affected_counts'].values())
 after=hashes();mutable={'private.anonymous_diagnostic_sessions','private.acquisition_visits','private.product_events','public.email_deliveries','public.consultation_notification_deliveries','private.retention_runs'}
 assert all(after[k]==v for k,v in protected.items() if k not in mutable)
 assert sql(f"select retention_purged_at is null from private.anonymous_diagnostic_sessions where id='{claimed}'")=='t'
 ok('physical payload erasure, analytics deletion, both email minimizations, idempotency; all business/Team/PDF/billing/consent rows preserved')
 # Bounded exact-ID scopes cannot affect unrelated old candidates.
 extras=[]
 for _ in range(3):
  x,_,_=fresh();extras.append(x);sql(f"update private.anonymous_diagnostic_sessions set expires_at=now()-interval '1 day' where id='{x}'")
 assert cleanup(False,1,{'anonymous_sessions':extras})['affected_counts']['anonymous_sessions']==1
 assert cleanup(False,1,{'anonymous_sessions':extras})['affected_counts']['anonymous_sessions']==1
 assert cleanup(False,1,{'anonymous_sessions':extras})['affected_counts']['anonymous_sessions']==1
 ok('bounded batch drains deterministically and exact-ID scope stays confined')
 # Marketing: synth identity, genuine grant, withdrawal retains old consent bytes.
 user=sql('select gen_random_uuid()')
 sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{user}','retention@example.test',now(),"+lit({'full_name':'Synthetic','data_processing_consent':True,'marketing_consent':True,'data_processing_version':current,'marketing_version':current})+f");insert into auth.sessions values('{user}','{user}')")
 consent_hash=sql(f"select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.user_consents c where user_id='{user}'")
 assert actor(f"select public.marketing_send_allowed('{user}')")=='t'
 request=sql('select gen_random_uuid()')
 assert actor(f"select public.withdraw_marketing_consent('{request}')",user,role='authenticated')=='t'
 assert actor(f"select public.withdraw_marketing_consent('{request}')",user,role='authenticated')=='t'
 assert actor(f"select public.marketing_send_allowed('{user}')")=='f'
 assert sql(f"select count(*) from private.marketing_withdrawals where request_id='{request}'")=='1'
 assert sql(f"select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.user_consents c where user_id='{user}'")==consent_hash
 actor(f"select public.withdraw_marketing_consent(gen_random_uuid(),'{owner}')",user,role='authenticated',error='marketing_forbidden')
 sql(f"update public.user_consents set version='changed' where user_id='{user}'",'immutable')
 ok('self withdrawal, duplicate request idempotence, cross-user denial; eligibility false with immutable grant and withdrawal evidence retained')
 # Publish the exact owner-approved bytes in this disposable local DB only.
 history=sql("select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.user_consents c")
 publication=next((ROOT/'supabase/migrations').glob('*_publish_approved_privacy_legal_v1.sql')).read_text()
 documents=json.loads((ROOT/'docs/v27-legal-package.json').read_text())['documents']
 for d in documents:assert hashlib.sha256((ROOT/d['path']).read_bytes()).hexdigest()==d['sha256']
 original=hashes()
 sql(publication.rsplit('commit;',1)[0]+'select publication_rollback_probe();commit;','does not exist')
 assert hashes()==original
 sql(publication.replace('ba79e8c1315d0ed82537e58ce3e5cc632e7a00293603b57d50931837cafe6664', 'unapproved',1),'owner_final_text_approval_required')
 assert hashes()==original
 sql(publication)
 for d in documents:
  assert sql("select body_sha256 from public.privacy_legal_documents where version='"+d['version']+"'")==d['sha256']
  assert sql("select encode(sha256(convert_to(body,'UTF8')),'hex') from public.privacy_legal_documents where version='"+d['version']+"'")==d['sha256']
 assert sql("select bool_and(not is_temporary) from public.consent_documents")=='t'
 assert sql("select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.user_consents c")==history
 assert sql(f"select count(*) from public.user_consents where user_id='{user}' and version<>'temporary-ru-v1'")=='0'
 published=hashes()
 sql(publication,'unexpected_current_consent_versions');assert hashes()==published
 sql("update public.privacy_legal_documents set body=body",'immutable')
 sql("set role anon;update public.privacy_legal_documents set body=body",'permission denied')
 assert sql("set role anon;select count(*) from public.privacy_legal_documents")=='3'
 ok('exact approved publication is atomic, validates approval/hash, denies replay and edits, preserves all history and grants no automatic consent')
 current='data-processing-consent-ru-v1';new=sql('select gen_random_uuid()')
 sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{new}','final@example.test',now(),"+lit({'full_name':'Synthetic final','data_processing_consent':True,'marketing_consent':False,'data_processing_version':current,'marketing_version':'marketing-consent-ru-v1'})+")")
 assert json.loads(sql(f"select jsonb_object_agg(kind,version) from public.user_consents where user_id='{new}'"))=={'data_processing':current,'marketing':'marketing-consent-ru-v1'}
 assert actor(f"select public.marketing_send_allowed('{new}')")=='f'
 old,oh,ov=fresh();sql(f"update private.anonymous_diagnostic_sessions set consent_version='temporary-ru-v1' where id='{old}'")
 actor("select public.acquisition_session('consent','"+old+"','"+oh+"',"+lit({'consent':True,'consent_version':'temporary-ru-v1'})+")",error='acquisition_consent_required')
 actor("select public.acquisition_session('consent','"+old+"','"+oh+"',"+lit({'consent':True,'consent_version':current,'marketing_version':'marketing-consent-ru-v1','marketing_granted':False})+")")
 assert sql(f"select count(*) from private.anonymous_diagnostic_consents where session_id='{old}' and kind='data_processing'")=='2'
 ns,nh,nv=fresh();assert sql(f"select consent_version from private.anonymous_diagnostic_sessions where id='{ns}'")==current
 ok('isolated final registration/anonymous/reconsent use exact versions; old consent bytes unchanged, optional marketing false')
 # Single-email Team onboarding with final pointers: synthetic pending identity, no real email.
 team=sql(f"insert into public.team_diagnostics(company_id,version_id,created_by_user_id,title) select '{company}',id,'{owner}','Synthetic final consent' from public.diagnostic_versions where version_number=4 returning id")
 token=secrets.token_hex(32);nonce=secrets.token_hex(32);th=hashlib.sha256(token.encode()).hexdigest();nh=hashlib.sha256(nonce.encode()).hexdigest()
 participant=sql(f"insert into public.team_participants(team_diagnostic_id,email,display_name) values('{team}','team-final@example.test','Synthetic final participant') returning id")
 sql(f"insert into private.team_invitations(participant_id,token_hash,expires_at) values('{participant}','{th}',now()+interval '1 day')")
 actor(f"select public.reserve_team_invitation_identity('{th}','{nh}')")
 team_user=sql('select gen_random_uuid()')
 sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{team_user}','team-final@example.test',now(),"+lit({'team_pending_nonce':nonce})+f");insert into auth.sessions values('{team_user}','{team_user}')")
 assert sql(f"select count(*) from public.user_consents where user_id='{team_user}'")=='0'
 actor(f"select public.finalize_team_invitation_identity('{token}',true,'temporary-ru-v1','temporary-ru-v1')",team_user,role='authenticated',error='team_policy_changed')
 assert actor(f"select public.finalize_team_invitation_identity('{token}',true,'{current}','marketing-consent-ru-v1')",team_user,role='authenticated')==participant
 assert json.loads(sql(f"select jsonb_object_agg(kind,version) from public.user_consents where user_id='{team_user}'"))=={'data_processing':current,'marketing':'marketing-consent-ru-v1'}
 assert actor(f"select public.marketing_send_allowed('{team_user}')")=='f'
 ok('final Team single-email consent is explicit, rejects stale versions and provisions exact final evidence with marketing false')
 # Existing identity: current consent must be appended when only the old temporary grant exists.
 token2=secrets.token_hex(32);hash2=hashlib.sha256(token2.encode()).hexdigest()
 participant2=sql(f"insert into public.team_participants(team_diagnostic_id,email,display_name) values('{team}','retention@example.test','Existing synthetic participant') returning id")
 sql(f"insert into private.team_invitations(participant_id,token_hash,expires_at) values('{participant2}','{hash2}',now()+interval '1 day')")
 assert actor(f"select public.finalize_team_invitation_identity('{token2}',true,'{current}','marketing-consent-ru-v1')",user,role='authenticated')==participant2
 assert actor(f"select public.finalize_team_invitation_identity('{token2}',true,'{current}','marketing-consent-ru-v1')",user,role='authenticated')==participant2
 assert sql(f"select count(*) from public.user_consents where user_id='{user}' and kind='data_processing' and version='{current}'")=='1'
 assert sql(f"select md5(string_agg(to_jsonb(c)::text,',' order by id)) from public.user_consents c where user_id='{user}' and version='temporary-ru-v1'")==consent_hash
 assert sql(f"select count(*) from public.user_consents where user_id='{user}' and kind='marketing'")=='1'
 assert actor(f"select public.marketing_send_allowed('{user}')")=='f'
 ok('existing Team identity appends current data consent once, preserves old temporary grants and does not alter marketing eligibility')
 print(json.dumps({'status':'PASS','checks':checks,'count':len(checks),'productionTouched':False,'stagingTouched':False}),flush=True)
finally:sql('drop database if exists '+db+' with(force)',database='postgres')
