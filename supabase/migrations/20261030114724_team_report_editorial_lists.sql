-- Permit concise, evidence-based Team reports while preserving the stored shape
-- and all upper bounds so completed reports remain readable.
create or replace function private.validate_team_report_v2(p_content jsonb,p_count integer) returns void language plpgsql set search_path='' as $$
declare k text; x jsonb; limits jsonb:='{"strengths":[0,5],"key_problem_zones":[0,5],"implementation_risks":[0,6],"first_actions":[1,6],"plan_30_days":[1,7],"plan_60_days":[1,7],"plan_90_days":[1,7]}';
begin
 if jsonb_typeof(p_content) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_content))<>14
  or jsonb_typeof(p_content->'participant_count') is distinct from 'number' or (p_content->>'participant_count')::numeric is distinct from p_count then raise exception 'team_schema_rejected';end if;
 foreach k in array array['summary','main_diagnosis','manageability_index_text','growth_constraint','next_step'] loop
  if jsonb_typeof(p_content->k) is distinct from 'string' or length(p_content->>k) not between 1 and 12000 then raise exception 'team_schema_rejected';end if;
 end loop;
 for k in select jsonb_object_keys(limits) loop
  if jsonb_typeof(p_content->k) is distinct from 'array' or jsonb_array_length(p_content->k) not between (limits->k->>0)::integer and (limits->k->>1)::integer then raise exception 'team_schema_rejected';end if;
  for x in select * from jsonb_array_elements(p_content->k) loop if jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 12000 then raise exception 'team_schema_rejected';end if;end loop;
 end loop;
 if jsonb_typeof(p_content->'team_analysis') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_content->'team_analysis'))<>4 then raise exception 'team_schema_rejected';end if;
 foreach k in array array['alignment','divergence','qualitative_signals','discussion_questions'] loop
  if jsonb_typeof(p_content->'team_analysis'->k) is distinct from 'array'
   or jsonb_array_length(p_content->'team_analysis'->k) not between (case when k='discussion_questions' then 1 else 0 end) and (case when k='discussion_questions' then 8 else 12 end) then raise exception 'team_schema_rejected';end if;
  for x in select * from jsonb_array_elements(p_content->'team_analysis'->k) loop if jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 12000 then raise exception 'team_schema_rejected';end if;end loop;
 end loop;
end; $$;
