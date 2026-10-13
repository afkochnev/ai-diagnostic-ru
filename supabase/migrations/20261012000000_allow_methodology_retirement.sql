-- Lifecycle prerequisite for retirement. The original guard rejected every
-- published-row update, even the declared published -> retired transition.
-- Keep the existing triggers active and allow only that status-only transition.
begin;

create or replace function private.reject_published_version_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'published'
     and new.status = 'retired'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status') then
    return new;
  end if;

  if old.status in ('published', 'retired') then
    raise exception 'published or retired methodology is immutable';
  end if;

  if tg_op = 'UPDATE' and new.status = 'retired' then
    raise exception 'only published methodology can be retired';
  end if;

  return coalesce(new, old);
end;
$$;

-- Retirement must not release the existing content UPDATE/DELETE guards.
-- Check both sides of a relationship change so a row cannot be moved from an
-- immutable version to a draft version to evade the same guard.
create or replace function private.reject_published_methodology_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_versions uuid[];
begin
  if tg_table_name in ('diagnostic_blocks', 'questions') then
    v_versions := array[old.version_id, new.version_id];
  elsif tg_table_name = 'diagnostic_block_translations' then
    select array_agg(b.version_id) into v_versions
      from public.diagnostic_blocks b
      where b.id in (old.block_id, new.block_id);
  elsif tg_table_name in ('question_translations', 'question_options') then
    select array_agg(q.version_id) into v_versions
      from public.questions q
      where q.id in (old.question_id, new.question_id);
  elsif tg_table_name = 'question_option_translations' then
    select array_agg(q.version_id) into v_versions
      from public.questions q
      join public.question_options o on o.question_id = q.id
      where o.id in (old.option_id, new.option_id);
  else
    raise exception 'unsupported methodology guard table: %', tg_table_name;
  end if;

  if exists (
    select 1 from public.diagnostic_versions v
    where v.id = any(v_versions) and v.status in ('published', 'retired')
  ) then
    raise exception 'published or retired methodology is immutable';
  end if;
  return coalesce(new, old);
end;
$$;

commit;
