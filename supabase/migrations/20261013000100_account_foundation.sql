-- Phase A: additive identity/account foundation. Keep V1 company uniqueness and
-- policies until the compatible application and Phase B are ready together.
begin;

-- Lock the source of signup before its trigger can start: queued registrations
-- execute the replacement provisioner after commit, avoiding missed accounts.
lock table auth.users, public.users, public.company_profiles in share row exclusive mode;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','archived')),
  legacy_origin_user_id uuid unique references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.account_memberships (
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  role text not null default 'owner' check (role = 'owner'),
  status text not null default 'active' check (status in ('active','revoked')),
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (account_id,user_id),
  check ((status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null))
);
create unique index account_memberships_one_active_owner_idx
  on public.account_memberships(account_id) where role='owner' and status='active';
create index account_memberships_user_access_idx
  on public.account_memberships(user_id,status,account_id);

create function private.guard_account_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.legacy_origin_user_id is distinct from old.legacy_origin_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'account identity and legacy origin are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger accounts_metadata_guard before update on public.accounts
  for each row execute function private.guard_account_metadata();

create function private.guard_membership_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is distinct from old.account_id
     or new.user_id is distinct from old.user_id
     or new.joined_at is distinct from old.joined_at then
    raise exception 'membership identity is immutable';
  end if;
  return new;
end;
$$;
create trigger memberships_identity_guard before update on public.account_memberships
  for each row execute function private.guard_membership_identity();

create function private.enforce_account_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if tg_table_name='accounts' then target := coalesce(new.id,old.id);
  else target := coalesce(new.account_id,old.account_id); end if;
  if exists(select 1 from public.accounts a where a.id=target and a.status='active')
     and (select count(*) from public.account_memberships m
       where m.account_id=target and m.role='owner' and m.status='active') <> 1 then
    raise exception 'active account must have exactly one active owner';
  end if;
  return null;
end;
$$;
create constraint trigger accounts_exactly_one_owner
  after insert or update or delete on public.accounts deferrable initially deferred
  for each row execute function private.enforce_account_owner();
create constraint trigger memberships_exactly_one_owner
  after insert or update or delete on public.account_memberships deferrable initially deferred
  for each row execute function private.enforce_account_owner();

create function private.can_access_account(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_verified_session() and exists (
    select 1 from public.account_memberships m join public.accounts a on a.id=m.account_id
    where m.account_id=p_account_id and m.user_id=(select auth.uid())
      and m.role='owner' and m.status='active' and a.status='active'
  );
$$;
alter table public.company_profiles add column account_id uuid;
alter table public.company_profiles add constraint company_profiles_account_id_fkey
  foreign key (account_id) references public.accounts(id) on delete restrict not valid;
create index company_profiles_account_list_idx on public.company_profiles(account_id,created_at,id);

create function private.can_access_company(p_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.company_profiles c where c.id=p_company_id
    and private.can_access_account(c.account_id));
$$;

create function private.can_access_diagnostic(p_diagnostic_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.diagnostics d where d.id=p_diagnostic_id
    and private.can_access_company(d.company_id));
$$;
revoke all on function private.can_access_account(uuid), private.can_access_company(uuid),
  private.can_access_diagnostic(uuid) from public, anon;
grant execute on function private.can_access_account(uuid), private.can_access_company(uuid),
  private.can_access_diagnostic(uuid) to authenticated;

alter table public.accounts enable row level security;
alter table public.account_memberships enable row level security;
revoke all on public.accounts, public.account_memberships from public, anon, authenticated;
grant select on public.accounts, public.account_memberships to authenticated;
create policy accounts_owner_read on public.accounts for select to authenticated
  using (private.can_access_account(id));
create policy memberships_owner_read on public.account_memberships for select to authenticated
  using (private.can_access_account(account_id));

-- Random UUID + unique immutable origin gives a stable mapping on every replay.
-- Conflicting owner/state mappings are errors, never silently repaired/revived.
create function private.ensure_legacy_account(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u public.users%rowtype; a public.accounts%rowtype; m public.account_memberships%rowtype;
begin
  select * into u from public.users where id=p_user_id;
  if u.id is null then raise exception 'legacy account user missing'; end if;
  insert into public.accounts(name,legacy_origin_user_id)
    values(u.full_name,u.id) on conflict (legacy_origin_user_id) do nothing;
  select * into a from public.accounts where legacy_origin_user_id=u.id for update;
  if a.id is null or a.status <> 'active' then
    raise exception 'legacy account mapping conflicts with account state';
  end if;
  if exists(select 1 from public.account_memberships
      where account_id=a.id and status='active' and user_id<>u.id) then
    raise exception 'legacy account mapping conflicts with owner';
  end if;
  insert into public.account_memberships(account_id,user_id,role,status)
    values(a.id,u.id,'owner','active') on conflict (account_id,user_id) do nothing;
  select * into m from public.account_memberships where account_id=a.id and user_id=u.id;
  if m.role <> 'owner' or m.status <> 'active' or m.revoked_at is not null then
    raise exception 'legacy membership mapping conflicts with existing membership';
  end if;
  return a.id;
end;
$$;
revoke all on function private.ensure_legacy_account(uuid) from public, anon, authenticated;

-- Compatibility for old V1 company INSERT payloads, without a nullable orphan.
create function private.assign_company_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_id is null then
    select id into new.account_id from public.accounts
      where legacy_origin_user_id=new.owner_user_id;
  end if;
  if new.account_id is null or not exists (
    select 1 from public.accounts a join public.account_memberships m on m.account_id=a.id
    where a.id=new.account_id and a.status='active' and m.user_id=new.owner_user_id
      and m.role='owner' and m.status='active'
  ) then raise exception 'company account must have the recorded creator as active owner'; end if;
  return new;
end;
$$;
create trigger company_profiles_assign_account before insert on public.company_profiles
  for each row execute function private.assign_company_account();

create or replace function private.touch_company_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.owner_user_id is distinct from old.owner_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'company identity and creator provenance are immutable';
  end if;
  if old.account_id is not null and new.account_id is distinct from old.account_id then
    raise exception 'company account cannot be changed';
  end if;
  if old.account_id is null and new.account_id is not null and not exists (
    select 1 from public.accounts a where a.id=new.account_id
      and a.legacy_origin_user_id=old.owner_user_id
  ) then raise exception 'company legacy account mapping conflict'; end if;
  if (to_jsonb(new)-'account_id') = (to_jsonb(old)-'account_id') then
    new.updated_at := old.updated_at;
  else new.updated_at := now(); end if;
  return new;
end;
$$;

create function private.backfill_legacy_accounts() returns void
language plpgsql security definer set search_path = '' as $$
declare u record;
begin
  for u in select id from public.users order by id loop
    perform private.ensure_legacy_account(u.id);
  end loop;
  if exists (
    select 1 from public.company_profiles c
    join public.accounts a on a.legacy_origin_user_id=c.owner_user_id
    where c.account_id is not null and c.account_id<>a.id
  ) then raise exception 'existing company legacy account mapping conflict'; end if;
  update public.company_profiles c set account_id=a.id
    from public.accounts a where a.legacy_origin_user_id=c.owner_user_id and c.account_id is null;
  if exists(select 1 from public.company_profiles where account_id is null) then
    raise exception 'company account backfill incomplete';
  end if;
end;
$$;
revoke all on function private.backfill_legacy_accounts() from public, anon, authenticated;
revoke all on function private.guard_account_metadata(), private.guard_membership_identity(),
  private.enforce_account_owner(), private.assign_company_account(), private.touch_company_profile()
  from public, anon, authenticated;

-- Preserve original consent/global-role provisioning, append account creation.
create or replace function private.provision_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare doc record; consent jsonb;
begin
  if new.raw_user_meta_data->'data_processing_consent' <> 'true'::jsonb
     or new.raw_user_meta_data->'data_processing_consent' is null then
    raise exception 'Data processing consent is required';
  end if;
  if jsonb_typeof(new.raw_user_meta_data->'marketing_consent') is distinct from 'boolean' then
    raise exception 'Marketing choice is required';
  end if;
  for doc in select * from public.consent_documents loop
    if new.raw_user_meta_data->>(doc.kind || '_version') is distinct from doc.version then
      raise exception 'Consent version mismatch';
    end if;
  end loop;
  insert into public.users(id, full_name) values(new.id, trim(new.raw_user_meta_data->>'full_name'));
  insert into public.user_roles(user_id, role) values(new.id, 'user');
  for doc in select * from public.consent_documents loop
    consent := new.raw_user_meta_data->(doc.kind || '_consent');
    insert into public.user_consents(user_id, kind, version, granted, source)
    values(new.id, doc.kind, doc.version, consent = 'true'::jsonb, 'email_registration');
  end loop;
  insert into private.audit_events(subject_id, action) values(new.id, 'identity_created');
  perform private.ensure_legacy_account(new.id);
  return new;
end;
$$;

select private.backfill_legacy_accounts();
set constraints all immediate;
commit;
