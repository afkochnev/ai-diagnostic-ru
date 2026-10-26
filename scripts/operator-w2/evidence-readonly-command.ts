/** Pure, staging-only candidate command construction. No credentials, filesystem,
 * HTTP, journal/slot creation, or execution occurs in this module. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { assertData } from './contract';
import { acceptedStageCaptureFingerprint, validateAcceptedStageSnapshot } from './preservation';
import { evidenceKeyContext, type EvidenceKeyContext } from '../../src/server/team/evidence-channel-key';
import { buildReadonlyEvidenceRunnerSource, READONLY_CHILD_TIMEOUT_MS } from './evidence-readonly-runner';

const PROJECT = 'vflgxgdwlftlyjslyrmo', ROOT = 'e3623f1d-2da0-4dfe-b600-d747f529c5fc';
export const READONLY_COMMAND_MAXIMUM_BYTES = 8192;
export const READONLY_REMOTE_HTTP_TIMEOUT_MS = 30000;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
function need(v: unknown): asserts v { if (!v) throw Error('readonly_evidence_command_denied'); }
function plainData(input: unknown): void {
    function walk(value: unknown, seen: Set<object>, depth: number): void {
        need(depth <= 20);
        if (value && typeof value === 'object') {
            need(!types.isProxy(value) && !seen.has(value));
            seen.add(value);
            for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) {
                need(Object.hasOwn(d, 'value'));
                walk(d.value, seen, depth + 1);
            }
            seen.delete(value);
        }
    }
    walk(input, new Set(), 0);
    assertData(input);
}
function context(input: unknown): EvidenceKeyContext {
    plainData(input);
    const value = evidenceKeyContext(input);
    need(value.rootRunId === ROOT);
    return value;
}
/** Same one-capture pre-import transport guard as the accepted command. Its
 * purpose is a hard request bound, not authentication or an evidence key. */
export function readonlyCaptureGuardSource(input: EvidenceKeyContext): string {
    const c = context(input), args = JSON.stringify({ p_run_id: ROOT, p_plan_sha256: c.approvedPlanSHA256, p_application_sha: c.canonicalAppSHA });
    return `const F=globalThis.fetch.bind(globalThis),U=${JSON.stringify('https://' + PROJECT + '.supabase.co/rest/v1/rpc/capture_controlled_team_w2_preservation')},B=${JSON.stringify(args)};let spent=false;Object.defineProperty(globalThis,'fetch',{configurable:false,writable:false,value:async(i,o)=>{try{if(spent||String(i)!==U||o?.method!=='POST'||o.redirect!=='error'||o.cache!=='no-store'||typeof o.body!=='string'||!(o.signal instanceof AbortSignal)||o.signal.aborted)throw Error();const b=JSON.parse(o.body),e=JSON.parse(B);if(!b||Object.getPrototypeOf(b)!==Object.prototype||Object.keys(b).sort().join(',')!==Object.keys(e).sort().join(',')||!Object.keys(e).every(k=>b[k]===e[k]))throw Error();spent=true;const signal=AbortSignal.any([o.signal,AbortSignal.timeout(${READONLY_REMOTE_HTTP_TIMEOUT_MS})]);return await F(i,{...o,signal});}catch{throw Error('STAGING_B_FETCH_HOLD_NO_RETRY');}}});`;
}
export function buildStagingReadonlyEvidenceJobRequest(input: { context: EvidenceKeyContext; nativeA: unknown }) {
    plainData(input);
    need(Object.keys(input).sort().join('|') === 'context|nativeA');
    const c = context(input.context), a = validateAcceptedStageSnapshot(input.nativeA, c);
    const tables = Object.entries(a.tables), auth = tables.filter(([name]) => name.startsWith('auth.'));
    need(tables.length === 122 && auth.length === 27);
    const nativeBinding = Object.freeze({ context: c, captureSHA256: acceptedStageCaptureFingerprint(a, c), rowCount: tables.reduce((n, [, t]) => n + t.rows.length, 0), AuthRows: auth.reduce((n, [, t]) => n + t.rows.length, 0), capturedAt: a.capturedAt });
    const manifest = Object.freeze({ version: 2 as const, purpose: 'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2' as const, project: PROJECT as 'vflgxgdwlftlyjslyrmo', rootRunId: ROOT, expectedSHA: c.canonicalAppSHA, approvedPlanSHA256: c.approvedPlanSHA256, expectedCaptureSHA256: nativeBinding.captureSHA256, expectedRowCount: nativeBinding.rowCount });
    const guard = 'data:text/javascript;base64,' + Buffer.from(readonlyCaptureGuardSource(c)).toString('base64');
    const runner = buildReadonlyEvidenceRunnerSource({ manifest, nativeBinding, directory: '/tmp/aca-v27-evidence-channel', childArgs: ['--import', 'tsx', '--import', guard, 'scripts/controlled-team-evidence-readonly.ts'], timeoutMs: READONLY_CHILD_TIMEOUT_MS });
    const startCommand = "node --import tsx -e '" + runner.replaceAll("'", "'\"'\"'") + "'";
    need(Buffer.byteLength(startCommand) <= READONLY_COMMAND_MAXIMUM_BYTES);
    const body = Object.freeze({ startCommand, planId: 'plan-srv-006' as const });
    return Object.freeze({ manifest, nativeBinding, body, bodySHA256: hash(JSON.stringify(body)), startCommandSHA256: hash(startCommand) });
}
