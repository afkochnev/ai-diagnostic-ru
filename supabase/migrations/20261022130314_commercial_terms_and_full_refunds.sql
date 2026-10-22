-- V2.7. Additive commercial version evidence and verified full-refund handling.
-- No fabricated legal text, merchant details, provider calls or feature activation.
begin;
create table public.commercial_legal_documents (
 version text primary key check(version ~ '^advanced-terms-ru-v[1-9][0-9]*$'),
 title text not null check(length(title) between 1 and 300),
 body text not null check(length(body) between 100 and 200000),
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 approved_at timestamptz not null,
 published_at timestamptz not null default now()
);
alter table public.commercial_legal_documents enable row level security;
revoke all on public.commercial_legal_documents from public,anon,authenticated;
grant select on public.commercial_legal_documents to anon,authenticated;
create policy commercial_document_read on public.commercial_legal_documents for select to anon,authenticated using (true);
create table private.commercial_legal_configuration (
 singleton boolean primary key default true check(singleton),
 active_version text references public.commercial_legal_documents(version)
);
insert into private.commercial_legal_configuration(singleton) values(true);
alter table private.commercial_legal_configuration enable row level security;
revoke all on private.commercial_legal_configuration from public,anon,authenticated,service_role;
create table private.billing_checkout_terms (
 checkout_id uuid primary key references private.billing_checkout_sessions(id),
 account_id uuid not null references public.accounts(id),user_id uuid not null references public.users(id),
 terms_version text not null references public.commercial_legal_documents(version),
 terms_sha256 text not null check(terms_sha256 ~ '^[a-f0-9]{64}$'),
 accepted_at timestamptz not null default clock_timestamp()
);
alter table private.billing_checkout_terms enable row level security;
revoke all on private.billing_checkout_terms from public,anon,authenticated,service_role;
create function private.commercial_evidence_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'commercial_evidence_immutable';end $$;
create function private.commercial_document_digest() returns trigger language plpgsql set search_path='' as $$
begin new.content_sha256:=encode(sha256(convert_to(new.body,'UTF8')),'hex');return new;end $$;
create trigger commercial_document_digest before insert on public.commercial_legal_documents for each row execute function private.commercial_document_digest();
create trigger commercial_document_immutable before update or delete on public.commercial_legal_documents for each row execute function private.commercial_evidence_immutable();
create trigger checkout_terms_immutable before update or delete on private.billing_checkout_terms for each row execute function private.commercial_evidence_immutable();
create function public.billing_current_commercial_terms() returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('version',d.version,'title',d.title,'body',d.body,'content_sha256',d.content_sha256,'approved_at',d.approved_at)
 from private.commercial_legal_configuration c join public.commercial_legal_documents d on d.version=c.active_version where c.singleton
$$;
revoke all on function public.billing_current_commercial_terms() from public;
grant execute on function public.billing_current_commercial_terms() to anon,authenticated,service_role;
create function public.billing_read_commercial_document(p_version text) returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('version',d.version,'title',d.title,'body',d.body,'content_sha256',d.content_sha256,'approved_at',d.approved_at)
 from public.commercial_legal_documents d where d.version=p_version
$$;
revoke all on function public.billing_read_commercial_document(text) from public;
grant execute on function public.billing_read_commercial_document(text) to anon,authenticated,service_role;
create function private.require_commercial_terms(v text,h text,accepted boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if accepted is distinct from true or v is null or h is null or not exists(
  select 1 from private.commercial_legal_configuration c join public.commercial_legal_documents d on d.version=c.active_version
  where c.singleton and d.version=v and d.content_sha256=h for share of c,d
 ) then raise exception 'billing_terms_required';end if;
end $$;
create function private.capture_checkout_terms(cid uuid,v text,h text) returns void language plpgsql security definer set search_path='' as $$
declare c private.billing_checkout_sessions;t private.billing_checkout_terms;begin
 select * into strict c from private.billing_checkout_sessions where id=cid;
 insert into private.billing_checkout_terms(checkout_id,account_id,user_id,terms_version,terms_sha256)
 values(c.id,c.account_id,auth.uid(),v,h) on conflict(checkout_id) do nothing;
 select * into strict t from private.billing_checkout_terms where checkout_id=cid;
 if t.terms_version<>v or t.terms_sha256<>h or t.user_id<>auth.uid() then raise exception 'billing_terms_context_conflict';end if;
end $$;
alter function public.billing_start_yookassa_checkout(uuid,uuid) rename to billing_start_yookassa_unversioned;
alter function public.billing_start_yookassa_unversioned(uuid,uuid) set schema private;
revoke all on function private.billing_start_yookassa_unversioned(uuid,uuid) from public,anon,authenticated,service_role;
alter function public.billing_start_checkout(uuid,uuid) rename to billing_start_mock_unversioned;
alter function public.billing_start_mock_unversioned(uuid,uuid) set schema private;
revoke all on function private.billing_start_mock_unversioned(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_start_yookassa_checkout(p_account_id uuid,p_company_id uuid default null,p_terms_version text default null,p_terms_sha256 text default null,p_terms_accepted boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 perform private.billing_owner(p_account_id);
 perform private.require_commercial_terms(p_terms_version,p_terms_sha256,p_terms_accepted);
 cid:=private.billing_start_yookassa_unversioned(p_account_id,p_company_id);
 perform private.capture_checkout_terms(cid,p_terms_version,p_terms_sha256);return cid;
end $$;
create function public.billing_start_checkout(p_account_id uuid,p_company_id uuid default null,p_terms_version text default null,p_terms_sha256 text default null,p_terms_accepted boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 perform private.billing_owner(p_account_id);
 perform private.require_commercial_terms(p_terms_version,p_terms_sha256,p_terms_accepted);
 cid:=private.billing_start_mock_unversioned(p_account_id,p_company_id);
 perform private.capture_checkout_terms(cid,p_terms_version,p_terms_sha256);return cid;
end $$;
revoke all on function public.billing_start_yookassa_checkout(uuid,uuid,text,text,boolean),public.billing_start_checkout(uuid,uuid,text,text,boolean) from public,anon,service_role;
grant execute on function public.billing_start_yookassa_checkout(uuid,uuid,text,text,boolean),public.billing_start_checkout(uuid,uuid,text,text,boolean) to authenticated;

create table private.billing_refunds (
 id uuid primary key default gen_random_uuid(),checkout_id uuid not null unique references private.billing_checkout_sessions(id),
 account_id uuid not null references public.accounts(id),provider_refund_ref text unique,
 amount_minor bigint not null default 48000 check(amount_minor=48000),currency text not null default 'RUB' check(currency='RUB'),
 status text not null default 'requested' check(status in('requested','pending','succeeded','canceled')),
 requested_by uuid references public.users(id),created_at timestamptz not null default clock_timestamp(),
 succeeded_at timestamptz,receipt_state text check(receipt_state in('pending','succeeded','canceled')),
 checked_at timestamptz,
 check(provider_refund_ref is null or provider_refund_ref ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
);
create index billing_refunds_account on private.billing_refunds(account_id);
create index billing_refunds_pending on private.billing_refunds(created_at) where status in('requested','pending');
alter table private.billing_refunds enable row level security;
revoke all on private.billing_refunds from public,anon,authenticated,service_role;

-- Administrative initiation is separate from provider-confirmed reconciliation.
-- The application has an additional OFF-by-default refund request switch.
create function public.billing_request_full_refund(p_checkout_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.billing_checkout_sessions;r private.billing_refunds;begin
 perform private.admin_console_actor();
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 perform 1 from public.accounts where id=c.account_id for update;
 if not exists(select 1 from private.billing_payments where checkout_id=c.id and status in('succeeded','refunded') and amount_minor=48000 and currency='RUB') then raise exception 'billing_refund_not_available';end if;
 insert into private.billing_refunds(checkout_id,account_id,requested_by) values(c.id,c.account_id,auth.uid()) on conflict(checkout_id) do nothing;
 select * into strict r from private.billing_refunds where checkout_id=c.id;
 return jsonb_build_object('id',r.id,'checkout_id',c.id,'created_at',r.created_at,'provider_refund_ref',r.provider_refund_ref,'status',r.status);
end $$;
create function public.billing_yookassa_refund_context(p_checkout_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.billing_service_actor();
 if not exists(select 1 from private.billing_refunds where checkout_id=p_checkout_id) then raise exception 'billing_not_found';end if;
 return private.billing_yookassa_context(p_checkout_id);
end $$;
create function public.billing_bind_full_refund(p_request_id uuid,p_checkout_id uuid,p_refund_ref text) returns void language plpgsql security definer set search_path='' as $$
declare r private.billing_refunds;begin
 perform private.billing_service_actor();
 if p_refund_ref is null or p_refund_ref !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'billing_invalid_refund';end if;
 select * into r from private.billing_refunds where id=p_request_id and checkout_id=p_checkout_id for update;
 if r.id is null then raise exception 'billing_not_found';end if;
 if r.provider_refund_ref is not null and r.provider_refund_ref<>p_refund_ref then raise exception 'billing_refund_reference_conflict';end if;
 update private.billing_refunds set provider_refund_ref=p_refund_ref,status=case when status='requested' then 'pending' else status end where id=r.id;
end $$;

-- Only authenticated provider GETs reach this service-role boundary. Pending,
-- canceled, mismatched and duplicate observations never revoke newer access.
create function public.billing_record_verified_refund(p_checkout_id uuid,p_payment_ref text,p_refund_ref text,p_status text,p_amount_minor bigint,p_currency text,p_created_at timestamptz,p_receipt_state text default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare c private.billing_checkout_sessions;r private.billing_refunds;e uuid;freeid uuid;oldplan text;olduntil timestamptz;begin
 perform private.billing_service_actor();
 if p_refund_ref is null or p_refund_ref !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_status is null or p_status not in('pending','succeeded','canceled') or p_amount_minor is distinct from 48000 or p_currency is distinct from 'RUB'
 or p_created_at is null or p_created_at>clock_timestamp()+interval '5 minutes'
 or (p_receipt_state is not null and p_receipt_state not in('pending','succeeded','canceled')) then raise exception 'billing_invalid_refund';end if;
 select * into c from private.billing_checkout_sessions where id=p_checkout_id and provider_key='yookassa';
 if c.id is null then raise exception 'billing_not_found';end if;
 perform 1 from public.accounts where id=c.account_id for update;
 if c.provider_checkout_ref is distinct from p_payment_ref or c.provider_test_mode is distinct from true
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
revoke all on function public.billing_request_full_refund(uuid) from public,anon,service_role;
grant execute on function public.billing_request_full_refund(uuid) to authenticated;
revoke all on function public.billing_record_verified_refund(uuid,text,text,text,bigint,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.billing_record_verified_refund(uuid,text,text,text,bigint,text,timestamptz,text) to service_role;
revoke all on function public.billing_yookassa_refund_context(uuid) from public,anon,authenticated;
grant execute on function public.billing_yookassa_refund_context(uuid) to service_role;
revoke all on function public.billing_bind_full_refund(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.billing_bind_full_refund(uuid,uuid,text) to service_role;
revoke all on function private.commercial_evidence_immutable(),private.commercial_document_digest(),private.require_commercial_terms(text,text,boolean),private.capture_checkout_terms(uuid,text,text) from public,anon,authenticated,service_role;

-- Preserve existing pagination/filter/authorization; append only safe evidence.
alter function public.billing_admin_read(jsonb) rename to billing_admin_read_v26b;
alter function public.billing_admin_read_v26b(jsonb) set schema private;
revoke all on function private.billing_admin_read_v26b(jsonb) from public,anon,authenticated,service_role;
create function public.billing_admin_read(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;rows jsonb;begin
 base:=private.billing_admin_read_v26b(p_filters);
 select coalesce(jsonb_agg(x.value||jsonb_build_object(
  'terms_version',(select terms_version from private.billing_checkout_terms where checkout_id=(x.value->>'checkout_id')::uuid),
  'terms_sha256',(select terms_sha256 from private.billing_checkout_terms where checkout_id=(x.value->>'checkout_id')::uuid),
  'refund_status',(select status from private.billing_refunds where checkout_id=(x.value->>'checkout_id')::uuid),
  'refund_receipt_state',(select receipt_state from private.billing_refunds where checkout_id=(x.value->>'checkout_id')::uuid)
 ) order by x.ordinality),'[]') into rows from jsonb_array_elements(base->'rows') with ordinality x(value,ordinality);
 return base||jsonb_build_object('rows',rows,'health',(base->'health')||jsonb_build_object(
  'receipt_failures',(select count(*) from private.billing_checkout_sessions where receipt_state='canceled'),
  'receipt_pending',(select count(*) from private.billing_checkout_sessions where status='succeeded' and (receipt_state is null or receipt_state='pending') and completed_at<clock_timestamp()-interval '15 minutes'),
  'refund_failures',(select count(*) from private.billing_refunds where status='canceled' or receipt_state='canceled'),
  'refund_pending',(select count(*) from private.billing_refunds where status in('requested','pending') and created_at<clock_timestamp()-interval '15 minutes')
 ));
end $$;
revoke all on function public.billing_admin_read(jsonb) from public,anon,service_role;
grant execute on function public.billing_admin_read(jsonb) to authenticated;
commit;
