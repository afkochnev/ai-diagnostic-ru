create or replace function public.save_diagnostic_block(
  p_diagnostic_id uuid,
  p_expected_revision integer,
  p_mutation_id uuid,
  p_current_block_id uuid,
  p_answers jsonb default '[]'::jsonb,
  p_answers_dirty boolean default true
) returns table (revision integer, current_block_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_diagnostic public.diagnostics%rowtype;
  v_previous integer;
  v_item jsonb;
  v_question_id uuid;
  v_answer_type text;
  v_value jsonb;
begin
  if v_actor is null then
    raise exception 'not_found';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'invalid';
  end if;

  select d.* into v_diagnostic
    from public.diagnostics d
   where d.id = p_diagnostic_id
     and d.created_by_user_id = v_actor
   for update;
  if not found or v_diagnostic.status <> 'in_progress' then
    raise exception 'not_found';
  end if;

  select m.resulting_revision into v_previous
    from public.diagnostic_mutations m
   where m.diagnostic_id = p_diagnostic_id
     and m.mutation_id = p_mutation_id;
  if found then
    revision := v_previous;
    current_block_id := v_diagnostic.current_block_id;
    return next;
    return;
  end if;
  if v_diagnostic.revision <> p_expected_revision then
    raise exception 'conflict';
  end if;

  if not exists (
    select 1 from public.diagnostic_blocks b
     where b.id = p_current_block_id
       and b.version_id = v_diagnostic.version_id
       and b.is_active
  ) then
    raise exception 'invalid';
  end if;

  if p_answers_dirty then
    for v_item in select value from jsonb_array_elements(p_answers) loop
      if jsonb_typeof(v_item) <> 'object'
         or not (v_item ? 'question_id')
         or not (v_item ? 'value') then
        raise exception 'invalid';
      end if;
      begin
        v_question_id := (v_item->>'question_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'invalid';
      end;
      select q.answer_type into v_answer_type
        from public.questions q
       where q.id = v_question_id
         and q.version_id = v_diagnostic.version_id
         and q.is_active;
      if not found then
        raise exception 'invalid';
      end if;
      v_value := v_item->'value';
      if v_value is null or jsonb_typeof(v_value) = 'null' then
        continue;
      elsif v_answer_type = 'scale_0_4' then
        if jsonb_typeof(v_value) <> 'number'
           or ((v_value #>> '{}')::numeric < 0)
           or ((v_value #>> '{}')::numeric > 4)
           or ((v_value #>> '{}')::numeric % 1) <> 0 then
          raise exception 'invalid';
        end if;
      elsif v_answer_type = 'text' then
        if jsonb_typeof(v_value) <> 'string' then
          raise exception 'invalid';
        end if;
      else
        raise exception 'invalid';
      end if;
    end loop;
  end if;

  update public.diagnostics
     set current_block_id = p_current_block_id,
         revision = p_expected_revision + 1
   where id = p_diagnostic_id;

  if p_answers_dirty then
    delete from public.answers a
     where a.diagnostic_id = p_diagnostic_id
       and a.question_id in (
         select (item->>'question_id')::uuid
           from jsonb_array_elements(p_answers) item
          where (item->'value') is null
             or jsonb_typeof(item->'value') = 'null'
             or (jsonb_typeof(item->'value') = 'string' and item->>'value' = '')
       );

    insert into public.answers (diagnostic_id, version_id, question_id, text_value, numeric_value, revision)
    select p_diagnostic_id,
           v_diagnostic.version_id,
           (item->>'question_id')::uuid,
           case when q.answer_type = 'text' then trim(item->>'value') else null end,
           case when q.answer_type = 'scale_0_4' then (item->>'value')::numeric else null end,
           p_expected_revision + 1
      from jsonb_array_elements(p_answers) item
      join public.questions q
        on q.id = (item->>'question_id')::uuid
       and q.version_id = v_diagnostic.version_id
       and q.is_active
     where not ((item->'value') is null
             or jsonb_typeof(item->'value') = 'null'
             or (jsonb_typeof(item->'value') = 'string' and item->>'value' = ''))
    on conflict (diagnostic_id, question_id) do update set
      version_id = excluded.version_id,
      text_value = excluded.text_value,
      numeric_value = excluded.numeric_value,
      revision = excluded.revision;
  end if;

  insert into public.diagnostic_mutations (diagnostic_id, mutation_id, resulting_revision)
  values (p_diagnostic_id, p_mutation_id, p_expected_revision + 1);

  revision := p_expected_revision + 1;
  current_block_id := p_current_block_id;
  return next;
exception
  when unique_violation then
    -- A concurrent replay can only race on the idempotency key. The row lock
    -- normally prevents this; expose the normal conflict contract if it does.
    raise exception 'conflict';
end;
$$;

revoke all on function public.save_diagnostic_block(uuid, integer, uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_diagnostic_block(uuid, integer, uuid, uuid, jsonb, boolean) to authenticated;
