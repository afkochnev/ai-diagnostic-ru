import {notFound} from 'next/navigation';
import {publishedCommercialTerms} from '@/server/billing/legal';
import {Container} from '@/components/ui/container';

export default async function AdvancedTermsPage({params}:{params:Promise<{version:string}>}){
 const {version}=await params,document=await publishedCommercialTerms(version);
 if(!document)notFound();
 return <main id="main-content" className="py-10"><Container>
  <h1 className="text-3xl font-semibold">{document.title}</h1>
  <p className="mt-3 text-muted">Версия: {document.version}</p>
  <article className="mt-8 whitespace-pre-wrap leading-relaxed">{document.body}</article>
 </Container></main>;
}
