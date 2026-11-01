-- Add Team subjects to the existing consultation/feedback workflow.
-- Old Individual RPCs and records keep their original contract.
begin;
alter table public.team_diagnostics add constraint team_diagnostics_id_company_key unique(id,company_id);
alter table public.team_ai_reports add constraint team_ai_reports_id_team_key unique(id,team_diagnostic_id);
alter table public.lead_requests
 alter column diagnostic_id drop not null,alter column report_id drop not null,
 add column team_diagnostic_id uuid,add column team_report_id uuid,
 add constraint lead_team_company_fk foreign key(team_diagnostic_id,company_id) references public.team_diagnostics(id,company_id) on delete restrict,
 add constraint lead_team_report_fk foreign key(team_report_id,team_diagnostic_id) references public.team_ai_reports(id,team_diagnostic_id) on delete restrict,
 add constraint lead_subject_check check (
  (diagnostic_id is not null and report_id is not null and team_diagnostic_id is null and team_report_id is null)
  or (diagnostic_id is null and report_id is null and team_diagnostic_id is not null and team_report_id is not null));
create unique index lead_requests_active_team_idx on public.lead_requests(user_id,team_report_id)
 where team_report_id is not null and status in('new','contacted','consultation_scheduled');
alter table public.feedback
 alter column diagnostic_id drop not null,
 add column team_diagnostic_id uuid,add column team_report_id uuid,
 add constraint feedback_team_company_fk foreign key(team_diagnostic_id,company_id) references public.team_diagnostics(id,company_id) on delete restrict,
 add constraint feedback_team_report_fk foreign key(team_report_id,team_diagnostic_id) references public.team_ai_reports(id,team_diagnostic_id) on delete restrict,
 add constraint feedback_subject_check check (
  (diagnostic_id is not null and team_diagnostic_id is null and team_report_id is null)
  or (diagnostic_id is null and team_diagnostic_id is not null and team_report_id is not null));
create unique index feedback_user_team_idx on public.feedback(user_id,team_diagnostic_id) where team_diagnostic_id is not null;
alter table public.jobs
 alter column diagnostic_id drop not null,
 add column team_diagnostic_id uuid references public.team_diagnostics(id) on delete restrict,
 add constraint jobs_subject_check check (
  (diagnostic_id is not null and team_diagnostic_id is null)
  or (kind='consultation_notification' and diagnostic_id is null and team_diagnostic_id is not null));
create unique index jobs_team_deduplication_idx on public.jobs(kind,team_diagnostic_id,deduplication_key) where team_diagnostic_id is not null;

create function public.create_team_lead_request(
 p_team_diagnostic_id uuid,p_team_report_id uuid,p_name text,p_contact_type text,
 p_contact_value text,p_comment text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();t public.team_diagnostics;r public.team_ai_reports;
 existing public.lead_requests;lead public.lead_requests;job uuid;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or not private.is_verified_session() then raise exception 'unauthorized';end if;
 if char_length(btrim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'invalid_name';end if;
 if p_contact_type is not null and p_contact_type not in('phone','telegram') then raise exception 'invalid_contact_type';end if;
 if (p_contact_type is null)<>(nullif(btrim(coalesce(p_contact_value,'')),'') is null) then raise exception 'contact_pair_required';end if;
 if p_contact_type='phone' and (btrim(p_contact_value)!~'^\+?[0-9 ()-]{7,25}$' or regexp_replace(p_contact_value,'[^0-9]','','g')!~'^[0-9]{7,15}$') then raise exception 'invalid_phone';end if;
 if p_contact_type='telegram' and btrim(p_contact_value)!~*'^(@?[A-Za-z0-9_]{5,32}|https?://(www\.)?t\.me/[A-Za-z0-9_]{5,32})$' then raise exception 'invalid_telegram';end if;
 if (p_comment is not null and char_length(p_comment)>3000) or p_idempotency_key is null then raise exception 'invalid_comment';end if;
 select * into t from public.team_diagnostics where id=p_team_diagnostic_id and private.can_access_company(company_id);
 if t.id is null then raise exception 'diagnostic_not_owned_or_completed';end if;
 select * into r from public.team_ai_reports where id=p_team_report_id and team_diagnostic_id=t.id and status='completed';
 if r.id is null then raise exception 'report_not_owned_or_completed';end if;
 select * into existing from public.lead_requests where user_id=actor and idempotency_key=p_idempotency_key;
 if existing.id is not null then
  if existing.team_diagnostic_id is distinct from t.id or existing.team_report_id is distinct from r.id then raise exception 'report_not_owned_or_completed';end if;
  return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status);
 end if;
 select * into existing from public.lead_requests where user_id=actor and team_report_id=r.id and status in('new','contacted','consultation_scheduled');
 if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status);end if;
 insert into public.lead_requests(user_id,company_id,team_diagnostic_id,team_report_id,name,email,contact_type,contact_value,comment,idempotency_key)
 values(actor,t.company_id,t.id,r.id,btrim(p_name),(select email from auth.users where id=actor),p_contact_type,
  case when p_contact_type='phone' then regexp_replace(btrim(p_contact_value),'[() -]','','g')
   when p_contact_type='telegram' then regexp_replace(regexp_replace(regexp_replace(lower(btrim(p_contact_value)),'^https?://',''),'^www\.',''),'^t\.me/','') end,
  nullif(btrim(p_comment),''),p_idempotency_key) returning * into lead;
 insert into public.jobs(kind,team_diagnostic_id,deduplication_key) values('consultation_notification',t.id,'lead:'||lead.id::text) returning id into job;
 insert into public.consultation_notification_deliveries(lead_request_id,job_id) values(lead.id,job);
 return jsonb_build_object('ok',true,'duplicate',false,'lead_id',lead.id,'status',lead.status);
exception when unique_violation then
 select * into existing from public.lead_requests where user_id=actor and team_report_id=p_team_report_id and status in('new','contacted','consultation_scheduled');
 if existing.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'lead_id',existing.id,'status',existing.status);end if;
 raise;
end $$;

create function public.create_team_feedback(p_team_diagnostic_id uuid,p_team_report_id uuid,p_rating integer,p_useful text,p_improve text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();t public.team_diagnostics;feedback public.feedback;
begin
 if current_setting('role',true)<>'authenticated' or actor is null or not private.is_verified_session() then raise exception 'unauthorized';end if;
 if p_rating is null or p_rating not between 1 and 5 then raise exception 'invalid_rating';end if;
 if char_length(coalesce(p_useful,''))>3000 or char_length(coalesce(p_improve,''))>3000 then raise exception 'invalid_feedback_input';end if;
 select * into t from public.team_diagnostics where id=p_team_diagnostic_id and private.can_access_company(company_id);
 if t.id is null then raise exception 'diagnostic_not_owned_or_completed';end if;
 if not exists(select 1 from public.team_ai_reports where id=p_team_report_id and team_diagnostic_id=t.id and status='completed') then raise exception 'report_not_owned_or_completed';end if;
 insert into public.feedback(user_id,company_id,team_diagnostic_id,team_report_id,rating,useful,improve)
 values(actor,t.company_id,t.id,p_team_report_id,p_rating,nullif(btrim(p_useful),''),nullif(btrim(p_improve),''))
 on conflict(user_id,team_diagnostic_id) where team_diagnostic_id is not null do nothing returning * into feedback;
 if feedback.id is null then
  select * into feedback from public.feedback where user_id=actor and team_diagnostic_id=t.id;
  return jsonb_build_object('ok',true,'duplicate',true,'feedback_id',feedback.id);
 end if;
 return jsonb_build_object('ok',true,'duplicate',false,'feedback_id',feedback.id);
end $$;
revoke all on function public.create_team_lead_request(uuid,uuid,text,text,text,text,uuid),
 public.create_team_feedback(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_team_lead_request(uuid,uuid,text,text,text,text,uuid),
 public.create_team_feedback(uuid,uuid,integer,text,text) to authenticated;

-- An old Individual caller must not mistake a replayed Team key for its own lead.
-- Preserve its signature, validation, notification path and valid replay result.
do $$
declare definition text; marker text:='if existing.id is not null then
    if not private.can_access_company(existing.company_id)';
begin
 definition:=pg_get_functiondef('public.create_lead_request(uuid,uuid,text,text,text,text,uuid)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'consultation_subject_definition_drift';end if;
 execute replace(definition,marker,'if existing.id is not null then
    if existing.team_diagnostic_id is not null or existing.diagnostic_id is distinct from d.id or existing.report_id is distinct from r.id then raise exception ''report_not_owned_or_completed'';end if;
    if not private.can_access_company(existing.company_id)');
end $$;

-- Keep existing view columns in place for rolling compatibility; append Team context.
create or replace view private.admin_v24_leads with(security_invoker=true) as
select l.id,l.name,l.email,l.user_id,l.company_id,c.name company_name,c.account_id,c.account_name,
 l.diagnostic_id,case when l.team_diagnostic_id is null then 'individual' else 'team' end diagnostic_type,l.status,l.created_at,l.contact_type,l.contact_value,l.comment,
 coalesce(n.status,'none') notification_status,concat_ws(' ',l.name,l.email,c.name,c.account_name) search_text,
 l.team_diagnostic_id,l.team_report_id
from public.lead_requests l join private.admin_v24_companies c on c.id=l.company_id
left join public.consultation_notification_deliveries n on n.lead_request_id=l.id;
create or replace view private.admin_v24_feedback with(security_invoker=true) as
select f.id,u.full_name name,au.email,f.user_id,f.company_id,c.name company_name,c.account_id,c.account_name,
 f.diagnostic_id,f.rating,f.useful,f.improve,f.created_at,'recorded'::text status,
 concat_ws(' ',u.full_name,au.email,c.name,c.account_name) search_text,
 case when f.team_diagnostic_id is null then 'individual' else 'team' end diagnostic_type,f.team_diagnostic_id,f.team_report_id
from public.feedback f join public.users u on u.id=f.user_id join auth.users au on au.id=u.id join private.admin_v24_companies c on c.id=f.company_id;
revoke all on private.admin_v24_leads,private.admin_v24_feedback from public,anon,authenticated,service_role;
commit;
