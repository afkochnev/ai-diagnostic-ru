import {FreeLanding, LandingAudience, LandingFormats, LandingPreviewLabel, LandingScope, SyntheticPreview} from "@/features/acquisition/free-landing";
import Image from "next/image";
import {ButtonLink} from "@/components/ui/button-link";
import {Card} from "@/components/ui/card";
import {Container} from "@/components/ui/container";
import {localePath, type Locale} from "@/i18n/config";
import type {Messages} from "@/i18n/messages";

export function LandingPage({locale, messages, authenticated = false, acquisition = false, attribution = {}}: {locale: Locale; messages: Messages; authenticated?: boolean; acquisition?: boolean; attribution?: Record<string, string>}) {
  if (acquisition) return <FreeLanding authenticated={authenticated} attribution={attribution}/>;
  const content = messages.landing;
  const registrationPath = localePath(locale, authenticated ? "/account" : "/register");
  const cta = authenticated ? "Открыть кабинет" : content.cta;

  return <main id="main-content">
    <section className="border-b border-line py-8 sm:py-12" aria-labelledby="hero-title"><Container>
      <a href="https://iteam.ru" target="_blank" rel="noreferrer" className="mb-6 inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"><Image src="/brand/iteam-logo-landing.png" alt="iTeam" width={144} height={45} className="h-auto w-32 sm:w-36" priority/></a>
      <div className="grid items-start gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-10"><div>
        <p className="text-sm font-medium text-muted">Для собственников и руководителей компаний</p>
        <h1 id="hero-title" className="mt-3 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl lg:text-[2.65rem]">{content.title}</h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">{content.description}</p>
        <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center"><ButtonLink href={registrationPath}>{cta}</ButtonLink><LandingPreviewLabel/></div>
        <p className="mt-4 text-sm font-medium">Индивидуальная диагностика, AI-отчёт и PDF — бесплатно</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">80 вопросов с оценкой 1–5 и 4 открытых вопроса (2 можно пропустить). Можно сделать паузу и продолжить из кабинета.</p>
        {!authenticated && <p className="mt-2 text-sm leading-relaxed text-muted">Сначала создайте аккаунт и подтвердите email — для сохранения ответов и доступа к отчёту.</p>}
      </div><SyntheticPreview/></div>
    </Container></section>
    <LandingAudience/>
    <section id="benefits" className="scroll-mt-8 border-y border-line bg-white py-10 sm:py-14" aria-labelledby="benefits-title"><Container>
      <h2 id="benefits-title" className="section-title">{content.benefitsTitle}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">{content.benefits.map(benefit => <Card key={benefit.title}>
        <h3 className="text-xl leading-snug font-semibold tracking-tight">{benefit.title}</h3><p className="mt-3 max-w-md leading-relaxed text-muted">{benefit.description}</p>
      </Card>)}</div>
    </Container></section>
    <LandingScope/>
    <section id="steps" className="scroll-mt-8 border-y border-line bg-white py-10 sm:py-14" aria-labelledby="steps-title"><Container>
      <h2 id="steps-title" className="section-title">{content.stepsTitle}</h2>
      <ol className="mt-6 grid gap-6 md:grid-cols-3">{content.steps.map((step, index) => <li key={step} className="flex gap-4 border-t border-line pt-4 md:block">
        <span aria-hidden="true" className="text-xl font-medium text-brand/60 tabular-nums">0{index + 1}</span><p className="max-w-80 leading-relaxed md:mt-3">{step}</p>
      </li>)}</ol>
    </Container></section>
    <LandingFormats/>
    <section className="border-t border-line py-10 sm:py-14" aria-labelledby="access-title"><Container>
      <div className="max-w-3xl"><h2 id="access-title" className="section-title">Сохранение и доступ к результатам</h2>
        <p className="mt-4 leading-relaxed text-muted">Сохранённые ответы и отчёты доступны после входа в аккаунт. Перед началом работы вы подтверждаете согласие на обработку данных. Пример на этой странице вымышленный и не содержит ответов пользователей.</p>
        <div className="mt-6"><ButtonLink href={registrationPath}>{cta}</ButtonLink></div>
      </div>
    </Container></section>
  </main>;
}
