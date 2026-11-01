import Link from "next/link";
import { Container } from "@/components/ui/container";
import { localePath, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { logoutAction } from "@/server/auth/actions";

export function SiteHeader({ locale, messages, signedIn }: { locale: Locale; messages: Messages; signedIn: boolean }) {
  return (
    <header className="border-b border-line bg-white">
      <Container className="flex min-h-22 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4 sm:flex-nowrap sm:py-5">
        <Link href={localePath(locale)} className="flex max-w-70 items-center gap-3 text-sm font-semibold leading-snug">
          {/* Reserved for the official logo; intentionally no invented brand mark. */}
          <span data-logo-slot aria-hidden="true" className="hidden h-8 w-10 shrink-0 sm:block" />
          <span>{messages.site.name}</span>
        </Link>
        <nav aria-label={messages.site.navigation} className="flex w-full min-w-0 flex-wrap items-center justify-end gap-3 text-sm sm:w-auto sm:shrink-0 sm:gap-6">
          {signedIn && <Link className="flex min-h-11 items-center underline" href="/ru/companies">Компании</Link>}
          {signedIn && <Link className="flex min-h-11 items-center underline" href="/ru/profile">Профиль пользователя</Link>}
          {signedIn ? <form action={logoutAction}><button className="min-h-11 cursor-pointer underline">{messages.auth.logout}</button></form> : <Link className="flex min-h-11 items-center underline" href="/ru/login">{messages.auth.loginLink}</Link>}
        </nav>
      </Container>
    </header>
  );
}
