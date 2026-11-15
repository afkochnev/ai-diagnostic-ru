-- Persist the production confirmation origin with the checkout so provider retries
-- keep the same return_url and idempotency key after a domain switch or rollback.
begin;

alter table private.billing_checkout_sessions
  add column yookassa_return_origin text
  check (
    yookassa_return_origin is null
    or (
      provider_key = 'yookassa'
      and provider_test_mode is false
      and yookassa_return_origin in ('https://audit.iteamsystems.com', 'https://audit.iteam.ru')
    )
  );

create function public.billing_start_yookassa_checkout_with_origin(
  p_account_id uuid,
  p_company_id uuid,
  p_terms_version text,
  p_terms_sha256 text,
  p_terms_accepted boolean,
  p_return_origin text
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  previous_ids uuid[];
  checkout_id uuid;
  return_origin text;
begin
  if p_return_origin is null or p_return_origin not in ('https://audit.iteamsystems.com', 'https://audit.iteam.ru') then
    raise exception 'billing_invalid_return_origin';
  end if;

  -- Hold the same locks in the existing reservation order so an old web build
  -- cannot create an unmarked checkout between the snapshot and the reservation.
  perform private.billing_owner(p_account_id);
  perform private.require_commercial_terms(p_terms_version, p_terms_sha256, p_terms_accepted);
  perform 1 from private.billing_configuration
    where yookassa_test_mode is false and private.billing_yookassa_ready(true)
    for share;
  if not found then raise exception 'billing_unavailable'; end if;
  perform 1 from public.accounts where id = p_account_id and status = 'active' for update;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into previous_ids
    from private.billing_checkout_sessions c
    where c.account_id = p_account_id
      and c.user_id = auth.uid()
      and c.provider_key = 'yookassa'
      and c.status in ('created', 'pending');

  checkout_id := public.billing_start_yookassa_checkout(
    p_account_id, p_company_id, p_terms_version, p_terms_sha256, p_terms_accepted
  );

  if not (checkout_id = any(previous_ids)) then
    update private.billing_checkout_sessions c
      set yookassa_return_origin = p_return_origin
      where c.id = checkout_id;
  end if;

  -- Rows reserved through the previous application retain a null marker and
  -- use the previous production domain during any provider retry.
  select c.yookassa_return_origin into strict return_origin
    from private.billing_checkout_sessions c where c.id = checkout_id;
  return public.billing_yookassa_owner_context(checkout_id)
    || jsonb_build_object('return_origin', return_origin);
end;
$$;

revoke all on function public.billing_start_yookassa_checkout_with_origin(uuid,uuid,text,text,boolean,text)
  from public,anon,service_role;
grant execute on function public.billing_start_yookassa_checkout_with_origin(uuid,uuid,text,text,boolean,text)
  to authenticated;

commit;
