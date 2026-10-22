import {z} from 'zod';

export const advancedTermsVersion='advanced-terms-ru-v1';
export const commercialAcceptanceSchema=z.strictObject({
 version:z.literal(advancedTermsVersion),sha256:z.string().regex(/^[a-f0-9]{64}$/),accepted:z.literal(true),
});
export type CommercialAcceptance=z.infer<typeof commercialAcceptanceSchema>;
export const commercialDocumentSchema=z.object({
 version:z.string().regex(/^advanced-terms-ru-v[1-9][0-9]*$/),title:z.string().min(1).max(300),body:z.string().min(100).max(200000),
 content_sha256:z.string().regex(/^[a-f0-9]{64}$/),approved_at:z.string(),
});
export function commercialTermsHref(version:string){return `/ru/legal/advanced/${encodeURIComponent(version)}`;}
export function commercialTermsRpc(terms:CommercialAcceptance){
 const t=commercialAcceptanceSchema.parse(terms);
 return {p_terms_version:t.version,p_terms_sha256:t.sha256,p_terms_accepted:t.accepted};
}
