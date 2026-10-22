#!/usr/bin/env python3
"""No cloud credentials: create only networkless disposable CI databases."""
from pathlib import Path
import subprocess,time
ROOT=Path(__file__).resolve().parents[1]
def run(*args,**kw):subprocess.run(args,cwd=ROOT,check=True,**kw)
owned=[]
try:
 # Build the historical pgTAP test image under the exact guarded local tag.
 dockerfile=b'FROM postgres:17-bookworm\nRUN apt-get update && apt-get install -y --no-install-recommends postgresql-17-pgtap && rm -rf /var/lib/apt/lists/*\n'
 run('docker','build','-t','ai-diagnostic-v22b-pgtap:local','-',input=dockerfile)
 specs=[('ai-diagnostic-v27-yookassa-ci','postgres:17-alpine','v27','scripts/test-v27-yookassa-local.py'),('ai-diagnostic-v27-retention-ci','postgres:17-alpine','v27','scripts/test-v27-retention-local.py'),('ai-diagnostic-v26b-ci-isolated','postgres:17-alpine','v26b','scripts/test-v26b-local.py'),('ai-diagnostic-v26-ci-isolated','postgres:17-alpine','v26','scripts/test-v26-local.py'),('ai-diagnostic-v24-isolated','postgres:17-alpine','v24','scripts/test-v24-local.py'),('ai-diagnostic-v22b-v24-pgtap','ai-diagnostic-v22b-pgtap:local','v24','scripts/test-legacy-sql-local.py'),('ai-diagnostic-v21a-v24-ci','postgres:17-alpine','v24','scripts/test-account-phase-a-local.py'),('ai-diagnostic-v23-v24-ci','postgres:17-alpine','v23','scripts/test-v23-local.py'),('ai-diagnostic-v22c-v24-ci','postgres:17-alpine','v22c','scripts/test-v22c3-local.py'),('ai-diagnostic-v25-ci-isolated','postgres:17-alpine','v25','scripts/test-v25-local.py')]
 for name,image,label,script in specs:
  run('docker','run','--detach','--network','none','--name',name,'--label','codex.task='+label,'--label','codex.parent=v24','--env','POSTGRES_HOST_AUTH_METHOD=trust',image);owned.append(name)
  for attempt in range(30):
   if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','postgres'],capture_output=True).returncode==0:break
   time.sleep(1)
  else:raise RuntimeError('local database unavailable')
  run('python3',script,'--container',name,*(['--with-v26b'] if label=='v26' else ['--with-v27'] if label=='v26b' else []))
finally:
 for name in owned:subprocess.run(['docker','rm','--force',name],check=False)
