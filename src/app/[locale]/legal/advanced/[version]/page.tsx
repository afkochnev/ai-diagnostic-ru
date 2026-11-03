import {notFound} from 'next/navigation';
import {publishedCommercialTerms} from '@/server/billing/legal';
import {Container} from '@/components/ui/container';
import {LegalDocumentBody} from '@/components/legal-document-body';

export default async function AdvancedTermsPage({params}:{params:Promise<{version:string}>}){
 const {version}=await params,document=await publishedCommercialTerms(version);
 if(!document)notFound();
 return <main id="main-content" className="py-10"><Container>
  <p className="mb-6 text-sm text-muted">Действующий адрес для обращений: <a className="underline" href="mailto:alexander@iteamsystems.com">alexander@iteamsystems.com</a>.</p>
  <LegalDocumentBody body={document.body}/>
 </Container></main>;
}
