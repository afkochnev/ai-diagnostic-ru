-- Retire the invalid historical manageability v3 without rewriting any content.
-- Requires 20261012000000_allow_methodology_retirement.sql. Run only through the
-- separately approved reconciliation procedure; this stage does not apply it.
begin;

-- A row lock alone does not prevent a concurrent new published version insert.
-- This brief operator migration lock keeps the final selection assertion stable.
lock table public.diagnostic_versions in share row exclusive mode;

do $$
declare
  v_definition uuid;
  v_v3 public.diagnostic_versions%rowtype;
  v_v4 public.diagnostic_versions%rowtype;
  v_current uuid;
begin
  select id into v_definition
    from public.diagnostic_definitions where key = 'manageability';
  if v_definition is null then
    raise exception 'manageability definition missing';
  end if;

  -- Serialize lifecycle changes while checking the current selection invariant.
  perform id from public.diagnostic_versions
    where definition_id = v_definition order by version_number for update;
  select * into v_v3 from public.diagnostic_versions
    where definition_id = v_definition and version_number = 3;
  if v_v3.id is null then
    raise exception 'manageability version 3 missing; reconciliation requires investigation';
  end if;
  if v_v3.status not in ('published', 'retired') then
    raise exception 'manageability version 3 must be published or retired, got %', v_v3.status;
  end if;

  select * into v_v4 from public.diagnostic_versions
    where definition_id = v_definition and version_number = 4;
  if v_v4.id is null or v_v4.status <> 'published' then
    raise exception 'published manageability version 4 missing';
  end if;
  if (select count(*) from public.diagnostic_blocks where version_id = v_v4.id) <> 10 then
    raise exception 'manageability version 4 total blocks expected 10';
  end if;
  if (select count(*) from public.diagnostic_blocks where version_id = v_v4.id and weight > 0) <> 8 then
    raise exception 'manageability version 4 scoring blocks expected 8';
  end if;
  if (select count(*) from public.diagnostic_blocks where version_id = v_v4.id and weight > 0 and is_active) <> 8 then
    raise exception 'manageability version 4 active scoring blocks expected 8';
  end if;
  if (select count(*) from public.questions where version_id = v_v4.id) <> 84 then
    raise exception 'manageability version 4 total questions expected 84';
  end if;
  if (select count(*) from public.questions q
      join public.diagnostic_blocks b on b.id = q.block_id and b.version_id = q.version_id
      where q.version_id = v_v4.id and q.weight > 0 and b.weight > 0) <> 80 then
    raise exception 'manageability version 4 scoring questions expected 80';
  end if;
  if (select count(*) from public.questions q
      join public.diagnostic_blocks b on b.id = q.block_id and b.version_id = q.version_id
      where q.version_id = v_v4.id and q.weight > 0 and b.weight > 0
        and q.is_active and b.is_active and q.answer_type = 'scale_0_4') <> 80 then
    raise exception 'manageability version 4 active numeric scoring questions expected 80';
  end if;
  if (select count(*) from public.scoring_policies where version_id = v_v4.id) <> 1 then
    raise exception 'manageability version 4 scoring policies expected 1';
  end if;
  if (select count(*) from public.maturity_levels where version_id = v_v4.id) <> 5 then
    raise exception 'manageability version 4 maturity levels expected 5';
  end if;

  update public.diagnostic_versions set status = 'retired'
    where id = v_v3.id and status = 'published';

  if not exists (
    select 1 from public.diagnostic_versions v
    where v.id = v_v3.id and v.status = 'retired'
      and (to_jsonb(v) - 'status') = (to_jsonb(v_v3) - 'status')
  ) then
    raise exception 'version 3 retirement changed historical metadata';
  end if;

  -- Mirrors selectCurrentPublishedVersion: definition-scoped, published-only,
  -- highest version number. A later/unexpected publication fails atomically.
  select id into v_current from public.diagnostic_versions
    where definition_id = v_definition and status = 'published'
    order by version_number desc limit 1;
  if v_current is distinct from v_v4.id then
    raise exception 'current published manageability selection must be version 4';
  end if;
end;
$$;

commit;
