import { createHash } from 'node:crypto';

const SERVICE = 'srv-daiqfnrm8hqs73dtaf1g';
const OWNER = 'tea-daipgd67bikc739jftl0';
const URL = `https://api.render.com/v1/services/${SERVICE}/jobs`;
const PREFLIGHT_MAX_AGE_MS = 60000;
// Conservative paidPlan enum reviewed in Render's public OpenAPI on 2026-10-26.
// A paid job planId does not make a Free base web service eligible for jobs.
const PAID_BASE_PLANS = new Set(['starter', 'standard', 'pro', 'pro_plus', 'pro_max', 'pro_ultra', '0.5c-512mb', '1c-2g', '2c-4g', '2c-8g', '2c-16g', '4c-8g', '4c-16g', '4c-32g', '8c-16g', '8c-32g', '8c-64g', '12c-24g', '12c-48g', '12c-96g']);
const MAXIMUM_BYTES = 1024 * 1024;
const TIMEOUT_MS = 30000;
const EVIDENCE_TIMEOUT_MS = 5000;
type Stage = 'intent' | 'credential' | 'dispatch_guard' | 'fetch' | 'http' | 'body' | 'utf8' | 'json' | 'receipt' | 'evidence';
type Reason = 'INTENT_FAILED' | 'CREDENTIAL_FAILED' | 'DISPATCH_GUARD_FAILED' | 'FETCH_FAILED' | 'TIMEOUT' | 'HTTP_STATUS_UNEXPECTED' | 'REDIRECT_DENIED' | 'BODY_MISSING' | 'BODY_LIMIT' | 'BODY_READ_FAILED' | 'INVALID_UTF8' | 'INVALID_JSON' | 'INVALID_RECEIPT' | 'OBSERVATION_WRITE_FAILED' | 'OBSERVATION_TIMEOUT';
export type RenderJobObservation = Readonly<{
    version: 1;
    status: 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP';
    serviceId: typeof SERVICE;
    stage: Stage;
    reason: Reason | null;
    fetchInvoked: boolean;
    httpStatus: number | null;
    providerId: string | null;
    retry: false;
}>;

export type RenderJobBaseServicePreflight = {
    observedAt: string;
    service: { id: string; ownerId: string; type: string; serviceDetails: { plan: string } };
};

function preflightFields(value: unknown, keys: string[]): Record<string, PropertyDescriptor> {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw Error('staging_render_job_base_service_denied');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string') || ownKeys.sort().join(',') !== keys.join(',')) throw Error('staging_render_job_base_service_denied');
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Object.values(fields).some(field => !Object.hasOwn(field, 'value'))) throw Error('staging_render_job_base_service_denied');
    return fields;
}

function snapshotBaseServicePreflight(input: unknown): number {
    const fields = preflightFields(input, ['observedAt', 'service']);
    const service = preflightFields(fields.service.value, ['id', 'ownerId', 'serviceDetails', 'type']);
    const details = preflightFields(service.serviceDetails.value, ['plan']);
    if (service.id.value !== SERVICE || service.ownerId.value !== OWNER || service.type.value !== 'web_service' || typeof details.plan.value !== 'string' || !PAID_BASE_PLANS.has(details.plan.value)) throw Error('staging_render_job_base_service_denied');
    const observedAt = fields.observedAt.value;
    if (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt)) throw Error('staging_render_job_base_service_denied');
    const time = Date.parse(observedAt);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== observedAt) throw Error('staging_render_job_base_service_denied');
    return time;
}

function baseServicePreflightFresh(observedAt: number): boolean {
    const age = Date.now() - observedAt;
    return age >= 0 && age <= PREFLIGHT_MAX_AGE_MS;
}

/** Future staging dispatch only. No CLI, default fetch, credential reader, budget
 * allocation or production/W2 integration. The caller must independently pin
 * authority/readiness and durably reserve a NEW authorized slot before dispatch.
 * A safe observation never proves delivery, job completion or capture B PASS. */
export function createStagingRenderJobDiagnostic(options: {
    body: { startCommand: string; planId: 'plan-srv-006' };
    expectedBodySHA256: string;
    baseServicePreflight: RenderJobBaseServicePreflight;
    fetch: typeof fetch;
    credentialReader: () => string;
    reserveIntent: () => void | Promise<void>;
    checkPreDispatch: () => void | Promise<void>;
    writeObservation: (observation: RenderJobObservation) => void | Promise<void>;
}) {
    // Supplied projection of a trusted, fresh service read. This is a necessary
    // prerequisite, not authority to run a job. Never fetch, upgrade or substitute
    // a service here. Caller readiness must independently bind the source read.
    const baseServiceObservedAt = snapshotBaseServicePreflight(options.baseServicePreflight);
    if (!baseServicePreflightFresh(baseServiceObservedAt)) throw Error('staging_render_job_base_service_denied');
    const input = options.body;
    if (!input || Object.getPrototypeOf(input) !== Object.prototype || Reflect.ownKeys(input).sort().join(',') !== 'planId,startCommand') throw Error('staging_render_job_request_denied');
    const fields = Object.getOwnPropertyDescriptors(input);
    if (Object.values(fields).some(d => !Object.hasOwn(d, 'value'))) throw Error('staging_render_job_request_denied');
    const body = { startCommand: fields.startCommand.value, planId: fields.planId.value };
    if (body.planId !== 'plan-srv-006' || typeof body.startCommand !== 'string' || !body.startCommand || Buffer.byteLength(body.startCommand) > 8192 || !/^[a-f0-9]{64}$/.test(options.expectedBodySHA256)) throw Error('staging_render_job_request_denied');
    const serialized = JSON.stringify(body);
    if (createHash('sha256').update(serialized).digest('hex') !== options.expectedBodySHA256 || ![options.fetch, options.credentialReader, options.reserveIntent, options.checkPreDispatch, options.writeObservation].every(fn => typeof fn === 'function')) throw Error('staging_render_job_request_denied');
    const startCommand = body.startCommand;
    // Snapshot references so caller mutations cannot substitute a destination,
    // credential reader, reservation or evidence writer after construction.
    const { fetch: fetchImpl, credentialReader, reserveIntent, checkPreDispatch, writeObservation } = options;
    let spent = false;
    return Object.freeze({ async dispatch(): Promise<RenderJobObservation> {
        if (spent) throw Error('staging_render_job_attempt_spent');
        if (!baseServicePreflightFresh(baseServiceObservedAt)) throw Error('staging_render_job_base_service_denied');
        spent = true;
        let stage: Stage = 'intent', reason: Reason | null = 'INTENT_FAILED', fetchInvoked = false, httpStatus: number | null = null, providerId: string | null = null;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined, credential = '', reader: ReadableStreamDefaultReader<Uint8Array> | undefined, response: Response | undefined;
        const cancel = () => { if (reader) void reader.cancel().catch(() => {}); else if (response?.body) void response.body.cancel().catch(() => {}); };
        const fail = (code: Reason): never => { reason = code; throw Error('staging_render_job_hold'); };
        try {
            await Promise.race([(async () => {
                await reserveIntent();
                if (controller.signal.aborted) fail('TIMEOUT');
                stage = 'credential'; reason = 'CREDENTIAL_FAILED';
                credential = credentialReader();
                if (typeof credential !== 'string' || credential.length < 20 || /[\r\n]/.test(credential)) fail('CREDENTIAL_FAILED');
                stage = 'dispatch_guard'; reason = 'DISPATCH_GUARD_FAILED';
                await checkPreDispatch();
                if (controller.signal.aborted) fail('TIMEOUT');
                if (!baseServicePreflightFresh(baseServiceObservedAt)) fail('DISPATCH_GUARD_FAILED');
                stage = 'fetch'; reason = 'FETCH_FAILED'; fetchInvoked = true;
                response = await fetchImpl(URL, { method: 'POST', headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, body: serialized, redirect: 'error', cache: 'no-store', signal: controller.signal });
                if (controller.signal.aborted) { cancel(); fail('TIMEOUT'); }
                stage = 'http';
                if (Number.isInteger(response.status) && response.status >= 100 && response.status <= 599) httpStatus = response.status;
                if (response.redirected) fail('REDIRECT_DENIED');
                if (![200, 201].includes(response.status)) fail('HTTP_STATUS_UNEXPECTED');
                // Do not read or hash HTTP error bodies, headers or statusText.
                stage = 'body'; reason = 'BODY_READ_FAILED';
                const declared = response.headers.get('content-length');
                if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAXIMUM_BYTES)) fail('BODY_LIMIT');
                const stream = response.body;
                if (!stream) return fail('BODY_MISSING');
                reader = stream.getReader();
                controller.signal.addEventListener('abort', cancel, { once: true });
                const chunks: Uint8Array[] = []; let bytes = 0;
                for (;;) {
                    const next = await reader.read();
                    if (controller.signal.aborted) fail('TIMEOUT');
                    if (next.done) break;
                    if (!(next.value instanceof Uint8Array) || bytes + next.value.byteLength > MAXIMUM_BYTES) fail('BODY_LIMIT');
                    chunks.push(next.value); bytes += next.value.byteLength;
                }
                stage = 'utf8'; reason = 'INVALID_UTF8';
                const text = new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
                stage = 'json'; reason = 'INVALID_JSON';
                const raw = JSON.parse(text), job = raw?.job ?? raw;
                stage = 'receipt'; reason = 'INVALID_RECEIPT';
                if (!job || typeof job.id !== 'string' || !/^job-[a-z0-9]{8,100}$/.test(job.id) || job.serviceId !== SERVICE || job.planId !== 'plan-srv-006' || job.startCommand !== startCommand) fail('INVALID_RECEIPT');
                providerId = job.id; reason = null;
            })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { reason = 'TIMEOUT'; controller.abort(); cancel(); reject(Error('staging_render_job_hold')); }, TIMEOUT_MS); })]);
        } catch {
            // Never serialize the caught error, body, credential or response hash.
            providerId = null;
        } finally {
            clearTimeout(timer); controller.abort(); cancel();
            controller.signal.removeEventListener('abort', cancel);
            try { reader?.releaseLock(); } catch { /* pending cancellation remains aborted */ }
            credential = '';
        }
        let observation: RenderJobObservation = Object.freeze({ version: 1, status: reason === null ? 'KNOWN_ACCEPTED' : 'UNKNOWN_SPENT_STOP', serviceId: SERVICE, stage, reason, fetchInvoked, httpStatus, providerId, retry: false });
        let evidenceTimer: ReturnType<typeof setTimeout> | undefined, evidenceTimedOut = false;
        try { await Promise.race([Promise.resolve().then(() => writeObservation(observation)), new Promise<never>((_, reject) => { evidenceTimer = setTimeout(() => { evidenceTimedOut = true; reject(Error('staging_render_job_hold')); }, EVIDENCE_TIMEOUT_MS); })]); }
        catch { observation = Object.freeze({ ...observation, status: 'UNKNOWN_SPENT_STOP', stage: 'evidence', reason: evidenceTimedOut ? 'OBSERVATION_TIMEOUT' : 'OBSERVATION_WRITE_FAILED', providerId: null }); }
        finally { clearTimeout(evidenceTimer); }
        return observation;
    } });
}
