"""Executed only inside the guarded networkless V26B runner's synthetic DB."""
candidate27=next((ROOT/'supabase/migrations').glob('*_commercial_terms_and_full_refunds.sql'))
prior=hashes()
sql(candidate27.read_text().rsplit('commit;',1)[0]+'select missing_v27_rollback_probe();commit;','does not exist')
assert hashes()==prior
sql(candidate27.read_text());current=hashes()
assert all(current[t]==h for t,h in prior.items())
assert sql('select count(*) from public.commercial_legal_documents')=='0'
sql("update private.billing_configuration set yookassa_enabled=true")
actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'billing_terms_required')
publication27=(ROOT/'supabase/migrations/20261022133523_publish_advanced_terms_ru_v1.sql').read_text()
body=(ROOT/'docs/legal/advanced-terms-ru-v1.md').read_text()
terms_hash=hashlib.sha256(body.encode()).hexdigest()
unpublished27=hashes()
sql(publication27.rsplit('commit;',1)[0]+'select missing_publication_rollback_probe();commit;','does not exist')
assert hashes()==unpublished27
sql(publication27)
published27=hashes()
assert all(published27[t]==h for t,h in unpublished27.items() if t not in ('public.commercial_legal_documents','private.commercial_legal_configuration'))
document27=json.loads(actor(0,"select public.billing_read_commercial_document('advanced-terms-ru-v1')",role='anon'))
assert document27['body']==body and document27['content_sha256']==terms_hash
assert json.loads(actor(0,'select public.billing_current_commercial_terms()',role='anon'))==document27
sql(publication27);assert hashes()==published27
conflicting_body27=body+'\nConflicting publication must be rejected.\n'
conflicting27=publication27.replace(body,conflicting_body27).replace(terms_hash,hashlib.sha256(conflicting_body27.encode()).hexdigest())
sql(conflicting27,'commercial_version_already_published_with_different_content');assert hashes()==published27
sql("update private.commercial_legal_configuration set active_version=null")
actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}',null,'advanced-terms-ru-v1','{terms_hash}',true)",'billing_terms_required')
sql("update private.commercial_legal_configuration set active_version='advanced-terms-ru-v1'")
for version,digest,accepted in [('temporary-ru-v1',terms_hash,'true'),('advanced-terms-ru-v1','a'*64,'true'),('advanced-terms-ru-v1',terms_hash,'false')]:
 actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}',null,'{version}','{digest}',{accepted})",'billing_terms_required')
def start27():return actor(1,f"select public.billing_start_yookassa_checkout('{accounts[1]}','{companies[1]}','advanced-terms-ru-v1','{terms_hash}',true)")
c27=start27();assert start27()==c27
evidence27=json.loads(sql(f"select to_jsonb(x) from private.billing_checkout_terms x where checkout_id='{c27}'"))
assert evidence27['terms_version']=='advanced-terms-ru-v1' and evidence27['terms_sha256']==terms_hash and evidence27['user_id']==uid(1)
for table in ['billing_checkout_terms','billing_refunds','commercial_legal_configuration']:
 actor(1,'select * from private.'+table,'permission denied')
actor(1,f"select private.billing_start_yookassa_unversioned('{accounts[1]}',null)",'permission denied')
actor(0,f"select public.billing_start_yookassa_checkout('{accounts[1]}')",'permission denied',role='service_role')
sql("update public.commercial_legal_documents set body='changed'",'commercial_evidence_immutable')
sql('delete from private.billing_checkout_terms','commercial_evidence_immutable')
passed('V27 additive rollback/preservation; absent/unpublished/stale/unaccepted legal version denied; exact acceptance immutable with no legacy API bypass')
passed('V27 approved publication matches versioned source bytes; anonymous read, safe replay and conflicting publication rollback preserve historical records')
ref27=bind(c27,71);event27=yoo(c27,ref27);assert process(event27)['status']=='processed'
history27=hashes();refund27='29000000-0000-5000-9000-000000000071'
actor(1,f"select public.billing_request_full_refund('{c27}')",'admin_access_denied')
request27=json.loads(actor(8,f"select public.billing_request_full_refund('{c27}')"))
assert json.loads(actor(8,f"select public.billing_request_full_refund('{c27}')"))['id']==request27['id']
actor(1,f"select public.billing_bind_full_refund('{request27['id']}','{c27}','{refund27}')",'permission denied')
actor(0,f"select public.billing_bind_full_refund('{request27['id']}','{c27}','{refund27}')",role='service_role')
actor(0,f"select public.billing_bind_full_refund('{request27['id']}','{c27}','29000000-0000-5000-9000-000000000072')",'billing_refund_reference_conflict',role='service_role')
actor(1,f"select public.billing_record_verified_refund('{c27}','{ref27}','{refund27}','succeeded',48000,'RUB',now(),null)",'permission denied')
def record27(status='succeeded',amount=48000,currency='RUB',reference=ref27,error=None):
 q=f"select public.billing_record_verified_refund('{c27}','{reference}','{refund27}','{status}',{amount},'{currency}',now(),'succeeded')"
 raw=actor(0,q,error,role='service_role');return json.loads(raw) if not error else raw
record27('pending');assert plan(1)=='advanced'
record27('canceled');assert plan(1)=='advanced'
record27(amount=47999,error='billing_invalid_refund');record27(currency='USD',error='billing_invalid_refund')
record27(reference='wrong',error='billing_refund_mismatch')
passed('V27 administrator-only stable refund request; pending/canceled/partial/wrong payment cannot downgrade; service-only financial API')
sql("create function private.v27_fail() returns trigger language plpgsql as $$begin raise exception 'forced_refund_audit_failure';end $$;create trigger v27_fail before insert on private.billing_plan_audit for each row execute function private.v27_fail()")
failure_before27=hashes();record27(error='forced_refund_audit_failure');assert hashes()==failure_before27 and plan(1)=='advanced'
sql('drop trigger v27_fail on private.billing_plan_audit;drop function private.v27_fail()')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:outcomes27=list(pool.map(lambda _:record27(),range(2)))
assert sorted(x['duplicate']for x in outcomes27)==[False,True] and plan(1)=='free'
assert sql(f"select count(*) from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")=='1'
assert sql(f"select status from private.billing_payments where checkout_id='{c27}'")=='refunded'
post27=hashes()
for table,h in history27.items():
 if not(table.startswith('private.billing_')or table=='private.account_subscriptions'):
  assert post27[table]==h,table
actor(1,f"select public.create_team_diagnostic('{companies[1]}','Denied refund Team')",'advanced_required')
actor(1,f"select public.invite_team_participant('{team}','blocked@example.test','Blocked',repeat('a',64))",'advanced_required')
assert actor(1,f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
assert json.loads(actor(8,"select public.billing_admin_read('{}')"))['health']['refund_pending']==0
passed('V27 forced audit failure rolls back all changes; concurrent full refund yields one Free subscription and retains every historical data/consent/report row')
cnew27=start27();refnew27=bind(cnew27,72);assert process(yoo(cnew27,refnew27))['status']=='processed' and plan(1)=='advanced'
active27=sql(f"select id from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")
assert record27()['duplicate'];record27('canceled')
assert plan(1)=='advanced' and sql(f"select id from private.account_subscriptions where account_id='{accounts[1]}' and status='active'")==active27
assert json.loads(sql(f"select to_jsonb(x) from private.billing_checkout_terms x where checkout_id='{c27}'"))==evidence27
assert process(event27)['duplicate'] and plan(1)=='advanced'
passed('V27 old refund/payment replays cannot cancel or extend a later repurchase; original commercial acceptance unchanged')

launch_migration27=next((ROOT/'supabase/migrations').glob('*_controlled_launch_gates.sql'))
gate_before27=hashes()
sql(launch_migration27.read_text().rsplit('commit;',1)[0]+'select missing_launch_rollback_probe();commit;','does not exist')
assert hashes()==gate_before27
sql(launch_migration27.read_text());gate_after27=hashes()
assert all(gate_after27[t]==h for t,h in gate_before27.items())
actor(1,f"select public.create_team_diagnostic('{companies[1]}','Paused')",'team_creation_paused')
actor(1,f"select public.invite_team_participant('{team}','paused@example.test','Paused',repeat('a',64))",'team_invitations_paused')
actor(0,f"select public.acquisition_session('start','{uid(1)}',repeat('a',64),'{{}}')",'acquisition_start_paused',role='service_role')
actor(1,'select * from private.launch_controls','permission denied')
actor(0,'select * from private.launch_controls','permission denied',role='service_role')
assert actor(1,f"select count(*) from public.team_diagnostics where id='{team}'")=='1'
sql('update private.launch_controls set team_creation_enabled=true,team_invitations_enabled=true,anonymous_start_enabled=true')
gated_team27=actor(1,f"select public.create_team_diagnostic('{companies[1]}','Enabled synthetic team')")
token27=secrets.token_hex(32)
participant27=actor(1,f"select public.invite_team_participant('{gated_team27}','v26b-2@example.test','Synthetic participant','{hashlib.sha256(token27.encode()).hexdigest()}')")
assert participant27
sql('update private.launch_controls set team_creation_enabled=false,team_invitations_enabled=false,anonymous_start_enabled=false')
actor(1,f"select public.renew_team_invitation('{participant27}',repeat('c',64))",'team_invitations_paused')
assert actor(1,f"select count(*) from public.team_diagnostics where id='{gated_team27}'")=='1'
assert plan(1)=='advanced'
passed('V27 DB creation gates default OFF and resist direct RPC bypass; independent activation/stop preserves old Team data and paid plan')
