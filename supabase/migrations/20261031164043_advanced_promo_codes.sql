-- Account-scoped, finite Advanced grants. No live codes or billing changes.
begin;

create table private.advanced_promo_codes (
 id uuid primary key default gen_random_uuid(),
 code_hash text not null unique check(code_hash ~ '^[a-f0-9]{64}$'),
 code_hint text not null check(code_hint ~ '^ITEAM-…[A-F0-9]{4}$'),
 label text not null check(char_length(btrim(label)) between 3 and 100),
 max_redemptions integer not null check(max_redemptions between 1 and 1000),
 redeem_until timestamptz not null check(isfinite(redeem_until)),
 revoked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 created_by_user_id uuid not null references public.users(id),
 check(redeem_until > created_at),
 check(revoked_at is null or revoked_at >= created_at)
);
create table private.advanced_promo_redemptions (
 id uuid primary key default gen_random_uuid(),
 promo_id uuid not null references private.advanced_promo_codes(id),
 account_id uuid not null references public.accounts(id),
 redeemed_by_user_id uuid not null references public.users(id),
 subscription_id uuid not null unique references private.account_subscriptions(id),
 redeemed_at timestamptz not null,
 effective_until timestamptz not null check(isfinite(effective_until)),
 unique(promo_id,account_id),
 check(effective_until > redeemed_at)
);
create index advanced_promo_redemptions_account on private.advanced_promo_redemptions(account_id,redeemed_at desc);
alter table private.advanced_promo_codes enable row level security;
alter table private.advanced_promo_redemptions enable row level security;
revoke all on private.advanced_promo_codes,private.advanced_promo_redemptions from public,anon,authenticated,service_role;

create function private.advanced_promo_redemption_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'promo_redemption_immutable';
end $$;
create trigger advanced_promo_redemption_history before update or delete on private.advanced_promo_redemptions
 for each row execute function private.advanced_promo_redemption_immutable();
revoke all on function private.advanced_promo_redemption_immutable() from public,anon,authenticated,service_role;

create function public.admin_create_advanced_promo(p_code text,p_label text,p_max_redemptions integer,p_redeem_until timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare actor uuid; canonical text; created private.advanced_promo_codes;
begin
 actor:=private.admin_console_actor();
 -- ASCII-only upper(trim); no locale-dependent Unicode aliases.
 canonical:=translate(btrim(coalesce(p_code,'')),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ');
 if char_length(coalesce(p_code,''))>64 or canonical !~ '^ITEAM-[A-F0-9]{24}$' or p_label is null or char_length(btrim(p_label)) not between 3 and 100
 or p_max_redemptions is null or p_max_redemptions not between 1 and 1000
 or p_redeem_until is null or not isfinite(p_redeem_until) or p_redeem_until<=clock_timestamp() then
  raise exception 'promo_invalid_input';
 end if;
 begin
  insert into private.advanced_promo_codes(code_hash,code_hint,label,max_redemptions,redeem_until,created_by_user_id)
  values(encode(sha256(convert_to(canonical,'UTF8')),'hex'),'ITEAM-…'||right(canonical,4),btrim(p_label),p_max_redemptions,p_redeem_until,actor)
  returning * into created;
 exception when unique_violation then raise exception 'promo_code_exists';end;
 return jsonb_build_object('id',created.id,'label',created.label,'code_hint',created.code_hint,'max_redemptions',created.max_redemptions,
  'redemptions',0,'redeem_until',created.redeem_until,'revoked_at',created.revoked_at,'created_at',created.created_at);
end $$;

create function public.admin_list_advanced_promos() returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
 perform private.admin_console_actor();
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'label',p.label,'code_hint',p.code_hint,'max_redemptions',p.max_redemptions,
  'redemptions',(select count(*) from private.advanced_promo_redemptions r where r.promo_id=p.id),
  'redeem_until',p.redeem_until,'revoked_at',p.revoked_at,'created_at',p.created_at) order by p.created_at desc,p.id)
  from (select * from private.advanced_promo_codes order by created_at desc,id limit 25) p),'[]'::jsonb));
end $$;

create function public.admin_revoke_advanced_promo(p_promo_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare code private.advanced_promo_codes;
begin
 perform private.admin_console_actor();
 select * into code from private.advanced_promo_codes where id=p_promo_id for update;
 if code.id is null then raise exception 'promo_not_found';end if;
 if code.revoked_at is null then
  update private.advanced_promo_codes set revoked_at=clock_timestamp() where id=code.id returning * into code;
 end if;
 -- Revocation stops new activations; existing grants are not shortened.
 return jsonb_build_object('id',code.id,'revoked_at',code.revoked_at);
end $$;

create function public.redeem_advanced_promo(p_account_id uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare actor uuid:=auth.uid(); canonical text; code private.advanced_promo_codes;
 prior private.advanced_promo_redemptions; current_subscription private.account_subscriptions;
 limit_result jsonb; used bigint; advanced_plan_id uuid; subscription uuid; activated_at timestamptz; until_time timestamptz;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or not private.can_access_account(p_account_id) then
  raise exception 'promo_not_found' using errcode='42501';
 end if;
 -- This limit is enforced inside the authenticated RPC, including direct calls.
 -- Business failures return JSON so attempts commit instead of being rolled back.
 limit_result:=public.consume_rate_limit('advanced-promo:'||actor::text||':'||p_account_id::text,10,900);
 if coalesce((limit_result->>'allowed')::boolean,false) is not true then
  return jsonb_build_object('status','rate_limited','effective_until',null);
 end if;
 if char_length(coalesce(p_code,''))>64 then return jsonb_build_object('status','invalid','effective_until',null);end if;
 canonical:=translate(btrim(coalesce(p_code,'')),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ');
 if canonical !~ '^ITEAM-[A-F0-9]{24}$' then return jsonb_build_object('status','invalid','effective_until',null);end if;
 -- All commercial changes serialize on the same Account lock as billing.
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found or not private.can_access_account(p_account_id) then raise exception 'promo_not_found' using errcode='42501';end if;
 select * into code from private.advanced_promo_codes
  where code_hash=encode(sha256(convert_to(canonical,'UTF8')),'hex') for update;
 if code.id is null then return jsonb_build_object('status','invalid','effective_until',null);end if;
 select * into prior from private.advanced_promo_redemptions where promo_id=code.id and account_id=p_account_id;
 if prior.id is not null then
  return jsonb_build_object('status','already_redeemed','effective_until',prior.effective_until);
 end if;
 select * into current_subscription from private.account_subscriptions where account_id=p_account_id and status='active' for update;
 if private.effective_account_plan(p_account_id)='advanced' then
  return jsonb_build_object('status','already_advanced','effective_until',current_subscription.effective_until);
 end if;
 -- Preserve paid and stale provider-managed state, including expired paid rows.
 -- Existing billing guards remain authoritative; no provider history is rewritten.
 if (current_subscription.id is not null and current_subscription.source='provider')
 or exists(select 1 from private.billing_provider_subscriptions where account_id=p_account_id and status in('active','cancel_pending','payment_failed')) then
  return jsonb_build_object('status','billing_managed','effective_until',null);
 end if;
 if current_subscription.effective_from>clock_timestamp() then return jsonb_build_object('status','invalid','effective_until',null);end if;
 if code.revoked_at is not null or code.redeem_until<=clock_timestamp() then
  return jsonb_build_object('status','invalid','effective_until',null);
 end if;
 select count(*) into used from private.advanced_promo_redemptions where promo_id=code.id;
 if used>=code.max_redemptions then return jsonb_build_object('status','invalid','effective_until',null);end if;
 select id into advanced_plan_id from public.plans where key='advanced' and status='active';
 if advanced_plan_id is null then return jsonb_build_object('status','invalid','effective_until',null);end if;
 activated_at:=clock_timestamp();until_time:=activated_at+interval '30 days';
 if current_subscription.id is not null then
  update private.account_subscriptions set status='ended',
   effective_until=case when effective_until is null then activated_at else least(effective_until,activated_at) end
   where id=current_subscription.id;
 end if;
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from,effective_until)
 values(p_account_id,advanced_plan_id,'active','manual',activated_at,until_time) returning id into subscription;
 insert into private.advanced_promo_redemptions(promo_id,account_id,redeemed_by_user_id,subscription_id,redeemed_at,effective_until)
 values(code.id,p_account_id,actor,subscription,activated_at,until_time);
 return jsonb_build_object('status','activated','effective_until',until_time);
end $$;

revoke all on function public.admin_create_advanced_promo(text,text,integer,timestamptz),public.admin_list_advanced_promos(),
 public.admin_revoke_advanced_promo(uuid),public.redeem_advanced_promo(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_advanced_promo(text,text,integer,timestamptz),public.admin_list_advanced_promos(),
 public.admin_revoke_advanced_promo(uuid),public.redeem_advanced_promo(uuid,text) to authenticated;
commit;
