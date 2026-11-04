-- Run after the normal migration chain in a disposable local/staging test database.
-- No hosted project credentials or business data are required.
begin;
do $$
declare v_version uuid;
begin
  select v.id into strict v_version from public.diagnostic_versions v
    join public.diagnostic_definitions d on d.id=v.definition_id
    where d.key='manageability' and v.version_number=4 and v.status='published';
  if (select count(*) from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_version and t.locale='en')<>84 then
    raise exception 'expected English text for all 84 existing questions';
  end if;
  if exists(select 1 from public.questions q left join public.question_translations t on t.question_id=q.id and t.locale='en' where q.version_id=v_version and q.is_active and (t.question_id is null or btrim(t.prompt)='')) then
    raise exception 'an active question has no English text';
  end if;
  if (select count(*) from public.questions q join public.diagnostic_blocks b on b.id=q.block_id join public.question_translations t on t.question_id=q.id and t.locale='en' where q.version_id=v_version and q.weight>0 and b.weight>0 and q.is_active and b.is_active)<>80 then
    raise exception 'English and Russian scoring question coverage differs';
  end if;
  if exists(select 1 from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_version and t.locale='en' and (t.prompt||coalesce(t.help_text,'')) ~ '[А-Яа-яЁё]') then
    raise exception 'English questions contain untranslated Russian text';
  end if;
  if (select count(*) from public.question_option_translations t join public.question_options o on o.id=t.option_id join public.questions q on q.id=o.question_id where q.version_id=v_version and t.locale='en' and t.label=o.position::text)<>400 then
    raise exception 'English options must preserve all original scale positions';
  end if;
  if (select count(*) from public.diagnostic_block_translations t join public.diagnostic_blocks b on b.id=t.block_id where b.version_id=v_version and t.locale='en')<>10
     or (select count(*) from public.maturity_level_translations t join public.maturity_levels m on m.id=t.maturity_level_id where m.version_id=v_version and t.locale='en')<>5 then
    raise exception 'English result labels are incomplete';
  end if;
  if (select count(*) from public.industry_translations where locale='en')<>16 then
    raise exception 'English industry list is incomplete';
  end if;
  if exists(select 1 from public.revenue_range_translations where locale='en' and name not like '%RUB%') then
    raise exception 'existing revenue ranges must retain their RUB currency';
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.users'::regclass and conname='users_locale_check' and pg_get_constraintdef(oid) like '%en%') then
    raise exception 'English presentation locale is not allowed for users';
  end if;
end $$;

-- Create a disposable verified owner through the existing identity provisioner.
-- Test the actual authenticated grants and RLS, not a superuser UPDATE.
do $$
declare v_user uuid:=gen_random_uuid(); v_company uuid:=gen_random_uuid(); v_diagnostic uuid:=gen_random_uuid(); v_version uuid;
begin
  select v.id into strict v_version from public.diagnostic_versions v
    join public.diagnostic_definitions d on d.id=v.definition_id
    where d.key='manageability' and v.version_number=4 and v.status='published';
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
    values(v_user,'english-locale-'||v_user||'@example.test',now(),
      jsonb_build_object('full_name','English locale test owner','data_processing_consent',true,'marketing_consent',false)
      || (select jsonb_object_agg(kind||'_version',version) from public.consent_documents));
  insert into public.company_profiles(id,account_id,owner_user_id,name,industry_key,products,employee_count,key_problems,main_goals)
    select v_company,a.id,v_user,'English locale test company','consulting','Test services',10,'Test constraints','Test goals'
    from public.accounts a where a.legacy_origin_user_id=v_user;
  insert into public.diagnostics(id,company_id,created_by_user_id,version_id,locale)
    values(v_diagnostic,v_company,v_user,v_version,'ru');
  perform set_config('test.english_locale_diagnostic',v_diagnostic::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated','aal','aal1')::text,true);
end $$;

set local role authenticated;
do $$
declare v_diagnostic uuid:=current_setting('test.english_locale_diagnostic')::uuid; v_updated uuid;
begin
  if current_user<>'authenticated' then raise exception 'test must use the authenticated database role'; end if;
  update public.diagnostics set locale=locale where id=v_diagnostic returning id into v_updated;
  if v_updated is distinct from v_diagnostic then raise exception 'owner no-op locale update must succeed'; end if;
  begin
    update public.diagnostics set locale='en' where id=v_diagnostic;
    raise exception 'owner changed the pinned assessment locale';
  exception when check_violation then
    if sqlerrm<>'diagnostic locale is immutable' then raise; end if;
  end;
  if (select locale from public.diagnostics where id=v_diagnostic)<>'ru' then raise exception 'original locale was changed'; end if;
end $$;
reset role;

-- A normal lifecycle change still works and frees the one-active-assessment slot.
update public.diagnostics set status='submitted' where id=current_setting('test.english_locale_diagnostic')::uuid;
set local role authenticated;
do $$
declare v_source public.diagnostics%rowtype; v_english uuid;
begin
  select * into strict v_source from public.diagnostics where id=current_setting('test.english_locale_diagnostic')::uuid;
  insert into public.diagnostics(company_id,created_by_user_id,version_id,locale)
    values(v_source.company_id,v_source.created_by_user_id,v_source.version_id,'en') returning id into v_english;
  if (select locale from public.diagnostics where id=v_english)<>'en' then raise exception 'owner cannot create an English assessment'; end if;
  begin
    insert into public.diagnostics(company_id,created_by_user_id,version_id,locale,status)
      values(v_source.company_id,v_source.created_by_user_id,v_source.version_id,'unsupported','submitted');
    raise exception 'unsupported assessment locale was accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;
rollback;
