import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { localePath, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

export function LandingPage({ locale, messages, authenticated = false }: { locale: Locale; messages: Messages; authenticated?: boolean }) {
  const content = messages.landing;
  const registrationPath = localePath(locale, authenticated ? "/account" : "/register");

  return (
    <main id="main-content">
      <section className="border-b border-line py-14 sm:py-20 lg:py-25" aria-labelledby="hero-title">
        <Container>
          <div className="mb-7 h-1 w-12 rounded-full bg-brand/40" aria-hidden="true" />
          <h1 id="hero-title" className="max-w-4xl text-[2.25rem] leading-[1.13] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-[3.65rem]">{content.title}</h1>
          <p className="mt-7 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">{content.description}</p>
          <div className="mt-9"><ButtonLink href={registrationPath}>{content.cta}</ButtonLink></div>
        </Container>
      </section>

      <section id="benefits" className="scroll-mt-8 py-14 sm:py-20" aria-labelledby="benefits-title">
        <Container>
          <h2 id="benefits-title" className="section-title">{content.benefitsTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:gap-5">
            {content.benefits.map((benefit, index) => (
              <Card key={benefit.title}>
                <span aria-hidden="true" className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl bg-surface text-sm font-semibold tabular-nums">0{index + 1}</span>
                <h3 className="text-xl leading-snug font-semibold tracking-tight">{benefit.title}</h3>
                <p className="mt-3 max-w-md leading-relaxed text-muted">{benefit.description}</p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section aria-labelledby="scope-title">
        <Container>
          <div className="grid gap-5 rounded-2xl border border-line bg-tint p-6 sm:p-10 lg:grid-cols-[1fr_1.6fr] lg:gap-12">
            <h2 id="scope-title" className="section-title">{content.scopeTitle}</h2>
            <p className="text-base leading-relaxed sm:text-lg">{content.scopeDescription}</p>
          </div>
        </Container>
      </section>

      <section id="steps" className="scroll-mt-8 py-14 sm:py-20" aria-labelledby="steps-title">
        <Container>
          <h2 id="steps-title" className="section-title">{content.stepsTitle}</h2>
          <ol className="mt-9 grid gap-7 md:grid-cols-3 md:gap-10">
            {content.steps.map((step, index) => (
              <li key={step} className="flex gap-4 border-t border-line pt-5 md:block">
                <span aria-hidden="true" className="text-2xl font-medium text-brand/60 tabular-nums">0{index + 1}</span>
                <p className="max-w-72 text-lg leading-relaxed font-medium md:mt-5">{step}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 sm:mt-12"><ButtonLink href={registrationPath}>{content.cta}</ButtonLink></div>
        </Container>
      </section>
    </main>
  );
}
