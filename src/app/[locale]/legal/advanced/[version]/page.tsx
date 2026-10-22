import {notFound} from 'next/navigation';
import {publishedCommercialTerms} from '@/server/billing/legal';
import {Container} from '@/components/ui/container';
import {LegalDocumentBody} from '@/components/legal-document-body';

export default async function AdvancedTermsPage({params}:{params:Promise<{version:string}>}){
 const {version}=await params,document=await publishedCommercialTerms(version);
 if(!document)notFound();
 return <main id="main-content" className="py-10"><Container>
  <LegalDocumentBody body={document.body}/>
 </Container></main>;
}
