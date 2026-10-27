/** Read-only, one-shot Render terminal collector. Import/construction performs no
 * credential read, file write or network request. A custom fetch is accepted only
 * for an owned LOCAL_MOCK journal; hosted collection captures native fetch. */
import { createHash } from 'node:crypto';
import {
    PAID_STAGING_JOB_PLAN, PAID_STAGING_JOBS_URL, PAID_STAGING_SERVICE,
    PAID_STAGING_WORKSPACE, type PaidStagingTerminalEvidence,
} from './paid-staging-dispatcher';
import {
    getPaidStagingJournalBinding, type PaidAcceptanceJournal,
    type PaidStagingJournalBinding,
} from './paid-staging-journal';

const nativeFetch = globalThis.fetch.bind(globalThis);
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, JOB = /^job-[a-z0-9]{8,100}$/;
type CollectorState = 'UNUSED' | 'CHECKING' | 'GET_INFLIGHT' | 'TERMINAL_PROVEN' | 'CONSUMED' | 'HOLD';
type Attempt = { state: CollectorState; proof?: Readonly<{ evidenceSHA256: string; binding: PaidStagingJournalBinding; evidence: PaidStagingTerminalEvidence; observedAt: number; now: () => number }> };
/** Journal identity is part of the capability. There is no public mint function,
 * raw proof object, persistent key, reset or retry operation. */
const attempts = new WeakMap<object, Map<string, Attempt>>();

function need(value: unknown, code: string): asserts value { if (!value) throw Error('PAID_STAGING_TERMINAL_' + code); }
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
function own<T extends object, K extends keyof T>(object: T, key: K): T[K] {
    const d = Object.getOwnPropertyDescriptor(object, key);
    need(d && Object.hasOwn(d, 'value'), 'OWN_DATA'); return d.value as T[K];
}
function method<T extends object, K extends keyof T>(object: T, key: K): T[K] {
    const fn = own(object, key); need(typeof fn === 'function', 'OWN_DATA_METHOD'); return fn;
}
function timestamp(value: unknown): number {
    need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value), 'TIME');
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    need(month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] && Number(value.slice(11, 13)) <= 23 && Number(value.slice(14, 16)) <= 59 && Number(value.slice(17, 19)) <= 59, 'TIME');
    const at = Date.parse(value); need(Number.isFinite(at), 'TIME'); return at;
}
function copyBinding(binding: PaidStagingJournalBinding): PaidStagingJournalBinding {
    const copy = Object.freeze(JSON.parse(canonical(binding))) as PaidStagingJournalBinding;
    need(['LOCAL_MOCK', 'HOSTED_STAGING'].includes(copy.mode) && typeof copy.acceptanceVersion === 'string' && copy.acceptanceVersion.length > 0 && SHA.test(copy.candidateSHA) && HEX.test(copy.planSHA256) && HEX.test(copy.requestSHA256) && copy.serviceId === PAID_STAGING_SERVICE && copy.workspaceId === PAID_STAGING_WORKSPACE && copy.slot === 'capture-b' && copy.jobPlanId === PAID_STAGING_JOB_PLAN && typeof copy.startCommand === 'string' && copy.startCommand.length > 0 && Buffer.byteLength(copy.startCommand) <= 8192, 'BINDING');
    return copy;
}
function sameBase(left: PaidStagingJournalBinding, right: PaidStagingJournalBinding) {
    return canonical({ ...left, providerId: null, reservedAt: null }) === canonical({ ...right, providerId: null, reservedAt: null });
}
function attemptKey(binding: PaidStagingJournalBinding) { return hash({ acceptanceVersion: binding.acceptanceVersion, candidateSHA: binding.candidateSHA, planSHA256: binding.planSHA256, requestSHA256: binding.requestSHA256, slot: binding.slot }); }

/** Called only by the owned journal's terminal operation. A hash fabricated by a
 * caller cannot mint proof: the same journal identity must already have a fresh,
 * exact terminal GET result. Successful consumption is irreversible. */
export function consumeTrustedTerminalProof(journal: PaidAcceptanceJournal, evidenceSHA256: string, expectedBinding: PaidStagingJournalBinding): void {
    need(HEX.test(evidenceSHA256), 'PROOF');
    const current = copyBinding(getPaidStagingJournalBinding(journal)), expected = copyBinding(expectedBinding);
    need(canonical(current) === canonical(expected), 'PROOF_BINDING');
    const attempt = attempts.get(journal)?.get(attemptKey(current)), proof = attempt?.proof;
    need(attempt?.state === 'TERMINAL_PROVEN' && proof && proof.evidenceSHA256 === evidenceSHA256 && canonical(proof.binding) === canonical(current), 'TRUSTED_PROOF_REQUIRED');
    const at = proof.now();
    if (!(Number.isFinite(at) && at >= proof.observedAt && at - proof.observedAt <= 60000)) { attempt.state = 'HOLD'; delete attempt.proof; throw Error('PAID_STAGING_TERMINAL_STALE_PROOF_HOLD'); }
    attempt.state = 'CONSUMED'; delete attempt.proof;
}

export function createPaidStagingTerminalCollector(options: {
    journal: PaidAcceptanceJournal; slot?: 'capture-b'; credentialReader(): string;
    /** LOCAL_MOCK only. Supplying this for HOSTED_STAGING is refused. */
    fetch?: typeof fetch; now?: () => number; timeoutMs?: number;
}) {
    need(options && Object.getPrototypeOf(options) === Object.prototype, 'OPTIONS');
    const journal = own(options, 'journal'), initial = copyBinding(getPaidStagingJournalBinding(journal));
    const slotDescriptor = Object.getOwnPropertyDescriptor(options, 'slot');
    need(!slotDescriptor || Object.hasOwn(slotDescriptor, 'value') && slotDescriptor.value === 'capture-b', 'SLOT');
    const names = ['reserve', 'read', 'receipt', 'terminal', 'inventory'] as const;
    const originals = names.map(name => [name, method(journal, name)] as const);
    const read = Function.prototype.bind.call(method(journal, 'read'), journal) as PaidAcceptanceJournal['read'];
    const inventory = Function.prototype.bind.call(method(journal, 'inventory'), journal) as PaidAcceptanceJournal['inventory'];
    const credentialOriginal = method(options, 'credentialReader');
    const credentials = Function.prototype.bind.call(credentialOriginal, options) as () => string;
    const fetchDescriptor = Object.getOwnPropertyDescriptor(options, 'fetch');
    need(!fetchDescriptor || Object.hasOwn(fetchDescriptor, 'value') && typeof fetchDescriptor.value === 'function' && initial.mode === 'LOCAL_MOCK', 'MOCK_FETCH_ONLY');
    need(initial.mode !== 'LOCAL_MOCK' || fetchDescriptor, 'EXPLICIT_MOCK_FETCH_REQUIRED');
    const fetcher = fetchDescriptor ? Function.prototype.bind.call(fetchDescriptor.value as typeof fetch, options) as typeof fetch : nativeFetch;
    const nowDescriptor = Object.getOwnPropertyDescriptor(options, 'now');
    need(!nowDescriptor || Object.hasOwn(nowDescriptor, 'value') && typeof nowDescriptor.value === 'function' && initial.mode === 'LOCAL_MOCK', 'MOCK_CLOCK_ONLY');
    const now = nowDescriptor ? Function.prototype.bind.call(nowDescriptor.value as () => number, options) as () => number : Date.now;
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(options, 'timeoutMs');
    need(!timeoutDescriptor || Object.hasOwn(timeoutDescriptor, 'value'), 'TIMEOUT');
    const timeoutMs = timeoutDescriptor ? timeoutDescriptor.value as number : 30000;
    need(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000, 'TIMEOUT');
    let localState: CollectorState = 'UNUSED';
    let currentAttempt: Attempt | undefined;
    function unchanged() {
        for (const [name, original] of originals) need(method(journal, name) === original, 'METHOD_CHANGED');
        need(method(options, 'credentialReader') === credentialOriginal && (!fetchDescriptor || own(options, 'fetch') === fetchDescriptor.value) && (!nowDescriptor || own(options, 'now') === nowDescriptor.value), 'METHOD_CHANGED');
        need(sameBase(initial, copyBinding(getPaidStagingJournalBinding(journal))), 'BINDING_CHANGED');
    }
    async function collect(): Promise<PaidStagingTerminalEvidence> {
        need(localState === 'UNUSED', 'SPENT_STOP'); localState = 'CHECKING';
        let key = '', timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        try {
            unchanged(); inventory();
            const bound = copyBinding(getPaidStagingJournalBinding(journal));
            need(typeof bound.providerId === 'string' && JOB.test(bound.providerId) && typeof bound.reservedAt === 'string', 'ACCEPTED_REQUIRED');
            const providerId = bound.providerId;
            const intent = read(bound.slot, 'intent'), receipt = read(bound.slot, 'receipt');
            need(intent && receipt && !read(bound.slot, 'terminal'), 'ACCEPTED_REQUIRED');
            need(own(intent, 'status') === 'RESERVED_BEFORE_MUTATION' && own(receipt, 'status') === 'KNOWN_ACCEPTED' && own(receipt, 'providerId') === bound.providerId && own(intent, 'requestSHA256') === bound.requestSHA256 && own(receipt, 'requestSHA256') === bound.requestSHA256 && own(intent, 'expectedSHA') === bound.candidateSHA && own(receipt, 'expectedSHA') === bound.candidateSHA && own(intent, 'planSHA256') === bound.planSHA256 && own(receipt, 'planSHA256') === bound.planSHA256, 'ACCEPTED_BINDING');
            const reservedAt = timestamp(bound.reservedAt), before = now(); need(Number.isFinite(before) && reservedAt <= before, 'TIME');
            let owned = attempts.get(journal); if (!owned) { owned = new Map(); attempts.set(journal, owned); }
            const id = attemptKey(bound); need(!owned.has(id), 'SPENT_STOP');
            currentAttempt = { state: 'CHECKING' }; owned.set(id, currentAttempt);
            unchanged();
            key = credentials(); need(typeof key === 'string' && /^[A-Za-z0-9._-]{20,4096}$/.test(key), 'CREDENTIAL'); unchanged();
            currentAttempt.state = 'GET_INFLIGHT'; localState = 'GET_INFLIGHT';
            const operation = (async () => {
                const response = await fetcher(PAID_STAGING_JOBS_URL + '/' + providerId, { method: 'GET', headers: { Authorization: 'Bearer ' + key }, redirect: 'error', cache: 'no-store', signal: controller.signal });
                need(!controller.signal.aborted && !response.redirected && response.status === 200, 'HTTP');
                const length = response.headers.get('content-length'); need(length === null || /^\d+$/.test(length) && Number(length) <= 65536, 'BODY_BOUND');
                const reader = response.body?.getReader(); need(reader, 'BODY'); const chunks: Uint8Array[] = []; let size = 0;
                const cancel = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', cancel, { once: true });
                try { for (;;) { need(!controller.signal.aborted, 'ABORTED'); const part = await reader.read(); if (part.done) break; size += part.value.length; need(size <= 65536, 'BODY_BOUND'); chunks.push(part.value); } }
                finally { controller.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
                need(!controller.signal.aborted, 'ABORTED');
                const value = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks, size))) as { job?: unknown };
                const raw = value && typeof value === 'object' && Object.hasOwn(value, 'job') ? value.job : value;
                need(raw && typeof raw === 'object' && !Array.isArray(raw), 'JOB'); const job = raw as Record<string, unknown>;
                need(job.id === providerId && job.serviceId === bound.serviceId && job.planId === bound.jobPlanId && job.startCommand === bound.startCommand && job.status === 'succeeded', 'JOB_BINDING');
                const observedAt = now(), startedAt = timestamp(job.startedAt), finishedAt = timestamp(job.finishedAt);
                need(Number.isFinite(observedAt) && observedAt >= before && observedAt - before <= 60000 && startedAt >= reservedAt && finishedAt >= startedAt && finishedAt <= observedAt, 'FRESH_TERMINAL_TIME');
                return { observedAt, evidence: Object.freeze({ id: providerId, serviceId: PAID_STAGING_SERVICE, planId: PAID_STAGING_JOB_PLAN, startCommand: bound.startCommand, status: 'succeeded' as const, startedAt: job.startedAt as string, finishedAt: job.finishedAt as string }) };
            })();
            const collected = await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('PAID_STAGING_TERMINAL_TIMEOUT')); }, timeoutMs); })]);
            const evidence = collected.evidence;
            need(!controller.signal.aborted, 'ABORTED'); unchanged(); inventory();
            need(canonical(copyBinding(getPaidStagingJournalBinding(journal))) === canonical(bound) && canonical(read(bound.slot, 'receipt')) === canonical(receipt) && !read(bound.slot, 'terminal'), 'POST_GET_BINDING');
            const evidenceSHA256 = hash({ ...evidence, startCommand: createHash('sha256').update(evidence.startCommand).digest('hex'), requestSHA256: bound.requestSHA256 });
            currentAttempt.proof = Object.freeze({ evidenceSHA256, binding: bound, evidence, observedAt: collected.observedAt, now }); currentAttempt.state = 'TERMINAL_PROVEN'; localState = 'TERMINAL_PROVEN';
            return evidence;
        } catch {
            controller.abort(); localState = 'HOLD'; if (currentAttempt) { currentAttempt.state = 'HOLD'; delete currentAttempt.proof; }
            throw Error('PAID_STAGING_TERMINAL_HOLD_NO_RETRY');
        } finally { if (timer) clearTimeout(timer); key = ''; }
    }
    return Object.freeze({ collect, state: () => Object.freeze({ status: currentAttempt?.state ?? localState }) });
}
