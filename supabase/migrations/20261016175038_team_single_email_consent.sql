-- One mailed Supabase credential; pending Auth identity before personal consent.
-- LOCAL CANDIDATE: apply on staging only after explicit migration approval.
begin;
create table private.team_identity_reservations (
 email text primary key check (email=lower(email) and length(email)<=254),
 nonce_hash text not null unique check (nonce_hash ~ '^[a-f0-9]{64}$'),
 invitation_hash text not null check (invitation_hash ~ '^[a-f0-9]{64}$'),
 display_name text not null check (length(trim(display_name)) between 1 and 100),
 user_id uuid unique references auth.users(id) on delete restrict,
 expires_at timestamptz not null,
 finalized_at timestamptz,
 created_at timestamptz not null default now()
);
alter table private.team_identity_reservations enable row level security;
revoke all on private.team_identity_reservations from public,anon,authenticated,service_role;

-- Only the server, after the normal owner-authorized invitation RPC, can reserve.
-- Editable user metadata alone is never authority to defer provisioning.
create function public.reserve_team_invitation_identity(p_token_hash text,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target jsonb;
begin
 if (select auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'team_invitation_unavailable'; end if;
 if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$' then raise exception 'team_invitation_unavailable'; end if;
 target:=public.resolve_team_invitation_auth(p_token_hash);
 if (target->>'create_user')::boolean then
  insert into private.team_identity_reservations(email,nonce_hash,invitation_hash,display_name,expires_at)
   values(target->>'email',p_nonce_hash,p_token_hash,target->>'display_name',now()+interval '5 minutes')
   on conflict(email) do update set nonce_hash=excluded.nonce_hash,invitation_hash=excluded.invitation_hash,
    display_name=excluded.display_name,expires_at=excluded.expires_at where team_identity_reservations.user_id is null;
  if not found then raise exception 'team_invitation_unavailable'; end if;
 end if;
 return target;
end; $$;
revoke all on function public.reserve_team_invitation_identity(text,text) from public,anon,authenticated;
grant execute on function public.reserve_team_invitation_identity(text,text) to service_role;

create or replace function private.provision_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare doc record; consent jsonb; pending private.team_identity_reservations;
begin
 select * into pending from private.team_identity_reservations
 where email=lower(new.email) and user_id is null and expires_at>now()
  and nonce_hash=encode(sha256(convert_to(new.raw_user_meta_data->>'team_pending_nonce','UTF8')),'hex')
 for update;
 if pending.email is not null then
  if not exists(select 1 from private.team_invitations i join public.team_participants p on p.id=i.participant_id
   join public.team_diagnostics d on d.id=p.team_diagnostic_id join public.company_profiles c on c.id=d.company_id
   join public.accounts a on a.id=c.account_id
   where i.token_hash=pending.invitation_hash and p.email=pending.email and i.expires_at>now()
    and p.revoked_at is null and d.status='open' and a.status='active')
  then raise exception 'team_invitation_unavailable'; end if;
  update private.team_identity_reservations set user_id=new.id where email=pending.email;
  -- No profile, role, consent, Account or membership is created here.
  return new;
 end if;
  if new.raw_user_meta_data->'data_processing_consent' <> 'true'::jsonb
     or new.raw_user_meta_data->'data_processing_consent' is null then
    raise exception 'Data processing consent is required';
  end if;
  if jsonb_typeof(new.raw_user_meta_data->'marketing_consent') is distinct from 'boolean' then
    raise exception 'Marketing choice is required';
  end if;
  for doc in select * from public.consent_documents loop
    if new.raw_user_meta_data->>(doc.kind || '_version') is distinct from doc.version then
      raise exception 'Consent version mismatch';
    end if;
  end loop;
  insert into public.users(id, full_name) values(new.id, trim(new.raw_user_meta_data->>'full_name'));
  insert into public.user_roles(user_id, role) values(new.id, 'user');
  for doc in select * from public.consent_documents loop
    consent := new.raw_user_meta_data->(doc.kind || '_consent');
    insert into public.user_consents(user_id, kind, version, granted, source)
    values(new.id, doc.kind, doc.version, consent = 'true'::jsonb, 'email_registration');
  end loop;
  insert into private.audit_events(subject_id, action) values(new.id, 'identity_created');
  perform private.ensure_legacy_account(new.id);
  return new;
end; $$;
revoke all on function private.provision_identity() from public,anon,authenticated;

-- Pending identities must not gain access through any existing verified-session RPC.
create or replace function private.is_verified_session() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=(select auth.uid()) and u.email_confirmed_at is not null)
 and not exists(select 1 from private.team_identity_reservations r where r.user_id=(select auth.uid()) and r.finalized_at is null);
$$;

-- Called only after the recipient explicitly submits current personal consent.
-- Provisioning and acceptance are atomic, with the original acceptance locks/RLS.
create function public.finalize_team_invitation_identity(p_token text,p_consent boolean,p_data_version text,p_marketing_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target public.team_participants; pending private.team_identity_reservations; doc record; pid uuid;
begin
 if actor is null or p_consent is distinct from true or p_token is null or p_token !~ '^[a-f0-9]{64}$'
 then raise exception 'team_invitation_unavailable'; end if;
 if p_data_version is distinct from (select version from public.consent_documents where kind='data_processing')
  or p_marketing_version is distinct from (select version from public.consent_documents where kind='marketing')
 then raise exception 'team_policy_changed'; end if;
 -- Match the established Team -> participant -> response lock order.
 perform 1 from public.team_diagnostics where id=(select p.team_diagnostic_id from public.team_participants p
  join private.team_invitations i on i.participant_id=p.id where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')) for update;
 select p.* into target from public.team_participants p join private.team_invitations i on i.participant_id=p.id
 where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update of p;
 if target.id is null or target.revoked_at is not null or not exists(select 1 from auth.users u where u.id=actor
  and lower(u.email)=target.email and u.email_confirmed_at is not null)
 then raise exception 'team_invitation_unavailable'; end if;
 if exists(select 1 from public.user_roles where user_id=actor and role='administrator') and (select auth.jwt()->>'aal') is distinct from 'aal2'
 then raise exception 'team_invitation_unavailable'; end if;
 select * into pending from private.team_identity_reservations where user_id=actor for update;
 if pending.user_id is not null and pending.finalized_at is null then
  if pending.email<>target.email or exists(select 1 from public.users where id=actor)
  then raise exception 'team_invitation_unavailable'; end if;
  insert into public.users(id,full_name) values(actor,trim(pending.display_name));
  insert into public.user_roles(user_id,role) values(actor,'user');
  for doc in select * from public.consent_documents loop
   insert into public.user_consents(user_id,kind,version,granted,source)
   values(actor,doc.kind,doc.version,doc.kind='data_processing','team_invitation');
  end loop;
  perform private.ensure_legacy_account(actor);
  update private.team_identity_reservations set finalized_at=now() where user_id=actor;
  insert into private.audit_events(subject_id,action) values(actor,'team_invitation_identity_finalized');
 elsif not exists(select 1 from public.user_roles where user_id=actor) then
  raise exception 'team_invitation_unavailable';
 end if;
 pid:=public.accept_team_invitation(p_token);
 return pid;
end; $$;
revoke all on function public.finalize_team_invitation_identity(text,boolean,text,text) from public,anon,service_role;
grant execute on function public.finalize_team_invitation_identity(text,boolean,text,text) to authenticated;
commit;
