import {notFound} from "next/navigation";
import {publishedPrivacyDocument} from "@/server/auth/legal";
import {LegalDocumentBody} from "@/components/legal-document-body";
import {Container} from "@/components/ui/container";

export default async function PrivacyVersionPage({params}: {params: Promise<{version: string}>}) {
  const {version} = await params;
  const document = await publishedPrivacyDocument(version);
  if (!document) notFound();
  return <main id="main-content" className="py-10"><Container>
    <LegalDocumentBody body={document.body}/>
    <p className="mt-8 text-sm text-muted">Версия: {document.version}</p>
  </Container></main>;
}
