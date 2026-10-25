-- Additive service-only channel diagnostics. No header/key/credential value,
-- fingerprint, fragment, length, timestamp, challenge or MAC is returned.
-- Existing Authorization/apikey challenge and credential/capture HMACs stay exact.
begin;

create function public.inspect_controlled_team_auth_header_channels(
 p_run_id uuid,p_window_id uuid,p_participant_id uuid,p_user_id uuid,
 p_operation text,p_reservation_id uuid,p_challenge text,p_custom_probe_mac text
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare headers jsonb;claims jsonb;auth_header_value text;authorization_payload text;api_key text;probe text;
 authorization_class text:='absent';apikey_class text:='absent';role_is_service boolean:=false;expected text;
begin
 -- SECURITY DEFINER changes current_user; use the strict request JWT role and
 -- the existing service guard, never the function owner's database identity.
 begin claims:=current_setting('request.jwt.claims',true)::jsonb;
 exception when others then raise exception 'controlled_team_service_required';end;
 role_is_service:=coalesce(jsonb_typeof(claims)='object' and jsonb_typeof(claims->'role')='string' and claims->>'role'='service_role',false);
 if not role_is_service then raise exception 'controlled_team_service_required';end if;
 perform private.controlled_team_service();
 if p_run_id is distinct from '00000000-0000-4000-8000-0000000000d1'::uuid
 or p_participant_id is distinct from '00000000-0000-4000-8000-0000000000d2'::uuid
 or p_user_id is distinct from '00000000-0000-4000-8000-0000000000d3'::uuid
 or p_operation is distinct from 'capability' or p_window_id is not null or p_reservation_id is not null
 then raise exception 'controlled_team_auth_scope_denied';end if;
 begin headers:=current_setting('request.headers',true)::jsonb;
 exception when others then headers:=null;end;
 if jsonb_typeof(headers)='object' then
  if jsonb_typeof(headers->'authorization')='string' then auth_header_value:=headers->>'authorization';end if;
  if jsonb_typeof(headers->'apikey')='string' then api_key:=headers->>'apikey';end if;
  if jsonb_typeof(headers->'x-aca-w2-probe')='string' then probe:=headers->>'x-aca-w2-probe';end if;
 end if;
 if auth_header_value is not null then
  if left(auth_header_value,7)='Bearer ' then
   authorization_payload:=substring(auth_header_value from 8);
   authorization_class:=case
    when authorization_payload ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then 'bearer_jwt'
    when authorization_payload ~ '^sb_secret_[A-Za-z0-9_-]+$' then 'bearer_sb_secret'
    else 'bearer_other' end;
  else authorization_class:='non_bearer';end if;
 end if;
 if api_key is not null then
  apikey_class:=case
   when api_key ~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then 'jwt'
   when api_key ~ '^sb_secret_[A-Za-z0-9_-]+$' then 'sb_secret'
   when api_key ~ '^sb_publishable_[A-Za-z0-9_-]+$' then 'sb_publishable'
   else 'other' end;
 end if;
 if probe ~ '^[a-f0-9]{64}$' and p_challenge ~ '^[a-f0-9]{64}$' and p_custom_probe_mac ~ '^[a-f0-9]{64}$' then
  expected:=encode(extensions.hmac(
   convert_to(E'aca-w2-header-channel-diagnostic-v2\nchallenge\n'||p_run_id::text||E'\n-\n'||p_participant_id::text||E'\n'||p_user_id::text||E'\ncapability\n-\n'||p_challenge,'UTF8'),
   convert_to(probe,'UTF8'),'sha256'),'hex');
 end if;
 return jsonb_build_object('authorization_class',authorization_class,'apikey_class',apikey_class,
  'authorization_payload_equals_apikey',coalesce(authorization_payload is not null and api_key is not null and authorization_payload=api_key,false),
  'jwt_role_is_service_role',role_is_service,'authorization_present',auth_header_value is not null,'apikey_present',api_key is not null,
  'custom_probe_matched',coalesce(expected=p_custom_probe_mac,false));
end $$;

revoke all on function public.inspect_controlled_team_auth_header_channels(uuid,uuid,uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.inspect_controlled_team_auth_header_channels(uuid,uuid,uuid,uuid,text,uuid,text,text) to service_role;

commit;
