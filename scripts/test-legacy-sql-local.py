#!/usr/bin/env python3
"""Execute unmodified pgTAP suites at their historical schema checkpoints, locally only."""
import argparse,json,secrets,subprocess,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--container',required=True);p.add_argument('--suite');a=p.parse_args()
info=json.loads(subprocess.check_output(['docker','inspect',a.container]))[0]
if not a.container.startswith('ai-diagnostic-v22b-') or info['Config']['Image']!='ai-diagnostic-v22b-pgtap:local' or any(info['NetworkSettings']['Ports'].values()) or info['HostConfig']['NetworkMode']!='none':raise SystemExit('isolated local pgTAP container required')
def sql(db,q):
 r=subprocess.run(['docker','exec','-i',a.container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input=q,text=True,capture_output=True)
 if r.returncode:raise AssertionError(r.stderr)
 return r.stdout.strip()
# These tests predate multiple published versions; their original assertions remain unchanged.
checkpoints={
 'identity.test.sql':'20260910000100',
 'methodology.test.sql':'20260917000100',
 'diagnostic.test.sql':'20260917000100',
 'submission.test.sql':'20260917000100',
 'email.test.sql':'20260917000100',
 'consultation.test.sql':'20260917000100',
 'consultation_worker.test.sql':'20260917000100',
 'production_worker.test.sql':'20260917000100',
 'methodology-rls.test.sql':'20260918000200',
 'methodology-ru-2-1.test.sql':'20260918000300',
 'methodology-repair.test.sql':'20261012000100',
}
if a.suite and a.suite not in checkpoints:raise SystemExit("unknown suite")
results=[]
for name,cutoff in checkpoints.items():
 if a.suite and name!=a.suite:continue
 db='tap_'+secrets.token_hex(6)
 try:
  sql('postgres','create database '+db)
  sql(db,(ROOT/'supabase/tests/fixtures/methodology-retirement-local-auth.sql').read_text()+"\ncreate table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));create schema if not exists extensions;grant usage on schema extensions to anon,authenticated,service_role;create extension pgtap with schema extensions;alter database "+db+" set search_path=public,extensions;")
  for mig in sorted((ROOT/'supabase/migrations').glob('*.sql')):
   if mig.name[:14]>cutoff:continue
   sql(db,mig.read_text())
  if name=='consultation_worker.test.sql':
   sql(db,"insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('10000000-0000-4000-8000-000000000001','local@example.test',now(),'{\"full_name\":\"Local fixture\",\"data_processing_consent\":true,\"marketing_consent\":false,\"data_processing_version\":\"temporary-ru-v1\",\"marketing_version\":\"temporary-ru-v1\"}');insert into public.company_profiles(id,owner_user_id,name,industry_key,country,products,customer_segments,sales_channels,employee_count,annual_revenue_key,company_age_years,management_levels,key_problems,main_goals) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Local worker fixture','consulting','Россия','P','C','S',10,'up_to_10m',2,1,'K','G');insert into public.diagnostics(id,company_id,created_by_user_id,version_id,status) select '9152284d-1974-4a60-a80f-2adee6bf6fd5','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',id,'completed' from public.diagnostic_versions where version_number=1;")
  if name=='methodology-rls.test.sql':
   # This historical suite asserts zero visible rows rather than table-level denial.
   # Grant SELECT ONLY in its local fixture so RLS is actually exercised; application grants are unchanged.
   sql(db,'grant select on public.diagnostic_definitions to anon')
  output=sql(db,(ROOT/'supabase/tests'/name).read_text())
  failures=[line for line in output.splitlines() if line.startswith('not ok') or line.startswith('# Looks like')]
  status='PASS' if not failures else 'FAIL'
  assertions=len(re.findall(r'^(?:not )?ok [0-9]+',output,re.M))
  row={'file':name,'checkpoint':cutoff,'status':status,'assertions':assertions,'failures':failures}
  results.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
 except Exception as e:
  row={'file':name,'checkpoint':cutoff,'status':'ERROR','error':str(e)};results.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
 finally:sql('postgres','drop database if exists '+db+' with(force)')
print(json.dumps({'results':results,'productionTouched':False,'scope':'local historical checkpoints, unmodified pgTAP assertions; never a remote database'},ensure_ascii=False),flush=True)
raise SystemExit(0 if all(r['status']=='PASS' for r in results) else 1)
