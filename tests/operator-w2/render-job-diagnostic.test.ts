import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createStagingRenderJobDiagnostic, type RenderJobObservation } from '../../scripts/operator-w2/render-job-diagnostic';

const SECRET = 'synthetic-render-credential-do-not-export', SERVICE = 'srv-daiqfnrm8hqs73dtaf1g';
const body = { startCommand: 'node scripts/synthetic-readonly-fixture.js', planId: 'plan-srv-006' as const };
const expectedBodySHA256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
const job = { id: 'job-synthetic000001', serviceId: SERVICE, ...body };
function fixture(fetchImpl: typeof fetch = vi.fn(async () => Response.json(job, { status: 201 })) as typeof fetch) {
    const observations: RenderJobObservation[] = [];
    const options = { body: { ...body }, expectedBodySHA256, fetch: fetchImpl, credentialReader: vi.fn(() => SECRET), reserveIntent: vi.fn(), checkPreDispatch: vi.fn(), writeObservation: vi.fn((o: RenderJobObservation) => { observations.push(o); }) };
    return { options, observations, fetchImpl, construct: () => createStagingRenderJobDiagnostic(options) };
}
afterEach(() => vi.useRealTimers());

describe('staging-only finite Render job diagnostic', () => {
    it.each([200, 201])('records a validated receipt at %s without claiming capture B completed', async status => {
        const fetchImpl = vi.fn(async (url, init) => {
            expect(url).toBe(`https://api.render.com/v1/services/${SERVICE}/jobs`);
            expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(body), redirect: 'error', cache: 'no-store' });
            expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ' + SECRET);
            return Response.json({ ...job, untrusted: SECRET }, { status });
        }) as typeof fetch;
        const f = fixture(fetchImpl), client = f.construct();
        expect(fetchImpl).not.toHaveBeenCalled(); expect(f.options.credentialReader).not.toHaveBeenCalled(); expect(f.options.reserveIntent).not.toHaveBeenCalled();
        const result = await client.dispatch();
        expect(result).toEqual({ version: 1, status: 'KNOWN_ACCEPTED', serviceId: SERVICE, stage: 'receipt', reason: null, fetchInvoked: true, httpStatus: status, providerId: job.id, retry: false });
        expect(f.options.reserveIntent.mock.invocationCallOrder[0]).toBeLessThan(f.options.credentialReader.mock.invocationCallOrder[0]);
        expect(f.options.checkPreDispatch.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(fetchImpl).mock.invocationCallOrder[0]);
        expect(JSON.stringify(f.observations)).not.toContain(SECRET); expect(Object.keys(result)).not.toContain('captureB');
        await expect(client.dispatch()).rejects.toThrow('attempt_spent'); expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each(['intent', 'credential', 'dispatch_guard'] as const)('retains %s failure without invoking fetch or echoing error material', async stage => {
        const f = fixture();
        f.options[{ intent: 'reserveIntent', credential: 'credentialReader', dispatch_guard: 'checkPreDispatch' }[stage] as 'reserveIntent'].mockImplementation(() => { throw Error(SECRET); });
        const client = f.construct(), result = await client.dispatch();
        expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage, fetchInvoked: false, httpStatus: null, providerId: null, retry: false });
        expect(f.fetchImpl).not.toHaveBeenCalled(); expect(JSON.stringify(f.observations)).not.toContain(SECRET);
        await expect(client.dispatch()).rejects.toThrow('spent');
    });
    it('rejects unsafe credential material before fetch', async () => {
        const f = fixture(); f.options.credentialReader.mockReturnValue(SECRET + '\r\n');
        expect(await f.construct().dispatch()).toMatchObject({ stage: 'credential', reason: 'CREDENTIAL_FAILED', fetchInvoked: false }); expect(f.fetchImpl).not.toHaveBeenCalled();
    });
    it('distinguishes fetch invocation from delivery proof, never exposing thrown messages', async () => {
        const f = fixture(vi.fn(async () => { throw Error(SECRET); }) as typeof fetch), client = f.construct();
        expect(await client.dispatch()).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'fetch', reason: 'FETCH_FAILED', fetchInvoked: true, httpStatus: null });
        expect(JSON.stringify(f.observations)).not.toContain(SECRET); await expect(client.dispatch()).rejects.toThrow('spent'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each([202, 204, 301, 400, 401, 403, 404, 409, 422, 429, 500, 503])('retains HTTP %s, stays HOLD and never reads/hashes its body', async httpStatus => {
        const response = new Response(httpStatus === 204 ? null : SECRET, { status: httpStatus, statusText: 'SENSITIVE', headers: { 'x-request-id': SECRET } });
        const f = fixture(vi.fn(async () => response) as typeof fetch), result = await f.construct().dispatch();
        expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'http', reason: 'HTTP_STATUS_UNEXPECTED', fetchInvoked: true, httpStatus, providerId: null });
        expect(JSON.stringify(f.observations)).not.toMatch(/SENSITIVE|synthetic-render-credential|request-id|responseSHA|bodySHA/); expect(response.bodyUsed).toBe(httpStatus !== 204);
    });
    it('retains a surfaced redirected response status but does not follow it', async () => {
        const response = Response.json(job, { status: 200 }); Object.defineProperty(response, 'redirected', { value: true });
        const f = fixture(vi.fn(async () => response) as typeof fetch);
        expect(await f.construct().dispatch()).toMatchObject({ stage: 'http', reason: 'REDIRECT_DENIED', httpStatus: 200 });
    });
    it.each(['missing', 'declared-limit', 'stream-limit', 'read-error', 'utf8', 'json', 'receipt', 'wrong-service', 'wrong-plan', 'wrong-command'])('retains HTTP201 after %s failure', async kind => {
        let response: Response;
        if (kind === 'missing') response = new Response(null, { status: 201 });
        else if (kind === 'declared-limit') response = new Response(SECRET, { status: 201, headers: { 'content-length': '1048577' } });
        else if (kind === 'stream-limit') response = new Response(new Uint8Array(1048577), { status: 201 });
        else if (kind === 'read-error') response = new Response(new ReadableStream({ start(c) { c.error(Error(SECRET)); } }), { status: 201 });
        else if (kind === 'utf8') response = new Response(new Uint8Array([255]), { status: 201 });
        else if (kind === 'json') response = new Response(SECRET, { status: 201 });
        else response = Response.json({ ...job, ...(kind === 'receipt' ? { id: SECRET } : kind === 'wrong-service' ? { serviceId: 'srv-production-denied' } : kind === 'wrong-plan' ? { planId: 'plan-srv-999' } : { startCommand: SECRET }) }, { status: 201 });
        const f = fixture(vi.fn(async () => response) as typeof fetch), client = f.construct(), result = await client.dispatch();
        expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', httpStatus: 201, providerId: null, fetchInvoked: true });
        expect(result.reason).toBe(({ missing: 'BODY_MISSING', 'declared-limit': 'BODY_LIMIT', 'stream-limit': 'BODY_LIMIT', 'read-error': 'BODY_READ_FAILED', utf8: 'INVALID_UTF8', json: 'INVALID_JSON' } as Record<string, string>)[kind] ?? 'INVALID_RECEIPT');
        expect(JSON.stringify(f.observations)).not.toContain(SECRET); await expect(client.dispatch()).rejects.toThrow('spent'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each(['fetch', 'body'])('bounds %s timeout and preserves any observed status', async kind => {
        vi.useFakeTimers();
        const f = fixture(vi.fn(async () => kind === 'fetch' ? new Promise<Response>(() => {}) : new Response(new ReadableStream({ start() {} }), { status: 201 })) as typeof fetch), client = f.construct();
        const pending = client.dispatch(); await vi.advanceTimersByTimeAsync(30000);
        const result = await pending; expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', reason: 'TIMEOUT', stage: kind, fetchInvoked: true, httpStatus: kind === 'fetch' ? null : 201 });
        await expect(client.dispatch()).rejects.toThrow('spent'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it('discards a late response after an ambiguous timeout without updating or retrying evidence', async () => {
        vi.useFakeTimers(); let resolve!: (value: Response) => void;
        const wait = new Promise<Response>(r => { resolve = r; }), f = fixture(vi.fn(() => wait) as typeof fetch), client = f.construct();
        const pending = client.dispatch(); await vi.advanceTimersByTimeAsync(30000);
        expect(await pending).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'fetch', reason: 'TIMEOUT', httpStatus: null });
        const late = Response.json(job, { status: 201 }); resolve(late); await vi.runAllTimersAsync();
        expect(late.bodyUsed).toBe(true); expect(f.observations).toHaveLength(1); expect(f.observations[0].httpStatus).toBeNull(); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it('does not let concurrent invocations spend a second POST', async () => {
        const f = fixture(), client = f.construct(), first = client.dispatch();
        await expect(client.dispatch()).rejects.toThrow('spent'); expect((await first).status).toBe('KNOWN_ACCEPTED'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it.each(['intent', 'dispatch_guard'])('awaits async %s before fetch, including safe rejection', async stage => {
        const f = fixture(); let resolve!: () => void;
        const wait = new Promise<void>(r => { resolve = r; });
        const options = { ...f.options, [stage === 'intent' ? 'reserveIntent' : 'checkPreDispatch']: () => wait };
        const client = createStagingRenderJobDiagnostic(options), pending = client.dispatch();
        await Promise.resolve(); expect(f.fetchImpl).not.toHaveBeenCalled(); resolve();
        expect((await pending).status).toBe('KNOWN_ACCEPTED'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
        const g = fixture(), fail = createStagingRenderJobDiagnostic({ ...g.options, [stage === 'intent' ? 'reserveIntent' : 'checkPreDispatch']: async () => { throw Error(SECRET); } });
        expect(await fail.dispatch()).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage, fetchInvoked: false });
        expect(g.fetchImpl).not.toHaveBeenCalled(); expect(JSON.stringify(g.observations)).not.toContain(SECRET);
    });
    it.each(['intent', 'dispatch_guard'])('never sends a late POST after async %s times out', async stage => {
        vi.useFakeTimers(); const f = fixture(); let resolve!: () => void;
        const wait = new Promise<void>(r => { resolve = r; }), client = createStagingRenderJobDiagnostic({ ...f.options, [stage === 'intent' ? 'reserveIntent' : 'checkPreDispatch']: () => wait });
        const pending = client.dispatch(); await vi.advanceTimersByTimeAsync(30000);
        expect(await pending).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage, reason: 'TIMEOUT', fetchInvoked: false });
        resolve(); await vi.runAllTimersAsync(); expect(f.fetchImpl).not.toHaveBeenCalled(); await expect(client.dispatch()).rejects.toThrow('spent'); expect(f.options.writeObservation).toHaveBeenCalledTimes(1);
    });
    it('HOLDs if observation persistence fails, without retrying the writer or POST', async () => {
        const f = fixture(); f.options.writeObservation.mockImplementation(() => { throw Error(SECRET); }); const client = f.construct();
        const result = await client.dispatch(); expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'evidence', reason: 'OBSERVATION_WRITE_FAILED', providerId: null, httpStatus: 201 });
        expect(JSON.stringify(result)).not.toContain(SECRET); expect(f.options.writeObservation).toHaveBeenCalledTimes(1); await expect(client.dispatch()).rejects.toThrow('spent'); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
    it('awaits async evidence durability and safely contains a rejected writer', async () => {
        const f = fixture(); let resolve!: () => void, returned = false;
        const wait = new Promise<void>(r => { resolve = r; }), client = createStagingRenderJobDiagnostic({ ...f.options, writeObservation: () => wait });
        const pending = client.dispatch().then(r => { returned = true; return r; });
        await new Promise(r => setTimeout(r, 0)); expect(returned).toBe(false); resolve(); expect((await pending).status).toBe('KNOWN_ACCEPTED');
        const g = fixture(), failed = createStagingRenderJobDiagnostic({ ...g.options, writeObservation: async () => { throw Error(SECRET); } });
        const result = await failed.dispatch(); expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'evidence', reason: 'OBSERVATION_WRITE_FAILED', httpStatus: 201 }); expect(JSON.stringify(result)).not.toContain(SECRET);
    });
    it('bounds a hung evidence writer without a second write or POST', async () => {
        vi.useFakeTimers(); const f = fixture(), writer = vi.fn(() => new Promise<void>(() => {})), client = createStagingRenderJobDiagnostic({ ...f.options, writeObservation: writer });
        const pending = client.dispatch(); await vi.advanceTimersByTimeAsync(5000);
        expect(await pending).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'evidence', reason: 'OBSERVATION_TIMEOUT', httpStatus: 201, providerId: null });
        expect(writer).toHaveBeenCalledTimes(1); expect(f.fetchImpl).toHaveBeenCalledTimes(1); await expect(client.dispatch()).rejects.toThrow('spent');
    });
    it('pins body hash and callbacks at construction, exports no execution CLI or production destination', async () => {
        const f = fixture(); expect(() => createStagingRenderJobDiagnostic({ ...f.options, expectedBodySHA256: '0'.repeat(64) })).toThrow('request_denied');
        expect(() => createStagingRenderJobDiagnostic({ ...f.options, body: { ...body, planId: 'other' as 'plan-srv-006' } })).toThrow('request_denied');
        const client = f.construct(); f.options.body.startCommand = SECRET; f.options.checkPreDispatch = vi.fn(() => { throw Error(SECRET); });
        expect((await client.dispatch()).status).toBe('KNOWN_ACCEPTED'); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(JSON.stringify(f.observations)).not.toContain(SECRET);
    });
    it('rejects accessor payloads before invoking getters or reserving anything', () => {
        const f = fixture(), getter = vi.fn(() => SECRET), bad = { ...body };
        Object.defineProperty(bad, 'startCommand', { enumerable: true, get: getter });
        expect(() => createStagingRenderJobDiagnostic({ ...f.options, body: bad })).toThrow('request_denied');
        expect(getter).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.options.reserveIntent).not.toHaveBeenCalled();
    });
});
