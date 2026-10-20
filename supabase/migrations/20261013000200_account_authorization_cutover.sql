-- Phase B: apply only with the account-aware application ready. No historical
-- row rewrite: replace authority policies, validate linkage, then remove the
-- obsolete one-company-per-human constraint. Methodology content is untouched.
begin;
lock table public.company_profiles, public.diagnostics in share row exclusive mode;

select private.backfill_legacy_accounts();
alter table public.company_profiles validate constraint company_profiles_account_id_fkey;
alter table public.company_profiles alter column account_id set not null;
alter table public.company_profiles drop constraint company_profiles_owner_user_id_key;

-- Permissive policies combine with OR. Replace, never retain, legacy authority.
drop policy "owners read company profiles" on public.company_profiles;
drop policy "owners create company profiles" on public.company_profiles;
drop policy "owners update company profiles" on public.company_profiles;
create policy company_accounts_read on public.company_profiles for select to authenticated
  using (private.can_access_account(account_id));
create policy company_accounts_create on public.company_profiles for insert to authenticated
  with check (private.can_access_account(account_id) and owner_user_id=(select auth.uid()));
create policy company_accounts_update on public.company_profiles for update to authenticated
  using (private.can_access_account(account_id)) with check (private.can_access_account(account_id));

drop policy diagnostics_owner_read on public.diagnostics;
drop policy diagnostics_owner_create on public.diagnostics;
drop policy diagnostics_owner_update on public.diagnostics;
create policy diagnostics_account_read on public.diagnostics for select to authenticated
  using (private.can_access_company(company_id));
create policy diagnostics_account_create on public.diagnostics for insert to authenticated
  with check (private.can_access_company(company_id) and created_by_user_id=(select auth.uid())
    and exists(select 1 from public.diagnostic_versions v where v.id=version_id and v.status='published'));
create policy diagnostics_account_update on public.diagnostics for update to authenticated
  using (private.can_access_company(company_id) and status='in_progress')
  with check (private.can_access_company(company_id) and status='in_progress');

drop policy answers_owner_read on public.answers;
drop policy answers_owner_create on public.answers;
drop policy answers_owner_update on public.answers;
drop policy answers_owner_delete on public.answers;
create policy answers_account_read on public.answers for select to authenticated
  using (private.can_access_diagnostic(diagnostic_id));
create policy answers_account_create on public.answers for insert to authenticated
  with check (exists(select 1 from public.diagnostics d where d.id=diagnostic_id
    and private.can_access_company(d.company_id) and d.status='in_progress'));
create policy answers_account_update on public.answers for update to authenticated
  using (exists(select 1 from public.diagnostics d where d.id=diagnostic_id
    and private.can_access_company(d.company_id) and d.status='in_progress'))
  with check (exists(select 1 from public.diagnostics d where d.id=diagnostic_id
    and private.can_access_company(d.company_id) and d.status='in_progress'));
create policy answers_account_delete on public.answers for delete to authenticated
  using (exists(select 1 from public.diagnostics d where d.id=diagnostic_id
    and private.can_access_company(d.company_id) and d.status='in_progress'));

drop policy mutations_owner_read on public.diagnostic_mutations;
drop policy mutations_owner_create on public.diagnostic_mutations;
create policy mutations_account_read on public.diagnostic_mutations for select to authenticated
  using (private.can_access_diagnostic(diagnostic_id));
create policy mutations_account_create on public.diagnostic_mutations for insert to authenticated
  with check (exists(select 1 from public.diagnostics d where d.id=diagnostic_id
    and private.can_access_company(d.company_id) and d.status='in_progress'));

drop policy snapshots_owner_read on public.diagnostic_company_snapshots;
drop policy results_owner_read on public.diagnostic_results;
drop policy block_results_owner_read on public.diagnostic_block_results;
create policy snapshots_account_read on public.diagnostic_company_snapshots for select to authenticated
  using (private.can_access_diagnostic(diagnostic_id));
create policy results_account_read on public.diagnostic_results for select to authenticated
  using (private.can_access_diagnostic(diagnostic_id));
create policy block_results_account_read on public.diagnostic_block_results for select to authenticated
  using (exists(select 1 from public.diagnostic_results r where r.id=result_id
    and private.can_access_diagnostic(r.diagnostic_id)));

drop policy ai_reports_owner_read on public.ai_reports;
drop policy report_artifacts_owner_read on public.report_artifacts;
create policy ai_reports_account_read on public.ai_reports for select to authenticated
  using (private.can_access_diagnostic(diagnostic_id));
create policy report_artifacts_account_read on public.report_artifacts for select to authenticated
  using (exists(select 1 from public.ai_reports r where r.id=report_id
    and private.can_access_diagnostic(r.diagnostic_id)));

-- Delivery/lead/feedback rows retain their original requester identity/privacy.
-- Current account permission is also required; provenance is not an authority.
drop policy email_deliveries_owner_read on public.email_deliveries;
create policy email_deliveries_requester_read on public.email_deliveries for select to authenticated
  using (user_id=(select auth.uid()) and private.can_access_diagnostic(diagnostic_id));
drop policy lead_requests_owner_read on public.lead_requests;
drop policy lead_requests_owner_create on public.lead_requests;
create policy lead_requests_requester_read on public.lead_requests for select to authenticated
  using (user_id=(select auth.uid()) and private.can_access_company(company_id));
create policy lead_requests_account_create on public.lead_requests for insert to authenticated
  with check (user_id=(select auth.uid()) and private.can_access_company(company_id) and status='new'
    and exists(select 1 from public.diagnostics d where d.id=diagnostic_id and d.company_id=company_id and d.status='completed')
    and exists(select 1 from public.ai_reports r where r.id=report_id and r.diagnostic_id=diagnostic_id and r.status='completed'));
drop policy consultation_delivery_owner_read on public.consultation_notification_deliveries;
create policy consultation_delivery_requester_read on public.consultation_notification_deliveries for select to authenticated
  using (exists(select 1 from public.lead_requests l where l.id=lead_request_id
    and l.user_id=(select auth.uid()) and private.can_access_company(l.company_id)));
drop policy feedback_owner_read on public.feedback;
create policy feedback_requester_read on public.feedback for select to authenticated
  using (user_id=(select auth.uid()) and private.can_access_company(company_id));

-- Pinned retired methodology remains accessible through the same account chain.
-- This changes access functions only, never version/child contents or ledger.
create or replace function private.can_read_diagnostic_version(p_version_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.diagnostics d where d.version_id=p_version_id
    and private.can_access_company(d.company_id));
$$;
create or replace function private.can_read_diagnostic_definition(p_definition_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.diagnostic_versions v
    where v.definition_id=p_definition_id and v.status='published')
    or exists(select 1 from public.diagnostic_versions v join public.diagnostics d on d.version_id=v.id
      where v.definition_id=p_definition_id and private.can_access_company(d.company_id));
$$;

-- Existing RPC contracts retained; authorize current account, not creator.
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
     and private.can_access_company(d.company_id)
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

create or replace function public.submit_diagnostic(p_diagnostic_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.diagnostics%rowtype; missing jsonb; j public.jobs%rowtype;
begin
  select * into d from public.diagnostics where id = p_diagnostic_id and private.can_access_company(company_id) for update;
  if d.id is null then raise exception 'not_found'; end if;
  if d.status <> 'in_progress' then
    select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default';
    return jsonb_build_object('ok', true, 'status', d.status, 'job_id', j.id);
  end if;
  if d.revision <> p_expected_revision then raise exception 'conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.id, 'block_id', q.block_id, 'position', q.position)), '[]'::jsonb) into missing
  from public.questions q left join public.answers a on a.diagnostic_id = d.id and a.question_id = q.id
  where q.version_id = d.version_id and q.is_active and q.is_required
    and ((q.answer_type = 'scale_0_4' and a.numeric_value is null) or (q.answer_type = 'text' and nullif(btrim(a.text_value), '') is null));
  if jsonb_array_length(missing) > 0 then return jsonb_build_object('ok', false, 'missing', missing, 'status', d.status); end if;
  insert into public.diagnostic_company_snapshots(diagnostic_id, company_id, profile_revision, profile_data)
    select d.id, c.id, c.revision, to_jsonb(c) from public.company_profiles c where c.id = d.company_id on conflict do nothing;
  update public.diagnostics set status = 'submitted', submitted_at = now(), revision = revision + 1 where id = d.id and status = 'in_progress' and revision = p_expected_revision;
  insert into public.jobs(kind, diagnostic_id, deduplication_key) values ('score_diagnostic', d.id, 'default')
    on conflict (kind, diagnostic_id, deduplication_key) do nothing returning * into j;
  if j.id is null then select * into j from public.jobs where kind = 'score_diagnostic' and diagnostic_id = d.id and deduplication_key = 'default'; end if;
  return jsonb_build_object('ok', true, 'status', 'submitted', 'job_id', j.id);
end; $$;

create or replace function public.create_lead_request(
  p_diagnostic_id uuid, p_report_id uuid, p_name text, p_contact_type text,
  p_contact_value text, p_comment text, p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = public, private as $$
declare actor uuid := (select auth.uid()); u public.users%rowtype; d public.diagnostics%rowtype; r public.ai_reports%rowtype; existing public.lead_requests%rowtype; lead public.lead_requests%rowtype; j public.jobs%rowtype;
begin
  if actor is null then raise exception 'unauthorized'; end if;
  select * into u from public.users where id=actor;
  if u.id is null then raise exception 'user_not_found'; end if;
  if not exists (select 1 from auth.users au where au.id=actor and au.email_confirmed_at is not null) then raise exception 'email_not_verified'; end if;
  if char_length(btrim(coalesce(p_name,''))) < 2 or char_length(btrim(coalesce(p_name,''))) > 100 then raise exception 'invalid_name'; end if;
  if p_contact_type is not null and p_contact_type not in ('phone','telegram') then raise exception 'invalid_contact_type'; end if;
  if (p_contact_type is null) <> (nullif(btrim(coalesce(p_contact_value,'')),'') is null) then raise exception 'contact_pair_required'; end if;
  if p_contact_type='phone' and (btrim(p_contact_value) !~ '^\+?[0-9 ()-]{7,25}$' or regexp_replace(p_contact_value,'[^0-9]','','g') !~ '^[0-9]{7,15}$') then raise exception 'invalid_phone'; end if;
  if p_contact_type='telegram' and btrim(p_contact_value) !~* '^(https?://)?(www\.)?t\.me/|^@?[A-Za-z0-9_]{5,32}$' then raise exception 'invalid_telegram'; end if;
  if p_comment is not null and char_length(p_comment) > 3000 then raise exception 'invalid_comment'; end if;
  select * into d from public.diagnostics where id=p_diagnostic_id and private.can_access_company(company_id) and status='completed';
  if d.id is null then raise exception 'diagnostic_not_owned_or_completed'; end if;
  select * into r from public.ai_reports where id=p_report_id and diagnostic_id=d.id and status='completed';
  if r.id is null then raise exception 'report_not_owned_or_completed'; end if;
  select * into existing from public.lead_requests where user_id=actor and idempotency_key=p_idempotency_key;
  if existing.id is not null then
    if not private.can_access_company(existing.company_id) then raise exception 'diagnostic_not_owned_or_completed'; end if;
    return jsonb_build_object('ok',true,'duplicate',false,'lead_id',existing.id,'status',existing.status);
  end if;
  select * into existing from public.lead_requests where user_id=actor and report_id=r.id and status in ('new','contacted','consultation_scheduled');
  if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status); end if;
  insert into public.lead_requests(user_id,company_id,diagnostic_id,report_id,name,email,contact_type,contact_value,comment,idempotency_key)
    select actor,d.company_id,d.id,r.id,btrim(p_name),(select email from auth.users where id=actor),p_contact_type,
      case when p_contact_type='phone' then regexp_replace(btrim(p_contact_value),'[() -]','','g') when p_contact_type='telegram' then regexp_replace(regexp_replace(regexp_replace(lower(btrim(p_contact_value)),'^https?://',''),'^www\.',''),'^t\.me/','') end,
      nullif(btrim(p_comment),''),p_idempotency_key returning * into lead;
  insert into public.jobs(kind,diagnostic_id,deduplication_key) values ('consultation_notification',lead.diagnostic_id,'lead:'||lead.id::text) returning * into j;
  insert into public.consultation_notification_deliveries(lead_request_id,job_id) values (lead.id,j.id);
  return jsonb_build_object('ok',true,'duplicate',false,'lead_id',lead.id,'status',lead.status);
exception when unique_violation then
  select * into existing from public.lead_requests where user_id=actor and report_id=p_report_id and status in ('new','contacted','consultation_scheduled');
  if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status); end if;
  raise;
end; $$;

-- Preserve the V1 feedback creator-consistency FK and requester semantics.
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
  select * into d from public.diagnostics where id = p_diagnostic_id and created_by_user_id = actor and private.can_access_company(company_id) and status = 'completed';
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

revoke all on function public.save_diagnostic_block(uuid,integer,uuid,uuid,jsonb,boolean),
  public.submit_diagnostic(uuid,integer),
  public.create_lead_request(uuid,uuid,text,text,text,text,uuid),
  public.create_feedback(uuid,integer,text,text) from public, anon;
grant execute on function public.save_diagnostic_block(uuid,integer,uuid,uuid,jsonb,boolean),
  public.submit_diagnostic(uuid,integer),
  public.create_lead_request(uuid,uuid,text,text,text,text,uuid),
  public.create_feedback(uuid,integer,text,text) to authenticated;
set constraints all immediate;
commit;
