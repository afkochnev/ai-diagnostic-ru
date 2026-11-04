import Link from "next/link";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";

export function EnglishPilotLanding({ authenticated }: { authenticated: boolean }) {
  const destination = authenticated ? "/en/account" : "/en/register";
  return <main id="main-content" className="py-12 sm:py-20"><Container>
    <section className="max-w-4xl"><p className="text-sm font-semibold uppercase tracking-wide text-muted">Individual assessment · English pilot</p><h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Understand what is holding a company back.</h1><p className="mt-6 max-w-3xl text-xl leading-relaxed">Explore eight management areas, read a reasoned analysis and prepare a practical 30 / 60 / 90-day action plan.</p><Link href={destination} className="mt-8 inline-flex min-h-14 items-center justify-center rounded-xl bg-brand px-6 py-3 font-semibold text-white">{authenticated ? "Open your workspace" : "Try the Individual assessment"}</Link><p className="mt-4 text-sm text-muted">Allow about 20 minutes. Your answers are saved so you can pause and return.</p></section>
    <section aria-labelledby="pilot-value" className="mt-12"><h2 id="pilot-value" className="text-2xl font-semibold">A useful starting point for a management conversation</h2><div className="mt-5 grid gap-5 md:grid-cols-3">{[
      ["A structured view", "A management health index and a profile across eight areas, grounded in the respondent’s assessment of the company."],
      ["A reasoned report", "An explanation of strengths, constraints and possible causes, connected to company context and goals."],
      ["Practical next steps", "Actions for the next 30, 60 and 90 days, with a report you can read online or download as a PDF."],
    ].map(([title, description]) => <Card key={title}><h3 className="text-lg font-semibold">{title}</h3><p className="mt-3 leading-relaxed text-muted">{description}</p></Card>)}</div></section>
    <section className="mt-10 max-w-3xl"><h2 className="text-2xl font-semibold">For consultants exploring the product</h2><p className="mt-4 leading-relaxed text-muted">Try the assessment yourself to understand the questions, results and report. This iteration covers the Individual experience. Consultant-managed client invitations, English Team assessments and pilot packages are being prepared separately.</p><p className="mt-4 text-sm text-muted">Results reflect the answers supplied. They support professional discussion and do not represent an independent verification of the company.</p></section>
  </Container></main>;
}
