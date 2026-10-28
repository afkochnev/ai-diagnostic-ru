import {createHmac} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {assertEvidenceChannelContext,deriveEvidenceChannelKey,evidenceChannelHeader,evidenceChannelMAC,evidenceKeyContextMessage,type EvidenceKeyContext,type EvidenceChannelKey} from '@/server/team/evidence-channel-key';
const secret='synthetic-existing-auth-flow-root-secret-for-local-tests';
const context:EvidenceKeyContext={domain:'aca-w2-evidence-key',version:1,rootRunId:'10000000-0000-4000-8000-000000000001',approvedPlanSHA256:'a'.repeat(64),canonicalAppSHA:'b'.repeat(40)};
describe('purpose-separated existing-root evidence key',()=>{
 it('derives exactly32 bytes with canonical immutable context and SQL-compatible byte decoding',()=>{
  const key=deriveEvidenceChannelKey(secret,context),message='synthetic nonsecret message';
  const canonical=['aca-w2-evidence-key','1',context.rootRunId,context.approvedPlanSHA256,context.canonicalAppSHA].join('\n');
  expect(evidenceKeyContextMessage(context)).toBe(canonical);
  const expected=createHmac('sha256',Buffer.from(secret,'utf8')).update(canonical,'utf8').digest();
  const header=evidenceChannelHeader(key);expect(header).toMatch(/^aca-w2-v1\.[a-f0-9]{64}$/);
  expect(Buffer.from(header.slice('aca-w2-v1.'.length),'hex')).toEqual(expected);
  expect(evidenceChannelMAC(key,message)).toBe(createHmac('sha256',expected).update(message,'utf8').digest('hex'));
  expect(evidenceChannelMAC(key,message)).not.toBe(createHmac('sha256',header).update(message).digest('hex'));
  expect(JSON.stringify(key)).toBe('{"kind":"controlled-team-evidence-key-v1"}');
  expect(JSON.stringify(key)).not.toContain(header);expect(Object.isFrozen(key)).toBe(true);
 });
 it('binds each context identity and root secret without clocks or mutable caller references',()=>{
  const input={...context},key=deriveEvidenceChannelKey(secret,input),original=evidenceChannelMAC(key,'x');input.approvedPlanSHA256='c'.repeat(64);
  expect(evidenceChannelMAC(key,'x')).toBe(original);
  expect(()=>assertEvidenceChannelContext(key,context)).not.toThrow();
  expect(()=>assertEvidenceChannelContext(key,{...context,canonicalAppSHA:'c'.repeat(40)})).toThrow('controlled_team_evidence_key_unavailable');
  for(const altered of [{...context,rootRunId:'10000000-0000-4000-8000-000000000002'},{...context,approvedPlanSHA256:'c'.repeat(64)},{...context,canonicalAppSHA:'c'.repeat(40)}])expect(evidenceChannelMAC(deriveEvidenceChannelKey(secret,altered),'x')).not.toBe(original);
  expect(evidenceChannelMAC(deriveEvidenceChannelKey(secret+'different',context),'x')).not.toBe(original);
 });
 it.each([{...context,version:2},{...context,domain:'other'},{...context,rootRunId:'A0000000-0000-4000-8000-000000000001'},{...context,approvedPlanSHA256:'A'.repeat(64)},{...context,canonicalAppSHA:'short'},{...context,now:123}])('rejects noncanonical context without echoing values',value=>{
  expect(()=>deriveEvidenceChannelKey(secret,value as EvidenceKeyContext)).toThrow('controlled_team_evidence_key_unavailable');
 });
 it.each(['','short','x'.repeat(4097),'x'.repeat(32)+'\ud800'])('refuses invalid root secrets',value=>{
  expect(()=>deriveEvidenceChannelKey(value,context)).toThrow('controlled_team_evidence_key_unavailable');
 });
 it('rejects cloned/forged handles rather than allowing raw strings or service keys',()=>{
  const key=deriveEvidenceChannelKey(secret,context);
  for(const value of [{...key},'Bearer synthetic-existing-service-key',Buffer.alloc(32)]){
   expect(()=>evidenceChannelMAC(value as EvidenceChannelKey,'x')).toThrow('controlled_team_evidence_key_unavailable');
   expect(()=>evidenceChannelHeader(value as EvidenceChannelKey)).toThrow('controlled_team_evidence_key_unavailable');
  }
 });
});
