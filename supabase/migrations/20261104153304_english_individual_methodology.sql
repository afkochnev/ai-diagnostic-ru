-- English translation of repaired RU-2.1 (published manageability version 4).
-- Adds en rows against the SAME IDs; no new methodology, scoring or historical edits.
-- Content source: METHODOLOGY_EN_1_0.csv. Legacy question keys remain unchanged.
begin;

alter table public.users drop constraint users_locale_check;
alter table public.users add constraint users_locale_check check (locale in ('ru','en'));

-- The assessment language is pinned at creation, like its methodology version.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.diagnostics'::regclass and conname='diagnostics_locale_check') then
    alter table public.diagnostics add constraint diagnostics_locale_check check (locale in ('ru','en'));
  end if;
end $$;

-- Preserve the existing lifecycle guard and add only language immutability.
create or replace function private.guard_diagnostic_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.company_id <> old.company_id or new.created_by_user_id <> old.created_by_user_id or new.version_id <> old.version_id or new.started_at <> old.started_at then raise exception 'diagnostic immutable fields cannot be changed'; end if;
  if new.locale is distinct from old.locale then raise exception 'diagnostic locale is immutable' using errcode='23514'; end if;
  if old.status='submitted' and new.status not in ('submitted','scoring') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  if old.status='scoring' and new.status not in ('scoring','completed','scoring_failed') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  if old.status='completed' and new.status <> old.status then raise exception 'completed diagnostic lifecycle is immutable'; end if;
  if old.status='scoring_failed' and new.status not in ('scoring_failed','scoring') then raise exception 'invalid diagnostic lifecycle transition'; end if;
  new.last_saved_at := now(); return new;
end; $$;

do $$
declare
  v_version uuid;
  v_before jsonb;
  v_after jsonb;
begin
  select v.id into v_version from public.diagnostic_versions v
    join public.diagnostic_definitions d on d.id=v.definition_id
    where d.key='manageability' and v.version_number=4 and v.status='published';
  if v_version is null then raise exception 'published repaired RU-2.1 version 4 is required'; end if;
  if (select count(*) from public.questions where version_id=v_version)<>84
     or (select count(*) from public.questions where version_id=v_version and answer_type='scale_0_4' and is_active)<>80
     or (select count(*) from public.diagnostic_blocks where version_id=v_version)<>10 then
    raise exception 'unexpected RU-2.1 question or block structure';
  end if;

  -- Snapshot the stable assessment/scoring metadata and Russian wording.
  select jsonb_build_object(
    'version', (select to_jsonb(v) from public.diagnostic_versions v where id=v_version),
    'blocks', (select jsonb_agg(to_jsonb(b) order by b.id) from public.diagnostic_blocks b where version_id=v_version),
    'questions', (select jsonb_agg(to_jsonb(q) order by q.id) from public.questions q where version_id=v_version),
    'options', (select jsonb_agg(to_jsonb(o) order by o.id) from public.question_options o join public.questions q on q.id=o.question_id where q.version_id=v_version),
    'scoring', (select jsonb_agg(to_jsonb(s)) from public.scoring_policies s where version_id=v_version),
    'maturity', (select jsonb_agg(to_jsonb(m) order by m.id) from public.maturity_levels m where version_id=v_version),
    'ru_questions', (select jsonb_agg(to_jsonb(t) order by t.question_id) from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_version and t.locale='ru')
  ) into v_before;

  create temporary table _english_questions(key text primary key,prompt text not null,help_text text) on commit drop;
  insert into _english_questions(key,prompt,help_text) values
    ('main_management_problem','What is the main management problem you want to solve in the next 3–6 months? Describe its causes and explain why it is your highest priority. Detailed answers will help make the report more useful.','Describe the situation, possible causes and desired outcome. One or two concrete examples will make the analysis more useful.'),
    ('main_company_goal','Name the company''s three main goals for the coming year.','List up to three main goals for the coming year.'),
    ('strategy_clarity','The company has a clear strategy: we can briefly explain where and how we intend to win, and which activities and opportunities we deliberately choose not to pursue.',null),
    ('strategy_alignment','We clearly understand the value we create for our target customers, the problem we solve for them and why they choose us over alternatives.',null),
    ('strategy_resources_focused','We have deliberately chosen the priority markets, customer segments, products and channels on which to focus our resources, as well as the areas we do not prioritise.',null),
    ('strategy_market_search','The company has 3–5 key strategic goals for the next 2–3 years, each with measurable outcomes that allow us to assess achievement objectively.',null),
    ('strategy_competitive_advantages','We regularly review important external changes, strategic assumptions and risks, consider possible scenarios and understand when the strategy would need to be revised.',null),
    ('strategy_decision_making_priorities','We understand which capabilities, resources, assets and features of our business model create lasting competitive advantages, and we deliberately strengthen them.',null),
    ('strategy_resources_priority','The company''s main projects and initiatives directly support its strategic goals; initiatives that do not create strategic value do not receive priority resources.',null),
    ('strategy_responsability','We understand the people, capabilities, funding and other resources needed to deliver the strategy, recognise current gaps and allocate resources in line with strategic priorities.',null),
    ('strategy_check_prerequisites','The company has a clear process for strategic decisions: people know who develops the options, who contributes to the discussion and who makes the final decision.',null),
    ('strategy_regularly_review','We regularly assess strategy execution against actual results and adjust the strategy and related initiatives when results, underlying assumptions or external conditions change.',null),
    ('role_clarity','The organisational structure fits the company''s current strategy, business model and scale, and adapts in good time as the business develops.',null),
    ('understands_area_responsibility','Every important outcome and key function has a named owner with the authority needed to deliver it and personal accountability for the result.',null),
    ('balance_authority_responsibility','The allocation of functions and responsibilities between departments has no significant duplication or gaps for which nobody is actually accountable.',null),
    ('decision_making_procedure','The number of management levels and each manager''s span of control allow managers to do their work well without creating systematic overload.',null),
    ('no_duplication_functions','The roles of the owner, chief executive and senior management team are clearly separated; strategic direction does not take over day-to-day operational management.',null),
    ('responsibility_determined','Rules for collaboration and handovers between departments are defined, so that tasks and responsibilities do not fall between functions.',null),
    ('no_conflicts_responsibility','The roles, authority and responsibilities of managers and departments are documented to the extent the business needs, kept up to date and used in practice.',null),
    ('interaction_departments','For the main types of management decisions, people understand the appropriate decision-making level and who has the authority to make the final decision.',null),
    ('structure_relevant_strategy','Issues are generally not escalated unnecessarily: decisions are made as close as possible to the work, where the necessary authority and capabilities exist.',null),
    ('responsibility_for_decisions','The organisational structure is reviewed periodically in light of strategy, company growth and actual management problems, and the effects of changes are assessed after implementation.',null),
    ('process_description','The company''s key end-to-end processes are defined from the initial input or customer need to the final outcome, and the main participants understand them.',null),
    ('process_responsibility','Every business-critical process has a named owner accountable for its final outcome and for improving the process as a whole.',null),
    ('process_executors_trained','Necessary standards and procedures exist for recurring business-critical operations; they are current, accessible to employees and used in practice.',null),
    ('rules_interaction_departments','Key processes have outcome and efficiency measures that allow us to assess quality, time, cost, productivity, waste and other important factors.',null),
    ('rules_and_standards_established','The company understands financial and operational performance at the level needed for management decisions, such as business lines, products, customer segments, orders or processes.',null),
    ('process_indicators_measured','Significant deviations and failures are analysed to identify root causes, followed by corrective action whose completion and effectiveness are monitored.',null),
    ('process_bottlenecks_known','Managers and employees know practical methods for analysing processes, identifying waste and finding the causes of inefficiency, and use them regularly to improve the work.',null),
    ('system_analysis_bottlenecks','Process improvement is systematic, and changes are evaluated through actual improvements in time, quality, cost, productivity or customer outcomes.',null),
    ('continuous_improvement_cycle','Core operational results are stable and predictable enough to plan volumes, delivery times, quality and resources without constant firefighting.',null),
    ('employees_improve_processes','Automation is used effectively in key processes and substantially reduces manual work, errors, processing time or dependence on particular employees.',null),
    ('goals_and_metrics_for_year','The company has a limited set of clearly stated priority goals for the year that managers understand and use to allocate attention and resources.',null),
    ('all_goals_are_interconnected','Every important goal has a specific measurable outcome, a deadline and a named person accountable for the result.',null),
    ('managers_understand_goals','Company goals are translated consistently into goals for departments and key managers, making each management level''s contribution clear.',null),
    ('all_goals_are_measurable','Every manager and key employee has a limited set of priority outcomes and understands how achieving them contributes to the company''s overall goals.',null),
    ('indicators_related_responsible','The company uses goals and measures as a complete management cycle: it plans outcomes, measures actual performance, identifies deviations, analyses their causes and takes corrective decisions.',null),
    ('there_are_early_warning_indicators','The measures are balanced: they reflect financial results as well as customers, processes, quality, the team and other factors that influence performance.',null),
    ('performance_data_trusted','Managers regularly compare planned and actual performance, analyse the causes of significant deviations and use the findings in their decisions.',null),
    ('indicators_are_not_contradictory','Goals and measures are revised when strategy, market conditions or underlying assumptions change significantly, rather than being retained as a formality until the end of the planning period.',null),
    ('comparison_of_plan_and_actual','The reward system supports meaningful outcomes and the behaviours the company needs, without encouraging improvement in one measure at the expense of overall performance.',null),
    ('decisions_on_indicators_deviations','Key measures have consistent calculation rules and clear data sources; information is updated as often as needed and managers trust it as a basis for decisions.',null),
    ('planning_and_control_cycle','The company has an agreed schedule of regular management meetings and reviews covering operational, tactical and strategic time horizons.',null),
    ('discussion_of_plan_implementation','Every regular management meeting or review has a specific purpose, defined participants, required inputs, an agreed format and a clear expected outcome.',null),
    ('causes_of_deviations_are_identified','Participants come prepared for management meetings, and the necessary information is available beforehand rather than taking considerable time to establish during the meeting.',null),
    ('decisions_have_deadlines_persons','Management meetings focus primarily on significant deviations, causes, possible actions and decisions, rather than simply exchanging information.',null),
    ('decisions_systematically_monitored','Meetings produce recorded decisions, named owners and deadlines, and the implementation of decisions is monitored systematically.',null),
    ('escalation_of_complex_problems','The company has a single accessible place showing current management decisions, their owners, deadlines and progress.',null),
    ('plans_are_being_promptly_adjusted','Operational, tactical and strategic issues are addressed in the appropriate management forums and are not mixed unnecessarily.',null),
    ('crossfunction_issues_resolved_jointly','Regular performance reviews lead to specific corrective actions, changes in priorities or reallocation of resources when needed.',null),
    ('management_cycles_are_regulated','There is a clear escalation process for significant problems, so issues quickly reach the management level with the authority to resolve them.',null),
    ('no_need_for_manual_control','Departments regularly address cross-functional issues together, turning problems at their boundaries into specific decisions and following up implementation.',null),
    ('competence_management_team','The composition of the senior management team fits the company''s current strategy and needs; we understand which management and professional capabilities are missing.',null),
    ('managers_are_independent','Every member of the senior management team has a clearly defined area of results, the necessary authority and personal accountability for their decisions.',null),
    ('honest_discussions_within_team','Senior team members make most decisions within their authority independently, without passing responsibility to the chief executive or owner.',null),
    ('managers_implement_decisions','The senior team can openly raise problems, risks, doubts and bad news, including information that other team members or the team leader may find uncomfortable.',null),
    ('the_leaders_act_as_one_team','The team can discuss disagreements constructively, consider different views and reach decisions without turning a substantive disagreement into a personal conflict.',null),
    ('first_person_delegates_authority','Agreements are honoured; when an agreement cannot be fulfilled, people give advance notice and initiate a revision instead of only reporting failure afterwards.',null),
    ('managers_do_development_tasks','Senior team members are regularly assessed on their results and management behaviour, and the findings inform development, role changes, rotation or other staffing decisions.',null),
    ('managers_are_constantly_learning','Management development is systematic: required capabilities are identified, developed deliberately and evaluated through changes in results and management practice.',null),
    ('company_forming_personnel_reserve','Senior team members make decisions in the interests of the whole company, rather than optimising only their own function or department.',null),
    ('the_team_can_act_independently','For critical management roles, the company understands its dependence on particular individuals, has potential successors or a replacement plan, and systematically prepares employees for greater responsibility.',null),
    ('personal_responsibility_of_managers','The company has clear priorities for developing products, services and customer value, linked to its strategy and changing market needs.',null),
    ('personal_results_and_indicators','There is a managed process for developing new products, services or business models, from identifying a need and testing a hypothesis to launch and evaluation.',null),
    ('authority_and_responsibility_balance','The company has clear criteria for selecting development initiatives: we compare their strategic value, expected impact, risks and resource needs, and can both launch projects and stop them in good time.',null),
    ('rewards_encourage_goal_achievement','We understand how the organisation itself needs to change as the business grows and develops, and have a view of the required changes to structure, processes, technology and capabilities over the next 2–3 years.',null),
    ('managers_are_rewarded_for_results','Significant organisational changes are managed as full projects or programmes, with defined goals, owners, resources, deadlines and success criteria.',null),
    ('employees_receive_recognition_results','The company has an ongoing process for generating, selecting, testing and scaling new ideas; innovation does not depend solely on occasional individual initiative.',null),
    ('failure_to_comply_has_consequences','The company consistently allocates the necessary people, time and funding to research, experiments, new solutions and testing promising hypotheses.',null),
    ('employees_receive_feedback','People can safely run well-founded, controlled experiments; an unsuccessful hypothesis is treated as a source of learning when the experiment was conducted properly and its findings were used.',null),
    ('responsibility_is_personalized','Important technological, market and other trends are regularly assessed for their potential impact on the business, and promising opportunities are turned into specific development initiatives.',null),
    ('its_not_customary_shift_responsibility','Innovation produces measurable impact: new or substantially improved products, processes, technologies or business models deliver demonstrated value to customers and the company.',null),
    ('leaders_exemplify_values','We have clearly defined values that every employee knows, and these values influence how people actually behave.',null),
    ('talk_openly_about_problems','Managers at every level demonstrate through their own behaviour the standards and principles the company expects of employees.',null),
    ('errors_require_identifying_causes','The company understands the culture required to deliver its strategy and deliberately develops the corresponding ways of behaving and working together.',null),
    ('employees_show_initiative','Employees and managers can openly report problems, risks and mistakes, including information that senior management may find uncomfortable.',null),
    ('cross_functional_cooperation','Basic rules for collaboration, accountability and acceptable behaviour are applied consistently, regardless of position, status or personal closeness to management.',null),
    ('employee_participation_in_management','When mistakes or failures occur, the company seeks to identify causes and improve the system while retaining personal accountability for deliberate breaches of rules and agreements.',null),
    ('fulfillment_of_obligations_is_valued','The culture helps the company attract and retain strong employees by supporting professional development, the use of people''s abilities and productive collaboration.',null),
    ('respond_quickly_to_changes','Employees receive information about company goals, plans and changes, and also have working channels for feedback, discussion of problems and suggestions.',null),
    ('employees_receive_full_information','Departments collaborate around company and customer outcomes, and functional boundaries do not obstruct the resolution of shared tasks.',null),
    ('employees_are_committed_to_values','Employees have sufficient autonomy within their responsibilities, and well-founded initiatives and improvement suggestions receive support and an opportunity to be implemented.',null),
    ('management_failures','Where do management failures occur most often?','Give one or two recent examples and describe their consequences.'),
    ('owner_intervention_cases','In which situations does the owner or chief executive need to intervene personally?','Describe the situations and explain why your personal involvement was needed.');
  if exists(select 1 from public.questions q where q.version_id=v_version and not exists(select 1 from _english_questions e where e.key=q.key))
     or exists(select 1 from _english_questions e where not exists(select 1 from public.questions q where q.version_id=v_version and q.key=e.key)) then
    raise exception 'English question keys do not exactly match RU-2.1';
  end if;
  insert into public.question_translations(question_id,locale,prompt,help_text)
    select q.id,'en',e.prompt,e.help_text from public.questions q join _english_questions e on e.key=q.key where q.version_id=v_version
    on conflict do nothing;
  if exists(select 1 from public.questions q join _english_questions e on e.key=q.key
      left join public.question_translations t on t.question_id=q.id and t.locale='en'
      where q.version_id=v_version and (t.question_id is null or t.prompt<>e.prompt or t.help_text is distinct from e.help_text)) then
    raise exception 'Existing English wording differs; do not overwrite a published translation';
  end if;

  insert into public.diagnostic_block_translations(block_id,locale,title,description)
    select b.id,'en',e.title,null from public.diagnostic_blocks b join (values
    ('company_info','General information'),
    ('strategy','Strategy'),
    ('structure','Organisational structure'),
    ('processes','Processes and operational efficiency'),
    ('goals_kpi','Goals and performance measures'),
    ('management_rhythm','Management rhythm'),
    ('team','Team maturity'),
    ('motivation','Innovation and development'),
    ('culture','Corporate culture'),
    ('open_questions','Open questions')
    ) e(key,title) on e.key=b.key where b.version_id=v_version on conflict do nothing;
  insert into public.diagnostic_version_translations(version_id,locale,title,description)
    values(v_version,'en','Company Management Diagnostic','Assess management practices and priorities for improvement.') on conflict do nothing;
  insert into public.question_option_translations(option_id,locale,label)
    select o.id,'en',o.position::text from public.question_options o join public.questions q on q.id=o.question_id
    where q.version_id=v_version on conflict do nothing;
  insert into public.maturity_level_translations(maturity_level_id,locale,label,description)
    select m.id,'en',e.label,null from public.maturity_levels m join (values
      ('critical','Critical'),('weak','Weak'),('developing','Developing'),('mature','Mature'),('strong','Strong')
    ) e(key,label) on e.key=m.key where m.version_id=v_version on conflict do nothing;

  if (select count(*) from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_version and t.locale='en')<>84
     or (select count(*) from public.diagnostic_block_translations t join public.diagnostic_blocks b on b.id=t.block_id where b.version_id=v_version and t.locale='en')<>10
     or (select count(*) from public.maturity_level_translations t join public.maturity_levels m on m.id=t.maturity_level_id where m.version_id=v_version and t.locale='en')<>5
     or (select count(*) from public.question_option_translations t join public.question_options o on o.id=t.option_id join public.questions q on q.id=o.question_id where q.version_id=v_version and t.locale='en')<>400 then
    raise exception 'English methodology translations are incomplete';
  end if;

  select jsonb_build_object(
    'version', (select to_jsonb(v) from public.diagnostic_versions v where id=v_version),
    'blocks', (select jsonb_agg(to_jsonb(b) order by b.id) from public.diagnostic_blocks b where version_id=v_version),
    'questions', (select jsonb_agg(to_jsonb(q) order by q.id) from public.questions q where version_id=v_version),
    'options', (select jsonb_agg(to_jsonb(o) order by o.id) from public.question_options o join public.questions q on q.id=o.question_id where q.version_id=v_version),
    'scoring', (select jsonb_agg(to_jsonb(s)) from public.scoring_policies s where version_id=v_version),
    'maturity', (select jsonb_agg(to_jsonb(m) order by m.id) from public.maturity_levels m where version_id=v_version),
    'ru_questions', (select jsonb_agg(to_jsonb(t) order by t.question_id) from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_version and t.locale='ru')
  ) into v_after;
  if v_before is distinct from v_after then raise exception 'English translation changed assessment metadata or Russian wording'; end if;
end $$;

insert into public.industry_translations(industry_key,locale,name) values
    ('manufacturing','en','Manufacturing'),
    ('wholesale','en','Wholesale'),
    ('ecommerce','en','E-commerce'),
    ('retail','en','Retail'),
    ('construction','en','Construction'),
    ('real_estate','en','Real estate'),
    ('software_development','en','IT / software development'),
    ('professional_services','en','Professional services'),
    ('consulting','en','Consulting'),
    ('logistics','en','Logistics'),
    ('horeca','en','Hospitality (hotels, restaurants and catering)'),
    ('education','en','Education'),
    ('medicine','en','Healthcare'),
    ('finance','en','Finance'),
    ('agriculture','en','Agriculture'),
    ('other','en','Other')
on conflict do nothing;

-- These labels describe existing RUB values explicitly; no foreign-currency conversion.
insert into public.revenue_range_translations(revenue_key,locale,name) values
    ('up_to_10m','en','Up to RUB 10 million'),
    ('10m_100m','en','RUB 10–100 million'),
    ('100m_500m','en','RUB 100–500 million'),
    ('500m_1b','en','RUB 500 million–1 billion'),
    ('1b_10b','en','RUB 1–10 billion'),
    ('over_10b','en','Over RUB 10 billion')
on conflict do nothing;

commit;
