-- V2.3: Account commercial state. No payment integration or historical resource rewrite.
begin;
lock table public.accounts in share row exclusive mode;

create table public.plans (
 id uuid primary key default gen_random_uuid(), key text not null unique check(key in('free','advanced')),
 display_name text not null, status text not null default 'active' check(status in('active','archived')),
 sort_order integer not null, created_at timestamptz not null default now()
);
create table private.entitlement_definitions (
 key text primary key check(key in('multi_company','team_diagnostics')),
 value_type text not null check(value_type='boolean'), description text not null,
 created_at timestamptz not null default now()
);
create table private.plan_entitlements (
 plan_id uuid not null references public.plans(id),
 entitlement_key text not null references private.entitlement_definitions(key),
 enabled boolean not null, primary key(plan_id,entitlement_key)
);
create table private.account_subscriptions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.accounts(id),
 plan_id uuid not null references public.plans(id),
 status text not null check(status in('active','ended')),
 source text not null check(source in('system_default','manual','provider')),
 provider_key text, provider_customer_ref text, provider_subscription_ref text,
 effective_from timestamptz not null, effective_until timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(effective_until is null or effective_until>=effective_from),
 check(status<>'ended' or effective_until is not null),
 check(source='provider' or (provider_key is null and provider_customer_ref is null and provider_subscription_ref is null))
);
create unique index account_subscriptions_one_active on private.account_subscriptions(account_id) where status='active';
create index account_subscriptions_history on private.account_subscriptions(account_id,effective_from,id);

insert into public.plans(key,display_name,sort_order) values('free','Free',0),('advanced','Advanced',1);
insert into private.entitlement_definitions(key,value_type,description) values
 ('multi_company','boolean','Создание дополнительных компаний в Account'),
 ('team_diagnostics','boolean','Создание командных диагностик и новых участников');
insert into private.plan_entitlements(plan_id,entitlement_key,enabled)
 select p.id,e.key,p.key='advanced' from public.plans p cross join private.entitlement_definitions e;

alter table public.plans enable row level security;
alter table private.entitlement_definitions enable row level security;
alter table private.plan_entitlements enable row level security;
alter table private.account_subscriptions enable row level security;
revoke all on public.plans,private.entitlement_definitions,private.plan_entitlements,private.account_subscriptions from public,anon,authenticated;
grant select on public.plans to authenticated;
create policy plans_catalog_read on public.plans for select to authenticated using(status='active');

create function private.default_account_plan() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 select new.id,id,'active','system_default',clock_timestamp() from public.plans where key='free' and status='active';
 if not found then raise exception 'free_plan_missing'; end if;
 return new;
end; $$;
create trigger accounts_default_free after insert on public.accounts for each row execute function private.default_account_plan();
insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 select a.id,p.id,'active','system_default',clock_timestamp() from public.accounts a cross join public.plans p where p.key='free';

-- VOLATILE is deliberate: gates read a fresh SPI snapshot after waiting for the
-- Account row lock, including a concurrently committed downgrade/company insert.
create function private.effective_account_plan(p_account_id uuid) returns text
language sql volatile security definer set search_path='' as $$
 select case when count(*)=1 and min(p.key)='advanced' then 'advanced' else 'free' end
 from private.account_subscriptions s join public.plans p on p.id=s.plan_id and p.status='active'
 join public.accounts a on a.id=s.account_id and a.status='active'
 where s.account_id=p_account_id and s.status='active' and s.effective_from<=clock_timestamp()
 and (s.effective_until is null or s.effective_until>clock_timestamp())
$$;
create function private.account_has_entitlement(p_account_id uuid,p_entitlement_key text) returns boolean
language sql volatile security definer set search_path='' as $$
 select coalesce((select e.enabled from private.plan_entitlements e
 join private.entitlement_definitions d on d.key=e.entitlement_key and d.value_type='boolean'
 join public.plans p on p.id=e.plan_id and p.status='active'
 where p.key=private.effective_account_plan(p_account_id) and e.entitlement_key=p_entitlement_key),false)
$$;
create function public.read_account_plan(p_account_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k text; result jsonb;
begin
 if not private.can_access_account(p_account_id) then raise exception 'not_found'; end if;
 k:=private.effective_account_plan(p_account_id);
 select jsonb_build_object('plan',k,'display_name',case when k='advanced' then 'Advanced' else 'Free' end,
  'entitlements',jsonb_build_object(
   'multi_company',coalesce((select e.enabled from private.plan_entitlements e join public.plans p on p.id=e.plan_id where p.key=k and e.entitlement_key='multi_company'),false),
   'team_diagnostics',coalesce((select e.enabled from private.plan_entitlements e join public.plans p on p.id=e.plan_id where p.key=k and e.entitlement_key='team_diagnostics'),false))) into result;
 return result;
end; $$;

create function private.subscription_history_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'subscription_history_immutable'; end if;
 if old.status<>'active' or new.status<>'ended' or new.effective_until is null
 or (to_jsonb(new)-'status'-'effective_until'-'updated_at') is distinct from (to_jsonb(old)-'status'-'effective_until'-'updated_at') then
  raise exception 'subscription_history_immutable'; end if;
 new.updated_at:=clock_timestamp(); return new;
end; $$;
create trigger account_subscription_history before update or delete on private.account_subscriptions
 for each row execute function private.subscription_history_guard();

create function public.assign_account_plan(p_account_id uuid,p_plan_key text) returns uuid
language plpgsql security definer set search_path='' as $$
declare pid uuid; sid uuid; at_time timestamptz;
begin
 if current_setting('role',true)<>'service_role' or coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'forbidden'; end if;
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found then raise exception 'not_found'; end if;
 select id into pid from public.plans where key=p_plan_key and status='active';
 if pid is null then raise exception 'invalid_plan'; end if;
 at_time:=clock_timestamp();
 update private.account_subscriptions set status='ended',effective_until=at_time where account_id=p_account_id and status='active';
 insert into private.account_subscriptions(account_id,plan_id,status,source,effective_from)
 values(p_account_id,pid,'active','manual',at_time) returning id into sid;
 return sid;
end; $$;

create function private.require_account_entitlement(p_account_id uuid,p_key text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.accounts where id=p_account_id and status='active' for update;
 if not found then raise exception 'not_found'; end if;
 if not private.account_has_entitlement(p_account_id,p_key) then raise exception 'advanced_required'; end if;
end; $$;
create function private.company_entitlement_gate() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.jwt()->>'role'='authenticated' and not private.can_access_account(new.account_id) then raise exception 'not_found'; end if;
 perform 1 from public.accounts where id=new.account_id and status='active' for update;
 if not found then raise exception 'not_found'; end if;
 if exists(select 1 from public.company_profiles where account_id=new.account_id)
 and not private.account_has_entitlement(new.account_id,'multi_company') then raise exception 'advanced_required'; end if;
 return new;
end; $$;
-- Alphabetically after company_profiles_assign_account (legacy nullable payload).
create trigger company_profiles_billing_gate before insert on public.company_profiles
 for each row execute function private.company_entitlement_gate();

revoke all on function private.default_account_plan(),private.effective_account_plan(uuid),
 private.account_has_entitlement(uuid,text),private.subscription_history_guard(),
 private.require_account_entitlement(uuid,text),private.company_entitlement_gate() from public,anon,authenticated;
revoke all on function public.read_account_plan(uuid) from public,anon;
grant execute on function public.read_account_plan(uuid) to authenticated;
revoke all on function public.assign_account_plan(uuid,text) from public,anon,authenticated;
grant execute on function public.assign_account_plan(uuid,text) to service_role;

-- Existing create/invite function bodies follow, with only the resource-creation
-- gate added. Renewal, participant consent/answers, workers, reports and RLS stay intact.

create or replace function public.create_team_diagnostic(p_company_id uuid,p_title text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid; t uuid; questionnaire jsonb;
begin
 if not private.can_access_company(p_company_id) then raise exception 'team_not_found'; end if;
 perform private.require_account_entitlement((select account_id from public.company_profiles where id=p_company_id),'team_diagnostics');
 if char_length(btrim(coalesce(p_title,''))) not between 2 and 200 then raise exception 'team_invalid_input'; end if;
 select dv.id into v from public.diagnostic_versions dv join public.diagnostic_definitions dd on dd.id=dv.definition_id
 where dd.key='manageability' and dv.status='published' order by dv.version_number desc limit 1;
 if v is null then raise exception 'team_methodology_missing'; end if;
 select jsonb_agg(jsonb_build_object('id',q.id,'block_id',b.id,'block_title',bt.title,'prompt',qt.prompt,
  'help',qt.help_text,'answer_type',q.answer_type,'required',q.is_required,
  'options',coalesce((select jsonb_agg(jsonb_build_object('value',o.score_value,'label',ot.label) order by o.position)
    from public.question_options o join public.question_option_translations ot on ot.option_id=o.id and ot.locale='ru' where o.question_id=q.id),'[]'::jsonb)) order by b.position,q.position)
 into questionnaire from public.questions q join public.diagnostic_blocks b on b.id=q.block_id
 join public.diagnostic_block_translations bt on bt.block_id=b.id and bt.locale='ru'
 join public.question_translations qt on qt.question_id=q.id and qt.locale='ru'
 where q.version_id=v and q.is_active and b.is_active;
 if questionnaire is null or jsonb_array_length(questionnaire)=0 then raise exception 'team_methodology_missing'; end if;
 insert into public.team_diagnostics(company_id,version_id,created_by_user_id,title) values(p_company_id,v,auth.uid(),btrim(p_title)) returning id into t;
 insert into private.team_questionnaires(team_diagnostic_id,questions) values(t,questionnaire);
 perform private.team_snapshot(t);
 -- Owner is deliberately not auto-enrolled.
 return t;
end; $$;
create or replace function public.invite_team_participant(p_team_id uuid,p_email text,p_display_name text,p_token_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.team_diagnostics%rowtype; pid uuid; mail text:=lower(btrim(coalesce(p_email,'')));
begin
 select * into t from public.team_diagnostics where id=p_team_id for update;
 if t.id is null or not private.can_access_company(t.company_id) then raise exception 'team_not_found'; end if;
 if t.status<>'open' then raise exception 'team_closed'; end if;
 if mail !~ '^[^[:space:]@,;<>]+@[^[:space:]@,;<>]+\.[^[:space:]@,;<>]+$' or char_length(mail)>254
   or char_length(btrim(coalesce(p_display_name,''))) not between 1 and 100 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'team_invalid_input'; end if;
 if exists(select 1 from public.team_participants where team_diagnostic_id=t.id and email=mail) then raise exception 'team_already_invited'; end if;
 if (select count(*) from public.team_participants where team_diagnostic_id=t.id)>=100 then raise exception 'team_participant_limit'; end if;
 perform private.require_account_entitlement((select account_id from public.company_profiles where id=t.company_id),'team_diagnostics');
 insert into public.team_participants(team_diagnostic_id,email,display_name) values(t.id,mail,btrim(p_display_name)) returning id into pid;
 insert into private.team_invitations(participant_id,token_hash,expires_at) values(pid,p_token_hash,now()+interval '7 days');
 return pid;
end; $$;
commit;
