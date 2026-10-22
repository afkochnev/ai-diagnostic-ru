-- Append current Team consent for existing identities. No publication, historical rewrite or marketing choice changes.
begin;
create or replace function public.finalize_team_invitation_identity(p_token text,p_consent boolean,p_data_version text,p_marketing_version text) returns uuid
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
 -- Existing identities also record a newly presented current data-processing consent.
 -- Preserve every previous row; Team joining does not issue or withdraw marketing consent.
 if not exists(select 1 from public.user_consents c where c.user_id=actor
  and c.kind='data_processing' and c.version=p_data_version and c.granted) then
  insert into public.user_consents(user_id,kind,version,granted,source)
  values(actor,'data_processing',p_data_version,true,'team_participation:'||pid::text);
 end if;
 return pid;
end; $$;
revoke all on function public.finalize_team_invitation_identity(text,boolean,text,text) from public,anon,service_role;
grant execute on function public.finalize_team_invitation_identity(text,boolean,text,text) to authenticated;
commit;
