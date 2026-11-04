import { ButtonLink } from "@/components/ui/button-link";
import { localePath } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { requestLocale } from "@/server/locale";

export default async function NotFound() {
  const locale = await requestLocale();
  const messages = getMessages(locale);
  return <main id="main-content" className="mx-auto max-w-xl px-5 py-20"><p aria-hidden="true" className="mb-4 text-sm">404</p><h1 className="section-title">{messages.errors.notFoundTitle}</h1><p className="my-6 leading-relaxed">{messages.errors.notFoundDescription}</p><ButtonLink href={localePath(locale)}>{messages.site.home}</ButtonLink></main>;
}
