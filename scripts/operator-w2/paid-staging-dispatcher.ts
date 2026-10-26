/** Pure, staging-only dispatch adapter. Importing this module reads no credentials,
 * opens no journal and performs no network request. It never owns/reset slots. */
import { createHash } from 'node:crypto';

export const PAID_STAGING_SERVICE = 'srv-daiqfnrm8hqs73dtaf1g';
export const PAID_STAGING_WORKSPACE = 'tea-daipgd67bikc739jftl0';
export const PAID_STAGING_JOBS_URL = `https://api.render.com/v1/services/${PAID_STAGING_SERVICE}/jobs`;
export const PAID_STAGING_JOB_PLAN = 'plan-srv-006';
export type JournalScope = Readonly<{ windowId: string; planSHA256: string; expectedSHA: string }>;
export type PublicJournalRecord = Readonly<{
    slot: string; status: string; requestSHA256: string;
    evidenceSHA256: string | null; providerId: string | null;
    httpStatus: number | null; windowId: string | null;
    planSHA256: string; expectedSHA: string;
}>;
/** Structurally compatible with the canonical Journal. A hosted acceptance caller
 * must supply its independently reviewed unused namespace; no W2 slot is added. */
export type PublicJournal<S extends string> = Readonly<{
    reserve(s: S, scope: JournalScope | null, requestSHA256: string, instanceId?: string): PublicJournalRecord;
    receipt(s: S, status: 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP', evidenceSHA256: string, providerId?: string, httpStatus?: number): PublicJournalRecord;
    terminal(s: S, evidenceSHA256: string): PublicJournalRecord;
    read(s: S, suffix: 'intent' | 'receipt' | 'terminal'): PublicJournalRecord | undefined;
    inventory(): Readonly<{ sha256: string; records: number; legacyFiles: number }>;
}>;
export type PaidBaseEvidence = Readonly<{
    serviceId: typeof PAID_STAGING_SERVICE;
    workspaceId: typeof PAID_STAGING_WORKSPACE;
    type: 'web_service'; plan: '0.5c-512mb'; region: 'frankfurt'; runtime: 'docker';
    liveSHA: string; observedAt: string; eligible: true;
}>;
export type PaidStagingRequest = Readonly<{ planId: typeof PAID_STAGING_JOB_PLAN; startCommand: string }>;
export type PaidStagingTerminalEvidence = Readonly<{
    id: string; serviceId: typeof PAID_STAGING_SERVICE; planId: typeof PAID_STAGING_JOB_PLAN;
    startCommand: string; status: 'succeeded'; startedAt: string; finishedAt: string;
}>;
export type PaidStagingPrechecks = Readonly<{
    filesystem(): void | Promise<void>;
    sourceCI(): void | Promise<void>;
    journalInventory(inventory: ReturnType<PublicJournal<string>['inventory']>): void | Promise<void>;
    metadata(): PaidBaseEvidence | Promise<PaidBaseEvidence>;
    paidBase(evidence: PaidBaseEvidence): void | Promise<void>;
}>;
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, JOB = /^job-[a-z0-9]{8,100}$/;
function need(value: unknown, code: string): asserts value { if (!value) throw Error('PAID_STAGING_DISPATCHER_' + code); }
function canonical(value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') { need(Number.isFinite(value), 'DATA'); return JSON.stringify(value); }
    need(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'DATA');
    return '{' + Reflect.ownKeys(value).sort((a, b) => String(a).localeCompare(String(b))).map(key => {
        need(typeof key === 'string', 'DATA'); const d = Object.getOwnPropertyDescriptor(value, key);
        need(d && Object.hasOwn(d, 'value') && d.enumerable, 'DATA');
        return JSON.stringify(key) + ':' + canonical(d.value);
    }).join(',') + '}';
}
function hash(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function ownMethod<T extends object, K extends keyof T>(object: T, key: K): T[K] {
    const d = Object.getOwnPropertyDescriptor(object, key);
    need(d && Object.hasOwn(d, 'value') && typeof d.value === 'function', 'OWN_DATA_METHOD');
    return d.value as T[K];
}
function methods<T extends object, K extends keyof T>(object: T, keys: readonly K[]) {
    need(object && typeof object === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(object)), 'METHOD_OBJECT');
    const originals = keys.map(key => [key, ownMethod(object, key)] as const);
    const bound = Object.fromEntries(originals.map(([key, fn]) => [key, Function.prototype.bind.call(fn as (...args: never[]) => unknown, object)])) as Pick<T, K>;
    return { bound: Object.freeze(bound), unchanged() { for (const [key, fn] of originals) need(ownMethod(object, key) === fn, 'METHOD_CHANGED'); } };
}
function requestCopy(request: PaidStagingRequest): PaidStagingRequest {
    need(request && Object.getPrototypeOf(request) === Object.prototype && Reflect.ownKeys(request).sort().join('|') === 'planId|startCommand', 'REQUEST');
    const plan = Object.getOwnPropertyDescriptor(request, 'planId'), command = Object.getOwnPropertyDescriptor(request, 'startCommand');
    need(plan && Object.hasOwn(plan, 'value') && plan.value === PAID_STAGING_JOB_PLAN && command && Object.hasOwn(command, 'value') && typeof command.value === 'string' && command.value.length > 0 && Buffer.byteLength(command.value) <= 8192, 'REQUEST');
    return Object.freeze({ planId: PAID_STAGING_JOB_PLAN, startCommand: command.value });
}
export function paidStagingRequestSHA256(request: PaidStagingRequest): string {
    return hash({ method: 'POST', url: PAID_STAGING_JOBS_URL, body: requestCopy(request) });
}
function timestamp(value: unknown): number { need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'TIME'); const t = Date.parse(value); need(Number.isFinite(t), 'TIME'); return t; }
function recordMatches(record: PublicJournalRecord | undefined, slot: string, requestSHA256: string, scope: JournalScope | null, expectedSHA: string, expectedPlanSHA256: string) {
    need(record && Object.getPrototypeOf(record) === Object.prototype && ['slot', 'status', 'requestSHA256', 'evidenceSHA256', 'providerId', 'httpStatus', 'windowId', 'planSHA256', 'expectedSHA'].every(key => { const d = Object.getOwnPropertyDescriptor(record, key); return d && Object.hasOwn(d, 'value'); }), 'JOURNAL_RECORD');
    need(record.slot === slot && record.requestSHA256 === requestSHA256 && record.expectedSHA === expectedSHA && record.windowId === (scope?.windowId ?? null) && record.planSHA256 === expectedPlanSHA256 && (scope === null || record.planSHA256 === scope.planSHA256), 'JOURNAL_BINDING');
    return record;
}
export function createPaidStagingDispatcher<S extends string>(options: {
    journal: PublicJournal<S>; slot: S; scope: JournalScope | null; request: PaidStagingRequest;
    expectedRequestSHA256: string; expectedApplicationSHA: string; expectedJournalPlanSHA256: string; instanceId?: string;
    prechecks: PaidStagingPrechecks; credentialReader(): string; fetch: typeof fetch;
    now?: () => number; timeoutMs?: number;
}) {
    const journalMethods = methods(options.journal, ['reserve', 'receipt', 'terminal', 'read', 'inventory'] as const), journal = journalMethods.bound;
    const checks = methods(options.prechecks, ['filesystem', 'sourceCI', 'journalInventory', 'metadata', 'paidBase'] as const);
    const credentials = Function.prototype.bind.call(ownMethod(options, 'credentialReader'), options) as () => string;
    const fetcher = Function.prototype.bind.call(ownMethod(options, 'fetch'), options) as typeof fetch;
    const now: () => number = options.now ? Function.prototype.bind.call(ownMethod(options, 'now')!, options) : Date.now;
    const request = requestCopy(options.request), requestSHA256 = paidStagingRequestSHA256(request), body = JSON.stringify(request);
    const slot = options.slot, expectedSHA = options.expectedApplicationSHA, expectedPlanSHA256 = options.expectedJournalPlanSHA256, timeoutMs = options.timeoutMs ?? 30000;
    need(typeof slot === 'string' && slot.length > 0 && slot.length <= 256 && !slot.includes('..') && SHA.test(expectedSHA) && HEX.test(expectedPlanSHA256) && HEX.test(options.expectedRequestSHA256) && requestSHA256 === options.expectedRequestSHA256 && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'CONSTRUCTION');
    need(options.scope === null || (Object.getPrototypeOf(options.scope) === Object.prototype && Reflect.ownKeys(options.scope).every(key => typeof key === 'string') && Reflect.ownKeys(options.scope).sort().join('|') === 'expectedSHA|planSHA256|windowId'), 'SCOPE');
    const scope = options.scope === null ? null : Object.freeze(JSON.parse(canonical(options.scope))) as JournalScope;
    need(scope === null || (/^[a-f0-9-]{36}$/.test(scope.windowId) && scope.planSHA256 === expectedPlanSHA256 && scope.expectedSHA === expectedSHA), 'SCOPE');
    const instanceId = options.instanceId;
    let state: 'UNUSED' | 'CHECKING' | 'RESERVE_FAILED' | 'RESERVED' | 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP' | 'HOLD' | 'TERMINAL_SUCCEEDED' = 'UNUSED';
    let jobId: string | undefined, acceptedEvidenceSHA256: string | undefined, dispatchStartedAt = 0, reserveReturned = false;
    let paidEvidence: PaidBaseEvidence | undefined;
    function freshPaid() { need(paidEvidence, 'PAID_BASE'); const observedAt = timestamp(paidEvidence.observedAt), at = now(); need(observedAt <= at && at - observedAt <= 60000, 'PAID_BASE_STALE'); }
    function unchanged() { journalMethods.unchanged(); checks.unchanged(); }
    function intent() { return recordMatches(journal.read(slot, 'intent'), slot, requestSHA256, scope, expectedSHA, expectedPlanSHA256); }
    function accepted() { const r = recordMatches(journal.read(slot, 'receipt'), slot, requestSHA256, scope, expectedSHA, expectedPlanSHA256); need(r.status === 'KNOWN_ACCEPTED' && r.providerId === jobId && r.evidenceSHA256 === acceptedEvidenceSHA256, 'ACCEPTED_RECEIPT'); return r; }
    async function dispatch() {
        need(state === 'UNUSED', 'SPENT_STOP'); state = 'CHECKING';
        try {
            await checks.bound.filesystem(); unchanged(); await checks.bound.sourceCI(); unchanged();
            const inventory = journal.inventory(); need(HEX.test(inventory.sha256) && Number.isSafeInteger(inventory.records) && inventory.records >= 0 && Number.isSafeInteger(inventory.legacyFiles) && inventory.legacyFiles >= 0, 'INVENTORY');
            need(!journal.read(slot, 'intent') && !journal.read(slot, 'receipt') && !journal.read(slot, 'terminal'), 'SLOT_ALREADY_EXISTS');
            await checks.bound.journalInventory(inventory); unchanged();
            const evidence = await checks.bound.metadata(); unchanged();
            need(evidence && Object.getPrototypeOf(evidence) === Object.prototype, 'METADATA');
            const paid = Object.freeze(JSON.parse(canonical(evidence))) as PaidBaseEvidence;
            const observedAt = timestamp(paid.observedAt), at = now();
            need(paid.serviceId === PAID_STAGING_SERVICE && paid.workspaceId === PAID_STAGING_WORKSPACE && paid.type === 'web_service' && paid.plan === '0.5c-512mb' && paid.region === 'frankfurt' && paid.runtime === 'docker' && paid.eligible === true && paid.liveSHA === expectedSHA && observedAt <= at && at - observedAt <= 60000, 'PAID_BASE');
            paidEvidence = paid; unchanged(); await checks.bound.paidBase(paid); unchanged(); freshPaid();
        } catch { state = 'HOLD'; throw Error('PAID_STAGING_DISPATCHER_PRECHECK_HOLD'); }
        try {
            freshPaid();
            const reservation = recordMatches(journal.reserve(slot, scope, requestSHA256, instanceId), slot, requestSHA256, scope, expectedSHA, expectedPlanSHA256);
            const durable = intent();
            for (const record of [reservation, durable]) need(record.status === 'RESERVED_BEFORE_MUTATION' && record.evidenceSHA256 === null && record.providerId === null && record.httpStatus === null, 'DURABLE_RESERVE');
            reserveReturned = true;
        } catch { state = 'RESERVE_FAILED'; throw Error('PAID_STAGING_DISPATCHER_RESERVE_FAILED_NO_EXTERNAL_CALLS'); }
        state = 'RESERVED';
        let key = '', receiptAttempted = false, timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController(); dispatchStartedAt = now();
        try {
            intent(); unchanged(); freshPaid();
            key = credentials(); need(typeof key === 'string' && /^[A-Za-z0-9._-]{20,4096}$/.test(key), 'CREDENTIAL'); unchanged();
            const operation = (async () => {
                freshPaid(); unchanged();
                const response = await fetcher(PAID_STAGING_JOBS_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body, redirect: 'error', cache: 'no-store', signal: controller.signal });
                need(!controller.signal.aborted && !response.redirected && [200, 201].includes(response.status), 'HTTP');
                const length = response.headers.get('content-length'); need(length === null || /^\d+$/.test(length) && Number(length) <= 65536, 'RESPONSE_BOUND');
                const reader = response.body?.getReader(); need(reader, 'RESPONSE_BODY'); const chunks: Uint8Array[] = []; let size = 0;
                const cancel = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', cancel, { once: true });
                try { for (;;) { need(!controller.signal.aborted, 'ABORTED'); const part = await reader.read(); if (part.done) break; size += part.value.length; need(size <= 65536, 'RESPONSE_BOUND'); chunks.push(part.value); } }
                finally { controller.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
                need(!controller.signal.aborted, 'ABORTED');
                const value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks, size))) as { job?: unknown };
                const raw = value && typeof value === 'object' && Object.hasOwn(value, 'job') ? value.job : value;
                need(raw && typeof raw === 'object' && !Array.isArray(raw), 'RECEIPT'); const job = raw as Record<string, unknown>;
                need(typeof job.id === 'string' && JOB.test(job.id) && job.serviceId === PAID_STAGING_SERVICE && job.planId === PAID_STAGING_JOB_PLAN && job.startCommand === request.startCommand && typeof job.status === 'string' && ['pending', 'queued', 'running', 'succeeded'].includes(job.status), 'RECEIPT');
                return { jobId: job.id, httpStatus: response.status, evidenceSHA256: hash({ id: job.id, serviceId: job.serviceId, planId: job.planId, startCommandSHA256: createHash('sha256').update(request.startCommand).digest('hex'), status: job.status, requestSHA256 }) };
            })();
            const receipt = await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('PAID_STAGING_DISPATCHER_TIMEOUT')); }, timeoutMs); })]);
            unchanged(); intent(); need(!journal.read(slot, 'receipt'), 'RECEIPT_ALREADY_EXISTS');
            receiptAttempted = true;
            journal.receipt(slot, 'KNOWN_ACCEPTED', receipt.evidenceSHA256, receipt.jobId, receipt.httpStatus);
            jobId = receipt.jobId; acceptedEvidenceSHA256 = receipt.evidenceSHA256; accepted(); state = 'KNOWN_ACCEPTED';
            return Object.freeze({ status: 'KNOWN_ACCEPTED' as const, jobId, requestSHA256, evidenceSHA256: receipt.evidenceSHA256 });
        } catch {
            controller.abort(); state = 'UNKNOWN_SPENT_STOP';
            if (!receiptAttempted) {
                try { intent(); if (!journal.read(slot, 'receipt')) journal.receipt(slot, 'UNKNOWN_SPENT_STOP', hash({ status: 'UNKNOWN_SPENT_STOP', requestSHA256 })); } catch { /* Spent intent/unknown or ambiguous receipt remains STOP. */ }
            }
            throw Error('PAID_STAGING_DISPATCHER_UNKNOWN_SPENT_STOP');
        } finally { if (timer) clearTimeout(timer); key = ''; }
    }
    /** Evidence must come from the caller's reviewed trusted owned-job collector.
     * This pure adapter validates its exact binding, not its network provenance. */
    function terminal(evidence: PaidStagingTerminalEvidence) {
        need(state === 'KNOWN_ACCEPTED', 'TERMINAL_REQUIRES_ACCEPTED');
        try {
            unchanged(); journal.inventory(); intent(); accepted(); need(!journal.read(slot, 'terminal'), 'TERMINAL_ALREADY_EXISTS');
            const e = JSON.parse(canonical(evidence)) as PaidStagingTerminalEvidence;
            need(Object.keys(e).sort().join('|') === 'finishedAt|id|planId|serviceId|startCommand|startedAt|status' && e.id === jobId && e.serviceId === PAID_STAGING_SERVICE && e.planId === PAID_STAGING_JOB_PLAN && e.startCommand === request.startCommand && e.status === 'succeeded', 'TERMINAL_PROVIDER');
            const started = timestamp(e.startedAt), finished = timestamp(e.finishedAt);
            need(started >= dispatchStartedAt && finished >= started && finished <= now(), 'TERMINAL_TIME');
            const evidenceSHA256 = hash({ ...e, startCommand: createHash('sha256').update(e.startCommand).digest('hex'), requestSHA256 });
            journal.terminal(slot, evidenceSHA256);
            const record = recordMatches(journal.read(slot, 'terminal'), slot, requestSHA256, scope, expectedSHA, expectedPlanSHA256);
            need(record.status === 'TERMINAL_SUCCEEDED' && record.evidenceSHA256 === evidenceSHA256, 'DURABLE_TERMINAL');
            state = 'TERMINAL_SUCCEEDED'; return Object.freeze({ status: 'TERMINAL_SUCCEEDED' as const, jobId: e.id, evidenceSHA256 });
        } catch { state = 'HOLD'; throw Error('PAID_STAGING_DISPATCHER_TERMINAL_HOLD'); }
    }
    return Object.freeze({ dispatch, terminal, state: () => Object.freeze({ status: state, slot, requestSHA256, reserved: reserveReturned }) });
}
