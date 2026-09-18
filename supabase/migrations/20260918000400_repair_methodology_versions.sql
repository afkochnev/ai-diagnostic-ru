-- Repair methodology versions without environment-specific UUIDs.
-- RU-2.0 content is embedded from the approved METHODOLOGY_RU_2_0.csv bank;
-- source v1 is used only for stable structural metadata/options, never wording.
begin;
do $$
declare
  v_definition uuid;
  v_v1 uuid;
  v_v1_status text;
  v_v2 uuid;
  v_v2_status text;
  v_v4 uuid;
  v_v4_status text;
  v_count integer;
begin
  select id into v_definition from public.diagnostic_definitions where key='manageability';
  if v_definition is null then raise exception 'manageability definition missing'; end if;
  select id,status into v_v1,v_v1_status from public.diagnostic_versions where definition_id=v_definition and version_number=1;
  if v_v1 is null or v_v1_status <> 'published' then raise exception 'published RU-1.0 source missing'; end if;

  create temporary table _repair_bank(block_key text, question_position integer, prompt text, block_title text, primary key(block_key,question_position)) on commit drop;
  insert into _repair_bank(block_key,question_position,prompt,block_title) values
      ('company_info',1,'Какую главную управленческую проблему Вы хотите решить в ближайшие 3–6 месяцев? Опишите ее причины и объясните, почему Вы ставите ей высший приоритет (Ваши развернутые ответы позволят сделать отчет более содержательным).','Общая информация'),
      ('company_info',2,'Назовите три главные цели компании на ближайший год','Общая информация'),
      ('strategy',1,'У компании есть ясная стратегия: мы можем кратко объяснить, где и за счёт чего собираемся выигрывать, а также от каких направлений и возможностей сознательно отказываемся.','Стратегия'),
      ('strategy',2,'Мы чётко понимаем, какую ценность создаём для целевых клиентов, какую их проблему решаем и почему они выбирают нас среди альтернатив.','Стратегия'),
      ('strategy',3,'Мы осознанно определили приоритетные рынки, клиентские сегменты, продукты и каналы, на которых концентрируем ресурсы, а также направления, которые не считаем приоритетными.','Стратегия'),
      ('strategy',4,'У компании есть 3–5 ключевых стратегических целей на ближайшие 2–3 года, и для каждой определены измеримые результаты, по которым можно объективно оценить её достижение.','Стратегия'),
      ('strategy',5,'Мы регулярно анализируем ключевые внешние изменения, предположения и риски стратегии, рассматриваем возможные сценарии развития и понимаем, при каких условиях стратегию потребуется пересмотреть.','Стратегия'),
      ('strategy',6,'Мы понимаем, какие компетенции, ресурсы, активы и особенности бизнес-модели создают наши устойчивые конкурентные преимущества, и целенаправленно их усиливаем.','Стратегия'),
      ('strategy',7,'Основные проекты и инициативы компании непосредственно связаны со стратегическими целями; инициативы, не создающие стратегической ценности, не получают приоритетных ресурсов.','Стратегия'),
      ('strategy',8,'Мы понимаем, какие люди, компетенции, финансовые и другие ресурсы необходимы для реализации стратегии, видим существующие дефициты и распределяем ресурсы в соответствии со стратегическими приоритетами.','Стратегия'),
      ('strategy',9,'В компании определён понятный порядок принятия стратегических решений: известно, кто готовит варианты, кто участвует в обсуждении и кто принимает окончательное решение.','Стратегия'),
      ('strategy',10,'Реализация стратегии регулярно оценивается по фактическим результатам, а сама стратегия и стратегические инициативы корректируются, когда меняются результаты, исходные предположения или внешняя среда.','Стратегия'),
      ('structure',1,'Организационная структура соответствует текущей стратегии, бизнес-модели и масштабу компании и своевременно изменяется вместе с развитием бизнеса.','Организационная структура'),
      ('structure',2,'Для каждого значимого результата и ключевой функции определён персональный владелец, который обладает необходимыми полномочиями и несёт ответственность за результат.','Организационная структура'),
      ('structure',3,'В распределении функций и ответственности между подразделениями нет существенных дублирований и «белых пятен», за которые фактически никто не отвечает.','Организационная структура'),
      ('structure',4,'Количество уровней управления и число прямых подчинённых у руководителей позволяют им качественно выполнять управленческую работу и не создают системной перегрузки.','Организационная структура'),
      ('structure',5,'Роли собственника, генерального директора и топ-команды чётко разделены; стратегическое руководство не подменяет собой операционное управление.','Организационная структура'),
      ('structure',6,'На стыках подразделений определены правила взаимодействия и передачи результата, поэтому задачи и ответственность не «зависают» между функциями.','Организационная структура'),
      ('structure',7,'Роли, полномочия и ответственность руководителей и подразделений формализованы в необходимой для бизнеса степени, актуальны и реально используются в работе.','Организационная структура'),
      ('structure',8,'Для основных типов управленческих решений понятно, на каком уровне они должны приниматься и кто обладает необходимыми полномочиями для окончательного решения.','Организационная структура'),
      ('structure',9,'Как правило, вопросы не поднимаются на более высокий уровень без необходимости: решения принимаются максимально близко к месту возникновения задачи при наличии необходимых полномочий и компетенций.','Организационная структура'),
      ('structure',10,'Организационная структура периодически пересматривается с учётом стратегии, роста компании и фактических проблем управления, а результаты внесённых изменений оцениваются после внедрения.','Организационная структура'),
      ('processes',1,'Ключевые сквозные процессы компании определены от входа или потребности клиента до конечного результата и понятны основным участникам процесса.','Процессы и операционная эффективность'),
      ('processes',2,'У каждого критически важного процесса есть персональный владелец, отвечающий за его конечный результат и развитие процесса в целом.','Процессы и операционная эффективность'),
      ('processes',3,'Для повторяющихся критически важных операций существуют необходимые стандарты и регламенты; они актуальны, доступны сотрудникам и реально применяются.','Процессы и операционная эффективность'),
      ('processes',4,'По ключевым процессам определены показатели результата и эффективности, позволяющие оценивать качество, сроки, стоимость, производительность, потери и другие существенные параметры.','Процессы и операционная эффективность'),
      ('processes',5,'Компания понимает финансовую и операционную эффективность на необходимом для управления уровне — по направлениям, продуктам, клиентским сегментам, заказам или процессам, там, где это существенно для принятия решений.','Процессы и операционная эффективность'),
      ('processes',6,'Существенные отклонения и сбои анализируются с выявлением корневых причин, после чего принимаются и контролируются корректирующие меры.','Процессы и операционная эффективность'),
      ('processes',7,'Руководители и сотрудники владеют понятными методами анализа процессов, выявления потерь и причин неэффективности и регулярно используют их для совершенствования работы.','Процессы и операционная эффективность'),
      ('processes',8,'Улучшение процессов ведётся системно, а результаты изменений оцениваются по фактическому изменению сроков, качества, затрат, производительности или клиентского результата.','Процессы и операционная эффективность'),
      ('processes',9,'Основные операционные результаты достаточно стабильны и предсказуемы, чтобы компания могла планировать объёмы, сроки, качество и ресурсы без постоянного режима аврала.','Процессы и операционная эффективность'),
      ('processes',10,'Автоматизация эффективно применяется в ключевых процессах и позволяет существенно снизить ручной труд, количество ошибок, время выполнения операций или зависимость от отдельных сотрудников.','Процессы и операционная эффективность'),
      ('goals_kpi',1,'У компании есть ограниченное число чётко сформулированных приоритетных целей на год, которые понятны руководителям и служат основой для распределения внимания и ресурсов.','Цели и показатели'),
      ('goals_kpi',2,'Для каждой существенной цели определены конкретный измеримый результат, срок достижения и персональный владелец результата.','Цели и показатели'),
      ('goals_kpi',3,'Цели компании последовательно декомпозированы до целей подразделений и ключевых руководителей так, чтобы было понятно, какой вклад обеспечивает каждый уровень управления.','Цели и показатели'),
      ('goals_kpi',4,'У каждого руководителя и ключевого сотрудника есть ограниченное число приоритетных результатов, и он понимает, как их достижение связано с общими целями компании.','Цели и показатели'),
      ('goals_kpi',5,'Компания использует систему целей и показателей как полноценный управленческий цикл: планирует результаты, измеряет факт, выявляет отклонения, анализирует их причины и принимает корректирующие решения.','Цели и показатели'),
      ('goals_kpi',6,'Система показателей сбалансирована: она отражает не только финансовые результаты, но и состояние клиентов, процессов, качества, команды и других факторов, оказывающих влияние на результат.','Цели и показатели'),
      ('goals_kpi',7,'Руководители регулярно сопоставляют плановые и фактические показатели, анализируют причины существенных отклонений и используют результаты анализа при принятии решений.','Цели и показатели'),
      ('goals_kpi',8,'Цели и показатели пересматриваются, когда существенно меняются стратегия, рыночные условия или исходные предположения, а не сохраняются формально до конца планового периода.','Цели и показатели'),
      ('goals_kpi',9,'Система вознаграждения поддерживает достижение значимых результатов и необходимое компании поведение и не создаёт стимулов улучшать отдельный показатель в ущерб общему результату.','Цели и показатели'),
      ('goals_kpi',10,'По ключевым показателям существуют единые правила расчёта и понятные источники данных; информация обновляется с необходимой периодичностью и воспринимается руководителями как достоверная основа для принятия решений.','Цели и показатели'),
      ('management_rhythm',1,'В компании существует согласованный календарь регулярных управленческих встреч и обзоров, соответствующий различным горизонтам управления — оперативному, тактическому и стратегическому.','Управленческий ритм'),
      ('management_rhythm',2,'У каждого регулярного управленческого формата есть конкретная цель, круг участников, необходимые входные данные, регламент и понятный ожидаемый результат.','Управленческий ритм'),
      ('management_rhythm',3,'Участники приходят на управленческие встречи подготовленными, а необходимые данные доступны заранее и не становятся предметом длительного выяснения непосредственно на совещании.','Управленческий ритм'),
      ('management_rhythm',4,'Управленческие встречи сосредоточены прежде всего на существенных отклонениях, причинах, вариантах действий и решениях, а не на простом обмене информацией.','Управленческий ритм'),
      ('management_rhythm',5,'По итогам встреч фиксируются решения, ответственные и сроки, а выполнение принятых решений систематически контролируется.','Управленческий ритм'),
      ('management_rhythm',6,'В компании есть единое доступное место, где можно увидеть действующие управленческие решения, ответственных, сроки исполнения и текущий статус каждого решения.','Управленческий ритм'),
      ('management_rhythm',7,'Операционные, тактические и стратегические вопросы рассматриваются в соответствующих управленческих контурах и не смешиваются без необходимости.','Управленческий ритм'),
      ('management_rhythm',8,'Регулярные обзоры результатов приводят к конкретным корректирующим действиям, изменению приоритетов или перераспределению ресурсов, когда это необходимо.','Управленческий ритм'),
      ('management_rhythm',9,'Для существенных проблем существует понятный механизм эскалации: вопрос быстро попадает на тот уровень управления, где есть необходимые полномочия для его решения.','Управленческий ритм'),
      ('management_rhythm',10,'Межфункциональные вопросы регулярно рассматриваются совместно заинтересованными подразделениями, а проблемы на стыках доводятся до конкретных решений и контроля исполнения.','Управленческий ритм'),
      ('team',1,'Состав топ-команды соответствует текущей стратегии и задачам компании; мы понимаем, каких управленческих и профессиональных компетенций команде не хватает.','Зрелость команды'),
      ('team',2,'У каждого члена топ-команды есть чётко определённая зона результата, необходимые полномочия и персональная ответственность за принимаемые решения.','Зрелость команды'),
      ('team',3,'Члены топ-команды принимают большинство решений в пределах своих полномочий самостоятельно, не перекладывая ответственность на генерального директора или собственника.','Зрелость команды'),
      ('team',4,'В топ-команде можно открыто поднимать проблемы, риски, сомнения и плохие новости, в том числе когда эта информация неприятна другим членам команды или руководителю.','Зрелость команды'),
      ('team',5,'Команда умеет конструктивно обсуждать разногласия, рассматривать различные точки зрения и принимать решения, не переводя содержательный конфликт в личный.','Зрелость команды'),
      ('team',6,'Принятые договорённости выполняются; если выполнить их невозможно, об этом сообщают заранее и инициируют пересмотр решения, а не констатируют срыв постфактум.','Зрелость команды'),
      ('team',7,'Работа членов топ-команды регулярно оценивается по результатам и управленческому поведению, а выводы используются для развития, изменения роли, ротации или других кадровых решений.','Зрелость команды'),
      ('team',8,'Развитие руководителей носит системный характер: необходимые компетенции определяются, целенаправленно развиваются и оцениваются по изменению результатов и управленческой практики.','Зрелость команды'),
      ('team',9,'Члены топ-команды принимают решения в интересах компании в целом, а не оптимизируют только результаты собственной функции или подразделения.','Зрелость команды'),
      ('team',10,'Для критически важных руководящих ролей компания понимает риски зависимости от конкретных людей, имеет потенциальных преемников или план замещения и системно готовит сотрудников к более высокой ответственности.','Зрелость команды'),
      ('motivation',1,'У компании есть ясные приоритеты развития продуктов, услуг и клиентской ценности, связанные со стратегией и изменениями потребностей рынка.','Инновации и развитие'),
      ('motivation',2,'Существует управляемый процесс создания и развития новых продуктов, услуг или бизнес-моделей — от выявления потребности и проверки гипотезы до запуска и оценки результата.','Инновации и развитие'),
      ('motivation',3,'У компании есть понятные критерии выбора инициатив развития: мы сравниваем их стратегическую ценность, ожидаемый эффект, риски и необходимые ресурсы и умеем не только запускать, но и своевременно останавливать проекты.','Инновации и развитие'),
      ('motivation',4,'Мы понимаем, как должна изменяться сама организация по мере роста и развития бизнеса, и имеем представление о необходимом развитии структуры, процессов, технологий и компетенций на ближайшие 2–3 года.','Инновации и развитие'),
      ('motivation',5,'Значимые организационные изменения управляются как полноценные проекты или программы с определёнными целями, владельцами, ресурсами, сроками и критериями результата.','Инновации и развитие'),
      ('motivation',6,'В компании действует постоянный механизм генерации, отбора, проверки и масштабирования новых идей, а инновации не зависят исключительно от эпизодической инициативы отдельных сотрудников.','Инновации и развитие'),
      ('motivation',7,'Компания системно выделяет необходимые ресурсы — людей, время и деньги — на исследования, эксперименты, разработку новых решений и проверку перспективных гипотез.','Инновации и развитие'),
      ('motivation',8,'В компании можно безопасно проводить обоснованные контролируемые эксперименты; неудачная гипотеза рассматривается как источник знания, если эксперимент был корректно проведён и его выводы использованы.','Инновации и развитие'),
      ('motivation',9,'Технологические, рыночные и другие существенные тренды регулярно оцениваются с точки зрения их возможного влияния на бизнес, а перспективные возможности переводятся в конкретные инициативы развития.','Инновации и развитие'),
      ('motivation',10,'Инновационная деятельность создаёт измеримый эффект: новые или существенно улучшенные продукты, процессы, технологии или бизнес-модели дают подтверждённую ценность клиентам и компании.','Инновации и развитие'),
      ('culture',1,'У нас есть чётко определённые ценности, известные каждому члену коллектива, и это не просто слова — они реально влияют на поведение людей.','Корпоративная культура'),
      ('culture',2,'Руководители всех уровней своим фактическим поведением демонстрируют те нормы и принципы, которых компания ожидает от сотрудников.','Корпоративная культура'),
      ('culture',3,'Компания понимает, какая культура необходима для реализации её стратегии, и целенаправленно развивает соответствующие нормы поведения и взаимодействия.','Корпоративная культура'),
      ('culture',4,'Сотрудники и руководители могут открыто сообщать о проблемах, рисках и ошибках, в том числе когда эта информация неприятна вышестоящему руководству.','Корпоративная культура'),
      ('culture',5,'Базовые правила взаимодействия, ответственности и допустимого поведения применяются последовательно независимо от должности, статуса и личной близости сотрудника к руководству.','Корпоративная культура'),
      ('culture',6,'При ошибках и сбоях компания стремится выявить причины и улучшить систему, одновременно сохраняя персональную ответственность за сознательное нарушение правил и договорённостей.','Корпоративная культура'),
      ('culture',7,'Корпоративная культура помогает компании привлекать и удерживать сильных сотрудников, создавая условия для профессионального развития, реализации способностей и продуктивного сотрудничества.','Корпоративная культура'),
      ('culture',8,'Сотрудники не только получают информацию о целях, планах и изменениях компании, но имеют работающие каналы обратной связи, обсуждения проблем и внесения предложений.','Корпоративная культура'),
      ('culture',9,'Сотрудничество между подразделениями строится вокруг результата компании и клиента, а функциональные границы не становятся препятствием для решения общих задач.','Корпоративная культура'),
      ('culture',10,'Сотрудники имеют достаточную самостоятельность в своей зоне ответственности, а обоснованные инициативы и предложения по улучшению получают поддержку и возможность реализации.','Корпоративная культура'),
      ('open_questions',1,'Где чаще всего возникают управленческие сбои?','Открытые вопросы'),
      ('open_questions',2,'В каких ситуациях собственнику или первому лицу приходится вмешиваться лично?','Открытые вопросы');
  create temporary table _repair_titles(block_key text primary key, block_title text, block_position integer, block_weight numeric) on commit drop;
  insert into _repair_titles(block_key,block_title,block_position,block_weight) values
      ('company_info','Общая информация',1,'0'),
      ('strategy','Стратегия',2,'1'),
      ('structure','Организационная структура',3,'1'),
      ('processes','Процессы и операционная эффективность',4,'1'),
      ('goals_kpi','Цели и показатели',5,'1'),
      ('management_rhythm','Управленческий ритм',6,'1'),
      ('team','Зрелость команды',7,'1'),
      ('motivation','Инновации и развитие',8,'1'),
      ('culture','Корпоративная культура',9,'1'),
      ('open_questions','Открытые вопросы',10,'0');

  select id,status into v_v2,v_v2_status from public.diagnostic_versions where definition_id=v_definition and version_number=2;
  if v_v2 is null then
    v_v2:=gen_random_uuid();
    insert into public.diagnostic_versions(id,definition_id,version_number,status,content_hash,source_file,published_at)
      values(v_v2,v_definition,2,'draft','stage12-2f-ru-2-0-repair','METHODOLOGY_RU_2_0.csv',null);
    insert into public.diagnostic_version_translations(version_id,locale,title,description)
      values(v_v2,'ru','Диагностика управляемости компании','Методика RU-2.0');
    create temporary table _repair_v2_blocks(old_id uuid primary key,new_id uuid not null,key text not null) on commit drop;
    insert into _repair_v2_blocks select b.id,gen_random_uuid(),b.key from public.diagnostic_blocks b where b.version_id=v_v1;
    insert into public.diagnostic_blocks(id,version_id,key,position,weight,is_active)
      select m.new_id,v_v2,b.key,b.position,b.weight,b.is_active from _repair_v2_blocks m join public.diagnostic_blocks b on b.id=m.old_id;
    insert into public.diagnostic_block_translations(block_id,locale,title,description)
      select m.new_id,t.locale,coalesce(rt.block_title,t.title),t.description
      from _repair_v2_blocks m join public.diagnostic_block_translations t on t.block_id=m.old_id
      left join _repair_titles rt on rt.block_key=(select b.key from public.diagnostic_blocks b where b.id=m.old_id);
    create temporary table _repair_v2_questions(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v2_questions select q.id,gen_random_uuid() from public.questions q where q.version_id=v_v1;
    insert into public.questions(id,version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score,legacy_ai_context_label,legacy_bubble_unique_id)
      select m.new_id,v_v2,b.new_id,q.key,q.position,q.answer_type,q.weight,q.is_required,q.is_active,q.reverse_score,q.legacy_ai_context_label,q.legacy_bubble_unique_id
      from _repair_v2_questions m join public.questions q on q.id=m.old_id join _repair_v2_blocks b on b.old_id=q.block_id;
    insert into public.question_translations(question_id,locale,prompt,help_text)
      select m.new_id,t.locale,'RU-2.0 pending',t.help_text from _repair_v2_questions m join public.question_translations t on t.question_id=m.old_id;
    update public.question_translations t set prompt=bank.prompt
      from public.questions q join public.diagnostic_blocks b on b.id=q.block_id and b.version_id=q.version_id
      join _repair_bank bank on bank.block_key=b.key and bank.question_position=q.position
      where t.question_id=q.id and q.version_id=v_v2 and t.locale='ru';
    create temporary table _repair_v2_options(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v2_options select o.id,gen_random_uuid() from public.question_options o join _repair_v2_questions q on q.old_id=o.question_id;
    insert into public.question_options(id,question_id,key,position,score_value)
      select m.new_id,q.new_id,o.key,o.position,o.score_value from _repair_v2_options m join public.question_options o on o.id=m.old_id join _repair_v2_questions q on q.old_id=o.question_id;
    insert into public.question_option_translations(option_id,locale,label)
      select m.new_id,t.locale,t.label from _repair_v2_options m join public.question_option_translations t on t.option_id=m.old_id;
    insert into public.scoring_policies(version_id,engine_key,engine_version,schema_version,configuration,policy_hash)
      select v_v2,engine_key,engine_version,schema_version,configuration,'stage12-2f-ru-2-0-repair' from public.scoring_policies where version_id=v_v1;
    create temporary table _repair_v2_maturity(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v2_maturity select id,gen_random_uuid() from public.maturity_levels where version_id=v_v1;
    insert into public.maturity_levels(id,version_id,key,position,classification_config)
      select m.new_id,v_v2,x.key,x.position,x.classification_config from _repair_v2_maturity m join public.maturity_levels x on x.id=m.old_id;
    insert into public.maturity_level_translations(maturity_level_id,locale,label,description)
      select m.new_id,t.locale,t.label,t.description from _repair_v2_maturity m join public.maturity_level_translations t on t.maturity_level_id=m.old_id;
  elsif v_v2_status <> 'published' then
    raise exception 'RU-2.0 exists but is not published';
  end if;
  select count(*) into v_count from public.diagnostic_blocks where version_id=v_v2 and weight>0; if v_count<>8 then raise exception 'RU-2.0 scoring blocks expected 8, got %',v_count; end if;
  select count(*) into v_count from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v2 and b.key not in ('company_info','open_questions') and q.weight>0; if v_count<>80 then raise exception 'RU-2.0 scoring questions expected 80, got %',v_count; end if;
  select count(*) into v_count from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v2 and b.key='company_info'; if v_count<>2 then raise exception 'RU-2.0 general info expected 2, got %',v_count; end if;
  select count(*) into v_count from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v2 and b.key='open_questions'; if v_count<>2 then raise exception 'RU-2.0 open questions expected 2, got %',v_count; end if;
  if (select count(*) from public.scoring_policies where version_id=v_v2)<>1 then raise exception 'RU-2.0 scoring policy missing'; end if;
  if (select count(*) from public.maturity_levels where version_id=v_v2)=0 then raise exception 'RU-2.0 maturity levels missing'; end if;
  if (select count(*) from public.question_translations t join public.questions q on q.id=t.question_id where q.version_id=v_v2 and t.locale='ru')<>84 then raise exception 'RU-2.0 translations incomplete'; end if;
  update public.diagnostic_versions set status='published',published_at=now() where id=v_v2 and status='draft';

  select id,status into v_v4,v_v4_status from public.diagnostic_versions where definition_id=v_definition and version_number=4;
  if v_v4 is null then
    v_v4:=gen_random_uuid();
    insert into public.diagnostic_versions(id,definition_id,version_number,status,content_hash,source_file,published_at)
      values(v_v4,v_definition,4,'draft','stage12-2f-ru-2-1-repair','METHODOLOGY_RU_2_1.csv',null);
    insert into public.diagnostic_version_translations(version_id,locale,title,description)
      select v_v4,locale,title,'Методика RU-2.1' from public.diagnostic_version_translations where version_id=v_v2;
    create temporary table _repair_v4_blocks(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v4_blocks select id,gen_random_uuid() from public.diagnostic_blocks where version_id=v_v2;
    insert into public.diagnostic_blocks(id,version_id,key,position,weight,is_active)
      select m.new_id,v_v4,b.key,b.position,b.weight,b.is_active from _repair_v4_blocks m join public.diagnostic_blocks b on b.id=m.old_id;
    insert into public.diagnostic_block_translations(block_id,locale,title,description)
      select m.new_id,t.locale,t.title,t.description from _repair_v4_blocks m join public.diagnostic_block_translations t on t.block_id=m.old_id;
    create temporary table _repair_v4_questions(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v4_questions select id,gen_random_uuid() from public.questions where version_id=v_v2;
    insert into public.questions(id,version_id,block_id,key,position,answer_type,weight,is_required,is_active,reverse_score,legacy_ai_context_label,legacy_bubble_unique_id)
      select m.new_id,v_v4,b.new_id,q.key,q.position,q.answer_type,q.weight,q.is_required,q.is_active,q.reverse_score,q.legacy_ai_context_label,q.legacy_bubble_unique_id from _repair_v4_questions m join public.questions q on q.id=m.old_id join _repair_v4_blocks b on b.old_id=q.block_id;
    insert into public.question_translations(question_id,locale,prompt,help_text)
      select m.new_id,t.locale,t.prompt,t.help_text from _repair_v4_questions m join public.question_translations t on t.question_id=m.old_id;
    create temporary table _repair_v4_options(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v4_options select o.id,gen_random_uuid() from public.question_options o join _repair_v4_questions q on q.old_id=o.question_id;
    insert into public.question_options(id,question_id,key,position,score_value) select m.new_id,q.new_id,o.key,o.position,o.score_value from _repair_v4_options m join public.question_options o on o.id=m.old_id join _repair_v4_questions q on q.old_id=o.question_id;
    insert into public.question_option_translations(option_id,locale,label) select m.new_id,t.locale,t.label from _repair_v4_options m join public.question_option_translations t on t.option_id=m.old_id;
    insert into public.scoring_policies(version_id,engine_key,engine_version,schema_version,configuration,policy_hash) select v_v4,engine_key,engine_version,schema_version,configuration,'stage12-2f-ru-2-1-repair' from public.scoring_policies where version_id=v_v2;
    create temporary table _repair_v4_maturity(old_id uuid primary key,new_id uuid not null) on commit drop;
    insert into _repair_v4_maturity select id,gen_random_uuid() from public.maturity_levels where version_id=v_v2;
    insert into public.maturity_levels(id,version_id,key,position,classification_config) select m.new_id,v_v4,x.key,x.position,x.classification_config from _repair_v4_maturity m join public.maturity_levels x on x.id=m.old_id;
    insert into public.maturity_level_translations(maturity_level_id,locale,label,description) select m.new_id,t.locale,t.label,t.description from _repair_v4_maturity m join public.maturity_level_translations t on t.maturity_level_id=m.old_id;
    update public.question_translations t set prompt='В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.' from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where t.question_id=q.id and q.version_id=v_v4 and b.key='structure' and q.position=3 and t.locale='ru';
  elsif v_v4_status <> 'published' then
    raise exception 'RU-2.1 version 4 exists but is not published';
  end if;
  if (select count(*) from public.diagnostic_blocks where version_id=v_v4 and weight>0)<>8 or (select count(*) from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v4 and b.key not in ('company_info','open_questions') and q.weight>0)<>80 or (select count(*) from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v4 and b.key='company_info')<>2 or (select count(*) from public.questions q join public.diagnostic_blocks b on b.id=q.block_id where q.version_id=v_v4 and b.key='open_questions')<>2 then raise exception 'RU-2.1 content counts invalid'; end if;
  if (select count(*) from public.questions q join public.diagnostic_blocks b on b.id=q.block_id join public.question_translations t on t.question_id=q.id where q.version_id=v_v4 and b.key='structure' and q.position=3 and t.locale='ru' and t.prompt='В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.')<>1 then raise exception 'RU-2.1 correction missing'; end if;
  select count(*) into v_count
  from public.questions q2 join public.diagnostic_blocks b2 on b2.id=q2.block_id
  join public.question_translations t2 on t2.question_id=q2.id and t2.locale='ru'
  join public.questions q4 on q4.version_id=v_v4 and q4.key=q2.key and q4.position=q2.position
  join public.diagnostic_blocks b4 on b4.id=q4.block_id and b4.key=b2.key
  join public.question_translations t4 on t4.question_id=q4.id and t4.locale='ru'
  where q2.version_id=v_v2 and t2.prompt<>t4.prompt;
  if v_count<>1 then raise exception 'RU-2.1 must differ from RU-2.0 in exactly one question, got %',v_count; end if;
  if (select count(*) from public.scoring_policies where version_id=v_v4)<>1 or (select count(*) from public.maturity_levels where version_id=v_v4)=0 then raise exception 'RU-2.1 scoring metadata incomplete'; end if;
  update public.diagnostic_versions set status='published',published_at=now() where id=v_v4 and status='draft';
end $$;
commit;
