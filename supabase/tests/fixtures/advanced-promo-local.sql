-- Minimal local-only Auth/Account shell. Existing plan/guard definitions are
-- loaded verbatim from their migrations by test-advanced-promo-local.py.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
grant usage on schema public,auth,private to anon,authenticated,service_role;
create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id));
create table public.users(id uuid primary key references auth.users(id));
create table public.user_roles(user_id uuid primary key references public.users(id),role text not null);
create table public.accounts(id uuid primary key,status text not null default 'active');
create table public.account_memberships(account_id uuid not null references public.accounts(id),user_id uuid not null references public.users(id),role text not null,status text not null);
create table public.company_profiles(id uuid primary key,account_id uuid not null references public.accounts(id));
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
create function private.is_verified_session() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
$$;
create function private.can_access_account(p_account_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_verified_session() and exists(select 1 from public.account_memberships m join public.accounts a on a.id=m.account_id
  where m.account_id=p_account_id and m.user_id=auth.uid() and m.role='owner' and m.status='active' and a.status='active')
$$;
create table private.billing_provider_subscriptions(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.accounts(id),status text not null,
 product_subscription_id uuid
);
