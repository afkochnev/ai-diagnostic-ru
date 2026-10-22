-- Creation gates only. Historical reads, participant answers, jobs and claims keep
-- their accepted authorization paths. Every environment starts closed at the DB.
begin;
create table private.launch_controls (
 singleton boolean primary key default true check(singleton),
 anonymous_start_enabled boolean not null default false,
 team_creation_enabled boolean not null default false,
 team_invitations_enabled boolean not null default false
);
insert into private.launch_controls(singleton) values(true);
alter table private.launch_controls enable row level security;
revoke all on private.launch_controls from public,anon,authenticated,service_role;
alter function public.create_team_diagnostic(uuid,text) rename to create_team_before_launch_controls;
alter function public.create_team_before_launch_controls(uuid,text) set schema private;
alter function public.invite_team_participant(uuid,text,text,text) rename to invite_team_before_launch_controls;
alter function public.invite_team_before_launch_controls(uuid,text,text,text) set schema private;
alter function public.renew_team_invitation(uuid,text) rename to renew_team_before_launch_controls;
alter function public.renew_team_before_launch_controls(uuid,text) set schema private;
alter function public.acquisition_session(text,uuid,text,jsonb) rename to acquisition_before_launch_controls;
alter function public.acquisition_before_launch_controls(text,uuid,text,jsonb) set schema private;
revoke all on function private.create_team_before_launch_controls(uuid,text),private.invite_team_before_launch_controls(uuid,text,text,text),private.renew_team_before_launch_controls(uuid,text),private.acquisition_before_launch_controls(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
create function public.create_team_diagnostic(p_company_id uuid,p_title text) returns uuid language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from private.launch_controls where team_creation_enabled) then raise exception 'team_creation_paused';end if;
 return private.create_team_before_launch_controls(p_company_id,p_title);
end $$;
create function public.invite_team_participant(p_team_id uuid,p_email text,p_display_name text,p_token_hash text) returns uuid language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from private.launch_controls where team_invitations_enabled) then raise exception 'team_invitations_paused';end if;
 return private.invite_team_before_launch_controls(p_team_id,p_email,p_display_name,p_token_hash);
end $$;
create function public.renew_team_invitation(p_participant_id uuid,p_token_hash text) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from private.launch_controls where team_invitations_enabled) then raise exception 'team_invitations_paused';end if;
 perform private.renew_team_before_launch_controls(p_participant_id,p_token_hash);
end $$;
create function public.acquisition_session(p_operation text,p_id uuid,p_secret_hash text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform private.billing_service_actor();
 if p_operation='start' and not exists(select 1 from private.launch_controls where anonymous_start_enabled) then raise exception 'acquisition_start_paused';end if;
 return private.acquisition_before_launch_controls(p_operation,p_id,p_secret_hash,p_payload);
end $$;
revoke all on function public.create_team_diagnostic(uuid,text),public.invite_team_participant(uuid,text,text,text),public.renew_team_invitation(uuid,text) from public,anon,service_role;
grant execute on function public.create_team_diagnostic(uuid,text),public.invite_team_participant(uuid,text,text,text),public.renew_team_invitation(uuid,text) to authenticated;
revoke all on function public.acquisition_session(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.acquisition_session(text,uuid,text,jsonb) to service_role;
commit;
