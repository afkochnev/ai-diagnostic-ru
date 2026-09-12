alter table public.diagnostics
  add constraint diagnostics_id_user_key unique (id, created_by_user_id);

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  diagnostic_id uuid not null,
  rating integer not null check (rating between 1 and 5),
  useful text,
  improve text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, diagnostic_id),
  foreign key (diagnostic_id, company_id) references public.diagnostics(id, company_id) on delete restrict,
  foreign key (diagnostic_id, user_id) references public.diagnostics(id, created_by_user_id) on delete restrict
);
create index feedback_company_idx on public.feedback(company_id, created_at desc);
create index feedback_diagnostic_idx on public.feedback(diagnostic_id);

alter table public.feedback enable row level security;
grant select on public.feedback to authenticated;
create policy feedback_owner_read on public.feedback for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.create_feedback(
  p_diagnostic_id uuid, p_rating integer, p_useful text, p_improve text
) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  actor uuid := (select auth.uid());
  d public.diagnostics%rowtype;
  f public.feedback%rowtype;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from auth.users au where au.id = actor and au.email_confirmed_at is not null) then raise exception 'email_not_verified'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 or p_rating <> trunc(p_rating) then raise exception 'invalid_rating'; end if;
  select * into d from public.diagnostics where id = p_diagnostic_id and created_by_user_id = actor and status = 'completed';
  if d.id is null then raise exception 'diagnostic_not_owned_or_completed'; end if;
  select * into f from public.feedback where user_id = actor and diagnostic_id = p_diagnostic_id;
  if f.id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'feedback_id', f.id); end if;
  insert into public.feedback(user_id, company_id, diagnostic_id, rating, useful, improve)
    values (actor, d.company_id, d.id, p_rating, nullif(btrim(p_useful), ''), nullif(btrim(p_improve), ''))
    on conflict (user_id, diagnostic_id) do nothing
    returning * into f;
  if f.id is null then
    select * into f from public.feedback where user_id = actor and diagnostic_id = p_diagnostic_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'feedback_id', f.id);
  end if;
  return jsonb_build_object('ok', true, 'duplicate', false, 'feedback_id', f.id);
end; $$;
revoke all on function public.create_feedback(uuid, integer, text, text) from public, anon;
grant execute on function public.create_feedback(uuid, integer, text, text) to authenticated;
