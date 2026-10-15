#!/usr/bin/env python3
"""Disposable PostgreSQL only. Never accepts remote URL, project ref, key or password."""
import argparse,json,secrets,subprocess
from pathlib import Path
from decimal import Decimal,localcontext
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--container',required=True);args=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',args.container]))[0]
if not args.container.startswith('ai-diagnostic-v22b-') or info['Config']['Image']!='postgres:17-alpine' or info['HostConfig']['NetworkMode']!='none' or any(info['NetworkSettings']['Ports'].values()) or info['Config']['Labels'].get('codex.task')!='v22b':raise SystemExit('isolated task container required')
db='v22b_'+secrets.token_hex(6)
def execute(q,database=None):
 return subprocess.run(['docker','exec','-i',args.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database or db],input=q,text=True,capture_output=True)
def sql(q,database=None,error=None):
 r=execute(q,database)
 if error:
  assert r.returncode and error in r.stderr, 'expected bounded SQL denial: '+error
 elif r.returncode:raise AssertionError(r.stderr)
 return r.stdout.strip()
def uid(n):return f'10000000-0000-4000-8000-{n:012}'
def statement(n,q):return "begin;set local request.jwt.claims='"+json.dumps({'sub':uid(n),'role':'authenticated','aal':'aal2' if n==4 else 'aal1'})+"';set local role authenticated;"+q+';commit;'
def actor(n,q,error=None):return sql(statement(n,q),error=error)
def worker(q,error=None):return sql("begin;set local request.jwt.claims='{\"role\":\"service_role\"}';set local role service_role;"+q+';commit;',error=error)
def rpc(name,args):return worker('select public.'+name+'('+args+')')
def jsonliteral(x):return "'"+json.dumps(x,ensure_ascii=False).replace("'","''")+"'::jsonb"
def source(t):return json.loads(sql(f"select to_jsonb(s) from private.team_source('{t}') s"))
def results(t):return json.loads(actor(1,f"select public.read_team_results('{t}')"))
def claims():return json.loads(worker("select coalesce(jsonb_agg(j),'[]') from public.claim_team_jobs() j"))
def identity(j):return f"'{j['id']}','{j['lease_token']}'"
def team(title):return actor(1,"select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','"+title+"')")
def invite(t,n):
 token=secrets.token_hex(32)
 pid=actor(1,f"select public.invite_team_participant('{t}','v22b-{n}@example.test','Synthetic person {n}',encode(sha256(convert_to('{token}','UTF8')),'hex'))")
 actor(n,f"select public.accept_team_invitation('{token}')")
 return pid
def answers(pid,n):
 data=json.loads(actor(n,f"select public.read_team_response('{pid}')"))
 return {q['id']:(int(q['id'][-2:],16)+n)%5 if q['answer_type']=='scale_0_4' else f'Confidential synthetic working practice variation {n}. A long private phrase excluded from any published output.' for q in data['questions']}
def submit(pid,n,revision=0,a=None):return actor(n,f"select public.save_team_response('{pid}',{revision},{jsonliteral(a if a is not None else answers(pid,n))},true)")
def aggregate():
 while True:
  jobs=claims()
  if not jobs:break
  for j in jobs:assert rpc('process_team_aggregate',identity(j)) in ('completed','superseded')
def report(t,count):
 rid=actor(1,f"select public.request_team_report('{t}')")
 assert rid==actor(1,f"select public.request_team_report('{t}')")
 j=claims()[0];assert claims()==[]
 prepared=json.loads(rpc('prepare_team_report_job',identity(j)))
 assert prepared['report_input']['participant_count']==count
 mainfields=set(prepared['report_input']);assert mainfields=={'participant_count','company_context','overall','blocks','questions'}
 assert all(set(g)=={'question','texts','response_count'} and g['response_count']>=3 for g in prepared['qualitative_groups'])
 summary={'themes':[],'strengths':[],'risks':[],'alignment_signals':[],'divergence_signals':[]}
 rpc('store_team_synthesis',identity(j)+','+jsonliteral(summary)+",'mock','local'")
 content={'participant_count':count,'executive_summary':'Обобщённый результат команды.','maturity':'Зрелость командного среднего.','strongest_blocks':[],'weakest_blocks':[],'agreement':[],'disagreement':[],'qualitative_themes':[],'risks':[],'priorities':[],'next_steps':[]}
 rpc('publish_team_report',identity(j)+','+jsonliteral(content)+",'local'")
 return rid,prepared
checks=[]
def passed(label):checks.append(label);print('PASS '+label,flush=True)
try:
 sql('create database '+db,'postgres')
 sql((ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text())
 migrations=sorted((ROOT/'supabase/migrations').glob('*.sql'))
 new=next(x for x in migrations if 'team_aggregation_report' in x.name)
 for path in migrations:
  if path==new:continue
  if path.name=='20261013000100_account_foundation.sql':sql((ROOT/'supabase/tests/fixtures/account-foundation-local-history.sql').read_text())
  sql(path.read_text())
 sql((ROOT/'supabase/tests/team-foundation.sql').read_text());sql("update public.accounts set status='active'")
 passed('all 45 existing V2.2A SQL assertions against baseline')
 tables=json.loads(sql("select jsonb_agg(schemaname||'.'||tablename) from pg_tables where schemaname in('public','private','auth')"))
 def snapshot():return {t:sql("select md5(coalesce(string_agg(to_jsonb(r)::text,',' order by to_jsonb(r)::text),'')) from "+t+' r') for t in tables}
 before=snapshot();policies=sql("select md5(string_agg(to_jsonb(p)::text,',' order by to_jsonb(p)::text)) from pg_policies p")
 # Force a failure before COMMIT: no partially installed objects survive.
 sql(new.read_text().rsplit('commit;',1)[0]+'select deliberately_invalid_v22b_transaction();commit;',error='does not exist')
 assert sql("select to_regclass('private.team_jobs') is null")=='t';assert before==snapshot()
 sql(new.read_text());assert before==snapshot()
 assert policies==sql("select md5(string_agg(to_jsonb(p)::text,',' order by to_jsonb(p)::text)) from pg_policies p where tablename not in ('team_results','team_block_results','team_question_statistics','team_ai_reports')")
 sql(new.read_text(),error='already exists');assert before==snapshot()
 passed('transaction rollback, additive apply, duplicate rejection, every pre-existing row/RLS preserved')
 assert sql("select count(*) from private.team_scoring_snapshots") == sql('select count(*) from public.team_diagnostics')
 sql("update private.team_scoring_snapshots set snapshot='{}'",error='team_immutable')
 passed('existing team scoring snapshot backfill and immutability')
 for n in range(6,11):
  meta={'full_name':'Synthetic account','marketing_consent':False,'marketing_version':'temporary-ru-v1','data_processing_consent':True,'data_processing_version':'temporary-ru-v1'}
  sql(f"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('{uid(n)}','v22b-{n}@example.test',now(),{jsonliteral(meta)})")
 t=team('Team report local acceptance');ps={n:invite(t,n) for n in range(6,11)}
 for n in range(6,9):
  assert results(t)['status']=='threshold' and results(t)['completed_count']==n-6
  assert actor(1,'select count(*) from public.team_results')=='0'
  a=answers(ps[n],n)
  # Two optional text questions have only two nonempty contributors and must be excluded.
  data=json.loads(actor(n,f"select public.read_team_response('{ps[n]}')"))
  if n==8:
   for q in data['questions']:
    if q['answer_type']=='text' and not q['required']:a.pop(q['id'])
  submit(ps[n],n,a=a)
 assert source(t)['completed_count']==3
 passed('0/1/2 threshold and complete participant submission independent of worker')
 j=claims()[0]
 worker(f"select public.process_team_aggregate('{j['id']}','00000000-0000-4000-8000-000000000000')",error='team_lease_lost')
 assert claims()==[]
 rpc('process_team_aggregate',identity(j));s3=source(t);r3=results(t);assert r3['status']=='ready' and len(r3['blocks'])==8
 # Compare actual PostgreSQL output with the unchanged individual Decimal.js engine.
 data=json.loads(sql(f"select jsonb_build_object('snapshot',s.snapshot,'responses',(select jsonb_agg(r.answers) from private.team_completed('{t}') r)) from private.team_scoring_snapshots s where team_diagnostic_id='{t}'"))
 code='''import {calculateBlockScore,calculateOverall,classifyMaturity} from './src/server/scoring/engine.ts';let raw='';for await(const chunk of process.stdin)raw+=chunk;const d=JSON.parse(raw);const rows=d.responses.map(a=>{const bs=d.snapshot.blocks.filter(b=>Number(b.weight)>0).map(b=>({...calculateBlockScore({block_id:b.id,block_weight:b.weight,questions:d.snapshot.questions.filter(q=>q.block_id===b.id).map(q=>({...q,is_active:true,is_required:q.required})),answers:Object.entries(a).map(([question_id,v])=>({question_id,numeric_value:typeof v==='number'?v:null}))}),block_weight:b.weight}));return {blocks:bs.map(b=>({id:b.block_id,score:b.raw.toString()})),overall:calculateOverall(bs).raw.toString()}});process.stdout.write(JSON.stringify(rows));'''
 engine=json.loads(subprocess.run(['node','--import','tsx','--input-type=module','-e',code],cwd=ROOT,input=json.dumps(data),text=True,capture_output=True,check=True).stdout)
 with localcontext() as ctx:
  ctx.prec=60
  def assertstats(values,mean,sd,lo,hi):
   v=list(map(Decimal,values));m=sum(v)/len(v);sigma=(sum((x-m)**2 for x in v)/len(v)).sqrt()
   assert abs(Decimal(str(mean))-m)<Decimal('1e-12');assert abs(Decimal(str(sd))-sigma)<Decimal('1e-12')
   assert abs(Decimal(str(lo))-min(v))<Decimal('1e-12') and abs(Decimal(str(hi))-max(v))<Decimal('1e-12')
  assertstats([p['overall'] for p in engine],*[r3['overall'][k] for k in ['overall_mean','overall_stddev','overall_min','overall_max']])
  for b in r3['blocks']:assertstats([next(x['score'] for x in p['blocks'] if x['id']==b['block_id']) for p in engine],*[b[k] for k in ['mean_score','stddev_score','min_score','max_score']])
  for q in r3['questions']:
   meta=next(x for x in data['snapshot']['questions'] if x['id']==q['question_id']);vals=[(4-a[meta['id']]) if meta['reverse_score'] else a[meta['id']] for a in data['responses']]
   assertstats(map(str,vals),*[q[k] for k in ['mean_score','stddev_score','min_score','max_score']]);assert q['participant_count']==3
 passed('SQL/unchanged individual engine parity: weights/reverse/overall/maturity and mean/stddev_pop/min/max')
 # Explicit unsupported nonlinear policy check rolls back and creates no team/snapshot.
 sql("begin;update public.scoring_policies set configuration='{\"nonlinear\":true}' where version_id=(select id from public.diagnostic_versions where version_number=4);set local request.jwt.claims='"+json.dumps({'sub':uid(1),'role':'authenticated'})+"';set local role authenticated;select public.create_team_diagnostic('20000000-0000-4000-8000-000000000001','Unsupported policy');commit;",error='team_scoring_policy_unsupported')
 passed('unsupported nonlinear policy fails closed instead of inventing a formula')
 rid,prepared=report(t,3);assert len(prepared['qualitative_groups'])==2
 passed('per-question text threshold excludes two contributors; report input contains no identities/response grouping')
 for who in [2,4,5,6,7,8,9,10]:
  assert json.loads(actor(who,"select jsonb_build_object('r',(select count(*) from public.team_results),'b',(select count(*) from public.team_block_results),'q',(select count(*) from public.team_question_statistics),'ai',(select count(*) from public.team_ai_reports))"))=={'r':0,'b':0,'q':0,'ai':0}
  actor(who,f"select public.read_team_results('{t}')",error='team_not_found')
  actor(who,'select * from private.team_responses',error='permission denied')
  actor(who,'select * from private.team_scoring_snapshots',error='permission denied')
  actor(who,'select * from private.team_jobs',error='permission denied')
 actor(1,f"select public.read_team_response('{ps[6]}')",error='team_response_unavailable')
 actor(7,f"select public.read_team_response('{ps[6]}')",error='team_response_unavailable')
 sql("set role anon;select * from public.team_results",error='permission denied')
 actor(1,'select public.claim_team_jobs()',error='permission denied')
 passed('owner/private, participants, foreign account, AAL2 admin without membership, unconfirmed and anonymous denial')
 for text in ['Synthetic person 6','v22b-6@example.test','00000000-0000-4000-8000-000000000000','+421 900 123 456','A long private phrase excluded from any published output.']:
  sql(f"select private.validate_team_output('{t}',{jsonliteral({'summary':text})})",error='team_privacy_rejected')
 masked=sql(f"select private.mask_team_text('{t}','sYNTHETIC person 6 fake@example.invalid +421 900 123 456 https://fake.invalid 00000000-0000-4000-8000-000000000000')")
 assert all(s not in masked for s in ['person','@','+421','https','00000000'])
 passed('masking and rejection of exact names/email/UUID/phone/URL/raw fragments, no rejected content stored')
 actor(6,f"select public.save_team_response('{ps[6]}',1,'{{}}',false)",error='team_response_completed')
 v1=sql(f"select md5(to_jsonb(r)::text) from public.team_ai_reports r where id='{rid}'")
 submit(ps[9],9);assert results(t)['status']=='pending' and source(t)['fingerprint']!=s3['fingerprint']
 aggregate();rid2,_=report(t,4);assert rid2!=rid and len(results(t)['reports'])==2
 assert sql(f"select md5(to_jsonb(r)::text) from public.team_ai_reports r where id='{rid}'")==v1
 sql(f"update public.team_ai_reports set structured_content='{{}}' where id='{rid}'",error='team_report_immutable')
 passed('fourth completion changes source; report dedupe/v2 and immutable v1')
 # Fifth started participant makes close behavior observable without modifying completed responses.
 actor(10,f"select public.save_team_response('{ps[10]}',0,'{{}}',false)")
 actor(1,f"select public.close_team_diagnostic('{t}')")
 actor(10,f"select public.save_team_response('{ps[10]}',1,'{{}}',false)",error='team_closed')
 actor(1,f"select public.renew_team_invitation('{ps[10]}',repeat('a',64))",error='team_not_found')
 actor(1,f"select public.invite_team_participant('{t}','closed@example.test','Closed invite',repeat('b',64))",error='team_closed')
 assert results(t)['status']=='ready' and len(results(t)['reports'])==2
 passed('irreversible close blocks invites/renew/save/submit while completed aggregates/reports survive')
 for n in [9,8]:actor(1,f"select public.revoke_team_participant('{ps[n]}')")
 assert results(t)['status']=='threshold' and actor(1,'select count(*) from public.team_ai_reports')=='0' and actor(1,'select count(*) from public.team_results')=='0'
 aggregate();assert sql(f"select md5(to_jsonb(r)::text) from public.team_ai_reports r where id='{rid}'")==v1
 passed('revocation excludes source; below3 hides all aggregates/history; obsolete jobs superseded')
 # True independent sessions crossing 2 -> 4.
 t2=team('Concurrent aggregate team');p2={n:invite(t2,n) for n in range(6,10)}
 for n in [6,7]:submit(p2[n],n)
 procs=[]
 for n in [8,9]:
  q=f"select public.save_team_response('{p2[n]}',0,{jsonliteral(answers(p2[n],n))},true)"
  process=subprocess.Popen(['docker','exec','-i',args.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  process.stdin.write(statement(n,q));process.stdin.close();process.stdin=None;procs.append(process)
 for process in procs:
  output=process.communicate(timeout=30);assert process.returncode==0,output[1]
 assert source(t2)['completed_count']==4
 assert sql(f"select count(*)=count(distinct (kind,team_diagnostic_id,source_fingerprint)) from private.team_jobs where team_diagnostic_id='{t2}'")=='t'
 aggregate();assert results(t2)['completed_count']==4 and results(t2)['status']=='ready'
 passed('actual concurrent 2->4 completions; no lost response, stale work safe, one aggregate per source')
 # Lease fencing/retry via a single current report job.
 actor(1,f"select public.request_team_report('{t2}')")
 claim_procs=[]
 claim_sql="begin;set local request.jwt.claims='{\"role\":\"service_role\"}';set local role service_role;select coalesce(jsonb_agg(j),'[]') from public.claim_team_jobs() j;commit;"
 for _ in range(2):
  proc=subprocess.Popen(['docker','exec','-i',args.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  proc.stdin.write(claim_sql);proc.stdin.close();proc.stdin=None;claim_procs.append(proc)
 claimed=[]
 for proc in claim_procs:
  out,err=proc.communicate(timeout=30);assert proc.returncode==0,err;claimed.append(json.loads(out))
 assert sorted(map(len,claimed))==[0,1]
 j=next(x[0] for x in claimed if x);assert j['kind']=='team_ai_report'
 passed('two simultaneous workers compete for one job; exactly one lease wins')
 rpc('fail_team_job',identity(j)+",'team_provider_retryable',true")
 sql(f"update private.team_jobs set available_at=now() where id='{j['id']}'")
 retry=claims()[0];assert retry['id']==j['id'] and retry['lease_token']!=j['lease_token'] and retry['attempts']==2
 worker('select public.prepare_team_report_job('+identity(j)+')',error='team_lease_lost')
 rpc('fail_team_job',identity(retry)+",'team_processing_failed',false")
 actor(1,f"select public.request_team_report('{t2}')");assert claims()[0]['attempts']==1
 passed('retry uses new fenced lease; old worker cannot publish; owner safe retry dedupes same report')
 # A dedicated pinned methodology exercises reverse, unequal question and block weights.
 sql((ROOT/'supabase/tests/fixtures/team-scoring-golden.sql').read_text())
 tg=team('Weighted reverse golden');pg={n:invite(tg,n) for n in range(6,9)}
 for n in range(6,9):
  a={k:1 for k in answers(pg[n],n)};submit(pg[n],n,a=a)
 aggregate();gold=results(tg)
 # Block1=(1*1 + (4-1)*3)/(4*4)*100=62.5; block2=25; overall=(62.5*1.5+25*3)/4.5=37.5.
 assert Decimal(str(gold['overall']['overall_mean']))==Decimal('37.5')
 assert sorted(Decimal(str(b['mean_score'])) for b in gold['blocks'])==[Decimal('25'),Decimal('62.5')]
 assert Decimal(str(gold['overall']['overall_stddev']))==0
 assert sql(f"select m.key from public.team_results r join public.maturity_levels m on m.id=r.maturity_level_id where r.team_diagnostic_id='{tg}'")=='weak'
 fp=source(tg)['fingerprint'];assert fp==sql(f"set timezone='Europe/Bratislava';select fingerprint from private.team_source('{tg}')")
 passed('golden reverse+unequal question/block weights; raw maturity, zero dispersion and timezone-independent fingerprint')
 # Participant completion survives queue insertion failure; owner refresh recovers work.
 tq=team('Queue unavailable completion');pq={n:invite(tq,n) for n in range(6,9)}
 for n in [6,7]:submit(pq[n],n)
 sql("create function private.local_fail_queue() returns trigger language plpgsql as $$begin raise exception 'synthetic queue unavailable';end;$$;create trigger local_fail_queue before insert on private.team_jobs for each row execute function private.local_fail_queue()")
 submit(pq[8],8);assert source(tq)['completed_count']==3 and results(tq)['status']=='pending'
 sql('drop trigger local_fail_queue on private.team_jobs;drop function private.local_fail_queue()')
 actor(1,f"select public.refresh_team_results('{tq}')");aggregate();assert results(tq)['status']=='ready'
 passed('queue failure does not roll back participant completion; owner refresh recovers')
 # Corrupt historical numeric denominator must fail atomically, never publish a partial result.
 ti=team('Integrity failure team');pi={n:invite(ti,n) for n in range(6,9)}
 for n in range(6,9):
  sql(f"update private.team_responses set completed_at=now() where participant_id='{pi[n]}';update public.team_participants set status='completed',completed_at=now() where id='{pi[n]}'")
 sql(f"select private.enqueue_team_aggregate('{ti}')");bad=claims()[0]
 worker('select public.process_team_aggregate('+identity(bad)+')',error='team_numeric_integrity')
 assert sql(f"select count(*) from public.team_results where team_diagnostic_id='{ti}'")=='0'
 rpc('fail_team_job',identity(bad)+",'team_numeric_integrity',false")
 passed('missing numeric denominator blocks publication atomically instead of reducing participant count')
 # Disable preserves all stored team data.
 responsehash=sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
 sql((ROOT/'supabase/rollbacks/v22b-team-report-disable.sql').read_text())
 actor(1,f"select public.read_team_results('{t2}')",error='permission denied')
 assert responsehash==sql("select md5(string_agg(to_jsonb(r)::text,',' order by participant_id)) from private.team_responses r")
 passed('non-destructive disable preserves response/report/snapshot history')
 print(json.dumps({'status':'PASS','checks':len(checks),'labels':checks,'scope':'isolated PostgreSQL; auth claims stubbed, no GoTrue/external providers'},ensure_ascii=False),flush=True)
finally:sql('drop database if exists '+db+' with(force)','postgres')
