import {it,expect} from 'vitest';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {captureFingerprint,consumeSnapshot,validateSnapshot} from '../../scripts/operator-w2/preservation';
import {FIXED} from '../../scripts/operator-w2/contract';
/** The isolated SQL suite optionally exports its actual argless READ ONLY RPC
 * capture to0600 private tmp. This checks the source-produced schema/HMAC wire
 * shape, never hosted Auth behavior or an actual production preservation claim. */
const path=process.env.W2_SQL_CAPTURE_FILE,expected=process.env.W2_SQL_CAPTURE_SHA256;
it.runIf(Boolean(path&&expected))('accepts the actual local SQL RPC capture and detects Auth/schema/ledger/cell tampering',()=>{
 expect(path).toMatch(/^\/private\/tmp\/aca-v27-w2-sql-preservation-[A-Za-z0-9-]+\.json$/);expect(expected).toMatch(/^[a-f0-9]{64}$/);const stat=lstatSync(path!);expect(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0).toBe(true);expect(stat.size).toBeLessThan(20_000_000);const bytes=readFileSync(path!);expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);const capture=validateSnapshot(JSON.parse(bytes.toString('utf8'))),scope={rootId:FIXED.root,windowId:null,teamId:FIXED.team,accountId:FIXED.account,planSHA256:'a'.repeat(64),expectedSHA:'f'.repeat(40),operationStartedAt:capture.capturedAt,operationFinishedAt:capture.capturedAt,clockSkewSeconds:0 as const,clockPolicyApproved:false};expect(Object.keys(capture.tables)).toHaveLength(116);expect(capture.ledger.count).toBe(54);const clone=structuredClone(capture);expect(captureFingerprint(clone)).toBe(captureFingerprint(capture));expect(consumeSnapshot(capture,clone,{kind:'exact'},scope).violations).toEqual([]);
 for(const change of [(s:typeof capture)=>{s.catalogue='b'.repeat(64);},(s:typeof capture)=>{s.ledger.digest='b'.repeat(64);},(s:typeof capture)=>{s.tables['auth.users'].rows[0].fields.updated_at='b'.repeat(64);},(s:typeof capture)=>{s.tables['auth.users'].rows[0].fields.encrypted_password='b'.repeat(64);},(s:typeof capture)=>{s.tables['public.user_roles'].rows[0].fields.role='b'.repeat(64);}]){const drift=structuredClone(capture);change(drift);expect(consumeSnapshot(capture,drift,{kind:'exact'},scope).status).toBe('HOLD');}
});
