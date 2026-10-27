/** Local-reviewed composition only. Import/construction never allocates a journal,
 * reads credentials or sends HTTP. A future execution supplies a fresh journal. */
import { createPaidStagingDispatcher, paidStagingRequestSHA256, type PaidStagingPrechecks } from './paid-staging-dispatcher';
import { getPaidStagingJournalBinding, type PaidAcceptanceJournal } from './paid-staging-journal';
import { createPaidStagingTerminalCollector } from './paid-staging-terminal';

const nativeFetch = globalThis.fetch.bind(globalThis);
type Options = {
    journal: PaidAcceptanceJournal;
    expectedApplicationSHA: string; expectedPlanSHA256: string; expectedRequestSHA256: string;
    acceptanceVersion: string; prechecks: PaidStagingPrechecks;
    credentialReader(): string; timeoutMs?: number;
} & ({ mode: 'LOCAL_MOCK'; fetch: typeof fetch; now?: () => number } | { mode: 'HOSTED_STAGING'; fetch?: never; now?: never });
function need(value: unknown, code: string): asserts value { if (!value) throw Error('PAID_STAGING_BINDING_' + code); }
function own(options: object, key: string) { const d = Object.getOwnPropertyDescriptor(options, key); need(d && Object.hasOwn(d, 'value'), 'OWN_DATA'); return d.value; }

/** KNOWN_ACCEPTED is a creation acknowledgement, never terminal success.
 * This wrapper exposes no caller-supplied terminal evidence argument. */
export function createPaidStagingBinding(options: Options) {
    need(options && Object.getPrototypeOf(options) === Object.prototype, 'OPTIONS');
    for (const key of Reflect.ownKeys(options)) { need(typeof key === 'string' && ['journal', 'expectedApplicationSHA', 'expectedPlanSHA256', 'expectedRequestSHA256', 'acceptanceVersion', 'prechecks', 'credentialReader', 'timeoutMs', 'mode', 'fetch', 'now'].includes(key), 'OPTIONS'); own(options, key); }
    const journal = own(options, 'journal') as PaidAcceptanceJournal;
    const mode = own(options, 'mode'), context = getPaidStagingJournalBinding(journal);
    need(context.mode === mode && (mode === 'HOSTED_STAGING' || mode === 'LOCAL_MOCK'), 'MODE');
    need(context.candidateSHA === own(options, 'expectedApplicationSHA') && context.planSHA256 === own(options, 'expectedPlanSHA256') && context.requestSHA256 === own(options, 'expectedRequestSHA256') && context.acceptanceVersion === own(options, 'acceptanceVersion'), 'EXACT_SCOPE');
    const request = Object.freeze({ planId: context.jobPlanId, startCommand: context.startCommand });
    need(paidStagingRequestSHA256(request) === context.requestSHA256, 'REQUEST');
    if (mode === 'HOSTED_STAGING') need(!Object.hasOwn(options, 'fetch') && !Object.hasOwn(options, 'now'), 'HOSTED_NATIVE_TRANSPORT_ONLY');
    const fetch = mode === 'LOCAL_MOCK' ? own(options, 'fetch') as typeof globalThis.fetch : nativeFetch;
    const credentialReader = own(options, 'credentialReader') as () => string;
    need(typeof fetch === 'function' && typeof credentialReader === 'function', 'PORTS');
    const now = mode === 'LOCAL_MOCK' && Object.hasOwn(options, 'now') ? own(options, 'now') as () => number : undefined;
    const timeoutMs = Object.hasOwn(options, 'timeoutMs') ? own(options, 'timeoutMs') as number : undefined;
    const dispatcher = createPaidStagingDispatcher({ journal, slot: 'capture-b', scope: null, request, expectedRequestSHA256: context.requestSHA256, expectedApplicationSHA: context.candidateSHA, expectedJournalPlanSHA256: context.planSHA256, prechecks: own(options, 'prechecks') as PaidStagingPrechecks, credentialReader, fetch, ...(now ? { now } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    const collector = createPaidStagingTerminalCollector({ journal, credentialReader, ...(mode === 'LOCAL_MOCK' ? { fetch, ...(now ? { now } : {}) } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
    let held = false, terminalAttempted = false;
    async function dispatch() { need(!held && !terminalAttempted, 'HOLD_STOP'); try { return await dispatcher.dispatch(); } catch { held = true; throw Error('PAID_STAGING_BINDING_DISPATCH_HOLD'); } }
    async function collectTerminal() {
        need(!held && !terminalAttempted, 'HOLD_STOP'); terminalAttempted = true;
        try { need(dispatcher.state().status === 'KNOWN_ACCEPTED', 'CREATION_RECEIPT_REQUIRED'); const evidence = await collector.collect(); return dispatcher.terminal(evidence); }
        catch { held = true; throw Error('PAID_STAGING_BINDING_TERMINAL_HOLD'); }
    }
    return Object.freeze({ dispatch, collectTerminal, inventory: journal.inventory, state: () => Object.freeze({ ...dispatcher.state(), status: held ? 'HOLD' : dispatcher.state().status, terminalAttempted }) });
}
