import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({cookies:vi.fn(),headers:vi.fn()}));
vi.mock('@/server/rate-limit',()=>({enforceRateLimit:vi.fn()}));
import {acquisitionEnabled,safeAttribution,shortProfileSchema,saveSchema} from '@/server/acquisition/contracts';
import {decodeCookie,hash,newSecret} from '@/server/acquisition/context';
import {acquisitionJson} from '@/server/acquisition/request';
import {sealInvitationAuthProof} from '@/server/team/invitation-auth-proof';
import {teamConversionDestination} from '@/features/acquisition/team-offer';
vi.mock('@/server/supabase/server',()=>({createAuthClient:vi.fn()}));
vi.mock('@/server/entitlements',()=>({getAccountPlan:vi.fn()}));
vi.mock('@/server/team/service',()=>({listTeams:vi.fn()}));
const baseline={name:'Synthetic','industry_key':'manufacturing',employee_count:30,products:'Products',key_problems:'Constraint',main_goals:'Goals'};
describe('V25 anonymous security boundaries',()=>{
 it('keeps production and mixed project/origin pairs disabled',()=>{
  expect(acquisitionEnabled({NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'})).toBe(false);
  expect(acquisitionEnabled({APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'})).toBe(true);
  expect(acquisitionEnabled({APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'})).toBe(false);
  expect(acquisitionEnabled({NODE_ENV:'development',APP_URL:'http://127.0.0.1:3250',SUPABASE_URL:'http://127.0.0.1:55321'})).toBe(true);
  expect(acquisitionEnabled({NODE_ENV:'production',APP_URL:'http://127.0.0.1:3250',SUPABASE_URL:'http://127.0.0.1:55321'})).toBe(false);
 });
 it('a UUID alone and malformed cookies never authorize answers',()=>{
  const id='10000000-0000-4000-8000-000000000001',secret=newSecret();expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect(decodeCookie(id)).toBeNull();expect(decodeCookie(`${id}.bad`)).toBeNull();expect(decodeCookie(`${id}.${secret}`)?.hash).toBe(hash(secret));
  expect(hash(secret)).not.toBe(secret);expect(newSecret()).not.toBe(secret);
 });
 it('accepts bounded first-touch fields, dropping full URLs/PII-shaped metadata',()=>{
  expect(safeAttribution({utm_source:'blog.iteam.ru',utm_medium:'popup',utm_campaign:'ai_audit',email:'synthetic@example.test',referrer_host:'https://host/?private=yes',utm_content:'x'.repeat(101)})).toEqual({utm_source:'blog.iteam.ru',utm_medium:'popup',utm_campaign:'ai_audit'});
 });
 it('keeps absent optional Company context unknown rather than manufacturing facts',()=>{
  const parsed=shortProfileSchema.parse(baseline);expect(parsed.country).toBeNull();expect(parsed.annual_revenue_key).toBeNull();expect(parsed.company_age_years).toBeNull();expect(parsed.management_levels).toBeNull();expect(parsed.products).toBe('Products');
  expect(shortProfileSchema.safeParse({...baseline,employee_count:0}).success).toBe(false);
  expect(shortProfileSchema.safeParse({...baseline,employee_count:3.5}).success).toBe(false);
  expect(shortProfileSchema.safeParse({...baseline,account_id:'foreign'}).success).toBe(false);
  expect(shortProfileSchema.safeParse({...baseline,main_goals:''}).success).toBe(false);
 });
 it('validates revision/mutation IDs and scale range independently of the runner',()=>{
  const input={expected_revision:1,mutation_id:crypto.randomUUID(),current_block_id:crypto.randomUUID(),answers:[{question_id:crypto.randomUUID(),value:4}]};
  expect(saveSchema.safeParse(input).success).toBe(true);expect(saveSchema.safeParse({...input,expected_revision:0}).success).toBe(false);
  expect(saveSchema.safeParse({...input,answers:[{question_id:input.answers[0].question_id,value:5}]}).success).toBe(false);
  expect(saveSchema.safeParse({...input,answers:[{question_id:input.answers[0].question_id,value:'x'.repeat(10001)}]}).success).toBe(false);
 });
 it('bounds streamed body bytes even when Content-Length is omitted or dishonest',async()=>{
  const req=new Request('http://localhost',{method:'POST',body:JSON.stringify({safe:true})});expect(await acquisitionJson(req)).toEqual({safe:true});
  await expect(acquisitionJson(new Request('http://localhost',{method:'POST',body:'x'.repeat(40)}),20)).rejects.toThrow('too_large');
  await expect(acquisitionJson(new Request('http://localhost',{method:'POST',headers:{'content-length':'999999'},body:'{}'}),20)).rejects.toThrow('too_large');
 });
 it('uses an existing team, same-company Advanced creation, or an explanatory Free destination',()=>{
  expect(teamConversionDestination('company',false)).toBe('/ru/companies/company/team-explainer');
  expect(teamConversionDestination('company',true)).toContain('/company/diagnostics?new=1&type=team');
  expect(teamConversionDestination('company',false,'team')).toBe('/ru/companies/company/teams/team');
 });
 it('separates the Supabase credential envelope from Team and rejects cross-flow reuse',async()=>{
  const {openInvitationAuthProof}=await import('@/server/team/invitation-auth-proof');const secret='synthetic-secret-for-unit-tests-000000000';
  const proof={email:'synthetic@example.test',invitationHash:hash('session'),tokenHash:'a'.repeat(64),type:'invite' as const};
  const encoded=sealInvitationAuthProof(proof,`anonymous-access/v1/${secret}`,1000);
  expect(openInvitationAuthProof(encoded,hash('session'),secret,1100)).toBeNull();
  expect(openInvitationAuthProof(encoded,hash('session'),`anonymous-access/v1/${secret}`,1100)?.email).toBe(proof.email);
  expect(encoded).not.toContain(proof.email);expect(encoded).not.toContain(proof.tokenHash);
 });
});
