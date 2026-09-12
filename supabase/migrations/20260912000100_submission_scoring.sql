create table public.diagnostic_company_snapshots (
  diagnostic_id uuid primary key references public.diagnostics(id) on delete restrict,
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  profile_revision integer not null,
  profile_data jsonb not null,
  captured_at timestamptz not null default now()
);
create table public.diagnostic_results (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null unique references public.diagnostics(id) on delete restrict,
  version_id uuid not null,
  raw_manageability_index numeric(30,15) not null check (raw_manageability_index >= 0 and raw_manageability_index <= 100),
  display_manageability_index numeric(5,1) not null,
  maturity_level_id uuid references public.maturity_levels(id) on delete restrict,
  calculation_version text not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique (id, version_id),
  foreign key (diagnostic_id, version_id) references public.diagnostics(id, version_id) on delete restrict
);
create table public.diagnostic_block_results (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.diagnostic_results(id) on delete restrict,
  block_id uuid not null,
  version_id uuid not null,
  raw_score numeric(30,15) not null check (raw_score >= 0 and raw_score <= 100),
  display_score numeric(5,1) not null,
  question_count integer not null,
  created_at timestamptz not null default now(),
  unique (result_id, block_id),
  foreign key (block_id, version_id) references public.diagnostic_blocks(id, version_id) on delete restrict
);
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('score_diagnostic')),
  diagnostic_id uuid not null unique references public.diagnostics(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
create index jobs_claim_idx on public.jobs(status, available_at);

create or replace function private.reject_result_change() returns trigger language plpgsql security definer set search_path = '' as $$ begin raise exception 'diagnostic results are immutable'; end; $$;
create trigger diagnostic_results_immutable before update or delete on public.diagnostic_results for each row execute function private.reject_result_change();
create trigger diagnostic_block_results_immutable before update or delete on public.diagnostic_block_results for each row execute function private.reject_result_change();
create trigger diagnostic_snapshots_immutable before update or delete on public.diagnostic_company_snapshots for each row execute function private.reject_result_change();

alter table public.diagnostic_company_snapshots enable row level security;
alter table public.diagnostic_results enable row level security;
alter table public.diagnostic_block_results enable row level security;
alter table public.jobs enable row level security;
grant select on public.diagnostic_company_snapshots, public.diagnostic_results, public.diagnostic_block_results to authenticated;
create policy snapshots_owner_read on public.diagnostic_company_snapshots for select to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid())));
create policy results_owner_read on public.diagnostic_results for select to authenticated using (exists (select 1 from public.diagnostics d where d.id=diagnostic_id and d.created_by_user_id=(select auth.uid())));
create policy block_results_owner_read on public.diagnostic_block_results for select to authenticated using (exists (select 1 from public.diagnostic_results r join public.diagnostics d on d.id=r.diagnostic_id where r.id=result_id and d.created_by_user_id=(select auth.uid())));

create or replace function public.submit_diagnostic(p_diagnostic_id uuid, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare d public.diagnostics%rowtype; missing jsonb; j public.jobs%rowtype;
begin
  select * into d from public.diagnostics where id=p_diagnostic_id and created_by_user_id=(select auth.uid());
  if d.id is null then raise exception 'not_found'; end if;
  if d.status <> 'in_progress' then select * into j from public.jobs where diagnostic_id=d.id; return jsonb_build_object('ok',true,'status',d.status,'job_id',j.id); end if;
  if d.revision <> p_expected_revision then raise exception 'conflict'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id',q.id,'block_id',q.block_id,'position',q.position)), '[]'::jsonb) into missing
  from public.questions q left join public.answers a on a.diagnostic_id=d.id and a.question_id=q.id
  where q.version_id=d.version_id and q.is_active and q.is_required and ((q.answer_type='scale_0_4' and a.numeric_value is null) or (q.answer_type='text' and nullif(btrim(a.text_value),'') is null));
  if jsonb_array_length(missing) > 0 then return jsonb_build_object('ok',false,'missing',missing,'status',d.status); end if;
  insert into public.diagnostic_company_snapshots(diagnostic_id,company_id,profile_revision,profile_data) select d.id,c.id,c.revision,to_jsonb(c) from public.company_profiles c where c.id=d.company_id on conflict do nothing;
  update public.diagnostics set status='submitted', submitted_at=now(), revision=revision+1 where id=d.id and status='in_progress' and revision=p_expected_revision;
  insert into public.jobs(kind,diagnostic_id) values ('score_diagnostic',d.id) on conflict (diagnostic_id) do nothing returning * into j;
  if j.id is null then select * into j from public.jobs where diagnostic_id=d.id; end if;
  return jsonb_build_object('ok',true,'status','submitted','job_id',j.id);
end; $$;
grant execute on function public.submit_diagnostic(uuid,integer) to authenticated;

insert into public.maturity_levels(version_id,key,position,classification_config)
select v.id, x.key, x.position, x.config::jsonb from public.diagnostic_versions v cross join (values
 ('critical',1,'{"min":0,"max":30}'),('weak',2,'{"min":30,"max":50}'),('developing',3,'{"min":50,"max":70}'),('mature',4,'{"min":70,"max":85}'),('strong',5,'{"min":85,"max":101}')
) x(key,position,config) where v.version_number=1 and v.status='published' on conflict (version_id,key) do nothing;
insert into public.maturity_level_translations(maturity_level_id,locale,label) select m.id,'ru',x.label from public.maturity_levels m join (values ('critical','Критическая зона'),('weak','Слабая зона'),('developing','Зона развития'),('mature','Зрелая зона'),('strong','Сильная зона')) x(key,label) on x.key=m.key on conflict do nothing;
