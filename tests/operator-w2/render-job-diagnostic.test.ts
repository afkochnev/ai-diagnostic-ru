import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createStagingRenderJobDiagnostic, type RenderJobObservation } from '../../scripts/operator-w2/render-job-diagnostic';

const SECRET = 'synthetic-render-credential-do-not-export', SERVICE = 'srv-daiqfnrm8hqs73dtaf1g';
const contract = JSON.parse(readFileSync(new URL('../fixtures/render-job-diagnostic/official-contract.json', import.meta.url), 'utf8'));
const frozenFree = JSON.parse(readFileSync(new URL('../fixtures/render-job-diagnostic/frozen-staging-free-service.json', import.meta.url), 'utf8'));
const body = contract.request as { startCommand: string; planId: 'plan-srv-006' };
const expectedBodySHA256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
// Deliberately not generated from body: the public request and response schemas
// are independent contracts, including createdAt on a successful job response.
const job = contract.receipt;
function fixture(fetchImpl: typeof fetch = vi.fn(async () => Response.json(job, { status: 201 })) as typeof fetch) {
    const observations: RenderJobObservation[] = [];
    const options = { body: { ...body }, expectedBodySHA256, baseServicePreflight: { observedAt: new Date().toISOString(), service: structuredClone(contract.eligibleBaseService) }, fetch: fetchImpl, credentialReader: vi.fn(() => SECRET), reserveIntent: vi.fn(), checkPreDispatch: vi.fn(), writeObservation: vi.fn((o: RenderJobObservation) => { observations.push(o); }) };
    return { options, observations, fetchImpl, construct: () => createStagingRenderJobDiagnostic(options) };
}
afterEach(() => vi.useRealTimers());

describe('staging-only finite Render job diagnostic', () => {
    it.each([200, 201])('records a validated receipt at %s without claiming capture B completed', async status => {
        const fetchImpl = vi.fn(async (url, init) => {
            expect(url).toBe(`https://api.render.com/v1/services/${SERVICE}/jobs`);
            expect(init).toMatchObject({ method: 'POST', body: JSON.stringify(body), redirect: 'error', cache: 'no-store' });
            expect(init?.body).toBe(contract.requestUTF8);
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

function expectNoPorts(f: ReturnType<typeof fixture>) {
    expect(f.options.reserveIntent).not.toHaveBeenCalled();
    expect(f.options.credentialReader).not.toHaveBeenCalled();
    expect(f.options.checkPreDispatch).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.options.writeObservation).not.toHaveBeenCalled();
    expect(f.observations).toEqual([]);
}

describe('fresh paid base-service prerequisite', () => {
    it('keeps source-derived request, response and service fixtures independent', () => {
        expect(contract.provenance.openAPI).toBe('https://api-docs.render.com/openapi/render-public-api-1.json');
        expect(Object.keys(body)).toEqual(['startCommand', 'planId']);
        expect(JSON.stringify(body)).toBe(contract.requestUTF8);
        expect(Object.keys(job).sort()).toEqual(['createdAt', 'id', 'planId', 'serviceId', 'startCommand']);
        expect(job).not.toBe(body); expect(job.createdAt).toBe('2026-10-26T10:00:00.000Z');
        expect(contract.eligibleBaseService.serviceDetails.plan).toBe('starter');
        expect(contract.paidPlanValues).toHaveLength(20);
        expect(new Set(contract.paidPlanValues).size).toBe(20);
    });

    it.each(contract.paidPlanValues as string[])('accepts the documented conservative paidPlan %s without any construction effect', plan => {
        const f = fixture(); f.options.baseServicePreflight.service.serviceDetails.plan = plan;
        expect(f.construct).not.toThrow(); expectNoPorts(f);
    });

    type MalformedRecord = Record<string | symbol, unknown>;
    const serviceOf = (value: MalformedRecord) => value.service as MalformedRecord;
    const detailsOf = (value: MalformedRecord) => serviceOf(value).serviceDetails as MalformedRecord;
    const denied: Record<string, (value: MalformedRecord) => unknown> = {
        absent: () => undefined,
        null: () => null,
        array: () => [],
        'wrapper-extra': value => ({ ...value, trusted: true }),
        'wrapper-missing-observation': value => { delete value.observedAt; return value; },
        'wrapper-missing-service': value => { delete value.service; return value; },
        'wrapper-symbol': value => Object.assign(value, { [Symbol('extra')]: true }),
        'wrapper-null-prototype': value => Object.assign(Object.create(null), value),
        'wrapper-custom-prototype': value => Object.assign(Object.create({ trusted: true }), value),
        'service-null': value => { value.service = null; return value; },
        'service-array': value => { value.service = []; return value; },
        'service-extra': value => { serviceOf(value).name = 'unreviewed'; return value; },
        'service-missing-owner': value => { delete serviceOf(value).ownerId; return value; },
        'service-symbol': value => { serviceOf(value)[Symbol('extra')] = true; return value; },
        'service-custom-prototype': value => { Object.setPrototypeOf(value.service, { trusted: true }); return value; },
        'wrong-service': value => { serviceOf(value).id = 'srv-production-denied'; return value; },
        'wrong-owner': value => { serviceOf(value).ownerId = 'tea-another-workspace'; return value; },
        'wrong-type-worker': value => { serviceOf(value).type = 'background_worker'; return value; },
        'wrong-type-private': value => { serviceOf(value).type = 'private_service'; return value; },
        'details-null': value => { serviceOf(value).serviceDetails = null; return value; },
        'details-array': value => { serviceOf(value).serviceDetails = []; return value; },
        'details-extra': value => { detailsOf(value).buildPlan = 'starter'; return value; },
        'details-missing-plan': value => { delete detailsOf(value).plan; return value; },
        'details-symbol': value => { detailsOf(value)[Symbol('extra')] = true; return value; },
        'details-null-prototype': value => { Object.setPrototypeOf(detailsOf(value), null); return value; },
        'free-base-with-paid-job-plan': value => { detailsOf(value).plan = 'free'; return value; },
        'unknown-plan': value => { detailsOf(value).plan = 'unknown'; return value; },
        'custom-plan': value => { detailsOf(value).plan = 'custom'; return value; },
        'legacy-plan': value => { detailsOf(value).plan = 'legacy'; return value; },
        'wrong-plan-case': value => { detailsOf(value).plan = 'STARTER'; return value; },
        'empty-plan': value => { detailsOf(value).plan = ''; return value; },
        'non-string-plan': value => { detailsOf(value).plan = 1; return value; },
        'boxed-plan': value => { detailsOf(value).plan = new String('starter'); return value; },
    };
    for (const [name, change] of Object.entries(denied)) {
        it(`denies ${name} before every callback, including observation persistence`, () => {
            const f = fixture(); f.options.baseServicePreflight = change(f.options.baseServicePreflight) as typeof f.options.baseServicePreflight;
            expect(f.construct).toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
        });
    }

    for (const path of ['observedAt', 'service', 'service.id', 'service.ownerId', 'service.type', 'service.serviceDetails', 'service.serviceDetails.plan']) {
        it(`denies accessor ${path} without evaluating it or any port`, () => {
            const f = fixture(), getter = vi.fn(() => SECRET), parts = path.split('.');
            let target: MalformedRecord = f.options.baseServicePreflight;
            for (const name of parts.slice(0, -1)) target = target[name] as MalformedRecord;
            Object.defineProperty(target, parts.at(-1)!, { enumerable: true, get: getter });
            expect(f.construct).toThrow('staging_render_job_base_service_denied');
            expect(getter).not.toHaveBeenCalled(); expectNoPorts(f);
        });
    }

    it('denies the saved actual Free service projection even with a fresh simulated wrapper timestamp', () => {
        vi.useFakeTimers(); vi.setSystemTime('2026-10-26T10:00:00.000Z');
        const f = fixture(); f.options.baseServicePreflight.service = structuredClone(frozenFree.service);
        expect(frozenFree.provenance.sourceArtifactSHA256).toBe('784c07337d81c8369877bf57b9ebad2fb57b37cc0043343291d023025faac75e');
        expect(frozenFree.provenance.savedObservedAt).toBe('2026-10-23T19:03:30.769Z');
        expect(f.options.baseServicePreflight.observedAt).toBe('2026-10-26T10:00:00.000Z');
        expect(f.options.body.planId).toBe('plan-srv-006');
        expect(f.construct).toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
    });

    it.each([0, 60000])('accepts canonical observedAt at age %sms inclusively', age => {
        vi.useFakeTimers(); vi.setSystemTime('2026-10-26T10:00:00.000Z');
        const f = fixture(); f.options.baseServicePreflight.observedAt = new Date(Date.now() - age).toISOString();
        expect(f.construct).not.toThrow(); expectNoPorts(f);
    });

    for (const [name, observedAt] of Object.entries({
        stale: '2026-10-26T09:58:59.999Z', future: '2026-10-26T10:00:00.001Z',
        'missing-milliseconds': '2026-10-26T10:00:00Z', 'two-digit-milliseconds': '2026-10-26T10:00:00.00Z',
        'extra-precision': '2026-10-26T10:00:00.0000Z', 'offset-form': '2026-10-26T10:00:00.000+00:00',
        'noncanonical-calendar': '2026-02-30T10:00:00.000Z', 'invalid-date': 'not a date',
        whitespace: ' 2026-10-26T10:00:00.000Z', 'number-value': 1793008800000, 'date-object': new Date('2026-10-26T10:00:00.000Z'), null: null,
    })) {
        it(`rejects observedAt ${name} before construction effects`, () => {
            vi.useFakeTimers(); vi.setSystemTime('2026-10-26T10:00:00.000Z');
            const f = fixture(); f.options.baseServicePreflight.observedAt = observedAt as string;
            expect(f.construct).toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
        });
    }

    it('rechecks age before reserve or credential access; a changed input cannot refresh the snapshot', async () => {
        vi.useFakeTimers(); vi.setSystemTime('2026-10-26T10:00:00.000Z');
        const f = fixture(), client = f.construct(); vi.setSystemTime('2026-10-26T10:01:00.001Z');
        await expect(client.dispatch()).rejects.toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
        f.options.baseServicePreflight.observedAt = new Date().toISOString();
        await expect(client.dispatch()).rejects.toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
    });

    it('rechecks that the observation is not in the future before any dispatch callbacks', async () => {
        vi.useFakeTimers(); vi.setSystemTime('2026-10-26T10:00:00.000Z');
        const f = fixture(), client = f.construct(); vi.setSystemTime('2026-10-26T09:59:59.999Z');
        await expect(client.dispatch()).rejects.toThrow('staging_render_job_base_service_denied'); expectNoPorts(f);
    });

    it.each([60001, -1])('rejects age %sms reached during the dispatch guard; slot stays spent', async age => {
        vi.useFakeTimers(); const initial = Date.parse('2026-10-26T10:00:00.000Z'); vi.setSystemTime(initial);
        const f = fixture(); f.options.checkPreDispatch.mockImplementation(async () => { vi.setSystemTime(initial + age); });
        const client = f.construct(), result = await client.dispatch();
        expect(result).toMatchObject({ status: 'UNKNOWN_SPENT_STOP', stage: 'dispatch_guard', reason: 'DISPATCH_GUARD_FAILED', fetchInvoked: false, httpStatus: null, providerId: null, retry: false });
        expect(f.options.reserveIntent).toHaveBeenCalledTimes(1); expect(f.options.credentialReader).toHaveBeenCalledTimes(1); expect(f.options.checkPreDispatch).toHaveBeenCalledTimes(1);
        expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.options.writeObservation).toHaveBeenCalledTimes(1);
        await expect(client.dispatch()).rejects.toThrow('attempt_spent'); expect(f.options.reserveIntent).toHaveBeenCalledTimes(1);
    });

    it('permits the exact60s prefetch boundary after an awaited guard', async () => {
        vi.useFakeTimers(); const initial = Date.parse('2026-10-26T10:00:00.000Z'); vi.setSystemTime(initial);
        const f = fixture(); f.options.checkPreDispatch.mockImplementation(async () => { vi.setSystemTime(initial + 60000); });
        expect(await f.construct().dispatch()).toMatchObject({ status: 'KNOWN_ACCEPTED', retry: false });
        expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('snapshots the validated paid service and timestamp, without trusting later caller mutation', async () => {
        const f = fixture(), client = f.construct();
        f.options.baseServicePreflight.observedAt = 'not a date';
        f.options.baseServicePreflight.service.id = 'srv-production-denied';
        f.options.baseServicePreflight.service.ownerId = 'tea-another-workspace';
        f.options.baseServicePreflight.service.type = 'background_worker';
        f.options.baseServicePreflight.service.serviceDetails.plan = 'free';
        expect(await client.dispatch()).toMatchObject({ status: 'KNOWN_ACCEPTED', retry: false, providerId: job.id });
        expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
});
