-- Production-capable YooKassa contracts; NO activation, merchant assignment or existing offer changes.
-- Apply only under a separately authorized release. Production remains untouched in this task.
begin;
alter table private.billing_configuration
 add column yookassa_test_mode boolean not null default true,
 add column yookassa_live_approved boolean not null default false,
 add column yookassa_reconciliation_enabled boolean not null default false,
 add constraint yookassa_live_requires_approval check((not yookassa_enabled and not yookassa_reconciliation_enabled) or yookassa_test_mode or yookassa_live_approved);
create function private.billing_yookassa_ready(p_create boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.billing_configuration where singleton and yookassa_shop_id is not null
 and (yookassa_test_mode or yookassa_live_approved)
 and case when p_create then yookassa_enabled else yookassa_enabled or yookassa_reconciliation_enabled end)
$$;
revoke all on function private.billing_yookassa_ready(boolean) from public,anon,authenticated,service_role;
alter table private.billing_offers drop constraint billing_offer_shape;
alter table private.billing_offers add constraint billing_offer_shape check(
 (test_mode and provider_key='mock' and amount_minor is null and currency is null and billing_mode is null and billing_period is null)
 or (provider_key='yookassa' and key='yookassa-advanced-annual-480-rub' and amount_minor=48000 and currency='RUB' and billing_mode='one_time' and billing_period='1_year')
 or (not test_mode and status<>'active'));
-- A referenced offer's identity/terms/mode are historical evidence, never a configuration switch.
create function private.billing_offer_identity_guard() returns trigger
language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at')
 and exists(select 1 from private.billing_checkout_sessions where offer_id=old.id) then raise exception 'billing_offer_in_use';end if;
 return new;
end $$;
revoke all on function private.billing_offer_identity_guard() from public,anon,authenticated,service_role;
create trigger billing_offer_identity_guard before update on private.billing_offers for each row execute function private.billing_offer_identity_guard();
create or replace function private.billing_start_yookassa_unversioned(p_account_id uuid,p_company_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.billing_offers;c private.billing_checkout_sessions;cid uuid;new_checkout_id uuid:=gen_random_uuid();merchant text;mode boolean;begin
 perform private.billing_owner(p_account_id);
 select yookassa_shop_id,yookassa_test_mode into merchant,mode from private.billing_configuration where private.billing_yookassa_ready(true) for share;
 if merchant is null then raise exception 'billing_unavailable';end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 -- A different active provider requires explicit reconciliation; never silently replace it.
 if exists(select 1 from private.account_subscriptions where account_id=p_account_id and source='provider' and status='active' and provider_key<>'yookassa') then raise exception 'billing_provider_conflict';end if;
 select * into o from private.billing_offers where key='yookassa-advanced-annual-480-rub' and status='active' and test_mode=mode;
 if o.id is null then raise exception 'billing_unavailable';end if;
 cid:=public.read_acquisition_continuation(p_account_id);
 if p_company_id is not null then
  if cid is not null and cid<>p_company_id then raise exception 'billing_continuation_changed';end if;cid:=p_company_id;
 end if;
 if cid is not null and not exists(select 1 from public.company_profiles where id=cid and account_id=p_account_id) then raise exception 'billing_not_found';end if;
 -- A created/unknown POST is never silently reissued with a fresh idempotency key.
 select * into c from private.billing_checkout_sessions where account_id=p_account_id and offer_id=o.id and user_id=auth.uid() and status in('created','pending');
 if c.id is not null then
  if c.company_id is distinct from cid or c.merchant_ref is distinct from merchant or c.provider_test_mode is distinct from mode then raise exception 'billing_checkout_context_conflict';end if;
  return c.id;
 end if;
 insert into private.billing_checkout_sessions(id,account_id,company_id,user_id,offer_id,provider_key,provider_checkout_ref,status,expires_at,merchant_ref,provider_test_mode)
 values(new_checkout_id,p_account_id,cid,auth.uid(),o.id,'yookassa','reserved-'||new_checkout_id,'created',clock_timestamp()+interval '23 hours',merchant,mode);
 insert into private.billing_provider_subscriptions(account_id,checkout_id,provider_key,provider_subscription_ref,provider_customer_ref,status)
 values(p_account_id,new_checkout_id,'yookassa','annual-'||new_checkout_id,'account-'||p_account_id,'pending');
 insert into private.billing_payments(account_id,checkout_id,provider_key,provider_payment_ref,status,amount_minor,currency)
 values(p_account_id,new_checkout_id,'yookassa','reserved-'||new_checkout_id,'pending',o.amount_minor,o.currency);
 perform private.billing_event(p_account_id,'advanced_checkout_started',new_checkout_id::text);return new_checkout_id;
end $$;

create or replace function public.billing_bind_yookassa_payment(p_checkout_id uuid,p_payment_ref text) returns void
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 perform private.billing_service_actor();
 if not private.billing_yookassa_ready(false) then raise exception 'billing_unavailable';end if;
 if p_payment_ref is null or p_payment_ref !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'billing_invalid_reference';end if;
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 if c.merchant_ref is distinct from (select yookassa_shop_id from private.billing_configuration) or c.provider_test_mode is distinct from (select yookassa_test_mode from private.billing_configuration) then raise exception 'billing_verification_mismatch';end if;
 perform 1 from public.accounts where id=c.account_id and status='active' for update;
 select * into c from private.billing_checkout_sessions where id=c.id for update;
 if c.status in('pending','succeeded','cancelled') and c.provider_checkout_ref=p_payment_ref then return;end if;
 if c.status<>'created' or c.created_at<clock_timestamp()-interval '23 hours' then raise exception 'billing_checkout_reconciliation_required';end if;
 update private.billing_checkout_sessions set provider_checkout_ref=p_payment_ref,status='pending' where id=c.id;
 update private.billing_payments set provider_payment_ref=p_payment_ref where checkout_id=c.id;
end $$;

create or replace function public.billing_process_verified_event(p_event jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare c private.billing_checkout_sessions;o private.billing_offers;s private.billing_provider_subscriptions;e private.billing_events;
 old private.account_subscriptions;prev private.billing_event_attempts;kind text;at_time timestamptz;until_time timestamptz;newid uuid;oldplan text;outcome text:='processed';safe_code text;begin
 perform private.billing_service_actor();
 if p_event->>'provider'='mock' then return private.billing_process_mock_verified_event(p_event,p_hash);end if;
 if not private.billing_yookassa_ready(false) then raise exception 'billing_unavailable';end if;
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>4096
 or exists(select 1 from jsonb_object_keys(p_event) k where k not in('provider','event_ref','type','checkout_id','subscription_ref','payment_ref','customer_ref','occurred_at','amount_minor','currency'))
 or (select count(*) from jsonb_object_keys(p_event))<>10 or p_event->>'provider' is distinct from 'yookassa'
 or p_event->>'type' is null or p_event->>'type' not in('payment_succeeded','checkout_cancelled')
 or p_event->>'payment_ref' is null or p_event->>'payment_ref' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_event->>'event_ref' is distinct from ((p_event->>'payment_ref')||case when p_event->>'type'='payment_succeeded' then '-succeeded' else '-canceled' end)
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'billing_invalid_event';end if;
 kind:=p_event->>'type';at_time:=(p_event->>'occurred_at')::timestamptz;
 if at_time is null or at_time>clock_timestamp()+interval '5 minutes' then raise exception 'billing_invalid_event';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:yookassa:'||(p_event->>'event_ref'),0));
 select * into e from private.billing_events where provider_key='yookassa' and provider_event_ref=p_event->>'event_ref';
 if e.id is not null then
  if e.payload_hash<>p_hash then return jsonb_build_object('status','rejected','error','event_identity_conflict');end if;
  select * into prev from private.billing_event_attempts where event_id=e.id order by id desc limit 1;
  if prev.processing_status<>'retryable' then return jsonb_build_object('status',prev.processing_status,'error',prev.safe_error_code,'duplicate',true);end if;
 end if;
 select * into c from private.billing_checkout_sessions where id=(p_event->>'checkout_id')::uuid and provider_key='yookassa';
 if c.id is null then raise exception 'billing_checkout_unknown';end if;
 perform 1 from public.accounts where id=c.account_id for update;
 select * into c from private.billing_checkout_sessions where id=c.id for update;
 if e.id is null then
  insert into private.billing_events(provider_key,provider_event_ref,event_type,payload_hash,checkout_id,account_id,subscription_ref)
  values('yookassa',p_event->>'event_ref',kind,p_hash,c.id,c.account_id,p_event->>'subscription_ref') returning * into e;
 end if;
 begin
  select * into o from private.billing_offers where id=c.offer_id;
  select * into s from private.billing_provider_subscriptions where checkout_id=c.id for update;
  if p_event->>'payment_ref' is distinct from c.provider_checkout_ref or p_event->>'payment_ref' is distinct from (select provider_payment_ref from private.billing_payments where checkout_id=c.id)
   or p_event->>'customer_ref' is distinct from ('account-'||c.account_id) or p_event->>'subscription_ref' is distinct from ('annual-'||c.id)
   or c.merchant_ref is distinct from (select yookassa_shop_id from private.billing_configuration) or c.provider_test_mode is distinct from (select yookassa_test_mode from private.billing_configuration)
   then outcome:='rejected';safe_code:='reference_mismatch';
  elsif o.key<>'yookassa-advanced-annual-480-rub' or o.provider_key<>'yookassa' or o.billing_mode<>'one_time' or o.billing_period<>'1_year'
   or o.amount_minor<>48000 or o.currency<>'RUB' or o.test_mode is distinct from c.provider_test_mode or (p_event->>'amount_minor')::bigint is distinct from o.amount_minor or p_event->>'currency' is distinct from o.currency
   then outcome:='rejected';safe_code:='amount_currency_mismatch';
  elsif at_time<c.created_at-interval '1 second' then outcome:='rejected';safe_code:='event_before_checkout';
  elsif c.status='succeeded' or s.status='ended' then outcome:='ignored';
  elsif kind='checkout_cancelled' then
   update private.billing_checkout_sessions set status='cancelled',completed_at=clock_timestamp() where id=c.id;
   update private.billing_payments set status='failed',failed_at=clock_timestamp() where checkout_id=c.id;
   update private.billing_provider_subscriptions set status='ended',last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;
   perform private.billing_event(c.account_id,'advanced_payment_failed',c.id::text);
  elsif c.status not in('pending','expired') or not exists(select 1 from public.accounts where id=c.account_id and status='active') then
   outcome:='rejected';safe_code:='checkout_not_payable';
  elsif exists(select 1 from private.account_subscriptions where account_id=c.account_id and status='active' and source='provider' and provider_key<>'yookassa') then
   outcome:='rejected';safe_code:='provider_conflict';
  else
   oldplan:=private.effective_account_plan(c.account_id);
   select * into old from private.account_subscriptions where account_id=c.account_id and status='active' for update;
   -- Calendar year in UTC; early manual renewal retains all remaining paid time.
   until_time:=greatest(clock_timestamp(),case when old.provider_key='yookassa' then old.effective_until else null end)+interval '1 year';
   update private.account_subscriptions set status='ended',effective_until=coalesce(effective_until,clock_timestamp()) where account_id=c.account_id and status='active';
   update private.billing_provider_subscriptions set status='ended',updated_at=clock_timestamp() where account_id=c.account_id and provider_key='yookassa' and status='active';
   insert into private.account_subscriptions(account_id,plan_id,status,source,provider_key,provider_customer_ref,provider_subscription_ref,effective_from,effective_until)
    values(c.account_id,o.plan_id,'active','provider','yookassa',p_event->>'customer_ref',p_event->>'subscription_ref',clock_timestamp(),until_time) returning id into newid;
   update private.billing_provider_subscriptions set status='active',product_subscription_id=newid,last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;
   update private.billing_checkout_sessions set status='succeeded',completed_at=clock_timestamp() where id=c.id;
   update private.billing_payments set status='succeeded',paid_at=at_time where checkout_id=c.id;
   insert into private.billing_plan_audit(account_id,old_plan,new_plan,source,provider_key,event_id,subscription_id,paid_until_before,paid_until_after)
    values(c.account_id,oldplan,'advanced','provider','yookassa',e.id,newid,old.effective_until,until_time);
   perform private.billing_event(c.account_id,'advanced_payment_succeeded',c.id::text);
   perform private.billing_event(c.account_id,'advanced_subscription_activated',c.id::text);
  end if;
 exception when others then outcome:='retryable';safe_code:='billing_transaction_retry';end;
 insert into private.billing_event_attempts(event_id,processing_status,safe_error_code) values(e.id,outcome,safe_code);
 return jsonb_build_object('status',outcome,'error',safe_code,'duplicate',false);
end $$;

create or replace function public.billing_record_verified_refund(p_checkout_id uuid,p_payment_ref text,p_refund_ref text,p_status text,p_amount_minor bigint,p_currency text,p_created_at timestamptz,p_receipt_state text default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare c private.billing_checkout_sessions;r private.billing_refunds;e uuid;freeid uuid;oldplan text;olduntil timestamptz;begin
 perform private.billing_service_actor();
 if not private.billing_yookassa_ready(false) then raise exception 'billing_unavailable';end if;
 if p_refund_ref is null or p_refund_ref !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_status is null or p_status not in('pending','succeeded','canceled') or p_amount_minor is distinct from 48000 or p_currency is distinct from 'RUB'
 or p_created_at is null or p_created_at>clock_timestamp()+interval '5 minutes'
 or (p_receipt_state is not null and p_receipt_state not in('pending','succeeded','canceled')) then raise exception 'billing_invalid_refund';end if;
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 perform 1 from public.accounts where id=c.account_id for update;
 if c.provider_checkout_ref is distinct from p_payment_ref or c.provider_test_mode is distinct from (select yookassa_test_mode from private.billing_configuration)
 or c.merchant_ref is distinct from (select yookassa_shop_id from private.billing_configuration)
 or p_created_at<c.created_at-interval '1 second'
 or not exists(select 1 from private.billing_payments where checkout_id=c.id and provider_payment_ref=p_payment_ref and status in('succeeded','refunded') and amount_minor=48000 and currency='RUB') then raise exception 'billing_refund_mismatch';end if;
 insert into private.billing_refunds(checkout_id,account_id,provider_refund_ref) values(c.id,c.account_id,p_refund_ref) on conflict(checkout_id) do nothing;
 select * into strict r from private.billing_refunds where checkout_id=c.id for update;
 if r.provider_refund_ref is not null and r.provider_refund_ref<>p_refund_ref then raise exception 'billing_refund_reference_conflict';end if;
 if r.status='succeeded' then
  update private.billing_refunds set receipt_state=case when receipt_state in('succeeded','canceled') and (p_receipt_state is null or p_receipt_state='pending') then receipt_state else coalesce(p_receipt_state,receipt_state) end,checked_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('status','processed','duplicate',true);
 end if;
 update private.billing_refunds set provider_refund_ref=p_refund_ref,status=p_status,receipt_state=coalesce(p_receipt_state,receipt_state),checked_at=clock_timestamp() where id=r.id;
 if p_status<>'succeeded' then return jsonb_build_object('status',p_status,'duplicate',false);end if;
 oldplan:=private.effective_account_plan(c.account_id);
 select effective_until into olduntil from private.account_subscriptions where account_id=c.account_id and status='active';
 insert into private.billing_events(provider_key,provider_event_ref,event_type,payload_hash,checkout_id,account_id,subscription_ref)
 values('yookassa',p_refund_ref||'-refunded','payment_refunded',encode(sha256(convert_to(p_refund_ref||':'||p_payment_ref||':48000:RUB','UTF8')),'hex'),c.id,c.account_id,'annual-'||c.id) returning id into e;
 update private.billing_payments set status='refunded' where checkout_id=c.id;
 update private.account_subscriptions set status='ended',effective_until=least(coalesce(effective_until,clock_timestamp()),clock_timestamp()) where account_id=c.account_id and status='active';
 update private.billing_provider_subscriptions set status='ended',updated_at=clock_timestamp() where account_id=c.account_id and status<>'ended';
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 select c.account_id,id,'active','system_default',clock_timestamp() from public.plans where key='free' returning id into freeid;
 insert into private.billing_plan_audit(account_id,old_plan,new_plan,source,provider_key,event_id,subscription_id,paid_until_before,paid_until_after)
 values(c.account_id,oldplan,'free','provider','yookassa',e,freeid,olduntil,null);
 insert into private.billing_event_attempts(event_id,processing_status) values(e,'processed');
 update private.billing_refunds set succeeded_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('status','processed','duplicate',false);
end $$;
create or replace function public.billing_record_yookassa_receipt(p_checkout_id uuid,p_payment_ref text,p_state text) returns void
language plpgsql security definer set search_path='' as $$begin
 perform private.billing_service_actor();
 if not private.billing_yookassa_ready(false) then raise exception 'billing_unavailable';end if;
 if p_state is not null and p_state not in('pending','succeeded','canceled') then raise exception 'billing_invalid_receipt_state';end if;
 update private.billing_checkout_sessions set
 receipt_state=case when receipt_state in('succeeded','canceled') and (p_state is null or p_state='pending') then receipt_state else coalesce(p_state,receipt_state) end,
 receipt_checked_at=clock_timestamp()
 where id=p_checkout_id and provider_key='yookassa' and provider_checkout_ref=p_payment_ref and provider_test_mode is not distinct from (select yookassa_test_mode from private.billing_configuration)
 and merchant_ref is not distinct from (select yookassa_shop_id from private.billing_configuration);
 if not found then raise exception 'billing_not_found';end if;
end $$;
-- CREATE OR REPLACE preserves existing grants; assert the exposed financial APIs remain service-only.
revoke all on function private.billing_start_yookassa_unversioned(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.billing_record_yookassa_receipt(uuid,text,text),public.billing_bind_yookassa_payment(uuid,text),public.billing_process_verified_event(jsonb,text),public.billing_record_verified_refund(uuid,text,text,text,bigint,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.billing_record_yookassa_receipt(uuid,text,text),public.billing_bind_yookassa_payment(uuid,text),public.billing_process_verified_event(jsonb,text),public.billing_record_verified_refund(uuid,text,text,text,bigint,text,timestamptz,text) to service_role;
commit;
