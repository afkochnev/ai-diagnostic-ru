import { z } from "zod";

export const SYNTHESIS_OVERLAP_THRESHOLD = 32;
export const privacyCorpusSchema = z.strictObject({
  threshold: z.literal(SYNTHESIS_OVERLAP_THRESHOLD),
  answers: z.array(z.strictObject({ question_index: z.number().int().positive(), text: z.string() })),
  identifiers: z.array(z.string().min(1)),
});
export type PrivacyCorpus = z.infer<typeof privacyCorpusSchema>;
export type StringLeaf = { path: string; tokens: (string | number)[]; value: string };
export type OverlapDiagnostic = { field_path: string; match_length: number; source_question_index: number };
export type PrivacyInspection = { overlaps: OverlapDiagnostic[]; policyViolation: boolean };

/** Code points (Postgres characters), not UTF-16 units. Retain exact and NFC modes. */
export function normalizePrivacyText(value: string) {
  return value.normalize("NFC").toLowerCase().replace(/\u03c2/g,"σ").replace(/i\u0307/g,"i").trim().replace(/\s+/gu," ");
}
export function stringLeaves(value: unknown, tokens: (string | number)[] = [], path = ""): StringLeaf[] {
  if (typeof value === "string") return [{ path, tokens, value }];
  if (Array.isArray(value)) return value.flatMap((v,i)=>stringLeaves(v,[...tokens,i],`${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k,v])=>
    stringLeaves(v,[...tokens,k],/^[a-zA-Z_]\w*$/.test(k) ? `${path ? path+"." : ""}${k}` : `${path}[${JSON.stringify(k)}]`));
  return [];
}
/** PostgreSQL jsonb canonical key order + lax $.** string filtering (array leaves repeat).
 * This also covers a forbidden fragment spanning three or more short fields. */
function dbStringLeaves(value: unknown, tokens: (string | number)[] = [], path = ""): StringLeaf[] {
  if(typeof value==="string") return stringLeaves(value,tokens,path);
  if(Array.isArray(value)) return [
    ...value.flatMap((v,i)=>typeof v==="string"?stringLeaves(v,[...tokens,i],`${path}[${i}]`):[]),
    ...value.flatMap((v,i)=>dbStringLeaves(v,[...tokens,i],`${path}[${i}]`)),
  ];
  if(value && typeof value==="object") return Object.keys(value).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b))).flatMap(k=>
    dbStringLeaves((value as Record<string,unknown>)[k],[...tokens,k],/^[a-zA-Z_]\w*$/.test(k)?`${path?path+".":""}${k}`:`${path}[${JSON.stringify(k)}]`));
  return [];
}
const policy = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\+?[0-9][0-9 ()\-]{7,}[0-9]|https?:\/\/|www\.|ignore\s+previous\s+instructions|system\s+prompt|developer\s+message|игнорируй\s+предыдущ|(?:респондент|участник|respondent)\s*[0-9]|(?:со слов|по словам)\s+(?:участник|респондент|руководител)|(?:один|одна|анонимный)\s+(?:из\s+)?(?:участник|респондент)|(?:участник|респондент)\s+(?:сообщил|отметил|считает|сказал)/iu;

/** No raw fragments/identities/generated values escape in diagnostics or exceptions. */
export function inspectTeamOutputPrivacy(output: unknown, corpus: PrivacyCorpus) {
  if (corpus.answers.reduce((n,a)=>n+Array.from(a.text).length,0)>500000) throw new Error("team_privacy_rejected");
  const leaves = stringLeaves(output), found = new Map<string,OverlapDiagnostic>();
  let policyViolation = false;
  const policyFields = new Set<string>();
  const modes = [(s:string)=>s.toLowerCase(), normalizePrivacyText];
  for (const normalize of modes) {
    const index = new Map<string,number>();
    for (const a of corpus.answers) {
      const chars = Array.from(normalize(a.text));
      for (let i=0;i<=chars.length-SYNTHESIS_OVERLAP_THRESHOLD;i++) index.set(chars.slice(i,i+SYNTHESIS_OVERLAP_THRESHOLD).join(""),a.question_index);
    }
    const identifiers = corpus.identifiers.map(normalize);
    const scan = (text: string, paths: string[] | ((offset: number,length: number)=>string[])) => {
      const flagPolicy = (start: number, length: number) => {
        policyViolation = true;
        const offset=Array.from(text.slice(0,start)).length;
        for(const path of typeof paths==="function" ? paths(offset,Array.from(text.slice(start,start+length)).length) : paths) policyFields.add(path);
      };
      for(const match of text.matchAll(new RegExp(policy.source,policy.flags+"g"))) flagPolicy(match.index,match[0].length);
      for(const id of identifiers) {
        if(!id) continue;
        let at=text.indexOf(id);
        while(at>=0) {flagPolicy(at,id.length);at=text.indexOf(id,at+id.length);}
      }
      const chars=Array.from(text);
      for (let i=0;i<=chars.length-SYNTHESIS_OVERLAP_THRESHOLD;i++) {
        const q=index.get(chars.slice(i,i+SYNTHESIS_OVERLAP_THRESHOLD).join(""));
        if(q===undefined) continue;
        const length=SYNTHESIS_OVERLAP_THRESHOLD; // exact witnessed length; never infer a longer match from different sources
        for(const path of typeof paths==="function" ? paths(i,length) : paths) {
          const old=found.get(path);
          if(!old || old.match_length<length) found.set(path,{field_path:path,match_length:length,source_question_index:q});
        }
      }
    };
    const values=leaves.map(leaf=>normalize(leaf.value));
    values.forEach((value,i)=>scan(value,[leaves[i].path]));
    const ordered=dbStringLeaves(output).map(leaf=>({...leaf,text:normalize(leaf.value)}));
    const parts=normalize===normalizePrivacyText?ordered.filter(leaf=>leaf.text.length>0):ordered;
    let offset=0;const ranges=parts.map(leaf=>{const start=offset;offset+=Array.from(leaf.text).length+1;return {start,end:offset-1,path:leaf.path};});
    scan(parts.map(leaf=>leaf.text).join(normalize===normalizePrivacyText?" ":"\n"),
      (start,length)=>ranges.filter(r=>r.start<start+length&&r.end>start).map(r=>r.path));
  }
  const overlaps=[...found.values()];
  // Zero length/source denotes a policy match, not a fragment of an open answer.
  const violations=[...overlaps,...[...policyFields].filter(path=>!found.has(path)).map(field_path=>({field_path,match_length:0,source_question_index:0}))];
  return {overlaps,policyViolation,violations};
}
export function inspectSynthesisPrivacy(output: unknown, corpus: PrivacyCorpus): PrivacyInspection {
  const {overlaps,policyViolation}=inspectTeamOutputPrivacy(output,corpus);
  return {overlaps,policyViolation};
}
