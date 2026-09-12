create table public.diagnostic_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_]+$'),
  created_at timestamptz not null default now()
);
create table public.diagnostic_versions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.diagnostic_definitions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null check (status in ('draft','published','retired')),
  content_hash text not null,
  source_file text not null,
  published_at timestamptz,
  unique (definition_id, version_number)
);
create table public.diagnostic_version_translations (
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  locale text not null,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  primary key (version_id, locale)
);
create table public.diagnostic_blocks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  position integer not null check (position > 0),
  weight numeric not null check (weight >= 0),
  is_active boolean not null default true,
  unique (version_id, key), unique (version_id, position), unique (id, version_id)
);
create table public.diagnostic_block_translations (
  block_id uuid not null references public.diagnostic_blocks(id) on delete restrict,
  locale text not null,
  title text not null check (char_length(btrim(title)) > 0),
  description text,
  primary key (block_id, locale)
);
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  block_id uuid not null,
  key text not null check (key ~ '^[a-z0-9_]+$'),
  position integer not null check (position > 0),
  answer_type text not null check (answer_type in ('scale_0_4','text')),
  weight numeric not null check (weight >= 0),
  is_required boolean not null,
  is_active boolean not null default true,
  reverse_score boolean not null default false,
  legacy_ai_context_label text,
  legacy_bubble_unique_id text,
  unique (version_id, key), unique (block_id, position), unique (id, version_id),
  foreign key (block_id, version_id) references public.diagnostic_blocks(id, version_id) on delete restrict
);
create table public.question_translations (
  question_id uuid not null references public.questions(id) on delete restrict,
  locale text not null,
  prompt text not null check (char_length(btrim(prompt)) > 0),
  help_text text,
  primary key (question_id, locale)
);
create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete restrict,
  key text not null,
  position integer not null check (position > 0),
  score_value numeric not null check (score_value >= 0 and score_value <= 4),
  unique (question_id, key), unique (question_id, position)
);
create table public.question_option_translations (
  option_id uuid not null references public.question_options(id) on delete restrict,
  locale text not null,
  label text not null,
  primary key (option_id, locale)
);
create table public.scoring_policies (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique references public.diagnostic_versions(id) on delete restrict,
  engine_key text not null,
  engine_version text not null,
  schema_version text not null,
  configuration jsonb not null default '{}'::jsonb,
  policy_hash text not null
);
create table public.maturity_levels (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  key text not null,
  position integer not null check (position > 0),
  classification_config jsonb not null default '{}'::jsonb,
  unique (version_id, key), unique (version_id, position)
);
create table public.maturity_level_translations (
  maturity_level_id uuid not null references public.maturity_levels(id) on delete restrict,
  locale text not null,
  label text not null,
  description text,
  primary key (maturity_level_id, locale)
);

create index diagnostic_versions_definition_idx on public.diagnostic_versions(definition_id);
create index diagnostic_blocks_version_position_idx on public.diagnostic_blocks(version_id, position);
create index questions_version_block_position_idx on public.questions(version_id, block_id, position);

create or replace function private.reject_published_methodology_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare version_id uuid;
begin
  if tg_table_name in ('diagnostic_blocks','questions') then version_id := coalesce(new.version_id, old.version_id);
  elsif tg_table_name = 'diagnostic_block_translations' then select b.version_id into version_id from public.diagnostic_blocks b where b.id=coalesce(new.block_id,old.block_id);
  elsif tg_table_name = 'question_translations' then select q.version_id into version_id from public.questions q where q.id=coalesce(new.question_id,old.question_id);
  elsif tg_table_name = 'question_options' then select q.version_id into version_id from public.questions q join public.question_options o on o.question_id=q.id where o.id=coalesce(new.id,old.id);
  elsif tg_table_name = 'question_option_translations' then select q.version_id into version_id from public.questions q join public.question_options o on o.question_id=q.id where o.id=coalesce(new.option_id,old.option_id);
  end if;
  if exists (select 1 from public.diagnostic_versions v where v.id = version_id and v.status = 'published') then raise exception 'published methodology is immutable'; end if;
  return coalesce(new, old);
end;
$$;

create trigger diagnostic_blocks_immutable before update or delete on public.diagnostic_blocks for each row execute function private.reject_published_methodology_change();
create trigger diagnostic_block_translations_immutable before update or delete on public.diagnostic_block_translations for each row execute function private.reject_published_methodology_change();
create trigger questions_immutable before update or delete on public.questions for each row execute function private.reject_published_methodology_change();
create trigger question_translations_immutable before update or delete on public.question_translations for each row execute function private.reject_published_methodology_change();
create trigger question_options_immutable before update or delete on public.question_options for each row execute function private.reject_published_methodology_change();
create trigger question_option_translations_immutable before update or delete on public.question_option_translations for each row execute function private.reject_published_methodology_change();

create table public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  locale text not null default 'ru',
  status text not null default 'in_progress' check (status in ('in_progress','submitted','scoring','completed','scoring_failed')),
  current_block_id uuid,
  revision integer not null default 1 check (revision > 0),
  started_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  unique (id, version_id),
  foreign key (current_block_id, version_id) references public.diagnostic_blocks(id, version_id) on delete restrict
);
create unique index diagnostics_one_active_per_company_idx on public.diagnostics(company_id) where status = 'in_progress';
create index diagnostics_owner_status_idx on public.diagnostics(created_by_user_id, status);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete cascade,
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  question_id uuid not null,
  text_value text,
  numeric_value numeric,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (diagnostic_id, question_id),
  foreign key (diagnostic_id, version_id) references public.diagnostics(id, version_id) on delete cascade,
  foreign key (question_id, version_id) references public.questions(id, version_id) on delete restrict,
  check ((text_value is not null and numeric_value is null) or (text_value is null and numeric_value is not null)),
  check (numeric_value is null or (numeric_value >= 0 and numeric_value <= 4))
);
create index answers_diagnostic_idx on public.answers(diagnostic_id);

create table public.diagnostic_mutations (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete cascade,
  mutation_id uuid not null,
  resulting_revision integer not null,
  created_at timestamptz not null default now(),
  unique (diagnostic_id, mutation_id)
);

create or replace function private.guard_diagnostic_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.company_id <> old.company_id or new.created_by_user_id <> old.created_by_user_id or new.version_id <> old.version_id or new.status <> old.status or new.started_at <> old.started_at then
    raise exception 'diagnostic immutable fields cannot be changed';
  end if;
  new.last_saved_at := now();
  return new;
end;
$$;
create trigger diagnostics_guard before update on public.diagnostics for each row execute function private.guard_diagnostic_update();

create or replace function private.guard_answer_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare q_type text;
begin
  select answer_type into q_type from public.questions where id = new.question_id and version_id = new.version_id;
  if q_type is null then raise exception 'question does not belong to pinned methodology'; end if;
  if q_type = 'text' and (new.text_value is null or new.numeric_value is not null) then raise exception 'text answer has invalid shape'; end if;
  if q_type = 'scale_0_4' and (new.numeric_value is null or new.text_value is not null) then raise exception 'scale answer has invalid shape'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger answers_guard before insert or update on public.answers for each row execute function private.guard_answer_version();

alter table public.diagnostic_definitions enable row level security;
alter table public.diagnostic_versions enable row level security;
alter table public.diagnostic_version_translations enable row level security;
alter table public.diagnostic_blocks enable row level security;
alter table public.diagnostic_block_translations enable row level security;
alter table public.questions enable row level security;
alter table public.question_translations enable row level security;
alter table public.question_options enable row level security;
alter table public.question_option_translations enable row level security;
alter table public.scoring_policies enable row level security;
alter table public.maturity_levels enable row level security;
alter table public.maturity_level_translations enable row level security;

grant select on public.diagnostic_definitions, public.diagnostic_versions, public.diagnostic_version_translations, public.diagnostic_blocks, public.diagnostic_block_translations, public.questions, public.question_translations, public.question_options, public.question_option_translations, public.scoring_policies, public.maturity_levels, public.maturity_level_translations to authenticated;
create policy methodology_definitions_read on public.diagnostic_definitions for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.definition_id = id and v.status = 'published'));
create policy methodology_versions_read on public.diagnostic_versions for select to authenticated using (status = 'published' or exists (select 1 from public.diagnostics d where d.version_id = id and d.created_by_user_id = (select auth.uid())));
create policy methodology_version_translations_read on public.diagnostic_version_translations for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id = version_id and (v.status = 'published' or exists (select 1 from public.diagnostics d where d.version_id = v.id and d.created_by_user_id = (select auth.uid())))));
create policy methodology_blocks_read on public.diagnostic_blocks for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id = version_id and (v.status = 'published' or exists (select 1 from public.diagnostics d where d.version_id = v.id and d.created_by_user_id = (select auth.uid())))));
create policy methodology_block_translations_read on public.diagnostic_block_translations for select to authenticated using (exists (select 1 from public.diagnostic_blocks b join public.diagnostic_versions v on v.id=b.version_id where b.id=block_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_questions_read on public.questions for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id = version_id and (v.status = 'published' or exists (select 1 from public.diagnostics d where d.version_id = v.id and d.created_by_user_id = (select auth.uid())))));
create policy methodology_question_translations_read on public.question_translations for select to authenticated using (exists (select 1 from public.questions q join public.diagnostic_versions v on v.id=q.version_id where q.id=question_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_options_read on public.question_options for select to authenticated using (exists (select 1 from public.questions q join public.diagnostic_versions v on v.id=q.version_id where q.id=question_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_option_translations_read on public.question_option_translations for select to authenticated using (exists (select 1 from public.question_options o join public.questions q on q.id=o.question_id join public.diagnostic_versions v on v.id=q.version_id where o.id=option_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_scoring_read on public.scoring_policies for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_maturity_read on public.maturity_levels for select to authenticated using (exists (select 1 from public.diagnostic_versions v where v.id=version_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));
create policy methodology_maturity_translations_read on public.maturity_level_translations for select to authenticated using (exists (select 1 from public.maturity_levels m join public.diagnostic_versions v on v.id=m.version_id where m.id=maturity_level_id and (v.status='published' or exists (select 1 from public.diagnostics d where d.version_id=v.id and d.created_by_user_id=(select auth.uid())))));

alter table public.diagnostics enable row level security;
alter table public.answers enable row level security;
alter table public.diagnostic_mutations enable row level security;
grant select, insert, update on public.diagnostics to authenticated;
grant select, insert, update on public.answers to authenticated;
grant select, insert on public.diagnostic_mutations to authenticated;
create policy diagnostics_owner_read on public.diagnostics for select to authenticated using (created_by_user_id = (select auth.uid()));
create policy diagnostics_owner_create on public.diagnostics for insert to authenticated with check (created_by_user_id = (select auth.uid()) and exists (select 1 from public.company_profiles c where c.id=company_id and c.owner_user_id=(select auth.uid())) and exists (select 1 from public.diagnostic_versions v where v.id=version_id and v.status='published'));
create policy diagnostics_owner_update on public.diagnostics for update to authenticated using (created_by_user_id = (select auth.uid()) and status = 'in_progress') with check (created_by_user_id = (select auth.uid()) and status = 'in_progress');
create policy answers_owner_read on public.answers for select to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid())));
create policy answers_owner_create on public.answers for insert to authenticated with check (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid()) and d.status='in_progress'));
create policy answers_owner_update on public.answers for update to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid()) and d.status='in_progress')) with check (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid()) and d.status='in_progress'));
create policy mutations_owner_read on public.diagnostic_mutations for select to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid())));
create policy mutations_owner_create on public.diagnostic_mutations for insert to authenticated with check (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid()) and d.status='in_progress'));
