-- Stage 2 only. Credentials remain exclusively in Supabase Auth.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.users (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  phone text,
  locale text not null default 'ru' check (locale = 'ru'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references public.users(id) on delete restrict,
  role text not null default 'user' check (role in ('user', 'administrator'))
);
create table public.consent_documents (
  kind text primary key check (kind in ('data_processing', 'marketing')),
  version text not null,
  is_temporary boolean not null default true
);
insert into public.consent_documents (kind, version) values
  ('data_processing', 'temporary-ru-v1'), ('marketing', 'temporary-ru-v1');
create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  kind text not null references public.consent_documents(kind),
  version text not null,
  granted boolean not null,
  recorded_at timestamptz not null default now(),
  source text not null,
  check (kind <> 'data_processing' or granted)
);
create index user_consents_user_id_idx on public.user_consents(user_id);
create table private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  subject_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);

-- Called once at identity creation. Later editable metadata has no effect.
create function private.provision_identity() returns trigger
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
  return new;
end;
$$;
revoke all on function private.provision_identity() from public, anon, authenticated;
create trigger provision_identity after insert on auth.users
  for each row execute function private.provision_identity();

-- Live session lookup also denies previously issued JWTs after logout.
create function private.is_verified_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null);
$$;
create function private.is_administrator() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_verified_session() and (select auth.jwt()->>'aal') = 'aal2'
    and exists(select 1 from public.user_roles where user_id = (select auth.uid()) and role = 'administrator');
$$;
revoke all on function private.is_verified_session(), private.is_administrator() from public, anon;
grant execute on function private.is_verified_session(), private.is_administrator() to authenticated;

alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_consents enable row level security;
alter table public.consent_documents enable row level security;
alter table private.audit_events enable row level security;
revoke all on public.users, public.user_roles, public.user_consents, public.consent_documents from anon, authenticated;
revoke all on private.audit_events from public, anon, authenticated;
grant select on public.users, public.user_roles, public.user_consents to authenticated;
grant update(full_name, phone, locale) on public.users to authenticated;
grant select on public.consent_documents to anon, authenticated;
create policy documents_read on public.consent_documents for select to anon, authenticated using (true);
create policy users_read on public.users for select to authenticated
  using ((id = (select auth.uid()) and private.is_verified_session()) or private.is_administrator());
create policy users_update on public.users for update to authenticated
  using (id = (select auth.uid()) and private.is_verified_session())
  with check (id = (select auth.uid()) and private.is_verified_session());
create policy roles_read on public.user_roles for select to authenticated
  using ((user_id = (select auth.uid()) and private.is_verified_session()) or private.is_administrator());
create policy consents_read on public.user_consents for select to authenticated
  using ((user_id = (select auth.uid()) and private.is_verified_session()) or private.is_administrator());

create function private.touch_user() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
revoke all on function private.touch_user() from public, anon, authenticated;
create trigger users_updated before update on public.users for each row execute function private.touch_user();

-- Role changes are SQL/operator-only and audited; no browser-callable setter.
create function private.audit_role_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.audit_events(actor_id, subject_id, action)
  values(auth.uid(), new.user_id, 'role_changed_to_' || new.role);
  return new;
end; $$;
revoke all on function private.audit_role_change() from public, anon, authenticated;
create trigger role_change after update on public.user_roles for each row
  when (old.role is distinct from new.role) execute function private.audit_role_change();
