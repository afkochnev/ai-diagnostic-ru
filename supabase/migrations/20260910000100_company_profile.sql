create table public.industries (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  sort_order integer not null unique check (sort_order > 0),
  is_active boolean not null default true
);

create table public.industry_translations (
  industry_key text not null references public.industries(key) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}$'),
  name text not null check (char_length(btrim(name)) > 0),
  primary key (industry_key, locale)
);

create table public.revenue_ranges (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  sort_order integer not null unique check (sort_order > 0),
  is_active boolean not null default true
);

create table public.revenue_range_translations (
  revenue_key text not null references public.revenue_ranges(key) on delete cascade,
  locale text not null check (locale ~ '^[a-z]{2}$'),
  name text not null check (char_length(btrim(name)) > 0),
  primary key (revenue_key, locale)
);

create table public.company_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  industry_key text not null references public.industries(key),
  country text not null check (char_length(btrim(country)) > 0),
  products text not null check (char_length(btrim(products)) > 0),
  customer_segments text not null check (char_length(btrim(customer_segments)) > 0),
  sales_channels text not null check (char_length(btrim(sales_channels)) > 0),
  employee_count integer not null check (employee_count > 0),
  annual_revenue_key text not null references public.revenue_ranges(key),
  company_age_years integer not null check (company_age_years >= 0),
  management_levels integer not null check (management_levels >= 1),
  key_problems text not null check (char_length(btrim(key_problems)) > 0),
  main_goals text not null check (char_length(btrim(main_goals)) > 0),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id)
);

create index company_profiles_owner_idx on public.company_profiles(owner_user_id);

create or replace function private.touch_company_profile() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.owner_user_id <> old.owner_user_id then
    raise exception 'company owner cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger company_profiles_touch before update on public.company_profiles
for each row execute function private.touch_company_profile();

insert into public.industries (key, sort_order) values
  ('manufacturing', 1), ('wholesale', 2), ('ecommerce', 3), ('retail', 4),
  ('construction', 5), ('real_estate', 6), ('software_development', 7),
  ('professional_services', 8), ('consulting', 9), ('logistics', 10),
  ('horeca', 11), ('education', 12), ('medicine', 13), ('finance', 14),
  ('agriculture', 15), ('other', 16);
insert into public.industry_translations (industry_key, locale, name) values
  ('manufacturing','ru','Производство'), ('wholesale','ru','Оптовая торговля'),
  ('ecommerce','ru','E-commerce'), ('retail','ru','Розничная торговля'),
  ('construction','ru','Строительство'), ('real_estate','ru','Недвижимость'),
  ('software_development','ru','IT / разработка ПО'), ('professional_services','ru','Профессиональные услуги'),
  ('consulting','ru','Консалтинг'), ('logistics','ru','Логистика'), ('horeca','ru','HoReCa'),
  ('education','ru','Образование'), ('medicine','ru','Медицина'), ('finance','ru','Финансы'),
  ('agriculture','ru','Сельское хозяйство'), ('other','ru','Другое');

insert into public.revenue_ranges (key, sort_order) values
  ('up_to_10m', 1), ('10m_100m', 2), ('100m_500m', 3), ('500m_1b', 4), ('1b_10b', 5), ('over_10b', 6);
insert into public.revenue_range_translations (revenue_key, locale, name) values
  ('up_to_10m','ru','до 10 млн руб.'), ('10m_100m','ru','10–100 млн руб.'),
  ('100m_500m','ru','100–500 млн руб.'), ('500m_1b','ru','500–1000 млн руб.'),
  ('1b_10b','ru','1–10 млрд руб.'), ('over_10b','ru','более 10 млрд руб.');

alter table public.industries enable row level security;
alter table public.industry_translations enable row level security;
alter table public.revenue_ranges enable row level security;
alter table public.revenue_range_translations enable row level security;
alter table public.company_profiles enable row level security;

grant select on public.industries, public.industry_translations, public.revenue_ranges, public.revenue_range_translations to authenticated;
grant select, insert, update on public.company_profiles to authenticated;

create policy "authenticated users read active industries" on public.industries for select to authenticated using (is_active);
create policy "authenticated users read industry translations" on public.industry_translations for select to authenticated using (exists (select 1 from public.industries i where i.key = industry_key and i.is_active));
create policy "authenticated users read active revenue ranges" on public.revenue_ranges for select to authenticated using (is_active);
create policy "authenticated users read revenue translations" on public.revenue_range_translations for select to authenticated using (exists (select 1 from public.revenue_ranges r where r.key = revenue_key and r.is_active));

create policy "owners read company profiles" on public.company_profiles for select to authenticated using (owner_user_id = (select auth.uid()));
create policy "owners create company profiles" on public.company_profiles for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy "owners update company profiles" on public.company_profiles for update to authenticated using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

revoke delete on public.company_profiles from authenticated, anon;
