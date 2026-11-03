import {notFound} from "next/navigation";
import {publishedPrivacyDocument} from "@/server/auth/legal";
import {LegalDocumentBody} from "@/components/legal-document-body";
import {Container} from "@/components/ui/container";

export default async function PrivacyVersionPage({params}: {params: Promise<{version: string}>}) {
  const {version} = await params;
  const document = await publishedPrivacyDocument(version);
  if (!document) notFound();
  return <main id="main-content" className="py-10"><Container>
    <p className="mb-6 text-sm text-muted">Действующий адрес для обращений: <a className="underline" href="mailto:alexander@iteamsystems.com">alexander@iteamsystems.com</a>.</p>
    <LegalDocumentBody body={document.body}/>
    <p className="mt-8 text-sm text-muted">Версия: {document.version}</p>
  </Container></main>;
}
