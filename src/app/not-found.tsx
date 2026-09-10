import { ButtonLink } from "@/components/ui/button-link";
import { defaultLocale, localePath } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";

export default function NotFound() {
  const messages = getMessages(defaultLocale);
  return <main id="main-content" className="mx-auto max-w-xl px-5 py-20"><p aria-hidden="true" className="mb-4 text-sm">404</p><h1 className="section-title">{messages.errors.notFoundTitle}</h1><p className="my-6 leading-relaxed">{messages.errors.notFoundDescription}</p><ButtonLink href={localePath(defaultLocale)}>{messages.site.home}</ButtonLink></main>;
}
