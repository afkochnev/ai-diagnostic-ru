import Image from 'next/image';
import Link from 'next/link';
import {Container} from '@/components/ui/container';
import {VisitTracker, AcquisitionCTA} from './tracking';

const areas = ['Стратегия', 'Организационная структура', 'Процессы и эффективность', 'Цели и показатели', 'Управленческий ритм', 'Зрелость команды', 'Инновации и развитие', 'Корпоративная культура'];
const situations = [
  ['Решения замыкаются на вас', 'Без участия собственника работа останавливается, а времени на развитие не остаётся.'],
  ['Планы регулярно срываются', 'Цели поставлены, но отклонения обнаруживаются поздно и повторяются из месяца в месяц.'],
  ['Ответственность размыта', 'Подразделения передают проблемы друг другу, а руководителю приходится вмешиваться.'],
];

export function LandingAudience() {
  return <section className="py-10 sm:py-14" aria-labelledby="audience-title"><Container>
    <h2 id="audience-title" className="section-title">Знакомые ситуации?</h2>
    <div className="mt-6 grid gap-4 md:grid-cols-3">{situations.map(([title, description]) => <article key={title} className="rounded-2xl border border-line bg-white p-6">
      <h3 className="text-lg font-semibold">{title}</h3><p className="mt-3 leading-relaxed text-muted">{description}</p>
    </article>)}</div>
    <p className="mt-5 max-w-3xl leading-relaxed text-muted">Диагностика помогает собственнику и руководителю увидеть, какие управленческие практики стоит изменить в первую очередь.</p>
  </Container></section>;
}

export function LandingScope() {
  return <section className="py-10 sm:py-14" aria-labelledby="scope-title"><Container>
    <h2 id="scope-title" className="section-title">Что оценивается?</h2>
    <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{areas.map(area => <li className="rounded-xl bg-tint p-4" key={area}>{area}</li>)}</ul>
  </Container></section>;
}

export function LandingFormats() {
  return <section className="py-10 sm:py-14" aria-labelledby="formats-title"><Container>
    <h2 id="formats-title" className="section-title">Начните со своего взгляда на компанию</h2>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <article className="rounded-2xl border border-line bg-white p-6"><h3 className="text-xl font-semibold">Индивидуальная · Free</h3><p className="mt-3 leading-relaxed text-muted">Вы отвечаете сами. Бесплатно получаете индекс, профиль восьми областей управления, полный AI-отчёт и PDF для одной компании.</p></article>
      <article className="rounded-2xl border border-line bg-white p-6"><h3 className="text-xl font-semibold">Командная · Advanced</h3><p className="mt-3 leading-relaxed text-muted">Несколько руководителей отвечают независимо. Командный отчёт показывает общую картину и расхождения оценок. Advanced также позволяет работать с несколькими компаниями.</p></article>
    </div>
    <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted">Результат основан на ответах участников. Он помогает выбрать темы для проверки и обсуждения, а не заменяет изучение фактической работы компании.</p>
  </Container></section>;
}

export function FreeLanding({authenticated, attribution}: {authenticated: boolean; attribution: Record<string, string>}) {
  const href = authenticated ? '/ru/account' : `/ru/free${Object.keys(attribution).length ? '?' + new URLSearchParams(attribution) : ''}`;
  const cta = <AcquisitionCTA href={href}>{authenticated ? 'Открыть кабинет' : 'Начать бесплатную диагностику'}</AcquisitionCTA>;
  return <main id="main-content">
    <VisitTracker attribution={attribution}/>
    <section className="border-b border-line py-8 sm:py-12" aria-labelledby="hero-title"><Container>
      <a href="https://iteam.ru" target="_blank" rel="noreferrer" className="mb-6 inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"><Image src="/brand/iteam-logo-landing.png" alt="iTeam" width={144} height={45} priority className="h-auto w-32 sm:w-36"/></a>
      <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10"><div>
        <p className="text-sm font-medium text-muted">Для собственников и руководителей компаний</p>
        <h1 id="hero-title" className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl lg:text-[2.65rem]">Узнайте, что ограничивает рост вашей компании</h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">Оцените восемь областей управления. Получите объяснение ключевых проблем и план действий на 30 / 60 / 90 дней.</p>
        <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">{cta}<a href="#report-example" className="rounded text-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">Посмотреть пример</a></div>
        <p className="mt-4 text-sm font-medium">Без регистрации до вопросов · Бесплатный отчёт и PDF</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">80 вопросов с оценкой 1–5 и 4 открытых вопроса (2 можно пропустить). Можно сделать паузу и продолжить в том же браузере в течение 7 дней.</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">После вопросов понадобятся сведения о компании, имя и email для доступа к результату.</p>
      </div><SyntheticPreview/></div>
    </Container></section>
    <LandingAudience/>
    <section className="border-y border-line bg-white py-10 sm:py-14" aria-labelledby="benefits-title"><Container>
      <h2 id="benefits-title" className="section-title">Что вы получите</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">{[
        ['Индекс и профиль управления', 'Оценка от 0 до 100 и результаты по восьми областям: видно, где система управления сильнее, а где требует внимания.'],
        ['Объяснение причин', 'AI связывает ваши оценки и описание бизнеса: показывает ограничения роста, риски и темы для проверки.'],
        ['План и PDF', 'Первые действия руководителя и план на 30 / 60 / 90 дней. Отчёт можно скачать и использовать в работе.'],
      ].map(([title, description]) => <article key={title} className="rounded-2xl border border-line p-6"><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 leading-relaxed text-muted">{description}</p></article>)}</div>
    </Container></section>
    <LandingScope/>
    <section id="steps" className="border-y border-line bg-white py-10 sm:py-14" aria-labelledby="steps-title"><Container>
      <h2 id="steps-title" className="section-title">Как это работает?</h2>
      <ol className="mt-6 grid gap-6 sm:grid-cols-3">{[
        ['1. Ответьте на вопросы', 'Оцените текущую практику управления. Ответы сохраняются по мере заполнения.'],
        ['2. Добавьте контекст', 'Расскажите о компании, её задачах и проблемах: это поможет сделать рекомендации конкретнее.'],
        ['3. Получите отчёт', 'Укажите имя и email. Подтвердите адрес по ссылке из письма и откройте результат.'],
      ].map(([title, description]) => <li key={title}><h3 className="text-xl font-semibold">{title}</h3><p className="mt-3 leading-relaxed text-muted">{description}</p></li>)}</ol>
    </Container></section>
    <LandingFormats/>
    <section className="border-t border-line py-10 sm:py-14" aria-labelledby="privacy-title"><Container>
      <div className="max-w-3xl"><h2 id="privacy-title" className="section-title">Сохранение и доступ к результатам</h2>
        <p className="mt-4 leading-relaxed text-muted">До начала вопросов мы попросим согласие на обработку данных. Анонимный прогресс хранится 7 дней и доступен в том же браузере. После подтверждения email диагностика сохраняется в вашем аккаунте.</p>
        <div className="mt-6 space-y-3">{[
          ['Кто увидит мои ответы?', 'Доступ к результатам требует входа. Ответы не попадают в аналитику переходов и не используются в открытых примерах на этой странице.'],
          ['Что делать, если я закрою страницу?', 'Вернитесь в том же браузере в течение 7 дней. Если данные браузера удалены до подтверждения email, доступ к анонимным ответам может быть утрачен.'],
          ['Полный отчёт бесплатный?', 'Да. Индивидуальная диагностика, полный AI-отчёт и PDF входят в Free. Для командной диагностики нужен Advanced.'],
        ].map(([title, description]) => <details className="rounded-xl border border-line bg-white p-5" key={title}><summary className="cursor-pointer font-semibold">{title}</summary><p className="mt-3 leading-relaxed text-muted">{description}</p></details>)}</div>
        <div className="mt-7">{cta}</div><Link href="/ru/login" className="mt-5 inline-block text-sm underline underline-offset-4">Уже есть доступ? Войти</Link>
      </div>
    </Container></section>
  </main>;
}

export function SyntheticPreview() {
  return <aside id="report-example" aria-label="Вымышленный пример отчёта" className="scroll-mt-6 rounded-2xl border border-line bg-white p-5 shadow-card sm:p-6">
    <p className="text-xs font-medium uppercase tracking-wide text-muted">Пример результата · вымышленная компания</p>
    <h2 className="mt-3 text-lg font-semibold">Индекс управляемости</h2>
    <p className="mt-1 text-4xl font-semibold">54 <span className="text-sm font-normal text-muted">из 100 · зона развития</span></p>
    <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">{areas.map((area, index) => <div key={area}><p>{area}</p><div className="mt-1 h-1.5 rounded bg-tint"><div className="h-full rounded bg-brand/60" style={{width: `${[60, 48, 42, 58, 50, 65, 56, 53][index]}%`}}/></div></div>)}</div>
    <h3 className="mt-5 font-semibold">Что ограничивает развитие</h3>
    <p className="mt-2 text-sm leading-relaxed text-muted">Цели есть, но не у каждого результата есть ответственный и срок. Поэтому руководитель поздно узнаёт об отклонениях и вынужден сам возвращать задачи в работу.</p>
    <h3 className="mt-4 font-semibold">План на 30 / 60 / 90 дней</h3>
    <ol className="mt-2 space-y-2 text-sm leading-relaxed text-muted"><li><strong className="font-medium text-brand">30 дней:</strong> выбрать три приоритетных результата, назначить ответственных и сроки.</li><li><strong className="font-medium text-brand">60 дней:</strong> проверить, помогает ли еженедельный разбор отклонений выполнять договорённости.</li><li><strong className="font-medium text-brand">90 дней:</strong> закрепить работающий порядок и распространить его на остальные подразделения.</li></ol>
    <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">Это иллюстрация формата, а не результат реальной диагностики. Ваш отчёт будет основан на ваших ответах.</p>
  </aside>;
}
