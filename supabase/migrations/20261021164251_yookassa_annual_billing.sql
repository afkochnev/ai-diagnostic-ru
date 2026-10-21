-- V2.6B. Additive, disabled by default. No production offer or credentials.
begin;
alter table private.billing_configuration add column yookassa_enabled boolean not null default false,
 add column yookassa_shop_id text check(yookassa_shop_id ~ '^[0-9]{1,20}$');
alter table private.billing_checkout_sessions add column merchant_ref text,
 add column provider_test_mode boolean;
alter table private.billing_plan_audit add column paid_until_before timestamptz,add column paid_until_after timestamptz;
-- Replace only the V2.6A offer shape constraint, leaving all existing offers untouched.
do $$declare n text;begin
 select conname into strict n from pg_constraint where conrelid='private.billing_offers'::regclass and contype='c' and pg_get_constraintdef(oid) like '%test_mode%';
 execute format('alter table private.billing_offers drop constraint %I',n);
end $$;
alter table private.billing_offers add constraint billing_offer_shape check(
 (test_mode and provider_key='mock' and amount_minor is null and currency is null and billing_mode is null and billing_period is null)
 or (provider_key='yookassa' and test_mode and key='yookassa-advanced-annual-480-rub' and amount_minor=48000 and currency='RUB' and billing_mode='one_time' and billing_period='1_year')
 or (not test_mode and status<>'active'));
insert into private.billing_offers(plan_id,key,status,billing_mode,billing_period,currency,amount_minor,provider_key,test_mode)
 select id,'yookassa-advanced-annual-480-rub','draft','one_time','1_year','RUB',48000,'yookassa',true from public.plans where key='advanced';

create function private.billing_service_actor() returns void
language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true)<>'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'billing_forbidden';end if;
end $$;
create function public.billing_start_yookassa_checkout(p_account_id uuid,p_company_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.billing_offers;c private.billing_checkout_sessions;cid uuid;new_checkout_id uuid:=gen_random_uuid();merchant text;begin
 perform private.billing_owner(p_account_id);
 select yookassa_shop_id into merchant from private.billing_configuration where yookassa_enabled;
 if merchant is null then raise exception 'billing_unavailable';end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 -- A different active provider requires explicit reconciliation; never silently replace it.
 if exists(select 1 from private.account_subscriptions where account_id=p_account_id and source='provider' and status='active' and provider_key<>'yookassa') then raise exception 'billing_provider_conflict';end if;
 select * into o from private.billing_offers where key='yookassa-advanced-annual-480-rub' and status='active' and test_mode;
 if o.id is null then raise exception 'billing_unavailable';end if;
 cid:=public.read_acquisition_continuation(p_account_id);
 if p_company_id is not null then
  if cid is not null and cid<>p_company_id then raise exception 'billing_continuation_changed';end if;cid:=p_company_id;
 end if;
 if cid is not null and not exists(select 1 from public.company_profiles where id=cid and account_id=p_account_id) then raise exception 'billing_not_found';end if;
 -- A created/unknown POST is never silently reissued with a fresh idempotency key.
 select * into c from private.billing_checkout_sessions where account_id=p_account_id and offer_id=o.id and user_id=auth.uid() and status in('created','pending');
 if c.id is not null then
  if c.company_id is distinct from cid then raise exception 'billing_checkout_context_conflict';end if;
  return c.id;
 end if;
 insert into private.billing_checkout_sessions(id,account_id,company_id,user_id,offer_id,provider_key,provider_checkout_ref,status,expires_at,merchant_ref,provider_test_mode)
 values(new_checkout_id,p_account_id,cid,auth.uid(),o.id,'yookassa','reserved-'||new_checkout_id,'created',clock_timestamp()+interval '23 hours',merchant,true);
 insert into private.billing_provider_subscriptions(account_id,checkout_id,provider_key,provider_subscription_ref,provider_customer_ref,status)
 values(p_account_id,new_checkout_id,'yookassa','annual-'||new_checkout_id,'account-'||p_account_id,'pending');
 insert into private.billing_payments(account_id,checkout_id,provider_key,provider_payment_ref,status,amount_minor,currency)
 values(p_account_id,new_checkout_id,'yookassa','reserved-'||new_checkout_id,'pending',o.amount_minor,o.currency);
 perform private.billing_event(p_account_id,'advanced_checkout_started',new_checkout_id::text);return new_checkout_id;
end $$;

create function private.billing_yookassa_context(p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'account_id',c.account_id,'company_id',c.company_id,'offer_id',c.offer_id,'offer_key',o.key,
 'amount_minor',o.amount_minor,'currency',o.currency,'merchant_ref',c.merchant_ref,'provider_test_mode',c.provider_test_mode,
 'provider_payment_ref',p.provider_payment_ref,'status',c.status,'created_at',c.created_at)
 from private.billing_checkout_sessions c join private.billing_offers o on o.id=c.offer_id join private.billing_payments p on p.checkout_id=c.id where c.id=p_id and c.provider_key='yookassa'
$$;
create function public.billing_yookassa_owner_context(p_checkout_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 perform private.billing_owner(c.account_id);if c.user_id<>auth.uid() then raise exception 'billing_not_found';end if;
 return private.billing_yookassa_context(c.id);
end $$;
create function public.billing_yookassa_payment_context(p_payment_ref text) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.billing_service_actor();
 return private.billing_yookassa_context((select checkout_id from private.billing_payments where provider_key='yookassa' and provider_payment_ref=p_payment_ref));
end $$;
create function public.billing_bind_yookassa_payment(p_checkout_id uuid,p_payment_ref text) returns void
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 perform private.billing_service_actor();
 if not exists(select 1 from private.billing_configuration where yookassa_enabled) then raise exception 'billing_unavailable';end if;
 if p_payment_ref is null or p_payment_ref !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'billing_invalid_reference';end if;
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 perform 1 from public.accounts where id=c.account_id and status='active' for update;
 select * into c from private.billing_checkout_sessions where id=c.id for update;
 if c.status in('pending','succeeded','cancelled') and c.provider_checkout_ref=p_payment_ref then return;end if;
 if c.status<>'created' or c.created_at<clock_timestamp()-interval '23 hours' then raise exception 'billing_checkout_reconciliation_required';end if;
 update private.billing_checkout_sessions set provider_checkout_ref=p_payment_ref,status='pending' where id=c.id;
 update private.billing_payments set provider_payment_ref=p_payment_ref where checkout_id=c.id;
end $$;

-- Preserve the accepted mock processor, behind the same normalized event boundary.
alter function public.billing_process_verified_event(jsonb,text) rename to billing_process_mock_verified_event;
alter function public.billing_process_mock_verified_event(jsonb,text) set schema private;
revoke all on function private.billing_process_mock_verified_event(jsonb,text) from public,anon,authenticated,service_role;
create function public.billing_process_verified_event(p_event jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare c private.billing_checkout_sessions;o private.billing_offers;s private.billing_provider_subscriptions;e private.billing_events;
 old private.account_subscriptions;prev private.billing_event_attempts;kind text;at_time timestamptz;until_time timestamptz;newid uuid;oldplan text;outcome text:='processed';safe_code text;begin
 perform private.billing_service_actor();
 if p_event->>'provider'='mock' then return private.billing_process_mock_verified_event(p_event,p_hash);end if;
 if not exists(select 1 from private.billing_configuration where yookassa_enabled) then raise exception 'billing_unavailable';end if;
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
   or c.merchant_ref is distinct from (select yookassa_shop_id from private.billing_configuration) or c.provider_test_mode is distinct from true
   then outcome:='rejected';safe_code:='reference_mismatch';
  elsif o.key<>'yookassa-advanced-annual-480-rub' or o.provider_key<>'yookassa' or o.billing_mode<>'one_time' or o.billing_period<>'1_year'
   or o.amount_minor<>48000 or o.currency<>'RUB' or not o.test_mode or (p_event->>'amount_minor')::bigint is distinct from o.amount_minor or p_event->>'currency' is distinct from o.currency
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

-- Local effective_account_plan already excludes effective_until <= now. Cleanup is not required for feature denial.
create function public.billing_expire_yookassa_entitlements(p_limit int default 100) returns int
language plpgsql security definer set search_path='' as $$declare r record;s private.account_subscriptions;e uuid;freeid uuid;n int:=0;begin
 perform private.billing_service_actor();
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'billing_invalid_limit';end if;
 for r in select a.id from public.accounts a where exists(select 1 from private.account_subscriptions x where x.account_id=a.id and x.status='active' and x.provider_key='yookassa' and x.effective_until<=clock_timestamp()) order by a.id limit p_limit for update of a skip locked loop
  select * into s from private.account_subscriptions where account_id=r.id and status='active' and provider_key='yookassa' and effective_until<=clock_timestamp() for update;
  if s.id is null then continue;end if;
  insert into private.billing_events(provider_key,provider_event_ref,event_type,payload_hash,account_id,subscription_ref)
   values('yookassa','expiry-'||s.id,'subscription_ended',encode(sha256(convert_to(s.id::text,'UTF8')),'hex'),s.account_id,s.provider_subscription_ref) returning id into e;
  update private.account_subscriptions set status='ended',effective_until=s.effective_until where id=s.id;
  insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from) select s.account_id,id,'active','system_default',clock_timestamp() from public.plans where key='free' returning id into freeid;
  update private.billing_provider_subscriptions set status='ended',updated_at=clock_timestamp() where product_subscription_id=s.id;
  insert into private.billing_plan_audit(account_id,old_plan,new_plan,source,provider_key,event_id,subscription_id,paid_until_before)
   values(s.account_id,'advanced','free','provider','yookassa',e,freeid,s.effective_until);
  insert into private.billing_event_attempts(event_id,processing_status) values(e,'processed');n:=n+1;
 end loop;return n;
end $$;

revoke all on function private.billing_service_actor(),private.billing_yookassa_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.billing_start_yookassa_checkout(uuid,uuid),public.billing_yookassa_owner_context(uuid) from public,anon,service_role;
grant execute on function public.billing_start_yookassa_checkout(uuid,uuid),public.billing_yookassa_owner_context(uuid) to authenticated;
revoke all on function public.billing_yookassa_payment_context(text),public.billing_bind_yookassa_payment(uuid,text),public.billing_process_verified_event(jsonb,text),public.billing_expire_yookassa_entitlements(int) from public,anon,authenticated;
grant execute on function public.billing_yookassa_payment_context(text),public.billing_bind_yookassa_payment(uuid,text),public.billing_process_verified_event(jsonb,text),public.billing_expire_yookassa_entitlements(int) to service_role;

create or replace function public.billing_admin_read(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;data jsonb;page_no int;begin
 actor:=private.admin_console_actor();
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('account','q','plan','provider','status','payment','from','to','page'))
 or coalesce(p_filters->>'page','1') !~ '^[0-9]{1,5}$' or length(coalesce(p_filters->>'q',''))>100
 or coalesce(p_filters->>'plan','') not in('','free','advanced') or coalesce(p_filters->>'provider','') not in('','mock','yookassa')
 or coalesce(p_filters->>'status','') not in('','pending','active','cancel_pending','payment_failed','ended')
 or coalesce(p_filters->>'payment','') not in('','pending','succeeded','failed','refunded','partially_refunded') then raise exception 'billing_invalid_filter';end if;
 page_no:=greatest(1,least(10000,coalesce((p_filters->>'page')::int,1)));
 with rows as(
 select a.id,a.name,private.effective_account_plan(a.id) plan,coalesce(s.source,'system_default') source,s.provider_key,
 case when s.provider_customer_ref is null then null else left(s.provider_customer_ref,10)||'…'||right(s.provider_customer_ref,6) end customer_ref,
 case when s.provider_subscription_ref is null then null else left(s.provider_subscription_ref,10)||'…'||right(s.provider_subscription_ref,6) end subscription_ref,
 case when s.provider_key='yookassa' and s.effective_until<=clock_timestamp() then 'ended' else coalesce(ps.status,s.status) end subscription_status,s.effective_from,s.effective_until,c.id checkout_id,c.status checkout_status,p.status payment_status,p.amount_minor,p.currency,coalesce(s.provider_key='yookassa',false) annual_access,false auto_renewal,a.created_at,
 greatest(a.updated_at,s.updated_at,ps.updated_at) updated_at,
 exists(select 1 from private.account_subscriptions x where x.account_id=a.id and x.status='active' and x.source='provider') provider_managed
 from public.accounts a
 left join lateral(select * from private.account_subscriptions where account_id=a.id and status='active' order by effective_from desc limit 1)s on true
 left join lateral(select * from private.billing_checkout_sessions where account_id=a.id order by created_at desc limit 1)c on true
 left join private.billing_provider_subscriptions ps on ps.checkout_id=c.id
 left join private.billing_payments p on p.checkout_id=c.id
 where (coalesce(p_filters->>'account','')='' or a.id=(p_filters->>'account')::uuid)
 and(coalesce(p_filters->>'q','')='' or a.name ilike '%'||(p_filters->>'q')||'%' or a.id::text=p_filters->>'q')
 and(coalesce(p_filters->>'from','')='' or a.created_at>=(p_filters->>'from')::date)
 and(coalesce(p_filters->>'to','')='' or a.created_at<(p_filters->>'to')::date+interval '1 day')
 ), filtered as(select * from rows where
 (coalesce(p_filters->>'plan','')='' or plan=p_filters->>'plan') and(coalesce(p_filters->>'provider','')='' or provider_key=p_filters->>'provider')
 and(coalesce(p_filters->>'status','')='' or subscription_status=p_filters->>'status') and(coalesce(p_filters->>'payment','')='' or payment_status=p_filters->>'payment'))
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from filtered order by created_at desc,id limit 25 offset (page_no-1)*25)x),
 'total',(select count(*) from filtered),'page',page_no,'page_size',25,
 'events',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select e.id,e.account_id,e.event_type,e.received_at,e.provider_key,t.processing_status,t.safe_error_code
 from private.billing_events e left join lateral(select * from private.billing_event_attempts where event_id=e.id order by id desc limit 1)t on true
 where coalesce(p_filters->>'account','')='' or e.account_id=(p_filters->>'account')::uuid order by e.received_at desc limit 25)x),
 'health',jsonb_build_object('webhook_failures',(select count(*) from private.billing_events e join lateral(select * from private.billing_event_attempts where event_id=e.id order by id desc limit 1)t on t.processing_status in('rejected','retryable')),
 'unprocessed_events',(select count(*) from private.billing_events e where not exists(select 1 from private.billing_event_attempts where event_id=e.id)),
 'stale_checkouts',(select count(*) from private.billing_checkout_sessions where status in('created','pending') and expires_at<=clock_timestamp()),
 'payment_failures',(select count(*) from private.billing_payments where status='failed'))) into data;
 return data;
end $$;


create or replace function public.billing_read_checkout(p_checkout_id uuid,p_returned boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 select * into c from private.billing_checkout_sessions where id=p_checkout_id;
 if c.id is null then raise exception 'billing_not_found';end if;perform private.billing_owner(c.account_id);
 if c.user_id<>auth.uid() then raise exception 'billing_not_found';end if;
 if p_returned then perform private.billing_event(c.account_id,'advanced_checkout_returned',c.id::text);end if;
 return jsonb_build_object('id',c.id,'account_id',c.account_id,'account_name',(select name from public.accounts where id=c.account_id),
 'company_id',c.company_id,'company_name',(select name from public.company_profiles where id=c.company_id),
 'status',case when c.status in('created','pending') and c.expires_at<=clock_timestamp() then 'expired' else c.status end,
 'provider_key',c.provider_key,'effective_until',(select effective_until from private.account_subscriptions where account_id=c.account_id and status='active'),'expires_at',c.expires_at,'plan',private.effective_account_plan(c.account_id),'test_mode',(select test_mode from private.billing_offers where id=c.offer_id));
end $$;

create function public.billing_read_annual_access(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform private.billing_owner(p_account_id);
 return (select jsonb_build_object('effective_until',effective_until,'renewable',provider_key='yookassa' and effective_until is not null)
 from private.account_subscriptions where account_id=p_account_id and status='active');
end $$;
revoke all on function public.billing_read_annual_access(uuid) from public,anon,service_role;
grant execute on function public.billing_read_annual_access(uuid) to authenticated;
commit;
