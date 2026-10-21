-- V2.6A: provider-neutral core. No real offer, price, provider or production enablement.
begin;
create table private.billing_configuration(singleton boolean primary key default true check(singleton),mock_enabled boolean not null default false,provider_key text not null default 'mock');
insert into private.billing_configuration values(true,false,'mock');
create table private.billing_offers(
 id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.plans(id),key text not null unique,
 status text not null check(status in('draft','active','archived')),billing_mode text check(billing_mode in('subscription','one_time')),
 billing_period text,currency text check(currency ~ '^[A-Z]{3}$'),amount_minor bigint check(amount_minor>=0),
 provider_key text,provider_price_ref text,test_mode boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check((test_mode and provider_key='mock' and amount_minor is null and currency is null and billing_mode is null and billing_period is null)
 or (not test_mode and status<>'active'))
);
insert into private.billing_offers(plan_id,key,status,provider_key,test_mode)
 select id,'mock-advanced','active','mock',true from public.plans where key='advanced';
create table private.billing_checkout_sessions(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),
 company_id uuid references public.company_profiles(id),user_id uuid not null references public.users(id),offer_id uuid not null references private.billing_offers(id),
 provider_key text not null,provider_checkout_ref text not null, status text not null check(status in('created','pending','succeeded','failed','expired','cancelled')),
 continuation text not null default 'team_create' check(continuation='team_create'),idempotency_key uuid not null unique default gen_random_uuid(),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',completed_at timestamptz,
 unique(provider_key,provider_checkout_ref)
);
create index billing_checkout_account on private.billing_checkout_sessions(account_id,created_at desc);
create unique index billing_checkout_reuse on private.billing_checkout_sessions(account_id,offer_id,user_id) where status in('created','pending');
create index billing_checkout_stale on private.billing_checkout_sessions(expires_at) where status in('created','pending');
create table private.billing_provider_subscriptions(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),checkout_id uuid not null unique references private.billing_checkout_sessions(id),
 provider_key text not null,provider_subscription_ref text not null,provider_customer_ref text,
 status text not null check(status in('pending','active','cancel_pending','payment_failed','ended')),
 last_event_at timestamptz,product_subscription_id uuid references private.account_subscriptions(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(provider_key,provider_subscription_ref)
);
create index billing_provider_account on private.billing_provider_subscriptions(account_id,status);
create table private.billing_payments(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),checkout_id uuid not null unique references private.billing_checkout_sessions(id),
 provider_key text not null,provider_payment_ref text not null,status text not null check(status in('pending','succeeded','failed','refunded','partially_refunded')),
 amount_minor bigint,currency text,created_at timestamptz not null default now(),paid_at timestamptz,failed_at timestamptz,refunded_at timestamptz,
 unique(provider_key,provider_payment_ref)
);
create table private.billing_events(
 id uuid primary key default gen_random_uuid(),provider_key text not null,provider_event_ref text not null,event_type text not null,
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),received_at timestamptz not null default now(),
 checkout_id uuid references private.billing_checkout_sessions(id),account_id uuid references public.accounts(id),subscription_ref text,
 unique(provider_key,provider_event_ref)
);
create index billing_events_account on private.billing_events(account_id,received_at desc);
create table private.billing_event_attempts(
 id bigint generated always as identity primary key,event_id uuid not null references private.billing_events(id),
 processing_status text not null check(processing_status in('processed','ignored','rejected','retryable')),safe_error_code text,
 processed_at timestamptz not null default now()
);
create index billing_attempt_event on private.billing_event_attempts(event_id,id desc);
create table private.billing_plan_audit(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),old_plan text not null,new_plan text not null,
 source text not null check(source='provider'),provider_key text not null,event_id uuid not null references private.billing_events(id),
 subscription_id uuid references private.account_subscriptions(id),created_at timestamptz not null default now()
);
create index billing_audit_account on private.billing_plan_audit(account_id,created_at desc);

create index billing_offer_plan on private.billing_offers(plan_id);
create index billing_checkout_company on private.billing_checkout_sessions(company_id);
create index billing_checkout_user on private.billing_checkout_sessions(user_id);
create index billing_checkout_offer on private.billing_checkout_sessions(offer_id);
create index billing_provider_product on private.billing_provider_subscriptions(product_subscription_id);
create index billing_payment_account on private.billing_payments(account_id);
create index billing_event_checkout on private.billing_events(checkout_id);
create index billing_audit_event on private.billing_plan_audit(event_id);
create index billing_audit_subscription on private.billing_plan_audit(subscription_id);

-- Private tables deliberately have no direct CRUD, even for service_role. Definer RPCs own mutations.
do $$declare t text;begin
 foreach t in array array['billing_configuration','billing_offers','billing_checkout_sessions','billing_provider_subscriptions','billing_payments','billing_events','billing_event_attempts','billing_plan_audit'] loop
 execute format('alter table private.%I enable row level security',t);
 execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
create trigger billing_events_immutable before update or delete on private.billing_events for each row execute function private.reject_result_change();
create trigger billing_attempts_immutable before update or delete on private.billing_event_attempts for each row execute function private.reject_result_change();
create trigger billing_audit_immutable before update or delete on private.billing_plan_audit for each row execute function private.reject_result_change();

create function private.billing_owner(p_account uuid) returns void
language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not private.is_verified_session() or not exists(select 1 from public.users u join auth.users au on au.id=u.id where u.id=auth.uid() and au.email_confirmed_at is not null)
 or not exists(select 1 from public.account_memberships m join public.accounts a on a.id=m.account_id where a.id=p_account and a.status='active' and m.user_id=auth.uid() and m.role='owner' and m.status='active' and m.revoked_at is null)
 then raise exception 'billing_not_found';end if;
end $$;
create function private.billing_event(p_account uuid,p_name text,p_key text) returns void
language plpgsql security definer set search_path='' as $$declare v uuid;begin
 for v in select distinct visit_id from private.anonymous_diagnostic_sessions where claimed_account_id=p_account loop
 perform private.acquisition_event(v,p_name,p_key);end loop;
end $$;

create function public.billing_start_checkout(p_account_id uuid,p_company_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.billing_offers; c private.billing_checkout_sessions; cid uuid; checkout uuid:=gen_random_uuid();begin
 perform private.billing_owner(p_account_id);
 if not (select mock_enabled from private.billing_configuration) then raise exception 'billing_unavailable';end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 select * into o from private.billing_offers where key='mock-advanced' and status='active' and test_mode and provider_key='mock';
 if o.id is null then raise exception 'billing_unavailable';end if;
 if exists(select 1 from private.account_subscriptions where account_id=p_account_id and status='active' and source='provider') then raise exception 'billing_already_active';end if;
 cid:=public.read_acquisition_continuation(p_account_id);
 if p_company_id is not null then
 if cid is not null and cid<>p_company_id then raise exception 'billing_continuation_changed';end if;cid:=p_company_id;end if;
 if cid is not null and not exists(select 1 from public.company_profiles where id=cid and account_id=p_account_id) then raise exception 'billing_not_found';end if;
 update private.billing_checkout_sessions set status='expired',completed_at=clock_timestamp() where account_id=p_account_id and status in('created','pending') and expires_at<=clock_timestamp();
 select * into c from private.billing_checkout_sessions where account_id=p_account_id and offer_id=o.id and user_id=auth.uid() and status in('created','pending');
 if c.id is not null then
 if c.company_id is distinct from cid then raise exception 'billing_checkout_context_conflict';end if;return c.id;end if;
 insert into private.billing_checkout_sessions(id,account_id,company_id,user_id,offer_id,provider_key,provider_checkout_ref,status)
 values(checkout,p_account_id,cid,auth.uid(),o.id,'mock','mock-checkout-'||checkout,'created');
 insert into private.billing_provider_subscriptions(account_id,checkout_id,provider_key,provider_subscription_ref,provider_customer_ref,status)
 values(p_account_id,checkout,'mock','mock-sub-'||checkout,'mock-customer-'||p_account_id,'pending');
 insert into private.billing_payments(account_id,checkout_id,provider_key,provider_payment_ref,status) values(p_account_id,checkout,'mock','mock-payment-'||checkout,'pending');
 perform private.billing_event(p_account_id,'advanced_checkout_started',checkout::text);
 return checkout;
end $$;


create function public.billing_bind_checkout(p_checkout_id uuid,p_checkout_ref text,p_customer_ref text,p_subscription_ref text,p_payment_ref text) returns void
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 if current_setting('role',true)<>'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'billing_forbidden';end if;
 if not(select mock_enabled from private.billing_configuration) then raise exception 'billing_unavailable';end if;
 if p_checkout_ref is null or p_customer_ref is null or p_subscription_ref is null or p_payment_ref is null
 or p_checkout_ref !~ '^[A-Za-z0-9_-]{1,160}$' or p_customer_ref !~ '^[A-Za-z0-9_-]{1,160}$' or p_subscription_ref !~ '^[A-Za-z0-9_-]{1,160}$' or p_payment_ref !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'billing_invalid_reference';end if;
 select * into c from private.billing_checkout_sessions where id=p_checkout_id;
 if c.id is null then raise exception 'billing_not_found';end if;
 perform 1 from public.accounts where id=c.account_id and status='active' for update;
 select * into c from private.billing_checkout_sessions where id=c.id for update;
 if c.status='pending' and c.provider_checkout_ref=p_checkout_ref and exists(select 1 from private.billing_provider_subscriptions where checkout_id=c.id and provider_customer_ref=p_customer_ref and provider_subscription_ref=p_subscription_ref) and exists(select 1 from private.billing_payments where checkout_id=c.id and provider_payment_ref=p_payment_ref) then return;end if;
 if c.status<>'created' or c.expires_at<=clock_timestamp() then raise exception 'billing_checkout_not_bindable';end if;
 update private.billing_checkout_sessions set provider_checkout_ref=p_checkout_ref,status='pending' where id=c.id;
 update private.billing_provider_subscriptions set provider_customer_ref=p_customer_ref,provider_subscription_ref=p_subscription_ref where checkout_id=c.id;
 update private.billing_payments set provider_payment_ref=p_payment_ref where checkout_id=c.id;
end $$;

create function public.billing_read_checkout(p_checkout_id uuid,p_returned boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$declare c private.billing_checkout_sessions;begin
 select * into c from private.billing_checkout_sessions where id=p_checkout_id;
 if c.id is null then raise exception 'billing_not_found';end if;perform private.billing_owner(c.account_id);
 if c.user_id<>auth.uid() then raise exception 'billing_not_found';end if;
 if p_returned then perform private.billing_event(c.account_id,'advanced_checkout_returned',c.id::text);end if;
 return jsonb_build_object('id',c.id,'account_id',c.account_id,'account_name',(select name from public.accounts where id=c.account_id),
 'company_id',c.company_id,'company_name',(select name from public.company_profiles where id=c.company_id),
 'status',case when c.status in('created','pending') and c.expires_at<=clock_timestamp() then 'expired' else c.status end,
 'expires_at',c.expires_at,'plan',private.effective_account_plan(c.account_id),'test_mode',(select test_mode from private.billing_offers where id=c.offer_id));
end $$;

-- Signature verification is adapter responsibility; only server service-role may deliver its strict normalized contract.
-- Immutable receipt + immutable attempts: failures cannot mark a plan transition processed outside its transaction.
create function public.billing_process_verified_event(p_event jsonb,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.billing_checkout_sessions;o private.billing_offers;s private.billing_provider_subscriptions;e private.billing_events;
 prev private.billing_event_attempts;kind text;at_time timestamptz;newid uuid;oldplan text; outcome text:='processed';safe_code text;begin
 if current_setting('role',true)<>'service_role' or auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'billing_forbidden';end if;
 if not (select mock_enabled from private.billing_configuration) then raise exception 'billing_unavailable';end if;
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>4096
 or exists(select 1 from jsonb_object_keys(p_event) k where k not in('provider','event_ref','type','checkout_id','subscription_ref','payment_ref','customer_ref','occurred_at','amount_minor','currency'))
 or (select count(*) from jsonb_object_keys(p_event))<>10
 or p_event->>'provider' is distinct from (select provider_key from private.billing_configuration) or p_event->>'event_ref' is null or p_event->>'event_ref' !~ '^[A-Za-z0-9_-]{1,160}$'
 or p_event->>'type' is null or p_event->>'type' not in('payment_succeeded','payment_failed','checkout_cancelled','subscription_cancel_pending','subscription_ended','subscription_payment_failed','payment_refunded')
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'billing_invalid_event';end if;
 kind:=p_event->>'type';at_time:=(p_event->>'occurred_at')::timestamptz;
 if at_time is null or at_time>clock_timestamp()+interval '5 minutes' then raise exception 'billing_invalid_event';end if;
 perform pg_advisory_xact_lock(hashtextextended('billing:'||(p_event->>'provider')||':'||(p_event->>'event_ref'),0));
 select * into e from private.billing_events where provider_key=p_event->>'provider' and provider_event_ref=p_event->>'event_ref';
 if e.id is not null then
 if e.payload_hash<>p_hash then return jsonb_build_object('status','rejected','error','event_identity_conflict');end if;
 select * into prev from private.billing_event_attempts where event_id=e.id order by id desc limit 1;
 if prev.processing_status<>'retryable' then return jsonb_build_object('status',prev.processing_status,'error',prev.safe_error_code,'duplicate',true);end if;
 end if;
 select * into c from private.billing_checkout_sessions where id=(p_event->>'checkout_id')::uuid;
 if c.id is null then raise exception 'billing_checkout_unknown';end if;
 -- All checkout, manual plan, entitlement creation and event paths lock Account first.
 perform 1 from public.accounts where id=c.account_id for update;
 select * into c from private.billing_checkout_sessions where id=c.id for update;
 if e.id is null then
 insert into private.billing_events(provider_key,provider_event_ref,event_type,payload_hash,checkout_id,account_id,subscription_ref)
 values(p_event->>'provider',p_event->>'event_ref',kind,p_hash,c.id,c.account_id,p_event->>'subscription_ref') returning * into e;end if;
 begin
 select * into o from private.billing_offers where id=c.offer_id;
 select * into s from private.billing_provider_subscriptions where checkout_id=c.id for update;
 if o.provider_key is distinct from c.provider_key or c.provider_key is distinct from p_event->>'provider'
 or p_event->>'subscription_ref' is distinct from s.provider_subscription_ref
 or p_event->>'payment_ref' is distinct from (select provider_payment_ref from private.billing_payments where checkout_id=c.id)
 or p_event->>'customer_ref' is distinct from s.provider_customer_ref
 then safe_code:='reference_mismatch';outcome:='rejected';
 elsif (p_event->>'amount_minor')::bigint is distinct from o.amount_minor or p_event->>'currency' is distinct from o.currency then safe_code:='amount_currency_mismatch';outcome:='rejected';
 elsif at_time<c.created_at-interval '1 second' then safe_code:='event_before_checkout';outcome:='rejected';
 elsif s.last_event_at is not null and at_time<s.last_event_at then outcome:='ignored';
 elsif s.status='ended' then outcome:='ignored';
 elsif kind='payment_succeeded' then
  if c.status='succeeded' then outcome:='ignored';
  elsif c.status<>'pending' or c.expires_at<=clock_timestamp() or o.status<>'active'
   or not exists(select 1 from public.accounts where id=c.account_id and status='active') then safe_code:='checkout_not_payable';outcome:='rejected';
  elsif exists(select 1 from private.account_subscriptions where account_id=c.account_id and source='provider' and status='active') then safe_code:='provider_already_active';outcome:='rejected';
  else
   oldplan:=private.effective_account_plan(c.account_id);
   update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where account_id=c.account_id and status='active';
   insert into private.account_subscriptions(account_id,plan_id,status,source,provider_key,provider_customer_ref,provider_subscription_ref,effective_from)
   values(c.account_id,o.plan_id,'active','provider',c.provider_key,p_event->>'customer_ref',s.provider_subscription_ref,clock_timestamp()) returning id into newid;
   update private.billing_provider_subscriptions set status='active',product_subscription_id=newid,provider_customer_ref=p_event->>'customer_ref',last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;
   update private.billing_checkout_sessions set status='succeeded',completed_at=clock_timestamp() where id=c.id;
   update private.billing_payments set status='succeeded',paid_at=clock_timestamp() where checkout_id=c.id;
   insert into private.billing_plan_audit(account_id,old_plan,new_plan,source,provider_key,event_id,subscription_id) values(c.account_id,oldplan,'advanced','provider',c.provider_key,e.id,newid);
   perform private.billing_event(c.account_id,'advanced_payment_succeeded',c.id::text);
   perform private.billing_event(c.account_id,'advanced_subscription_activated',c.id::text);
  end if;
 elsif kind in('payment_failed','checkout_cancelled') then
  if c.status not in('created','pending') then outcome:='ignored';else
  update private.billing_checkout_sessions set status=case when kind='payment_failed' then 'failed' else 'cancelled' end,completed_at=clock_timestamp() where id=c.id;
  update private.billing_payments set status='failed',failed_at=clock_timestamp() where checkout_id=c.id;
  update private.billing_provider_subscriptions set last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;
  perform private.billing_event(c.account_id,'advanced_payment_failed',c.id::text);end if;
 elsif kind='subscription_ended' then
  update private.billing_provider_subscriptions set status='ended',last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;
  if s.product_subscription_id is not null and exists(select 1 from private.account_subscriptions where id=s.product_subscription_id and status='active') then
   update private.account_subscriptions set status='ended',effective_until=clock_timestamp() where id=s.product_subscription_id and status='active';
   insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from) select c.account_id,id,'active','system_default',clock_timestamp() from public.plans where key='free' returning id into newid;
   insert into private.billing_plan_audit(account_id,old_plan,new_plan,source,provider_key,event_id,subscription_id) values(c.account_id,'advanced','free','provider',c.provider_key,e.id,newid);
  end if;
  perform private.billing_event(c.account_id,'advanced_subscription_cancelled',c.id::text);
 elsif kind='subscription_cancel_pending' then
  if s.status not in('active','payment_failed') then outcome:='ignored';else update private.billing_provider_subscriptions set status='cancel_pending',last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;end if;
 elsif kind='subscription_payment_failed' then
  if s.status not in('active','cancel_pending') then outcome:='ignored';else update private.billing_provider_subscriptions set status='payment_failed',last_event_at=at_time,updated_at=clock_timestamp() where id=s.id;end if;
 elsif kind='payment_refunded' then
  if c.status<>'succeeded' then outcome:='ignored';else update private.billing_payments set status='refunded',refunded_at=clock_timestamp() where checkout_id=c.id;end if;
  -- No invented refund entitlement/grace-period policy.
 end if;
 exception when others then outcome:='retryable';safe_code:='billing_transaction_retry';
 end;
 insert into private.billing_event_attempts(event_id,processing_status,safe_error_code) values(e.id,outcome,safe_code);
 return jsonb_build_object('status',outcome,'error',safe_code,'duplicate',false);
end $$;

-- Guard both existing manual entry points. Existing history guard already allows only active → ended;
-- no expansion of historical row mutability is needed.
create function private.billing_prevent_manual_provider() returns trigger
language plpgsql set search_path='' as $$begin
 if new.source='manual' and exists(select 1 from private.billing_provider_subscriptions where account_id=new.account_id and status in('active','cancel_pending','payment_failed')) then
 raise exception 'billing_provider_managed';end if;return new;
end $$;
create trigger billing_manual_plan_guard before insert on private.account_subscriptions for each row execute function private.billing_prevent_manual_provider();
-- Trigger on active→ended closes the gap even if a manual RPC returns unchanged before inserting.
-- Manual RPCs are additionally checked before touching the old row below.

create or replace function public.admin_assign_account_plan(p_account_id uuid,p_target_plan text,p_reason text,p_expected_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; previous text; plan_id uuid; subscription uuid; changed_at timestamptz:=clock_timestamp();
begin
 actor:=private.admin_console_actor();
 if p_target_plan not in('free','advanced') or p_expected_plan not in('free','advanced') or p_target_plan is null or p_expected_plan is null then raise exception 'admin_invalid_plan';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then raise exception 'admin_invalid_reason';end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found then raise exception 'admin_not_found';end if;
 if exists(select 1 from private.account_subscriptions where account_id=p_account_id and status='active' and source='provider') then raise exception 'billing_provider_managed';end if;
 previous:=private.effective_account_plan(p_account_id);
 if previous=p_target_plan then return jsonb_build_object('status','unchanged','plan',previous);end if;
 if previous<>p_expected_plan then raise exception 'admin_plan_changed_refresh';end if;
 select id into plan_id from public.plans where key=p_target_plan and status='active';
 if plan_id is null then raise exception 'admin_invalid_plan';end if;
 update private.account_subscriptions set status='ended',effective_until=changed_at where account_id=p_account_id and status='active';
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 values(p_account_id,plan_id,'active','manual',changed_at) returning id into subscription;
 insert into private.admin_plan_changes(account_id,old_plan,new_plan,administrator_user_id,reason,subscription_id)
 values(p_account_id,previous,p_target_plan,actor,btrim(p_reason),subscription);
 insert into private.audit_events(actor_id,subject_id,action) values(actor,p_account_id,'account_plan_changed');
 return jsonb_build_object('status','changed','old_plan',previous,'plan',p_target_plan,'subscription_id',subscription);
end; $$;

create or replace function public.assign_account_plan(p_account_id uuid,p_plan_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; sid uuid; at_time timestamptz;
begin
 if current_setting('role',true)<>'service_role' or coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'forbidden'; end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found then raise exception 'not_found'; end if;
 if exists(select 1 from private.account_subscriptions where account_id=p_account_id and status='active' and source='provider') then raise exception 'billing_provider_managed';end if;
 select id into pid from public.plans where key=p_plan_key and status='active';
 if pid is null then raise exception 'invalid_plan'; end if;
 at_time:=clock_timestamp();
 update private.account_subscriptions set status='ended',effective_until=at_time where account_id=p_account_id and status='active';
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 values(p_account_id,pid,'active','manual',at_time) returning id into sid;
 return sid;
end; $$;

create or replace function private.acquisition_event(p_visit uuid,p_name text,p_key text default '',p_metadata jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare s private.anonymous_diagnostic_sessions;
begin
 if p_name not in('landing_view','landing_cta_clicked','anonymous_diagnostic_started','diagnostic_block_completed',
 'anonymous_diagnostic_completed','company_profile_completed','claim_email_submitted','claim_email_verified','diagnostic_claimed',
 'individual_result_ready','individual_report_ready','individual_report_viewed','individual_pdf_downloaded','advanced_offer_viewed',
 'team_explainer_viewed','advanced_cta_clicked','account_became_advanced','team_diagnostic_created','first_team_invitation_sent','team_report_ready','advanced_checkout_started','advanced_checkout_returned','advanced_payment_succeeded','advanced_payment_failed','advanced_subscription_activated','advanced_subscription_cancelled')
 or length(p_key)>100 or jsonb_typeof(p_metadata)<>'object' or exists(select 1 from jsonb_object_keys(p_metadata) k where k not in('block_position','total_blocks','source_surface','source'))
 or (p_metadata ? 'source_surface' and p_metadata->>'source_surface' not in('individual_report','dashboard','diagnostics_hub','team_explainer'))
 or (p_metadata ? 'source' and p_metadata->>'source' not in('manual','provider','system'))
 or (p_metadata ? 'block_position' and (p_metadata->>'block_position') !~ '^[0-9]{1,3}$')
 or (p_metadata ? 'total_blocks' and (p_metadata->>'total_blocks') !~ '^[0-9]{1,3}$')
 then raise exception 'acquisition_invalid_event'; end if;
 select * into s from private.anonymous_diagnostic_sessions where visit_id=p_visit;
 insert into private.product_events(visit_id,anonymous_session_id,user_id,account_id,company_id,diagnostic_id,event_name,entity_key,metadata)
 values(p_visit,s.id,s.claimed_user_id,s.claimed_account_id,s.claimed_company_id,s.claimed_diagnostic_id,p_name,coalesce(p_key,''),p_metadata)
 on conflict(visit_id,event_name,entity_key) do nothing;
end; $$;
create function public.billing_admin_read(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;data jsonb;page_no int;begin
 actor:=private.admin_console_actor();
 if p_filters is null or jsonb_typeof(p_filters)<>'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('account','q','plan','provider','status','payment','from','to','page'))
 or coalesce(p_filters->>'page','1') !~ '^[0-9]{1,5}$' or length(coalesce(p_filters->>'q',''))>100
 or coalesce(p_filters->>'plan','') not in('','free','advanced') or coalesce(p_filters->>'provider','') not in('','mock')
 or coalesce(p_filters->>'status','') not in('','pending','active','cancel_pending','payment_failed','ended')
 or coalesce(p_filters->>'payment','') not in('','pending','succeeded','failed','refunded','partially_refunded') then raise exception 'billing_invalid_filter';end if;
 page_no:=greatest(1,least(10000,coalesce((p_filters->>'page')::int,1)));
 with rows as(
 select a.id,a.name,private.effective_account_plan(a.id) plan,coalesce(s.source,'system_default') source,s.provider_key,
 case when s.provider_customer_ref is null then null else left(s.provider_customer_ref,10)||'…'||right(s.provider_customer_ref,6) end customer_ref,
 case when s.provider_subscription_ref is null then null else left(s.provider_subscription_ref,10)||'…'||right(s.provider_subscription_ref,6) end subscription_ref,
 coalesce(ps.status,s.status) subscription_status,s.effective_from,s.effective_until,c.id checkout_id,c.status checkout_status,p.status payment_status,a.created_at,
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

revoke all on function private.billing_owner(uuid),private.billing_event(uuid,text,text),private.billing_prevent_manual_provider() from public,anon,authenticated,service_role;
revoke all on function public.billing_start_checkout(uuid,uuid),public.billing_read_checkout(uuid,boolean),public.billing_admin_read(jsonb) from public,anon,service_role;
grant execute on function public.billing_start_checkout(uuid,uuid),public.billing_read_checkout(uuid,boolean),public.billing_admin_read(jsonb) to authenticated;
revoke all on function public.billing_bind_checkout(uuid,text,text,text,text),public.billing_process_verified_event(jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_bind_checkout(uuid,text,text,text,text),public.billing_process_verified_event(jsonb,text) to service_role;
create or replace function public.read_acquisition_funnel(p_filters jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; data jsonb;
begin
 actor:=private.admin_console_actor();
 if jsonb_typeof(p_filters)<>'object' or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','utm_source','utm_medium','utm_campaign'))
 or exists(select 1 from jsonb_each_text(p_filters) t where t.value !~ '^[A-Za-z0-9._-]{0,100}$') then raise exception 'admin_invalid_filter'; end if;
 with cohort as(select v.id from private.acquisition_visits v where
  (coalesce(p_filters->>'from','')='' or v.created_at >= (p_filters->>'from')::date)
  and(coalesce(p_filters->>'to','')='' or v.created_at < (p_filters->>'to')::date+interval '1 day')
  and(coalesce(p_filters->>'utm_source','')='' or v.attribution->>'utm_source'=p_filters->>'utm_source')
  and(coalesce(p_filters->>'utm_medium','')='' or v.attribution->>'utm_medium'=p_filters->>'utm_medium')
  and(coalesce(p_filters->>'utm_campaign','')='' or v.attribution->>'utm_campaign'=p_filters->>'utm_campaign')),
 stages as(select e.event_name,count(distinct e.visit_id) n from private.product_events e join cohort c on c.id=e.visit_id group by e.event_name)
 select jsonb_build_object('cohort_size',(select count(*) from cohort),'stages',(select coalesce(jsonb_object_agg(event_name,n),'{}') from stages),
 'campaigns',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select v.attribution->>'utm_source' utm_source,v.attribution->>'utm_medium' utm_medium,v.attribution->>'utm_campaign' utm_campaign,count(*) visits from private.acquisition_visits v join cohort c on c.id=v.id group by 1,2,3 order by count(*) desc limit 25)x),
 'block_progress',(select coalesce(jsonb_agg(to_jsonb(x) order by x.block_position),'[]') from(select (e.metadata->>'block_position')::int block_position,max((e.metadata->>'total_blocks')::int) total_blocks,count(distinct e.visit_id) sessions from private.product_events e join cohort c on c.id=e.visit_id where e.event_name='diagnostic_block_completed' group by 1)x),
 'conversions',(select jsonb_agg(jsonb_build_object('from',p.a,'to',p.b,'denominator',(select count(*) from cohort c where exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.a)),'numerator',(select count(*) from cohort c where exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.a) and exists(select 1 from private.product_events e where e.visit_id=c.id and e.event_name=p.b)))) from(values('landing_view','anonymous_diagnostic_started'),('anonymous_diagnostic_started','anonymous_diagnostic_completed'),('anonymous_diagnostic_completed','company_profile_completed'),('company_profile_completed','claim_email_submitted'),('claim_email_submitted','claim_email_verified'),('claim_email_verified','individual_report_ready'),('individual_report_viewed','advanced_cta_clicked'),('advanced_cta_clicked','advanced_checkout_started'),('advanced_checkout_started','advanced_payment_succeeded'),('advanced_payment_succeeded','account_became_advanced'),('account_became_advanced','team_diagnostic_created'))p(a,b)),
 'intents',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select i.account_id,i.company_id,i.source_surface,i.destination,i.created_at from private.advanced_conversion_intents i join cohort c on c.id=i.visit_id order by i.created_at desc limit 25)x)) into data;
 return data;
end; $$;
commit;
