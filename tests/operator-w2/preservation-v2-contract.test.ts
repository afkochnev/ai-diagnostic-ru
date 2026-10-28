import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import columns from './fixtures/preservation-columns.json';
import {CAPTURE_TABLES,MANAGED_STORAGE_CAPTURE_TABLES,MANAGED_STORAGE_CAPTURE_COLUMNS} from '../../scripts/operator-w2/capture-queries';
import {FIXED} from '../../scripts/operator-w2/contract';
import {preservationContext,validateSnapshot,validateAcceptedStageSnapshot,acceptedStageCaptureFingerprint,compareAcceptedStageSnapshots,type PreservationSnapshot} from '../../scripts/operator-w2/preservation';
const H=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const context=preservationContext({rootId:FIXED.root,planSHA256:'a'.repeat(64),expectedSHA:'b'.repeat(40)});
function capture():PreservationSnapshot{
 const s:PreservationSnapshot={format:'ACA_W2_PRESERVATION_HMAC_V2',algorithm:'HMAC-SHA256',context,capturedAt:'2026-10-25T10:00:00Z',databaseClock:'2026-10-25T10:00:00Z',transactionReadOnly:'on',timezone:'UTC',project:null,tables:Object.fromEntries(CAPTURE_TABLES.map(t=>[t,{columns:(columns as Record<string,string[]>)[t],rows:[]}])),catalogue:H('full-catalogue'),ledger:{count:58,digest:H('exact-ledger58')},gates:{launch:1,financial:0},wireTraces:[]};
 const name='private.controlled_team_policy';s.tables[name].rows.push({key:H('policy-key'),full:H('policy-full'),fields:Object.fromEntries(s.tables[name].columns.map(c=>[c,H(['policy',c])])),facts:null});return s;
}
function later(s:PreservationSnapshot){const a=structuredClone(s);a.capturedAt='2026-10-25T10:00:01Z';a.databaseClock=a.capturedAt;return a;}
describe('native v2 accepted-stage preservation contract',()=>{
 it('accepts one unchanged complete pair under the exact explicit nonsecret context',()=>{const a=capture(),b=later(a);expect(validateAcceptedStageSnapshot(a,context)).toBe(a);expect(compareAcceptedStageSnapshots(a,b,context).status).toBe('PASS');expect(acceptedStageCaptureFingerprint(a,context)).toBe(acceptedStageCaptureFingerprint(b,context));expect(Object.keys(a)).not.toContain('keyId');expect(compareAcceptedStageSnapshots(a,b,context).productionOrW2Authorization).toBe(false);});
 it('keeps acceptance branch separate from configured production and refuses its root fixture',()=>{expect(()=>validateSnapshot(capture(),context)).toThrow();const configured=capture();configured.project=FIXED.project;configured.gates.launch=0;expect(validateSnapshot(configured,context)).toBe(configured);expect(()=>validateAcceptedStageSnapshot(configured,context)).toThrow();for(const t of ['private.controlled_team_runs','private.controlled_team_effects','private.controlled_team_windows','private.controlled_team_verifications','private.controlled_team_auth_wire']){const x=capture();x.tables[t].rows.push({key:H(t),full:H('row'),fields:Object.fromEntries(x.tables[t].columns.map(c=>[c,H(c)])),facts:null});expect(()=>validateAcceptedStageSnapshot(x,context)).toThrow();}});
 it('rejects legacy/extra key-fingerprint fields, unknown algorithms, bad ledger counts and open financial gates',()=>{for(const edit of [(s:PreservationSnapshot)=>{(s as unknown as Record<string,unknown>).keyId=H('key-fingerprint');},(s:PreservationSnapshot)=>{s.format='ACA_W2_PRESERVATION_HMAC_V1' as typeof s.format;},(s:PreservationSnapshot)=>{s.algorithm='sha256' as typeof s.algorithm;},(s:PreservationSnapshot)=>{s.ledger.count=56;},(s:PreservationSnapshot)=>{s.ledger.count=57;},(s:PreservationSnapshot)=>{s.gates.financial=1;},(s:PreservationSnapshot)=>{s.gates.launch=0;},(s:PreservationSnapshot)=>{s.tables['private.controlled_team_policy'].rows=[];},(s:PreservationSnapshot)=>{s.project='vflgxgdwlftlyjslyrmo';},(s:PreservationSnapshot)=>{(s.tables['auth.users'] as unknown as Record<string,unknown>).rawHeader='unexpected';}]){const s=capture();edit(s);expect(()=>validateAcceptedStageSnapshot(s,context)).toThrow();}});
 it('binds domain/version/root/plan and exact runtime SHA rather than accepting schema defaults',()=>{for(const bad of [{...context,domain:'other'},{...context,version:2},{...context,rootRunId:'00000000-0000-4000-8000-000000000001'},{...context,approvedPlanSHA256:'c'.repeat(64)},{...context,canonicalAppSHA:'c'.repeat(40)}]){expect(()=>validateAcceptedStageSnapshot(capture(),bad as typeof context)).toThrow();const s=capture();s.context=bad as typeof context;expect(()=>validateAcceptedStageSnapshot(s,context)).toThrow();}expect(()=>validateAcceptedStageSnapshot(capture(),undefined as unknown as typeof context)).toThrow();});
 it('requires a new independent fingerprint bridge across candidate-to-merge contexts',()=>{const a=capture(),b=later(a),newContext={...context,canonicalAppSHA:'d'.repeat(40)};b.context=newContext;expect(()=>compareAcceptedStageSnapshots(a,b,context)).toThrow();expect(()=>compareAcceptedStageSnapshots(a,b,newContext)).toThrow();});
 it('holds any changed full-row or cell commitment across all122 tables without excluding timestamps',()=>{for(const t of CAPTURE_TABLES){const a=capture(),cols=a.tables[t].columns,row={key:H(t),full:H('old-row'),fields:Object.fromEntries(cols.map(c=>[c,H(c)])),facts:null};if(t==='private.controlled_team_policy'){a.tables[t].rows[0]=row;}else a.tables[t].rows.push(row);const b=later(a);b.tables[t].rows.find(r=>r.key===row.key)!.full=H('changed');expect(()=>compareAcceptedStageSnapshots(a,b,context),t).toThrow();const d=later(a);d.tables[t].rows.find(r=>r.key===row.key)!.fields[cols[0]]=H('changed-cell');expect(()=>compareAcceptedStageSnapshots(a,d,context),t).toThrow();}});
 it('rejects catalogue/ledger/facts drift, omitted Auth security fields and reversed capture clocks',()=>{for(const edit of [(s:PreservationSnapshot)=>{s.catalogue=H('drift');},(s:PreservationSnapshot)=>{s.ledger.digest=H('drift');},(s:PreservationSnapshot)=>{s.tables['private.controlled_team_policy'].rows[0].facts={unexpected:true};},(s:PreservationSnapshot)=>{s.tables['auth.users'].columns=s.tables['auth.users'].columns.filter(c=>c!=='updated_at');},(s:PreservationSnapshot)=>{s.capturedAt='2000-01-01T00:00:00Z';}]){const a=capture(),b=later(a);edit(b);expect(()=>compareAcceptedStageSnapshots(a,b,context)).toThrow();}});
 it('never evaluates getters while rejecting unexpected snapshot or caller-context data',()=>{let n=0;const x=capture();Object.defineProperty(x,'unexpected',{get(){n++;return 'secret';}});expect(()=>validateAcceptedStageSnapshot(x,context)).toThrow();const bad={...context};Object.defineProperty(bad,'unexpected',{get(){n++;return 'secret';}});expect(()=>validateAcceptedStageSnapshot(capture(),bad)).toThrow();expect(n).toBe(0);});
});

describe('exact managed-storage inventory contract',()=>{
 it('matches every raw SQL arm, SQL capture list and SQL complete-inventory guard without a wildcard',()=>{
  const source=readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261025175943_controlled_team_managed_storage_capture.sql',import.meta.url)),'utf8');
  const raw=[...source.matchAll(/select '([a-z0-9_]+[.][a-z0-9_]+)' name,to_jsonb\(r\) j from ([a-z0-9_]+[.][a-z0-9_]+) r/g)];
  expect(raw).toHaveLength(122);expect(raw.every(m=>m[1]===m[2])).toBe(true);expect(raw.map(m=>m[1]).sort()).toEqual([...CAPTURE_TABLES].sort());
  const captures=source.match(/captures as materialized\(select unnest\(ARRAY\[([^\]]+)\]::text\[\]\) name\)/)?.[1];
  const guard=source.match(/is distinct from ARRAY\[([^\]]+)\]::text\[\] then raise exception 'controlled_team_capture_denied'/)?.[1];
  for(const list of [captures,guard])expect([...String(list).matchAll(/'([^']+)'/g)].map(m=>m[1])).toEqual([...CAPTURE_TABLES]);
  expect(MANAGED_STORAGE_CAPTURE_TABLES).toEqual(['storage.buckets_analytics','storage.buckets_vectors','storage.migrations','storage.s3_multipart_uploads','storage.s3_multipart_uploads_parts','storage.vector_indexes']);
 });
 it('holds missing managed tables, missing cells, any added123rd table and storage catalogue ownership drift',()=>{
  for(const t of MANAGED_STORAGE_CAPTURE_TABLES){expect((columns as Record<string,string[]>)[t]).toEqual(MANAGED_STORAGE_CAPTURE_COLUMNS[t]);const omitted=capture();delete omitted.tables[t];expect(()=>validateAcceptedStageSnapshot(omitted,context),t).toThrow();const bad=capture();bad.tables[t].columns=bad.tables[t].columns.slice(1);expect(()=>validateAcceptedStageSnapshot(bad,context),t).toThrow();const widened=capture();widened.tables[t].columns.push('unreviewed_column');expect(()=>validateAcceptedStageSnapshot(widened,context),t).toThrow();}
  const extra=capture();extra.tables['storage.unreviewed_123rd']={columns:['id'],rows:[]};expect(()=>validateAcceptedStageSnapshot(extra,context)).toThrow();
  const a=capture(),b=later(a);b.catalogue=H('changed-managed-relation-owner');expect(()=>compareAcceptedStageSnapshots(a,b,context)).toThrow();
 });
 it('keeps every managed storage row and cell immutable, including storage.migrations history',()=>{
  for(const t of MANAGED_STORAGE_CAPTURE_TABLES){const a=capture(),cols=a.tables[t].columns,row={key:H(t),full:H([t,'row']),fields:Object.fromEntries(cols.map(c=>[c,H([t,c])])),facts:null};a.tables[t].rows.push(row);
   const b=later(a);b.tables[t].rows[0].full=H('changed row');expect(()=>compareAcceptedStageSnapshots(a,b,context),t).toThrow();
   for(const col of cols){const c=later(a);c.tables[t].rows[0].fields[col]=H('changed managed cell');expect(()=>compareAcceptedStageSnapshots(a,c,context),t+'.'+col).toThrow();const d=later(a);delete d.tables[t].rows[0].fields[col];expect(()=>validateAcceptedStageSnapshot(d,context),t+'.'+col).toThrow();}
   const removed=later(a);removed.tables[t].rows=[];expect(()=>compareAcceptedStageSnapshots(a,removed,context),t).toThrow();
  }
 });
});
