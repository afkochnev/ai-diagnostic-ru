-- Additive paired diagnostic only: compare both existing headers with Node.
-- No credential/capture HMAC switch, window, reservation or provider effect.
begin;

create function public.check_controlled_team_auth_header_capability(
 p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,
 p_operation text,p_reservation_id uuid,p_challenge text,p_authorization_mac text,p_apikey_mac text
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare headers jsonb;api_key text;message text;authorization_expected text;apikey_expected text;
begin
 perform private.controlled_team_service();
 -- These UUIDs are a domain binding, not foreign keys or W2 admission. The
 -- diagnostic requires no production cohort or new staging database rows.
 if p_run_id is distinct from '00000000-0000-4000-8000-0000000000d1'::uuid
 or p_participant_id is distinct from '00000000-0000-4000-8000-0000000000d2'::uuid
 or p_user_id is distinct from '00000000-0000-4000-8000-0000000000d3'::uuid
 or p_operation is distinct from 'capability' or p_window_id is not null or p_reservation_id is not null
 then raise exception 'controlled_team_auth_scope_denied';end if;
 if p_challenge ~ '^[a-f0-9]{64}$' then
  message:=E'aca-w2-auth-evidence-v1\nchallenge\n'||p_run_id::text||E'\n-\n'||p_participant_id::text||E'\n'||p_user_id::text||E'\ncapability\n-\n'||p_challenge;
  if p_authorization_mac ~ '^[a-f0-9]{64}$' then authorization_expected:=private.controlled_team_auth_mac(message);end if;
 end if;
 begin
  headers:=current_setting('request.headers',true)::jsonb;
  if jsonb_typeof(headers)='object' and jsonb_typeof(headers->'apikey')='string' then api_key:=headers->>'apikey';end if;
 exception when others then api_key:=null;
 end;
 -- Use the exact raw header bytes. Do not trim, prepend Bearer, fall back to
 -- Authorization, or return the header, expected MAC or any key fingerprint.
 if message is not null and api_key is not null and length(api_key) between 20 and 4096 and api_key ~ '^[A-Za-z0-9._-]+$'
 and p_apikey_mac ~ '^[a-f0-9]{64}$' then
  apikey_expected:=encode(extensions.hmac(
   convert_to(message,'UTF8'),
   convert_to(api_key,'UTF8'),'sha256'),'hex');
 end if;
 return jsonb_build_object('authorization_matched',coalesce(authorization_expected=p_authorization_mac,false),'apikey_matched',coalesce(apikey_expected=p_apikey_mac,false),
  'run_id',p_run_id,'window_id',p_window_id,'participant_id',p_participant_id,'user_id',p_user_id,
  'operation',p_operation,'reservation_id',p_reservation_id,'diagnostic_only',true,'server_now',clock_timestamp());
end $$;

revoke all on function public.check_controlled_team_auth_header_capability(uuid,uuid,uuid,uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.check_controlled_team_auth_header_capability(uuid,uuid,uuid,uuid,text,uuid,text,text,text) to service_role;

commit;
