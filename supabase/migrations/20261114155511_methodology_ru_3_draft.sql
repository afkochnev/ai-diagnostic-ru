-- AI Company Audit v3 questionnaire. Source: Вопросы диагностики edited.docx.
-- Source SHA-256: fa7c84583951d38a53a233086598e6a2da273fad13d6a0993f474fb2877f0d50.
-- Word paragraph text is preserved except for leading/trailing layout whitespace.
-- Leave version 5 in draft so deployed readers continue to select published RU-2.1.
begin;

do $$
declare
  v_definition uuid;
  v_previous uuid;
  v_version uuid;
  v_option_template uuid;
begin
  select id into strict v_definition
    from public.diagnostic_definitions where key = 'manageability';
  select id into strict v_previous
    from public.diagnostic_versions
    where definition_id = v_definition and version_number = 4 and status = 'published';
  if exists (
    select 1 from public.diagnostic_versions
    where definition_id = v_definition
      and (version_number = 5 or (version_number > 5 and status = 'published'))
  ) then
    raise exception 'RU-3 requires an unused version 5 and no later published manageability version';
  end if;

  insert into public.diagnostic_versions (definition_id, version_number, status, content_hash, source_file)
    values (v_definition, 5, 'draft',
      'fa7c84583951d38a53a233086598e6a2da273fad13d6a0993f474fb2877f0d50',
      'Вопросы диагностики edited.docx')
    returning id into v_version;
  insert into public.diagnostic_version_translations (version_id, locale, title, description)
    select v_version, locale, title, 'Методика RU-3'
    from public.diagnostic_version_translations where version_id = v_previous and locale = 'ru';

  insert into public.diagnostic_blocks (version_id, key, position, weight, is_active)
    select v_version, key, position, weight, is_active
    from public.diagnostic_blocks where version_id = v_previous;
  insert into public.diagnostic_block_translations (block_id, locale, title, description)
    select target.id, 'ru', word.title, t.description
    from (values
      ('company_info', 'Общие вопросы'),
      ('strategy', 'Стратегия'),
      ('structure', 'Организационная структура'),
      ('processes', 'Процессы и операционная эффективность'),
      ('goals_kpi', 'Цели и показатели'),
      ('management_rhythm', 'Управленческий ритм'),
      ('team', 'Зрелость команды'),
      ('motivation', 'Инновации и развитие'),
      ('culture', 'Корпоративная культура'),
      ('open_questions', 'Общие вопросы')
    ) word(block_key, title)
    join public.diagnostic_blocks target on target.version_id = v_version and target.key = word.block_key
    join public.diagnostic_blocks source on source.version_id = v_previous and source.key = word.block_key
    join public.diagnostic_block_translations t on t.block_id = source.id and t.locale = 'ru';

  -- Stable block and context keys preserve their consumers. Question keys follow meaning,
  -- so changed questions do not inherit old IDs, positional keys or unrelated hints.
  create temporary table ru3_bank (
    block_key text not null,
    position integer not null,
    question_key text primary key,
    answer_type text not null,
    is_required boolean not null,
    prompt text not null,
    unique (block_key, position)
  ) on commit drop;
  insert into ru3_bank (block_key, position, question_key, answer_type, is_required, prompt)
  values
      ('company_info', 1, 'main_management_problem', 'text', true, 'Какую проблему вы хотите решить за 3–6 месяцев? Как она проявляется и какой результат вы хотите увидеть? Если есть предположение о причине, укажите его. (Ваши развернутые ответы позволят сделать отчет более содержательным).'),
      ('company_info', 2, 'main_company_goal', 'text', true, 'Назовите до трёх главных целей компании на ближайший год. Если известен критерий достижения, укажите его.'),
      ('strategy', 1, 'strategy_document_access', 'scale_0_4', true, 'Стратегия компании зафиксирована в документе, доступном каждому члену управленческой команды в общем рабочем пространстве.'),
      ('strategy', 2, 'strategy_team_participation', 'scale_0_4', true, 'Стратегия разрабатывалась с активным участием всей управленческой команды.'),
      ('strategy', 3, 'strategy_alignment', 'scale_0_4', true, 'Документ "Стратегия" четко определяет, какую ценность мы создаём для целевых клиентов, какую их проблему решаем и почему они выбирают нас среди альтернативных поставщиков.'),
      ('strategy', 4, 'strategic_goal_metrics', 'scale_0_4', true, 'Стратегия направлена на достижение долгосрочных целей, имеющих измеримые критерии, по которым можно определить прогресс.'),
      ('strategy', 5, 'strategy_clarity', 'scale_0_4', true, 'Наша стратегия ясно определяет, где и за счёт чего собираемся выигрывать, а также от каких направлений и возможностей сознательно отказываемся.'),
      ('strategy', 6, 'strategic_goal_ownership', 'scale_0_4', true, 'Ответственность за достижение каждой стратегической цели закреплена за одним из членов команды.'),
      ('strategy', 7, 'strategy_projects_underway', 'scale_0_4', true, 'В текущем году у нас запланированы и выполняются несколько проектов, предусмотренных стратегией.'),
      ('strategy', 8, 'strategy_progress_review', 'scale_0_4', true, 'В предыдущие три месяца команда проводила как минимум одну встречу, посвященную рассмотрению хода выполнения стратегии.'),
      ('strategy', 9, 'strategic_decision_rights', 'scale_0_4', true, 'В компании определён и документально зафиксирован порядок принятия стратегических решений: известно, кто готовит варианты, кто участвует в обсуждении и кто принимает окончательное решение.'),
      ('strategy', 10, 'strategy_regularly_review', 'scale_0_4', true, 'Мы регулярно подвергаем проверке предположения, на которых основана наша стратегия и вносим коррективы. В течение прошедших 12 месяцев команда провела как минимум одну сессию, посвященную актуализации стратегии.'),
      ('strategy', 11, 'strategy_summary', 'text', false, 'Опишите суть стратегии компании 2-3 фразами'),
      ('structure', 1, 'organization_chart', 'scale_0_4', true, 'Структура компании отражена на организационной схеме, которая верно отражает состав подразделений и отношения подчиненности.'),
      ('structure', 2, 'division_role_definitions', 'scale_0_4', true, 'Цели, задачи и функции каждого подразделения компании описаны в Положении о подразделении или ином документе, и это не дань формальности, а отражение реальной деятельности.'),
      ('structure', 3, 'job_descriptions_applied', 'scale_0_4', true, 'Должностные обязанности каждого сотрудника документированы, люди их знают и руководствуются в своей работе; эти документы своевременно обновляются.'),
      ('structure', 4, 'line_management_alignment', 'scale_0_4', true, 'У нас исключены ситуации, когда сотрудник получает распоряжения от вышестоящего начальства "через голову" своего непосредственного руководителя.'),
      ('structure', 5, 'project_reporting_lines', 'scale_0_4', true, 'Для сотрудников, участвующих в проектной работе, четко определен порядок подчиненности руководителю подразделения и проектному менеджеру; конфликты на пересечении их полномочий крайне редки.'),
      ('structure', 6, 'responsibility_determined', 'scale_0_4', true, 'В течение последних трех месяцев не вспоминается ситуаций, когда возникали сбои в работе по причине "белых пятен" - отсутствия ответственного на том или ином участке.'),
      ('structure', 7, 'resource_conflict_resolution', 'scale_0_4', true, 'В течение последних трех месяцев не вспоминается конфликтов между руководителями по поводу распределения ресурсов (люди, бюджеты, иные активы).'),
      ('structure', 8, 'owner_executive_role_separation', 'scale_0_4', true, 'Роли собственника, генерального директора и топ-команды чётко разделены и зафиксированы документально; стратегическое руководство не подменяет собой операционное управление.'),
      ('structure', 9, 'structure_relevant_strategy', 'scale_0_4', true, 'Стратегия определяет требования к организационной структуре; эти требования зафиксированы в документах по стратегии и служат основой для решений о развитии компании.'),
      ('structure', 10, 'organization_structure_review', 'scale_0_4', true, 'В течение последних 6 месяцев вопрос развития организационной структуры, внесения актуальных изменений в документы рассматривался управленческой командой.'),
      ('structure', 11, 'structure_gaps', 'text', false, 'Какие недостатки вы видите в организационной структуре компании?'),
      ('processes', 1, 'process_landscape', 'scale_0_4', true, 'Мы точно знаем, из каких бизнес-процессов состоит деятельность нашей компании; имеется описание ландшафта процессов.'),
      ('processes', 2, 'process_description', 'scale_0_4', true, 'Ключевые сквозные процессы компании определены и документированы от входа или потребности клиента до конечного результата.'),
      ('processes', 3, 'process_standards_applied', 'scale_0_4', true, 'Регламенты бизнес-процессов не формальны, исполнители их знают и руководствуются в своей работе.'),
      ('processes', 4, 'process_owner_and_metrics', 'scale_0_4', true, 'Для каждого из ключевых процессов определен владелец, отвечающий за результаты, а также измеримые показатели.'),
      ('processes', 5, 'process_measurement_visibility', 'scale_0_4', true, 'Показатели ключевых процессов регулярно измеряются и отражаются в управленческой отчетности или на дашбордах, эти данные доступны каждому члену команды.'),
      ('processes', 6, 'process_issue_review', 'scale_0_4', true, 'В течение последних трех месяцев, как минимум, один раз команда собиралась, чтобы обсудить отклонения в каком-то бизнес-процессе и выработала конкретные меры по улучшению.'),
      ('processes', 7, 'process_improvement_follow_up', 'scale_0_4', true, 'Решения об усовершенствовании бизнес-процессов ставятся на контроль, имеются протоколы совещаний и отчеты о результатах выполнения.'),
      ('processes', 8, 'process_improvement_methods', 'scale_0_4', true, 'Руководители владеют методами анализа и совершенствования бизнес-процессов (по TQM, кайдзен или другим) и демонстрируют их применение на практике.'),
      ('processes', 9, 'process_improvement_training', 'scale_0_4', true, 'В компании организовано регулярное обучение руководителей и сотрудников методам анализа и совершенствования бизнес-процессов.'),
      ('processes', 10, 'process_ai_it_plan', 'scale_0_4', true, 'У нас имеется план внедрения в бизнес-процессы ИТ и AI, его выполнение мы обсуждали как минимум один раз в течение последних трех месяцев.'),
      ('processes', 11, 'process_improvement_ideas', 'text', false, 'Что, по вашему мнению, необходимо сделать для улучшения управляемости и эффективности бизнес-процессов?'),
      ('goals_kpi', 1, 'multi_year_goals', 'scale_0_4', true, 'Компания имеет стратегические цели на период 2 года или более, утвержденные командой и зафиксированные документально.'),
      ('goals_kpi', 2, 'all_goals_are_interconnected', 'scale_0_4', true, 'При разработке годового плана мы определяем, какие шаги нам нужно предпринять для приближения к стратегическим целям, и исходя из этого ставим цели на год.'),
      ('goals_kpi', 3, 'division_annual_targets', 'scale_0_4', true, 'Каждое подразделение и его руководитель имеют план на год и измеримые цели, как критерии успешного достижения результата.'),
      ('goals_kpi', 4, 'employee_goal_participation', 'scale_0_4', true, 'Сотрудники участвуют в подготовке и обсуждении целей и планов подразделений, сознательно принимают свои цели и ключевые показатели.'),
      ('goals_kpi', 5, 'employee_results_alignment', 'scale_0_4', true, 'Каждый сотрудник может назвать свои главные результаты на текущий период (месяц, квартал, год) и объяснить, как они связаны с целями компании.'),
      ('goals_kpi', 6, 'monthly_results_visibility', 'scale_0_4', true, 'Результаты исполнения планов компании отражаются в ежемесячной отчетности, которая доступна каждому члену управленческой команды.'),
      ('goals_kpi', 7, 'balanced_reporting', 'scale_0_4', true, 'В отчётах отражаются не только финансовые показатели, но также данные о клиентах, показателях процессов, состоянии ключевых ресурсов, вовлеченности и удовлетворенности сотрудников.'),
      ('goals_kpi', 8, 'performance_data_trusted', 'scale_0_4', true, 'Все члены команды пользуются данными о фактических результатах компании из единого источника и доверяют им как надежным и достоверным.'),
      ('goals_kpi', 9, 'monthly_performance_review', 'scale_0_4', true, 'Результаты выполнения планов обсуждаются управленческой командой не реже чем раз в месяц, по отклонениям вырабатываются и ставятся на контроль решения.'),
      ('goals_kpi', 10, 'performance_reporting_tools', 'scale_0_4', true, 'Для отображения и анализа управленческих данных используются удобные средства автоматизации, позволяющие оперативно получать нужную информацию.'),
      ('goals_kpi', 11, 'missing_indicators', 'text', false, 'Каких показателей вам, как руководителю, не хватает для более полного контроля деятельности компании?'),
      ('management_rhythm', 1, 'planning_and_control_cycle', 'scale_0_4', true, 'В компании существует календарь регулярных управленческих встреч, раздельно по оперативным, тактическим и стратегическим вопросам'),
      ('management_rhythm', 2, 'management_format_rules', 'scale_0_4', true, 'У каждого регулярного управленческого формата есть свой регламент, включающий конкретная цель, круг участников, необходимые входные данные и понятный ожидаемый результат.'),
      ('management_rhythm', 3, 'meeting_readiness', 'scale_0_4', true, 'Совещания, как правило, хорошо подготовлены: имеется повестка, документы для обсуждения формируются заранее, участники приходят подготовленными.'),
      ('management_rhythm', 4, 'meeting_decision_records', 'scale_0_4', true, 'Решения, принятые на управленческих встречах, фиксируются в протоколах; эти протоколы доступны всем членам команды в общем рабочем пространстве.'),
      ('management_rhythm', 5, 'decisions_systematically_monitored', 'scale_0_4', true, 'Решения, принятые на управленческих встречах, ставятся на контроль, о них не забывают и регулярно отслеживают выполнение.'),
      ('management_rhythm', 6, 'decision_register', 'scale_0_4', true, 'Руководители могут открыть общий список действующих решений и увидеть ответственного, срок и состояние каждого решения.'),
      ('management_rhythm', 7, 'overdue_decision_response', 'scale_0_4', true, 'Невыполненные решения не остаются без внимания, команда на очередном совещании рассматривает причины и вырабатывает необходимые меры.'),
      ('management_rhythm', 8, 'decision_routing', 'scale_0_4', true, 'В компании есть четкое понимание, какие вопросы должны решаться на местах, какие подлежат коллективному обсуждению, какие доносятся до вышестоящего руководства, и эти правила записаны в руководящих документах.'),
      ('management_rhythm', 9, 'cross_functional_review', 'scale_0_4', true, 'Вопросы, затрагивающие интересы смежных подразделений, решаются на совместных собраниях; в последние 3 месяца было, по крайне мере, одно такое собрание.'),
      ('management_rhythm', 10, 'decision_tracking_tools', 'scale_0_4', true, 'Для контроля исполнения решений топ-команды и проектных команд, используются удобные ИТ технологии.'),
      ('management_rhythm', 11, 'meeting_effectiveness', 'text', false, 'Как вы оцениваете продуктивность совещаний управленческой команды? Что нужно улучшить?'),
      ('team', 1, 'competence_management_team', 'scale_0_4', true, 'На каждом ключевом направлении: маркетинг, продажи, производство, финансы, персонал, IT и других у нас есть руководители, имеющие необходимые знания и опыт.'),
      ('team', 2, 'functional_strategy_ownership', 'scale_0_4', true, 'Каждый руководитель имеет функциональную стратегию своего направления, вытекающую из стратегии компании, и полностью отвечает за ее выполнение.'),
      ('team', 3, 'managers_are_independent', 'scale_0_4', true, 'Каждый руководитель принимает самостоятельные решения в своей области управления, не перекладывая ответственность на генерального директора или собственника.'),
      ('team', 4, 'cross_functional_autonomy', 'scale_0_4', true, 'Руководители подразделений умеют договариваться между собой и принимать совместные решения, не обращаясь к генеральному директору или собственнику.'),
      ('team', 5, 'leadership_discussion_participation', 'scale_0_4', true, 'На встречах команды все руководители равноправны при обсуждении и выработке решений, каждый высказывает свое мнение и слушает других.'),
      ('team', 6, 'honest_discussions_within_team', 'scale_0_4', true, 'В нашей команде принято открыто выражать свое мнение, говорить о проблемах, рисках, плохих новостях в том числе, когда эта информация неприятна другим членам команды или руководителю.'),
      ('team', 7, 'working_disagreement', 'scale_0_4', true, 'При выработке решений у нас нередко случаются рабочие конфликты, когда сталкиваются противоположные мнения членов команды; можно вспомнить конкретные факты в течение последних шести месяцев.'),
      ('team', 8, 'respectful_conflict', 'scale_0_4', true, 'Конфликты между членами команды никогда не переходят на личности и не вызывают взаимных оскорблений и обид.'),
      ('team', 9, 'managers_implement_decisions', 'scale_0_4', true, 'Невозможно припомнить ситуацию, когда кто-либо из членов команды не выполнил принятые обязательства, не сообщив своевременно коллегам о необходимости пересмотра договоренности.'),
      ('team', 10, 'management_development_and_review', 'scale_0_4', true, 'Развитие руководителей поставлено на системную основу: проводятся планомерные учебные мероприятия, обучающие практики, действует система оценки руководителей.'),
      ('team', 11, 'team_weak_points', 'text', false, 'Какие вы видите слабые места в управленческой команде в части профессионализма, коммуникаций, ценностей?'),
      ('motivation', 1, 'innovation_priorities', 'scale_0_4', true, 'Приоритеты развития продуктов, услуг и инфраструктуры компании определяются стратегией и зафиксированы в руководящих документах, утвержденных командой.'),
      ('motivation', 2, 'innovation_launch_review', 'scale_0_4', true, 'Решения по запуску новых продуктов или направлений бизнеса не возникают спонтанно, они принимаются коллегиально после обсуждения маркетингового, технического и финансового обоснования.'),
      ('motivation', 3, 'product_development_process', 'scale_0_4', true, 'В компании есть четко определенный регламентированный процесс создания новых продуктов от идеи до разработки и выпуска на рынок.'),
      ('motivation', 4, 'innovation_investment_returns', 'scale_0_4', true, 'В компании ведется учет расходов и доходов по каждому инновационному проекту, проводится анализ эффективности инвестиций.'),
      ('motivation', 5, 'organization_change_projects', 'scale_0_4', true, 'Значимые изменения бизнес-процессов, управленческих систем, внедрение информационных технологий проводятся форме проектов, например, в течение последних 12 месяцев реализован один такой проект или более.'),
      ('motivation', 6, 'development_project_governance', 'scale_0_4', true, 'В компании действует регламент управления проектами развития, предусматривающий формирование команды, назначение руководителя, наличие плана, регулярного контроля и анализа результатов.'),
      ('motivation', 7, 'idea_pipeline', 'scale_0_4', true, 'В компании действует постоянный механизм генерации, отбора, проверки новых идей. С банком идей, ходом их рассмотрения и результатами можно ознакомиться в общем рабочем пространстве.'),
      ('motivation', 8, 'tech_market_trend_review', 'scale_0_4', true, 'В течение последних 6 месяцев по крайней мере один раз команда обсуждала технологические, рыночные и другие существенные тренды с точки зрения их влияния на бизнес.'),
      ('motivation', 9, 'market_release_or_pilot', 'scale_0_4', true, 'В течение последних двух лет выпущен на рынок новый продукт или осуществлен пилотный проект на новом сегменте рынка.'),
      ('motivation', 10, 'innovation_growth_impact', 'scale_0_4', true, 'Инновационная деятельность дает измеримый эффект в виде прироста клиентской базы, увеличения продаж и прибыли; эти показатели можно видеть в управленческой отчетности.'),
      ('motivation', 11, 'innovation_opportunities', 'text', false, 'Как вы оцениваете способность компании к развитию, что можно улучшить в инновационной деятельности?'),
      ('culture', 1, 'shared_company_values', 'scale_0_4', true, 'На вопрос о ценностях компании никто из сотрудников не затруднится с ответом, и все ответы будут одинаковы.'),
      ('culture', 2, 'employees_receive_full_information', 'scale_0_4', true, 'В компании развита система внутренних коммуникаций, сотрудники информированы о целях и планах компании, сообщают руководству о проблемах и рисках, открыто взаимодействуют со смежными отделами.'),
      ('culture', 3, 'respectful_employee_treatment', 'scale_0_4', true, 'Уважение к сотрудникам - норма в нашей компании. Руководители не повышают голос на подчиненных, не допускаю т унижающих высказываний, не устраивают публичного порицания.'),
      ('culture', 4, 'fulfillment_of_obligations_is_valued', 'scale_0_4', true, 'Руководители служат примером выполнения обещаний и соблюдения договоренностей; не удается вспомнить случая нарушения этой нормы коллегами в течение нескольких последних месяцев.'),
      ('culture', 5, 'workplace_trust', 'scale_0_4', true, 'Взаимоотношения в компании строятся на доверии, мы не контролируем поведение людей, не ведем слежку за сотрудниками, исходя из презумпции их порядочности.'),
      ('culture', 6, 'talk_openly_about_problems', 'scale_0_4', true, 'Сотрудники не боятся открыто высказывать свое мнение даже если это неприятно их руководителю; можно вспомнить примеры такого поведения.'),
      ('culture', 7, 'employee_improvement_participation', 'scale_0_4', true, 'В течение года более половины сотрудников внесли предложения по улучшению работы компании.'),
      ('culture', 8, 'employee_learning_participation', 'scale_0_4', true, 'В компании действуют различные формы обучения и развития, в которые вовлечены более половины сотрудников.'),
      ('culture', 9, 'respond_to_conduct_violations', 'scale_0_4', true, 'Сознательное нарушение сотрудниками норм и принципов корпоративного поведения не остается без внимания их коллег и руководителей, за такими поступками следует порицание и корректирующие действия.'),
      ('culture', 10, 'culture_employer_reputation', 'scale_0_4', true, 'Корпоративная культура продвигает наш HR бренд, вызывает позитивные отклики клиентов, партнеров, кандидатов; есть примеры таких отзывов.'),
      ('culture', 11, 'reported_company_culture', 'text', false, 'Как бы вы охарактеризовали корпоративную культуру компании?'),
      ('open_questions', 1, 'management_failures', 'text', false, 'Где за последние три месяца повторялся управленческий сбой? Опишите один случай и его последствие.'),
      ('open_questions', 2, 'owner_intervention_cases', 'text', false, 'В каком недавнем случае пришлось вмешаться собственнику или первому лицу? Что потребовало его участия и к чему это привело?'),
      ('open_questions', 3, 'missing_manageability_context', 'text', false, 'Что важное для оценки управляемости вашей компании осталось за рамками анкеты?');

  insert into public.questions
    (version_id, block_id, key, position, answer_type, weight, is_required, is_active, reverse_score)
    select v_version, b.id, q.question_key, q.position, q.answer_type,
      case when q.answer_type = 'scale_0_4' then 1 else 0 end,
      q.is_required, true, false
    from ru3_bank q join public.diagnostic_blocks b on b.version_id = v_version and b.key = q.block_key;
  insert into public.question_translations (question_id, locale, prompt, help_text)
    select target.id, 'ru', source.prompt,
      -- Both revised introductions already contain their guidance in the Word prompt.
      case when source.block_key = 'company_info' then '' end
    from ru3_bank source join public.questions target
      on target.version_id = v_version and target.key = source.question_key;

  -- Copy the existing 1–5 display / 0–4 storage mapping and translated option labels.
  select id into strict v_option_template
    from public.questions where version_id = v_previous and key = 'strategy_clarity' and answer_type = 'scale_0_4';
  insert into public.question_options (question_id, key, position, score_value)
    select q.id, source.key, source.position, source.score_value
    from public.questions q cross join public.question_options source
    where q.version_id = v_version and q.answer_type = 'scale_0_4' and source.question_id = v_option_template;
  insert into public.question_option_translations (option_id, locale, label)
    select target.id, t.locale, t.label
    from public.questions q
    join public.question_options target on target.question_id = q.id
    join public.question_options source on source.question_id = v_option_template and source.key = target.key
    join public.question_option_translations t on t.option_id = source.id and t.locale = 'ru'
    where q.version_id = v_version;

  insert into public.scoring_policies
    (version_id, engine_key, engine_version, schema_version, configuration, policy_hash)
    select v_version, engine_key, engine_version, schema_version, configuration, policy_hash
    from public.scoring_policies where version_id = v_previous;
  insert into public.maturity_levels (version_id, key, position, classification_config)
    select v_version, key, position, classification_config
    from public.maturity_levels where version_id = v_previous;
  insert into public.maturity_level_translations (maturity_level_id, locale, label, description)
    select target.id, t.locale, t.label, t.description
    from public.maturity_levels target
    join public.maturity_levels source on source.version_id = v_previous and source.key = target.key
    join public.maturity_level_translations t on t.maturity_level_id = source.id and t.locale = 'ru'
    where target.version_id = v_version;

  if (select count(*) from public.diagnostic_block_translations t
      join public.diagnostic_blocks b on b.id = t.block_id where b.version_id = v_version and t.locale = 'ru') <> 10
    or (select count(*) from public.question_translations t
      join public.questions q on q.id = t.question_id where q.version_id = v_version and t.locale = 'ru') <> 93
    or (select count(*) from public.question_option_translations t
      join public.question_options o on o.id = t.option_id
      join public.questions q on q.id = o.question_id where q.version_id = v_version and t.locale = 'ru') <> 400
    or (select count(*) from public.scoring_policies where version_id = v_version) <> 1
    or (select count(*) from public.maturity_level_translations t
      join public.maturity_levels m on m.id = t.maturity_level_id where m.version_id = v_version and t.locale = 'ru') <> 5
  then
    raise exception 'RU-3 draft methodology has incomplete content';
  end if;
end $$;

commit;
