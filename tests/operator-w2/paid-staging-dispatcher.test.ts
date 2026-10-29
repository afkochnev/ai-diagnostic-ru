import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXED, REQUIRED_SOURCE_FILES, bytesDigest, createW2Plan, digest, type Slot } from '../../scripts/operator-w2/contract';
import { openRootJournal } from '../../scripts/operator-w2/journal';
import { createPaidStagingDispatcher, paidStagingRequestSHA256, PAID_STAGING_SERVICE, PAID_STAGING_WORKSPACE, PAID_STAGING_JOBS_URL, PAID_STAGING_JOB_PLAN, type PaidBaseEvidence, type PaidStagingPrechecks, type PaidStagingTerminalEvidence, type PublicJournal } from '../../scripts/operator-w2/paid-staging-dispatcher';

const H = 'a'.repeat(64), SHA = 'a'.repeat(40), SLOT: Slot = 'controls/env-warm';
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
const KEY = 'synthetic-render-key-only-in-mock', JOB = 'job-aaaaaaaaaaaaaaaaaaaa';
const directories: string[] = [];
function directory() { const p = mkdtempSync(join(realpathSync(tmpdir()), 'paid-public-journal-test-')); chmodSync(p, 0o700); directories.push(p); return p; }
afterEach(() => { vi.useRealTimers(); for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture() {
    const sourceManifest = Object.fromEntries(REQUIRED_SOURCE_FILES.map(p => [p, H]));
    const plan = createW2Plan({ version: 1, authorization: 'LOCAL_MOCK_ONLY', rootId: FIXED.root, teamId: FIXED.team, expectedSHA: SHA, treeSHA: 'b'.repeat(40), planSHA256: H, sourceManifest, sourceManifestSHA256: digest(sourceManifest), oldEffectsSHA256: H, finalBaselineSHA256: H, fixtureCommitmentSHA256: H, clockSkewSeconds: 0, clockPolicyApproved: false, preimage: { webDeployId: 'dep-current00000000', workerDeployId: 'dep-current00000000', webEnvSHA256: H, workerEnvSHA256: H, authConfigSHA256: H, webConfigSHA256: H, workerConfigSHA256: H, webOneoffsSHA256: H, workerOneoffsSHA256: H }, maximumRenderJobs: 5, maximumAccessJobs: 3, maximumAuthLinks: 3, maximumVerifications: 3, maximumModelGET: 1, maximumResponses: 4, maximumResponseOutputParameterSum: 32000, maximumEmails: 3, maximumAggregate: 1, maximumReport: 1, maximumPDF: 1, maximumWebDeploys: 2, maximumEnvWrites: 2, maximumAuthConfigWrites: 2, maximumSuspend: 1, maximumResume: 1, maximumManualWorkerDeploy: 0 });
    const base = directory(), core = openRootJournal(plan, { mode: 'LOCAL_MOCK', base });
    const trace: string[] = [], request = { planId: PAID_STAGING_JOB_PLAN as typeof PAID_STAGING_JOB_PLAN, startCommand: 'node mock-only-capture.mjs' };
    const journal: Mutable<PublicJournal<Slot>> = {
        reserve: vi.fn((...args: Parameters<typeof core.reserve>) => { trace.push('reserve'); return core.reserve(...args); }),
        receipt: vi.fn((...args: Parameters<typeof core.receipt>) => { trace.push('receipt'); return core.receipt(...args); }),
        terminal: vi.fn((...args: Parameters<typeof core.terminal>) => { trace.push('terminal'); return core.terminal(...args); }),
        read: core.read, inventory: core.inventory,
    };
    const paid: PaidBaseEvidence = { serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE, type: 'web_service', plan: '0.5c-512mb', region: 'frankfurt', runtime: 'docker', liveSHA: SHA, observedAt: new Date().toISOString(), eligible: true };
    const prechecks: Mutable<PaidStagingPrechecks> = {
        filesystem: () => { trace.push('filesystem'); core.inventory(); },
        sourceCI: () => { trace.push('sourceCI'); },
        journalInventory: () => { trace.push('journalInventory'); },
        metadata: () => { trace.push('metadata'); return paid; },
        paidBase: () => { trace.push('paidBase'); },
    };
    const credentialReader = vi.fn(() => { trace.push('credentials'); return KEY; });
    const job = { id: JOB, serviceId: PAID_STAGING_SERVICE as typeof PAID_STAGING_SERVICE, planId: PAID_STAGING_JOB_PLAN as typeof PAID_STAGING_JOB_PLAN, startCommand: request.startCommand, status: 'pending' };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { trace.push('fetch'); return Response.json(job, { status: 201 }); });
    const options = { journal, slot: SLOT, scope: null, request, expectedRequestSHA256: paidStagingRequestSHA256(request), expectedApplicationSHA: SHA, expectedJournalPlanSHA256: H, prechecks, credentialReader, fetch, timeoutMs: 1000 };
    const terminal = (): PaidStagingTerminalEvidence => ({ ...job, status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
    return { base, plan, core, journal, paid, trace, request, job, prechecks, credentialReader, fetch, options, terminal, create: () => createPaidStagingDispatcher(options) };
}
function zeroExternal(f: ReturnType<typeof fixture>) { expect(f.credentialReader).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled(); }

describe('public Journal lifecycle for the inert paid staging adapter', () => {
    it('constructs without journal, credentials, HTTP or a hosted slot; core has no write API', () => {
        const f = fixture(); f.create();
        expect(f.trace).toEqual([]); expect(f.core.inventory().records).toBe(0); zeroExternal(f);
        expect(Object.keys(f.core).sort()).toEqual(['assertSettled', 'inventory', 'read', 'receipt', 'reserve', 'terminal']);
        expect(Object.isFrozen(f.core)).toBe(true);
    });
    it('uses only reserve once, then credentials, HTTP and durable receipt; terminal is later', async () => {
        const f = fixture(), d = f.create(); const r = await d.dispatch();
        expect(f.trace).toEqual(['filesystem', 'sourceCI', 'journalInventory', 'metadata', 'paidBase', 'reserve', 'credentials', 'fetch', 'receipt']);
        expect(f.journal.reserve).toHaveBeenCalledExactlyOnceWith(SLOT, null, f.options.expectedRequestSHA256, undefined);
        expect(f.core.inventory().records).toBe(2); expect(f.core.read(SLOT, 'receipt')?.status).toBe('KNOWN_ACCEPTED');
        expect(f.core.read(SLOT, 'terminal')).toBeUndefined();
        expect(r.status).toBe('KNOWN_ACCEPTED'); expect(d.state().reserved).toBe(true);
        expect(String(f.fetch.mock.calls[0][0])).toBe(PAID_STAGING_JOBS_URL);
        expect(f.fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', body: JSON.stringify(f.request) });
        const reopened = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base: f.base });
        expect(reopened.inventory()).toEqual(f.core.inventory());
        expect(d.terminal(f.terminal()).status).toBe('TERMINAL_SUCCEEDED');
        expect(f.journal.terminal).toHaveBeenCalledTimes(1); expect(f.core.inventory().records).toBe(3);
        await expect(d.dispatch()).rejects.toThrow('SPENT_STOP'); expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it('real core refuses orphan receipts and terminal without KNOWN_ACCEPTED', () => {
        const f = fixture(); expect(() => f.core.receipt(SLOT, 'KNOWN_ACCEPTED', H)).toThrow('intent_required');
        expect(() => f.core.terminal(SLOT, H)).toThrow('accepted_receipt_required');
        f.core.reserve(SLOT, null, H); expect(() => f.core.terminal(SLOT, H)).toThrow('accepted_receipt_required');
        f.core.receipt(SLOT, 'UNKNOWN_SPENT_STOP', H); expect(() => f.core.terminal(SLOT, H)).toThrow('accepted_receipt_required'); zeroExternal(f);
    });
    it('reserve failure reads no credentials, sends nothing, and is not a successful reservation', async () => {
        const f = fixture(); f.journal.reserve = vi.fn(() => { throw Error('private mock failure'); }); const d = f.create();
        await expect(d.dispatch()).rejects.toThrow('RESERVE_FAILED_NO_EXTERNAL_CALLS');
        zeroExternal(f); expect(f.journal.reserve).toHaveBeenCalledTimes(1); expect(f.core.inventory().records).toBe(0);
        expect(d.state()).toMatchObject({ reserved: false, status: 'RESERVE_FAILED' });
        await expect(d.dispatch()).rejects.toThrow('SPENT_STOP'); expect(f.journal.reserve).toHaveBeenCalledTimes(1);
    });
    it('real filesystem permission failure at reserve keeps all external calls zero', async () => {
        const f = fixture(); f.journal.reserve = vi.fn((...args: Parameters<typeof f.core.reserve>) => { chmodSync(f.base, 0o755); return f.core.reserve(...args); }); const d = f.create();
        await expect(d.dispatch()).rejects.toThrow('RESERVE_FAILED'); zeroExternal(f); expect(d.state().reserved).toBe(false);
        chmodSync(f.base, 0o700); expect(f.core.inventory().records).toBe(0);
    });
    it.each(['missing', 'malformed', 'promise', 'wrong-status', 'wrong-plan'])('requires a valid synchronous durable reserve (%s)', async kind => {
        const f = fixture();
        f.journal.reserve = vi.fn((...args: Parameters<typeof f.core.reserve>) => {
            if (kind === 'missing') return undefined as never;
            if (kind === 'malformed') return {} as never;
            const r = f.core.reserve(...args);
            if (kind === 'promise') return Promise.resolve(r) as never;
            return { ...r, ...(kind === 'wrong-status' ? { status: 'KNOWN_ACCEPTED' } : { planSHA256: 'b'.repeat(64) }) };
        });
        const d = f.create(); await expect(d.dispatch()).rejects.toThrow('RESERVE_FAILED'); zeroExternal(f);
        expect(d.state().reserved).toBe(false); expect(f.journal.reserve).toHaveBeenCalledTimes(1);
    });
    it('partial reserve remains spent, cannot be replayed and never reads credentials', async () => {
        const f = fixture(); f.journal.reserve = vi.fn((...args: Parameters<typeof f.core.reserve>) => { f.core.reserve(...args); throw Error('disk acknowledgement lost'); });
        const d = f.create(); await expect(d.dispatch()).rejects.toThrow('RESERVE_FAILED');
        expect(f.core.read(SLOT, 'intent')?.status).toBe('RESERVED_BEFORE_MUTATION');
        expect(f.core.read(SLOT, 'receipt')).toBeUndefined(); zeroExternal(f);
        const reopened = f.create(); await expect(reopened.dispatch()).rejects.toThrow('PRECHECK_HOLD'); zeroExternal(f);
        expect(f.journal.reserve).toHaveBeenCalledTimes(1);
    });
    it('validates expected plan even without a W2 window', async () => {
        const f = fixture(); f.options.expectedJournalPlanSHA256 = 'b'.repeat(64); const d = f.create();
        await expect(d.dispatch()).rejects.toThrow('RESERVE_FAILED'); zeroExternal(f);
        expect(f.core.read(SLOT, 'intent')).toBeDefined(); expect(d.state().reserved).toBe(false);
    });
    it.each(['throw', 'http400', 'wrong-job', 'oversized', 'bad-json'])('unknown outcome is durable, sanitized and never retried (%s)', async kind => {
        const f = fixture(); f.fetch.mockImplementation(async () => {
            if (kind === 'throw') throw Error(KEY);
            if (kind === 'http400') return Response.json({ secret: KEY }, { status: 400 });
            if (kind === 'wrong-job') return Response.json({ ...f.job, serviceId: 'srv-foreign' }, { status: 201 });
            if (kind === 'oversized') return new Response('x'.repeat(65537));
            return new Response('{');
        });
        const d = f.create(); await expect(d.dispatch()).rejects.toThrow('UNKNOWN_SPENT_STOP');
        expect(f.core.read(SLOT, 'receipt')?.status).toBe('UNKNOWN_SPENT_STOP');
        expect(JSON.stringify([f.core.read(SLOT, 'intent'), f.core.read(SLOT, 'receipt'), d.state()])).not.toContain(KEY);
        expect(() => d.terminal(f.terminal())).toThrow('TERMINAL_REQUIRES_ACCEPTED');
        await expect(d.dispatch()).rejects.toThrow('SPENT_STOP'); await expect(f.create().dispatch()).rejects.toThrow('PRECHECK_HOLD');
        expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.journal.reserve).toHaveBeenCalledTimes(1);
    });
    it('receipt persistence failure never attempts another receipt or fallback', async () => {
        const f = fixture(); f.journal.receipt = vi.fn(() => { throw Error('durability uncertain'); }); const d = f.create();
        await expect(d.dispatch()).rejects.toThrow('UNKNOWN_SPENT_STOP');
        expect(f.journal.receipt).toHaveBeenCalledTimes(1); expect(f.core.read(SLOT, 'receipt')).toBeUndefined();
        expect(f.core.read(SLOT, 'intent')).toBeDefined(); expect(d.state().reserved).toBe(true);
        await expect(d.dispatch()).rejects.toThrow('SPENT_STOP'); expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it('does not mark a creation receipt terminal even when its provider status says succeeded', async () => {
        const f = fixture(); f.fetch.mockResolvedValue(Response.json({ ...f.job, status: 'succeeded' }, { status: 201 }));
        await f.create().dispatch(); expect(f.journal.terminal).not.toHaveBeenCalled(); expect(f.core.read(SLOT, 'terminal')).toBeUndefined();
    });
    it.each(['id', 'service', 'plan', 'command', 'status', 'time'])('requires exact independently collected terminal evidence (%s)', async kind => {
        const f = fixture(), d = f.create(); await d.dispatch();
        const evidence = { ...f.terminal(), ...({ id: { id: 'job-foreignforeign' }, service: { serviceId: 'srv-foreign' }, plan: { planId: 'plan-other' }, command: { startCommand: 'different command' }, status: { status: 'running' }, time: { finishedAt: '2099-01-01T00:00:00Z' } }[kind]) } as PaidStagingTerminalEvidence;
        expect(() => d.terminal(evidence)).toThrow('TERMINAL_HOLD'); expect(f.journal.terminal).not.toHaveBeenCalled();
        expect(f.core.read(SLOT, 'terminal')).toBeUndefined(); expect(d.state().status).toBe('HOLD');
    });
    it('times out once; a late provider response cannot create an accepted receipt', async () => {
        const f = fixture(); vi.useFakeTimers();
        let respond!: (r: Response) => void;
        f.fetch.mockImplementation(() => new Promise(resolve => { respond = resolve; }));
        const d = f.create(), outcome = d.dispatch().catch(e => e);
        await vi.advanceTimersByTimeAsync(1001); expect((await outcome).message).toContain('UNKNOWN_SPENT_STOP');
        respond(Response.json(f.job, { status: 201 })); await Promise.resolve(); await Promise.resolve();
        expect(f.core.read(SLOT, 'receipt')?.status).toBe('UNKNOWN_SPENT_STOP'); expect(f.fetch).toHaveBeenCalledTimes(1);
        await expect(d.dispatch()).rejects.toThrow('SPENT_STOP');
    });
});

describe('immutable methods and strict sequential prerequisites', () => {
    it.each(['reserve', 'receipt', 'terminal', 'read', 'inventory'] as const)('replacement of journal.%s fails closed without invoking the replacement', async key => {
        const f = fixture(), d = f.create(), replacement = vi.fn(() => { throw Error('must not run'); });
        Object.defineProperty(f.journal, key, { value: replacement });
        await expect(d.dispatch()).rejects.toThrow('PRECHECK_HOLD'); expect(replacement).not.toHaveBeenCalled(); zeroExternal(f);
    });
    it('detects terminal method replacement after dispatch and retains spent receipt', async () => {
        const f = fixture(), d = f.create(); await d.dispatch(); const replacement = vi.fn(); f.journal.terminal = replacement;
        expect(() => d.terminal(f.terminal())).toThrow('TERMINAL_HOLD'); expect(replacement).not.toHaveBeenCalled();
        expect(f.core.read(SLOT, 'receipt')?.status).toBe('KNOWN_ACCEPTED'); expect(f.core.read(SLOT, 'terminal')).toBeUndefined();
    });
    it('rejects getter/inherited public methods before invoking them', () => {
        const f = fixture(), getter = vi.fn(() => f.core.reserve); Object.defineProperty(f.journal, 'reserve', { get: getter });
        expect(() => f.create()).toThrow('OWN_DATA_METHOD'); expect(getter).not.toHaveBeenCalled(); zeroExternal(f);
        expect(() => createPaidStagingDispatcher({ ...f.options, journal: Object.create(f.core) })).toThrow('METHOD_OBJECT');
    });
    it('snapshots request and transport; option replacement cannot change destination or credential reader', async () => {
        const f = fixture(), d = f.create(), evil = vi.fn(); f.request.startCommand = 'mutated'; f.options.fetch = evil; f.options.credentialReader = evil;
        await d.dispatch(); expect(evil).not.toHaveBeenCalled(); expect(f.fetch).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(f.fetch.mock.calls[0][1]?.body)).startCommand).toBe('node mock-only-capture.mjs');
    });
    it('rejects scope getters without invoking them and oversize commands', () => {
        const f = fixture(), getter = vi.fn(); const scope = { windowId: '00000000-0000-4000-8000-000000000202', planSHA256: H, expectedSHA: SHA };
        Object.defineProperty(scope, 'expectedSHA', { get: getter });
        expect(() => createPaidStagingDispatcher({ ...f.options, scope })).toThrow(); expect(getter).not.toHaveBeenCalled();
        expect(() => paidStagingRequestSHA256({ ...f.request, startCommand: 'x'.repeat(8193) })).toThrow('REQUEST'); zeroExternal(f);
    });
    it.each(['filesystem', 'sourceCI', 'journalInventory', 'metadata', 'paidBase'] as const)('a failing %s stops before reserve/credentials/HTTP', async key => {
        const f = fixture(); Object.defineProperty(f.prechecks, key, { value: vi.fn(() => { throw Error('private detail'); }) });
        await expect(f.create().dispatch()).rejects.toThrow('PRECHECK_HOLD');
        expect(f.journal.reserve).not.toHaveBeenCalled(); zeroExternal(f);
    });
    it.each(['sourceCI', 'paidBase'] as const)('awaits async %s and refuses a rejection before reserve', async key => {
        const f = fixture(); let reject!: (e: Error) => void;
        Object.defineProperty(f.prechecks, key, { value: vi.fn(() => new Promise<void>((_, r) => { reject = r; })) });
        const d = f.create(), outcome = d.dispatch().catch(e => e);
        for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(f.journal.reserve).not.toHaveBeenCalled(); zeroExternal(f);
        reject(Error('async rejected')); expect((await outcome).message).toContain('PRECHECK_HOLD'); zeroExternal(f);
    });
    it('awaits asynchronous metadata before paid validation or reserve', async () => {
        const f = fixture(); let resolve!: (e: PaidBaseEvidence) => void;
        f.prechecks.metadata = vi.fn(() => new Promise<PaidBaseEvidence>(r => { resolve = r; }));
        const d = f.create(), outcome = d.dispatch(); for (let i = 0; i < 10; i++) await Promise.resolve();
        expect(f.journal.reserve).not.toHaveBeenCalled(); zeroExternal(f); resolve(f.paid); await outcome;
        expect(f.fetch).toHaveBeenCalledTimes(1);
    });
    it.each(['free', 'service', 'workspace', 'sha', 'old', 'future', 'region', 'eligible'])('rejects unsuitable/stale metadata (%s)', async kind => {
        const f = fixture(); const patch = { free: { plan: 'free' }, service: { serviceId: 'srv-other' }, workspace: { workspaceId: 'tea-other' }, sha: { liveSHA: 'b'.repeat(40) }, old: { observedAt: new Date(Date.now() - 60001).toISOString() }, future: { observedAt: new Date(Date.now() + 60000).toISOString() }, region: { region: 'oregon' }, eligible: { eligible: false } }[kind];
        Object.assign(f.paid, patch); await expect(f.create().dispatch()).rejects.toThrow('PRECHECK_HOLD');
        expect(f.journal.reserve).not.toHaveBeenCalled(); zeroExternal(f);
    });
    it('rechecks freshness after slow paid validation and before reserve', async () => {
        const f = fixture(); let now = Date.now(); f.options.prechecks.paidBase = () => { now += 60001; };
        const d = createPaidStagingDispatcher({ ...f.options, now: () => now });
        await expect(d.dispatch()).rejects.toThrow('PRECHECK_HOLD'); expect(f.journal.reserve).not.toHaveBeenCalled(); zeroExternal(f);
    });
    it('preserves a byte-pinned old UNKNOWN B and all legacy files without a reset API', async () => {
        const f = fixture(), legacyPath = 'control-operations/old-b.json', file = join(f.base, legacyPath);
        mkdirSync(join(f.base, 'control-operations'), { mode: 0o700 }); const bytes = Buffer.from('{"status":"UNKNOWN_SPENT_STOP"}\n'); writeFileSync(file, bytes, { mode: 0o600 });
        const legacyCore = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base: f.base, legacy: [{ path: legacyPath, sha256: bytesDigest(bytes) }] });
        const d = createPaidStagingDispatcher({ ...f.options, journal: legacyCore, prechecks: { ...f.prechecks, filesystem: () => { legacyCore.inventory(); } } }); await d.dispatch();
        expect(readFileSync(file)).toEqual(bytes); expect(legacyCore.inventory().legacyFiles).toBe(1);
        expect(Object.keys(legacyCore)).not.toContain('reset'); expect(Object.keys(legacyCore)).not.toContain('write');
    });
});
