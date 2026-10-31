-- Recoverable admin-only code display and archival. No codes or grants are seeded.
begin;

alter table private.advanced_promo_codes
 add column code_ciphertext text,
 add column deleted_at timestamptz,
 add constraint advanced_promo_ciphertext_shape check (
  code_ciphertext is null or (octet_length(code_ciphertext)=121 and code_ciphertext ~ '^v1\.[0-9a-f]{24}\.[0-9a-f]{60}\.[0-9a-f]{32}$')
 ),
 add constraint advanced_promo_deleted_state check (
  deleted_at is null or (isfinite(deleted_at) and deleted_at >= created_at and revoked_at is not null)
 );
create index advanced_promo_codes_current_idx on private.advanced_promo_codes(created_at desc,id)
 where deleted_at is null;

-- The five-argument RPC is explicit (no DEFAULT): retaining a four-argument
-- wrapper avoids ambiguous overload resolution during a rolling application deploy.
create function public.admin_create_advanced_promo(p_code text,p_label text,p_max_redemptions integer,p_redeem_until timestamptz,p_code_ciphertext text) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare actor uuid; canonical text; created private.advanced_promo_codes;
begin
 actor:=private.admin_console_actor();
 canonical:=translate(btrim(coalesce(p_code,'')),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ');
 if char_length(coalesce(p_code,''))>64 or canonical !~ '^ITEAM-[A-F0-9]{24}$' or p_label is null or char_length(btrim(p_label)) not between 3 and 100
 or p_max_redemptions is null or p_max_redemptions not between 1 and 1000
 or p_redeem_until is null or not isfinite(p_redeem_until) or p_redeem_until<=clock_timestamp()
 or (p_code_ciphertext is not null and (octet_length(p_code_ciphertext)<>121 or p_code_ciphertext !~ '^v1\.[0-9a-f]{24}\.[0-9a-f]{60}\.[0-9a-f]{32}$')) then
  raise exception 'promo_invalid_input';
 end if;
 begin
  insert into private.advanced_promo_codes(code_hash,code_hint,label,max_redemptions,redeem_until,created_by_user_id,code_ciphertext)
  values(encode(sha256(convert_to(canonical,'UTF8')),'hex'),'ITEAM-…'||right(canonical,4),btrim(p_label),p_max_redemptions,p_redeem_until,actor,p_code_ciphertext)
  returning * into created;
 exception when unique_violation then raise exception 'promo_code_exists';end;
 return jsonb_build_object('id',created.id,'label',created.label,'code_hint',created.code_hint,'max_redemptions',created.max_redemptions,
  'redemptions',0,'redeem_until',created.redeem_until,'revoked_at',created.revoked_at,'created_at',created.created_at);
end $$;

create or replace function public.admin_create_advanced_promo(p_code text,p_label text,p_max_redemptions integer,p_redeem_until timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
 return public.admin_create_advanced_promo(p_code,p_label,p_max_redemptions,p_redeem_until,null::text);
end $$;

create or replace function public.admin_list_advanced_promos() returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
begin
 perform private.admin_console_actor();
 return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'id',p.id,'label',p.label,'code_hint',p.code_hint,'code_ciphertext',p.code_ciphertext,'code_hash',p.code_hash,
  'max_redemptions',p.max_redemptions,
  'redemptions',(select count(*) from private.advanced_promo_redemptions r where r.promo_id=p.id),
  'redeem_until',p.redeem_until,'revoked_at',p.revoked_at,'created_at',p.created_at) order by p.created_at desc,p.id)
  from (select * from private.advanced_promo_codes where deleted_at is null order by created_at desc,id limit 25) p),'[]'::jsonb));
end $$;

create function public.admin_delete_advanced_promo(p_promo_id uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare code private.advanced_promo_codes; archived_at timestamptz;
begin
 perform private.admin_console_actor();
 select * into code from private.advanced_promo_codes where id=p_promo_id for update;
 if code.id is null then raise exception 'promo_not_found';end if;
 if code.deleted_at is null then
  archived_at:=clock_timestamp();
  update private.advanced_promo_codes
   set deleted_at=archived_at,revoked_at=coalesce(revoked_at,archived_at)
   where id=code.id returning * into code;
 end if;
 -- Existing redeem RPC already rejects revoked codes for new Accounts, while
 -- prior redemptions retain their original deadline. No grant/history is changed.
 return jsonb_build_object('id',code.id,'deleted_at',code.deleted_at);
end $$;

revoke all on function public.admin_create_advanced_promo(text,text,integer,timestamptz),
 public.admin_create_advanced_promo(text,text,integer,timestamptz,text),public.admin_list_advanced_promos(),
 public.admin_delete_advanced_promo(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_advanced_promo(text,text,integer,timestamptz),
 public.admin_create_advanced_promo(text,text,integer,timestamptz,text),public.admin_list_advanced_promos(),
 public.admin_delete_advanced_promo(uuid) to authenticated;
comment on column private.advanced_promo_codes.code_ciphertext is
 'Optional versioned server AES-256-GCM envelope; legacy hash-only codes remain unrecoverable. Never plaintext.';
comment on function public.admin_delete_advanced_promo(uuid) is
 'Admin-only soft archival: hide the code and revoke future redemptions, retaining grants and immutable redemption history.';
commit;
