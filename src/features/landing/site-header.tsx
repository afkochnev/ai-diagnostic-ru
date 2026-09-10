import Link from "next/link";
import { Container } from "@/components/ui/container";
import { localePath, type Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import { logoutAction } from "@/server/auth/actions";

export function SiteHeader({ locale, messages, signedIn }: { locale: Locale; messages: Messages; signedIn: boolean }) {
  return (
    <header className="border-b border-line bg-white">
      <Container className="flex min-h-22 items-center justify-between gap-6 py-5">
        <Link href={localePath(locale)} className="flex max-w-70 items-center gap-3 text-sm font-semibold leading-snug">
          {/* Reserved for the official logo; intentionally no invented brand mark. */}
          <span data-logo-slot aria-hidden="true" className="hidden h-8 w-10 shrink-0 sm:block" />
          <span>{messages.site.name}</span>
        </Link>
        <nav aria-label={messages.site.navigation} className="flex shrink-0 flex-wrap items-center justify-end gap-3 text-sm sm:gap-6">
          {signedIn ? <form action={logoutAction}><button className="min-h-11 cursor-pointer underline">{messages.auth.logout}</button></form> : <Link className="flex min-h-11 items-center underline" href="/ru/login">{messages.auth.loginLink}</Link>}
        </nav>
      </Container>
    </header>
  );
}
