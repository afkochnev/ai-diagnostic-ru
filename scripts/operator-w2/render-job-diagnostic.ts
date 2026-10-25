import { createHash } from 'node:crypto';

const SERVICE = 'srv-daiqfnrm8hqs73dtaf1g';
const URL = `https://api.render.com/v1/services/${SERVICE}/jobs`;
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

/** Future staging dispatch only. No CLI, default fetch, credential reader, budget
 * allocation or production/W2 integration. The caller must independently pin
 * authority/readiness and durably reserve a NEW authorized slot before dispatch.
 * A safe observation never proves delivery, job completion or capture B PASS. */
export function createStagingRenderJobDiagnostic(options: {
    body: { startCommand: string; planId: 'plan-srv-006' };
    expectedBodySHA256: string;
    fetch: typeof fetch;
    credentialReader: () => string;
    reserveIntent: () => void | Promise<void>;
    checkPreDispatch: () => void | Promise<void>;
    writeObservation: (observation: RenderJobObservation) => void | Promise<void>;
}) {
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
