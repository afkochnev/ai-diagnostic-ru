import { it, expect, vi } from 'vitest';
import * as vm from 'node:vm';
import { createHash } from 'node:crypto';
import columns from './fixtures/preservation-columns.json';
import { CAPTURE_TABLES } from '../../scripts/operator-w2/capture-queries';
import { type PreservationSnapshot, acceptedStageCaptureFingerprint } from '../../scripts/operator-w2/preservation';
import { buildStagingReadonlyEvidenceJobRequest, readonlyCaptureGuardSource, READONLY_COMMAND_MAXIMUM_BYTES } from '../../scripts/operator-w2/evidence-readonly-command';
import { evidenceKeyContext } from '../../src/server/team/evidence-channel-key';
const context = evidenceKeyContext({ domain: 'aca-w2-evidence-key', version: 1, rootRunId: 'e3623f1d-2da0-4dfe-b600-d747f529c5fc', approvedPlanSHA256: 'a'.repeat(64), canonicalAppSHA: 'b'.repeat(40) });
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function snapshot(): PreservationSnapshot {
    const s: PreservationSnapshot = { format: 'ACA_W2_PRESERVATION_HMAC_V2', algorithm: 'HMAC-SHA256', context, capturedAt: '2026-10-26T10:00:00Z', databaseClock: '2026-10-26T10:00:00Z', transactionReadOnly: 'on', timezone: 'UTC', project: null, tables: Object.fromEntries(CAPTURE_TABLES.map(t => [t, { columns: (columns as Record<string, string[]>)[t], rows: [] }])), catalogue: hash('catalogue'), ledger: { count: 58, digest: hash('ledger') }, gates: { launch: 1, financial: 0 }, wireTraces: [] };
    const p = s.tables['private.controlled_team_policy'];
    p.rows.push({ key: hash('key'), full: hash('full'), fields: Object.fromEntries(p.columns.map(c => [c, hash(c)])), facts: null });
    return s;
}
function loaderSource(startCommand: string) {
    expect(startCommand.startsWith("node --import tsx -e '")).toBe(true);
    return startCommand.slice("node --import tsx -e '".length, -1).replaceAll("'\"'\"'", "'");
}
it('constructs inert fixed staging command with exact pre-import, manifest and dynamic counts under8192bytes', () => {
    const s = snapshot(), fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
        const built = buildStagingReadonlyEvidenceJobRequest({ context, nativeA: s });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(built.body.planId).toBe('plan-srv-006');
        expect(Buffer.byteLength(built.body.startCommand)).toBeLessThanOrEqual(READONLY_COMMAND_MAXIMUM_BYTES);
        expect(built.manifest.expectedSHA).toBe(context.canonicalAppSHA);
        expect(built.manifest.expectedRowCount).toBe(1);
        expect(built.nativeBinding.captureSHA256).toBe(acceptedStageCaptureFingerprint(s, context));
        const run = vi.fn();
        vm.runInNewContext(loaderSource(built.body.startCommand), { Buffer, require: (id: string) => { expect(id).toBe('./scripts/operator-w2/evidence-readonly-runner.ts'); return { runReadonlyEvidenceRunner: run }; }, console: { error: vi.fn() }, process: { exitCode: 0 } });
        expect(run).toHaveBeenCalledTimes(1);
        const o = run.mock.calls[0][0];
        expect(o.directory).toBe('/tmp/aca-v27-evidence-channel');
        expect(o.timeoutMs).toBe(120000);
        expect(o.childArgs.slice(0, 3)).toEqual(['--import', 'tsx', '--import']);
        expect(o.childArgs[4]).toBe('scripts/controlled-team-evidence-readonly.ts');
        expect(o.childArgs).toHaveLength(5);
        expect(Buffer.from(o.childArgs[3].split(',')[1], 'base64').toString()).toBe(readonlyCaptureGuardSource(context));
        expect(o.nativeBinding).toEqual(built.nativeBinding);
    } finally { fetchSpy.mockRestore(); }
});
it('does not retain or serialize raw rows or optional caller key material', () => {
    expect(() => buildStagingReadonlyEvidenceJobRequest({ context, nativeA: snapshot(), key: 'SYNTHETIC_SECRET' } as never)).toThrow();
    expect(() => buildStagingReadonlyEvidenceJobRequest({ context, nativeA: { ...snapshot(), rawSecret: 'SYNTHETIC_SECRET' } })).toThrow();
});
it('refuses proxies/accessors and mismatched root/context/inventory before source construction', () => {
    let called = false;
    expect(() => buildStagingReadonlyEvidenceJobRequest({ context, get nativeA() { called = true; return snapshot(); } })).toThrow();
    expect(called).toBe(false);
    expect(() => buildStagingReadonlyEvidenceJobRequest(new Proxy({ context, nativeA: snapshot() }, {}))).toThrow();
    expect(() => readonlyCaptureGuardSource(new Proxy(context, {}))).toThrow();
    expect(() => buildStagingReadonlyEvidenceJobRequest({ context: { ...context, rootRunId: '00000000-0000-4000-8000-000000000001' }, nativeA: snapshot() })).toThrow();
    const bad = snapshot(); delete bad.tables['storage.migrations'];
    expect(() => buildStagingReadonlyEvidenceJobRequest({ context, nativeA: bad })).toThrow();
});
const target = 'https://vflgxgdwlftlyjslyrmo.supabase.co/rest/v1/rpc/capture_controlled_team_w2_preservation';
function guard() {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    const sandbox = { fetch: fetchSpy, AbortSignal };
    vm.runInNewContext(readonlyCaptureGuardSource(context), sandbox);
    const init = () => ({ method: 'POST', redirect: 'error', cache: 'no-store', body: JSON.stringify({ p_run_id: context.rootRunId, p_plan_sha256: context.approvedPlanSHA256, p_application_sha: context.canonicalAppSHA }), signal: new AbortController().signal });
    return { fetchSpy, wrapped: sandbox.fetch as unknown as typeof fetch, init, sandbox };
}
it('identical reviewed guard permits one exact capture and forbids retry after success', async () => {
    const g = guard(); await g.wrapped(target, g.init() as RequestInit);
    await expect(g.wrapped(target, g.init() as RequestInit)).rejects.toThrow('STAGING_B_FETCH_HOLD_NO_RETRY');
    expect(g.fetchSpy).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyDescriptor(g.sandbox, 'fetch')).toMatchObject({ writable: false, configurable: false });
});
it.each(['url', 'method', 'redirect', 'cache', 'body', 'signal'])('guard refuses wrong%s without an external call', async kind => {
    const g = guard(), init = g.init() as Record<string, unknown>;
    if (kind === 'method') init.method = 'GET'; if (kind === 'redirect') init.redirect = 'follow'; if (kind === 'cache') init.cache = 'default'; if (kind === 'body') init.body = JSON.stringify({ p_run_id: context.rootRunId }); if (kind === 'signal') delete init.signal;
    await expect(g.wrapped(kind === 'url' ? target + '/unexpected' : target, init as RequestInit)).rejects.toThrow('STAGING_B_FETCH_HOLD_NO_RETRY');
    expect(g.fetchSpy).not.toHaveBeenCalled();
});
it('guard consumes the one capture even if its first network attempt fails', async () => {
    const g = guard(); g.fetchSpy.mockRejectedValueOnce(Error('SYNTHETIC_SECRET'));
    await expect(g.wrapped(target, g.init() as RequestInit)).rejects.toThrow('STAGING_B_FETCH_HOLD_NO_RETRY');
    await expect(g.wrapped(target, g.init() as RequestInit)).rejects.toThrow('STAGING_B_FETCH_HOLD_NO_RETRY');
    expect(g.fetchSpy).toHaveBeenCalledTimes(1);
});
