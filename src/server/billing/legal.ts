import 'server-only';
import {createHash} from 'node:crypto';
import {billingRpc} from './service';
import {advancedTermsVersion,commercialDocumentSchema} from './legal-contract';

// A missing approved source is unavailable, never a generated legal placeholder.
export async function currentCommercialTerms(){
 let data:unknown;
 try{data=await billingRpc('billing_current_commercial_terms',{});}catch{return null;}
 const parsed=commercialDocumentSchema.safeParse(data);
 if(!parsed.success||parsed.data.version!==advancedTermsVersion)return null;
 if(createHash('sha256').update(parsed.data.body).digest('hex')!==parsed.data.content_sha256)return null;
 return parsed.data;
}
export async function publishedCommercialTerms(version:string){
 if(!/^advanced-terms-ru-v[1-9][0-9]*$/.test(version))return null;
 let data:unknown;
 try{data=await billingRpc('billing_read_commercial_document',{p_version:version});}catch{return null;}
 const parsed=commercialDocumentSchema.safeParse(data);
 if(!parsed.success||parsed.data.version!==version||createHash('sha256').update(parsed.data.body).digest('hex')!==parsed.data.content_sha256)return null;
 return parsed.data;
}
