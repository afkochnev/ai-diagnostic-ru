import { requestLocale } from "@/server/locale";
import {notFound} from "next/navigation";
import {publishedPrivacyDocument} from "@/server/auth/legal";
import {LegalDocumentBody} from "@/components/legal-document-body";
import {Container} from "@/components/ui/container";

export default async function PrivacyVersionPage({params}: {params: Promise<{version: string}>}) {
  const locale = await requestLocale();
  const {version} = await params;
  const document = await publishedPrivacyDocument(version);
  if (!document) notFound();
  return <main id="main-content" className="py-10"><Container>
    <p className="mb-6 text-sm text-muted">{locale === "en" ? "Current contact:" : "Действующий адрес для обращений:"} <a className="underline" href="mailto:alexander@iteamsystems.com">alexander@iteamsystems.com</a>.</p>
    {locale === "en" && <p className="mb-6 rounded-xl bg-tint p-4 text-sm">The current published legal document below is in Russian. This is the original text and version; it has not been translated or replaced. English terms for international paid pilots will be reviewed separately.</p>}
    <LegalDocumentBody body={document.body}/>
    <p className="mt-8 text-sm text-muted">{locale === "en" ? "Version:" : "Версия:"} {document.version}</p>
  </Container></main>;
}
