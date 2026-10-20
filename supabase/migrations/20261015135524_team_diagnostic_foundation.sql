-- V2.2A: additive team foundation. Does not alter individual diagnostics/answers,
-- account roles, methodology RLS, worker jobs, AI, billing or report data.
begin;

create table public.team_diagnostics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company_profiles(id) on delete restrict,
  version_id uuid not null references public.diagnostic_versions(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);
create index team_diagnostics_company_idx on public.team_diagnostics(company_id,created_at desc);
create table public.team_participants (
  id uuid primary key default gen_random_uuid(),
  team_diagnostic_id uuid not null references public.team_diagnostics(id) on delete restrict,
  email text not null check (email=lower(btrim(email)) and char_length(email)<=254),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  status text not null default 'invited' check (status in ('invited','started','completed')),
  invited_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  unique(team_diagnostic_id,email)
);
create index team_participants_team_idx on public.team_participants(team_diagnostic_id);
-- The owner-readable metadata has no answers, tokens or bound user identifiers.
create table private.team_questionnaires (
  team_diagnostic_id uuid primary key references public.team_diagnostics(id) on delete restrict,
  questions jsonb not null check (jsonb_typeof(questions)='array')
);
create table private.team_invitations (
  participant_id uuid primary key references public.team_participants(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  redeemed_at timestamptz
);
create table private.team_responses (
  participant_id uuid primary key references public.team_participants(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  revision integer not null default 0 check (revision>=0),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers)='object'),
  completed_at timestamptz
);
create index team_responses_user_idx on private.team_responses(user_id,participant_id);
-- No direct table access, even for an authenticated company owner/global admin.
-- Participant RPCs below are the only answer API and check the current actor.
alter table public.team_diagnostics enable row level security;
alter table public.team_participants enable row level security;
alter table private.team_questionnaires enable row level security;
alter table private.team_invitations enable row level security;
alter table private.team_responses enable row level security;
revoke all on public.team_diagnostics,public.team_participants,
 private.team_questionnaires,private.team_invitations,private.team_responses from public,anon,authenticated;
grant select on public.team_diagnostics,public.team_participants to authenticated;
create policy team_owner_read on public.team_diagnostics for select to authenticated
 using (private.can_access_company(company_id));
create policy team_participants_owner_read on public.team_participants for select to authenticated
 using (exists(select 1 from public.team_diagnostics d where d.id=team_diagnostic_id and private.can_access_company(d.company_id)));

create function public.create_team_diagnostic(p_company_id uuid,p_title text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v uuid; t uuid; questionnaire jsonb;
begin
 if not private.can_access_company(p_company_id) then raise exception 'team_not_found'; end if;
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
 -- Owner is deliberately not auto-enrolled.
 return t;
end; $$;

create function public.invite_team_participant(p_team_id uuid,p_email text,p_display_name text,p_token_hash text) returns uuid
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
 insert into public.team_participants(team_diagnostic_id,email,display_name) values(t.id,mail,btrim(p_display_name)) returning id into pid;
 insert into private.team_invitations(participant_id,token_hash,expires_at) values(pid,p_token_hash,now()+interval '7 days');
 return pid;
end; $$;

create function public.renew_team_invitation(p_participant_id uuid,p_token_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 select * into p from public.team_participants where id=p_participant_id for update;
 if p.id is null or p.revoked_at is not null or not exists(select 1 from public.team_diagnostics d where d.id=p.team_diagnostic_id and d.status='open' and private.can_access_company(d.company_id)) then raise exception 'team_not_found'; end if;
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'team_invalid_input'; end if;
 update private.team_invitations set token_hash=p_token_hash,expires_at=now()+interval '7 days',redeemed_at=null where participant_id=p.id;
 -- Existing participant binding and all answers remain untouched.
end; $$;

create function public.revoke_team_participant(p_participant_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 select * into p from public.team_participants where id=p_participant_id for update;
 if p.id is null or not exists(select 1 from public.team_diagnostics d where d.id=p.team_diagnostic_id and private.can_access_company(d.company_id)) then raise exception 'team_not_found'; end if;
 update public.team_participants set revoked_at=coalesce(revoked_at,now()) where id=p.id;
end; $$;

create function public.accept_team_invitation(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.team_participants%rowtype; inv private.team_invitations%rowtype; actor uuid:=auth.uid();
begin
 if not private.is_verified_session() then raise exception 'team_invitation_unavailable'; end if;
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'team_invitation_unavailable'; end if;
 -- Lock order is participant then response for all response/revoke mutations.
 select tp.* into p from public.team_participants tp join private.team_invitations ti on ti.participant_id=tp.id
 where ti.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update of tp;
 if p.id is null or p.revoked_at is not null or not exists(select 1 from auth.users u where u.id=actor and lower(u.email)=p.email and u.email_confirmed_at is not null)
 or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id where d.id=p.team_diagnostic_id and d.status='open' and a.status='active') then raise exception 'team_invitation_unavailable'; end if;
 select * into inv from private.team_invitations where participant_id=p.id;
 if inv.expires_at<=now() then raise exception 'team_invitation_unavailable'; end if;
 if exists(select 1 from private.team_responses where participant_id=p.id and user_id<>actor) then raise exception 'team_invitation_unavailable'; end if;
 insert into private.team_responses(participant_id,user_id) values(p.id,actor) on conflict(participant_id) do nothing;
 update private.team_invitations set redeemed_at=coalesce(redeemed_at,now()) where participant_id=p.id;
 return p.id;
end; $$;

create function private.require_team_response(p_participant_id uuid) returns public.team_participants
language plpgsql stable security definer set search_path='' as $$
declare p public.team_participants%rowtype;
begin
 select * into p from public.team_participants where id=p_participant_id;
 if not private.is_verified_session() or p.id is null or p.revoked_at is not null
 or not exists(select 1 from private.team_responses r join auth.users u on u.id=r.user_id where r.participant_id=p.id and r.user_id=auth.uid() and lower(u.email)=p.email and u.email_confirmed_at is not null)
 or not exists(select 1 from public.team_diagnostics d join public.company_profiles c on c.id=d.company_id join public.accounts a on a.id=c.account_id where d.id=p.team_diagnostic_id and d.status='open' and a.status='active') then raise exception 'team_response_unavailable'; end if;
 return p;
end; $$;

create function public.read_team_response(p_participant_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.team_participants; result jsonb;
begin
 p:=private.require_team_response(p_participant_id);
 select jsonb_build_object('participant_id',p.id,'display_name',p.display_name,'status',p.status,'revision',r.revision,'answers',r.answers,'questions',q.questions,'title',d.title)
 into result from private.team_responses r join public.team_diagnostics d on d.id=p.team_diagnostic_id join private.team_questionnaires q on q.team_diagnostic_id=d.id where r.participant_id=p.id;
 return result;
end; $$;

create function public.save_team_response(p_participant_id uuid,p_expected_revision integer,p_answers jsonb,p_submit boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.team_participants; r private.team_responses; qs jsonb; q jsonb; k text; val jsonb; next_revision integer;
begin
 perform 1 from public.team_participants where id=p_participant_id for update;
 p:=private.require_team_response(p_participant_id);
 select * into r from private.team_responses where participant_id=p.id for update;
 if r.revision is distinct from p_expected_revision then raise exception 'team_revision_conflict'; end if;
 if r.completed_at is not null then raise exception 'team_response_completed'; end if;
 if p_submit is null or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>1000000 then raise exception 'team_invalid_answers'; end if;
 select questions into qs from private.team_questionnaires where team_diagnostic_id=p.team_diagnostic_id;
 for k,val in select * from jsonb_each(p_answers) loop
  select item into q from jsonb_array_elements(qs) item where item->>'id'=k;
  if q is null then raise exception 'team_invalid_answers'; end if;
  if val<>'null'::jsonb then
   if q->>'answer_type'='scale_0_4' then
    if jsonb_typeof(val)<>'number' or not exists(select 1 from jsonb_array_elements(q->'options') o where o->'value'=val) then raise exception 'team_invalid_answers'; end if;
   elsif jsonb_typeof(val)<>'string' or char_length(val#>>'{}')>10000 then raise exception 'team_invalid_answers'; end if;
  end if;
 end loop;
 if p_submit and exists(select 1 from jsonb_array_elements(qs) item where (item->>'required')::boolean and
   (not(p_answers ? (item->>'id')) or p_answers->(item->>'id')='null'::jsonb or p_answers->(item->>'id')='""'::jsonb)) then raise exception 'team_required_answers_missing'; end if;
 next_revision:=r.revision+1;
 update private.team_responses set answers=p_answers,revision=next_revision,completed_at=case when p_submit then now() end where participant_id=p.id;
 update public.team_participants set status=case when p_submit then 'completed' else 'started' end,started_at=coalesce(started_at,now()),completed_at=case when p_submit then now() end where id=p.id;
 -- No score, report, AI, mail or individual diagnostic job is enqueued.
 return jsonb_build_object('revision',next_revision,'status',case when p_submit then 'completed' else 'started' end);
end; $$;

revoke all on function private.require_team_response(uuid) from public,anon,authenticated;
revoke all on function public.create_team_diagnostic(uuid,text),public.invite_team_participant(uuid,text,text,text),public.revoke_team_participant(uuid),public.renew_team_invitation(uuid,text),
 public.accept_team_invitation(text),public.read_team_response(uuid),public.save_team_response(uuid,integer,jsonb,boolean) from public,anon;
grant execute on function public.create_team_diagnostic(uuid,text),public.invite_team_participant(uuid,text,text,text),public.revoke_team_participant(uuid),public.renew_team_invitation(uuid,text),
 public.accept_team_invitation(text),public.read_team_response(uuid),public.save_team_response(uuid,integer,jsonb,boolean) to authenticated;
commit;
