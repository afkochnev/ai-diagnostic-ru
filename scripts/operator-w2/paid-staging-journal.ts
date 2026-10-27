/** Dedicated, fresh, append-only paid staging acceptance journal. Import is inert.
 * This namespace never opens the canonical production W2 journal or old slots. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, writeSync, type Stats } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { consumeTrustedTerminalProof } from './paid-staging-terminal';
import { PAID_STAGING_JOB_PLAN, PAID_STAGING_SERVICE, PAID_STAGING_WORKSPACE, paidStagingRequestSHA256, type JournalScope, type PaidStagingRequest, type PublicJournal, type PublicJournalRecord } from './paid-staging-dispatcher';

export const PAID_ACCEPTANCE_SLOTS = Object.freeze(['capture-b'] as const);
export type AcceptanceSlot = typeof PAID_ACCEPTANCE_SLOTS[number];
export type PaidAcceptanceJournal = PublicJournal<AcceptanceSlot>;
export type PaidStagingJournalBinding = Readonly<{
    mode: 'LOCAL_MOCK' | 'HOSTED_STAGING'; acceptanceVersion: string; candidateSHA: string; planSHA256: string;
    serviceId: typeof PAID_STAGING_SERVICE; workspaceId: typeof PAID_STAGING_WORKSPACE; requestSHA256: string;
    slot: 'capture-b'; providerId: string | null; reservedAt: string | null; startCommand: string; jobPlanId: typeof PAID_STAGING_JOB_PLAN;
}>;
const ownedBindings = new WeakMap<PaidAcceptanceJournal, () => PaidStagingJournalBinding>();
/** Read-only ownership/context check. There is deliberately no registration API. */
export function getPaidStagingJournalBinding(journal: PaidAcceptanceJournal): PaidStagingJournalBinding {
    const read = ownedBindings.get(journal); need(read, 'OWNED_JOURNAL_REQUIRED'); return read();
}
const SUFFIXES = ['intent', 'receipt', 'terminal'] as const;
type Suffix = typeof SUFFIXES[number];
const HEX = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/, JOB = /^job-[a-z0-9]{8,100}$/;
const DOMAIN = 'aca-paid-staging-acceptance-journal-v1';
const MAX_FILE = 16384;
function need(value: unknown, code: string): asserts value { if (!value) throw Error('PAID_STAGING_JOURNAL_' + code); }
function sha(bytes: string | Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
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
function plain(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
    need(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length, code);
    for (const key of Reflect.ownKeys(value)) { need(typeof key === 'string' && keys.includes(key), code); const d = Object.getOwnPropertyDescriptor(value, key); need(d && Object.hasOwn(d, 'value') && d.enumerable, code); }
    return value as Record<string, unknown>;
}
function entryExists(path: string) { try { lstatSync(path); return true; } catch (error) { need(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT', 'PATH_READ'); return false; } }
function sameInode(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino; }
function owned(path: string, directory: boolean) {
    const s = lstatSync(path), uid = process.getuid?.();
    need(uid !== undefined && !s.isSymbolicLink() && s.uid === uid && (directory ? s.isDirectory() : s.isFile()) && (s.mode & 0o7777) === (directory ? 0o700 : 0o600) && (directory || s.nlink === 1), 'PRIVATE_OWNER');
    return s;
}
function ancestors(path: string) {
    let current: string = sep;
    for (const segment of resolve(path).split(sep).filter(Boolean)) { current = join(current, segment); const s = lstatSync(current); need(!s.isSymbolicLink() && s.isDirectory(), 'ANCESTOR_SYMLINK'); }
}
function safeBase(raw: unknown, mode: 'LOCAL_MOCK' | 'HOSTED_STAGING') {
    need(typeof raw === 'string' && isAbsolute(raw) && raw === resolve(raw), 'BASE');
    const parts = raw.split(sep).filter(Boolean);
    need(!parts.includes('aca-v27-controlled-team') && !parts.includes('artifacts') && !parts.includes('.git') && !parts.some(p => p === 'operator-v2' || p === 'phase2-team-w2-paid-staging-acceptance-v2'), 'PROTECTED_NAMESPACE');
    if (mode === 'LOCAL_MOCK') need(dirname(raw) === realpathSync(tmpdir()) && /^paid-binding-test-[A-Za-z0-9]+$/.test(basename(raw)), 'MOCK_BASE');
    else need(/^aca-v27-paid-staging-[a-z0-9-]+$/.test(basename(raw)), 'HOSTED_BASE');
    ancestors(raw); owned(raw, true); return raw;
}
type StoredRecord = PublicJournalRecord & Readonly<{
    version: 1; domain: typeof DOMAIN; mode: 'LOCAL_MOCK' | 'HOSTED_STAGING'; acceptanceVersion: string; bindingSHA256: string;
    serviceId: typeof PAID_STAGING_SERVICE; workspaceId: typeof PAID_STAGING_WORKSPACE;
    at: string;
}>;
const RECORD_KEYS = ['version', 'domain', 'mode', 'acceptanceVersion', 'bindingSHA256', 'serviceId', 'workspaceId', 'at', 'slot', 'status', 'requestSHA256', 'evidenceSHA256', 'providerId', 'httpStatus', 'windowId', 'planSHA256', 'expectedSHA'] as const;
/** Creates a NEW namespace. A failed/used namespace cannot be reopened by this API.
 * No reset, overwrite, deletion, arbitrary slot or generic write method exists. */
export function createPaidStagingJournal(options: {
    mode: 'LOCAL_MOCK' | 'HOSTED_STAGING'; base: string; acceptanceVersion: string; expectedApplicationSHA: string; planSHA256: string;
    request: PaidStagingRequest; expectedRequestSHA256: string;
}): PaidAcceptanceJournal {
    const o = plain(options, ['mode', 'base', 'acceptanceVersion', 'expectedApplicationSHA', 'planSHA256', 'request', 'expectedRequestSHA256'], 'OPTIONS');
    need(o.mode === 'LOCAL_MOCK' || o.mode === 'HOSTED_STAGING', 'MODE'); const mode = o.mode;
    const base = safeBase(o.base, mode), versionValue = o.acceptanceVersion, sourceValue = o.expectedApplicationSHA, planValue = o.planSHA256, requestValue = o.expectedRequestSHA256;
    need(typeof versionValue === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(versionValue) && typeof sourceValue === 'string' && SHA.test(sourceValue) && typeof planValue === 'string' && HEX.test(planValue) && typeof requestValue === 'string' && HEX.test(requestValue), 'BINDING');
    const acceptanceVersion: string = versionValue, expectedSHA: string = sourceValue, planSHA256: string = planValue, requestSHA256: string = requestValue;
    const request = plain(o.request, ['planId', 'startCommand'], 'REQUEST');
    need(request.planId === PAID_STAGING_JOB_PLAN && typeof request.startCommand === 'string', 'REQUEST');
    const pinnedRequest = Object.freeze({ planId: PAID_STAGING_JOB_PLAN, startCommand: request.startCommand });
    need(paidStagingRequestSHA256(pinnedRequest) === requestSHA256, 'REQUEST_SHA');
    const binding = Object.freeze({ version: 1, domain: DOMAIN, mode, acceptanceVersion, expectedSHA, planSHA256, requestSHA256, serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE, planId: PAID_STAGING_JOB_PLAN, startCommandSHA256: sha(pinnedRequest.startCommand) });
    const bindingSHA256 = sha(canonical(binding)), namespace = join(base, `paid-acceptance-${acceptanceVersion}-${bindingSHA256}`), bindingBytes = Buffer.from(canonical(binding) + '\n');
    const baseInode = owned(base, true);
    function checkBase() { ancestors(base); need(sameInode(baseInode, owned(base, true)), 'BASE_CHANGED'); }
    function syncDirectory(path: string, expected: Stats) {
        const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const current = fstatSync(fd); need(current.isDirectory() && sameInode(current, expected), 'DIRECTORY_CHANGED'); fsyncSync(fd); }
        finally { closeSync(fd); }
    }
    checkBase();
    try { mkdirSync(namespace, { mode: 0o700 }); }
    catch { throw Error('PAID_STAGING_JOURNAL_NAMESPACE_EXISTS_OR_DENIED'); }
    const namespaceInode = owned(namespace, true); syncDirectory(base, baseInode);
    const knownFiles = new Map<string, string>(), knownInodes = new Map<string, Stats>(); let slotInode: Stats | undefined, held = false, reserveAttempted = false;
    function stableDirectories() {
        checkBase(); need(sameInode(namespaceInode, owned(namespace, true)), 'NAMESPACE_CHANGED');
        if (slotInode) need(sameInode(slotInode, owned(join(namespace, 'capture-b'), true)), 'SLOT_CHANGED');
        else need(!entryExists(join(namespace, 'capture-b')), 'UNEXPECTED_SLOT');
    }
    function fileBytes(path: string) {
        stableDirectories(); const before = owned(path, false); if (knownInodes.has(path)) need(sameInode(before, knownInodes.get(path)!), 'FILE_REPLACED'); const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const s = fstatSync(fd); need(sameInode(before, s) && s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o7777) === 0o600 && s.size > 0 && s.size <= MAX_FILE, 'FILE_CHANGED');
            const bytes = Buffer.alloc(s.size); let offset = 0;
            while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, null); need(n > 0, 'FILE_SHORT_READ'); offset += n; }
            need(readSync(fd, Buffer.alloc(1), 0, 1, null) === 0 && fstatSync(fd).size === s.size && sameInode(s, owned(path, false)), 'FILE_CHANGED'); stableDirectories(); return bytes;
        } finally { closeSync(fd); }
    }
    function persist(path: string, bytes: Buffer) {
        need(bytes.length > 0 && bytes.length <= MAX_FILE, 'FILE_BOUND'); stableDirectories();
        let fd: number | undefined, createdInode: Stats | undefined;
        try {
            fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            const s = fstatSync(fd); createdInode = s; need(s.isFile() && s.nlink === 1 && s.uid === process.getuid?.() && (s.mode & 0o7777) === 0o600, 'FILE_OWNER');
            let offset = 0;
            while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset); need(n > 0, 'PARTIAL_WRITE'); offset += n; }
            fsyncSync(fd); closeSync(fd); fd = undefined;
            stableDirectories(); syncDirectory(dirname(path), dirname(path) === namespace ? namespaceInode : slotInode!);
            need(createdInode && sameInode(createdInode, owned(path, false)) && fileBytes(path).equals(bytes) && sameInode(createdInode, owned(path, false)), 'DURABLE_READBACK'); knownFiles.set(path, sha(bytes)); knownInodes.set(path, createdInode);
        } catch { held = true; throw Error('PAID_STAGING_JOURNAL_PERSISTENCE_HOLD_SPENT'); }
        finally { if (fd !== undefined) closeSync(fd); }
    }
    persist(join(namespace, 'binding.json'), bindingBytes);
    function slot(s: unknown): asserts s is AcceptanceSlot { need(s === 'capture-b', 'SLOT'); }
    function path(s: AcceptanceSlot, end: Suffix) { return join(namespace, s, `${end}.json`); }
    function validateRecord(value: unknown, end: Suffix): StoredRecord {
        const r = plain(value, RECORD_KEYS, 'RECORD');
        need(r.version === 1 && r.domain === DOMAIN && r.mode === mode && r.acceptanceVersion === acceptanceVersion && r.bindingSHA256 === bindingSHA256 && r.serviceId === PAID_STAGING_SERVICE && r.workspaceId === PAID_STAGING_WORKSPACE && r.slot === 'capture-b' && r.windowId === null && r.expectedSHA === expectedSHA && r.planSHA256 === planSHA256 && r.requestSHA256 === requestSHA256 && typeof r.at === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.at) && Number.isFinite(Date.parse(r.at)), 'RECORD_BINDING');
        if (end === 'intent') need(r.status === 'RESERVED_BEFORE_MUTATION' && r.evidenceSHA256 === null && r.providerId === null && r.httpStatus === null, 'INTENT');
        else {
            need(typeof r.evidenceSHA256 === 'string' && HEX.test(r.evidenceSHA256), 'EVIDENCE');
            if (end === 'terminal') need(r.status === 'TERMINAL_SUCCEEDED' && typeof r.providerId === 'string' && JOB.test(r.providerId) && [200, 201].includes(r.httpStatus as number), 'TERMINAL');
            else if (r.status === 'KNOWN_ACCEPTED') need(typeof r.providerId === 'string' && JOB.test(r.providerId) && [200, 201].includes(r.httpStatus as number), 'RECEIPT');
            else need(r.status === 'UNKNOWN_SPENT_STOP' && r.providerId === null && r.httpStatus === null, 'UNKNOWN');
        }
        return Object.freeze(r) as StoredRecord;
    }
    function read(s: AcceptanceSlot, end: Suffix): StoredRecord | undefined {
        slot(s); need(SUFFIXES.includes(end), 'SUFFIX'); stableDirectories(); const p = path(s, end);
        if (!knownFiles.has(p)) { need(!entryExists(p), 'UNKNOWN_RECORD'); return; }
        const bytes = fileBytes(p); need(sha(bytes) === knownFiles.get(p), 'FILE_CHANGED');
        let value: unknown; try { value = JSON.parse(bytes.toString('utf8')); } catch { throw Error('PAID_STAGING_JOURNAL_MALFORMED'); }
        return validateRecord(value, end);
    }
    function inventory() {
        stableDirectories(); const names = readdirSync(namespace).sort();
        need(names.join('|') === (slotInode ? 'binding.json|capture-b' : 'binding.json'), 'UNKNOWN_ENTRY');
        if (slotInode) { const names = readdirSync(join(namespace, 'capture-b')).sort(); const expected = SUFFIXES.filter(end => knownFiles.has(path('capture-b', end))).map(end => `${end}.json`).sort(); need(names.join('|') === expected.join('|'), 'UNKNOWN_SLOT_ENTRY'); }
        const entries = [...knownFiles].map(([p, h]) => { need(sha(fileBytes(p)) === h, 'FILE_CHANGED'); return { path: p.slice(namespace.length + 1), sha256: h }; }).sort((a, b) => a.path.localeCompare(b.path));
        const intent = read('capture-b', 'intent'), receipt = read('capture-b', 'receipt'), terminal = read('capture-b', 'terminal');
        need(!receipt || intent, 'ORPHAN_RECEIPT'); need(!terminal || receipt?.status === 'KNOWN_ACCEPTED' && terminal.providerId === receipt.providerId && terminal.httpStatus === receipt.httpStatus, 'ORPHAN_TERMINAL');
        return Object.freeze({ sha256: sha(canonical({ bindingSHA256, entries: Object.fromEntries(entries.map(x => [x.path, x.sha256])) })), records: entries.length - 1, legacyFiles: 0 });
    }
    function writable() { need(!held, 'HOLD_SPENT'); inventory(); }
    function record(status: string, evidenceSHA256: string | null, providerId: string | null, httpStatus: number | null): StoredRecord {
        return Object.freeze({ version: 1, domain: DOMAIN, mode, acceptanceVersion, bindingSHA256, serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE, at: new Date().toISOString(), slot: 'capture-b', windowId: null, planSHA256, expectedSHA, requestSHA256, status, evidenceSHA256, providerId, httpStatus });
    }
    function append(end: Suffix, r: StoredRecord) { validateRecord(r, end); persist(path('capture-b', end), Buffer.from(canonical(r) + '\n')); return read('capture-b', end)!; }
    const journal: PaidAcceptanceJournal = Object.freeze({
        reserve(s: AcceptanceSlot, scope: JournalScope | null, suppliedRequestSHA256: string, instanceId?: string) {
            slot(s); writable(); need(!reserveAttempted && !read(s, 'intent'), 'SLOT_SPENT');
            need(scope === null && instanceId === undefined && suppliedRequestSHA256 === requestSHA256, 'RESERVATION_BINDING');
            reserveAttempted = true;
            try { mkdirSync(join(namespace, s), { mode: 0o700 }); slotInode = owned(join(namespace, s), true); syncDirectory(namespace, namespaceInode); return append('intent', record('RESERVED_BEFORE_MUTATION', null, null, null)); }
            catch { held = true; throw Error('PAID_STAGING_JOURNAL_RESERVE_HOLD_SPENT'); }
        },
        read,
        receipt(s: AcceptanceSlot, status: 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP', evidenceSHA256: string, providerId?: string, httpStatus?: number) {
            slot(s); writable(); need(read(s, 'intent') && !read(s, 'receipt'), 'INTENT_REQUIRED_OR_RECEIPT_SPENT');
            need(HEX.test(evidenceSHA256), 'EVIDENCE');
            if (status === 'KNOWN_ACCEPTED') need(typeof providerId === 'string' && JOB.test(providerId) && [200, 201].includes(httpStatus ?? 0), 'RECEIPT_BINDING');
            else need(status === 'UNKNOWN_SPENT_STOP' && providerId === undefined && httpStatus === undefined, 'UNKNOWN_BINDING');
            return append('receipt', record(status, evidenceSHA256, providerId ?? null, httpStatus ?? null));
        },
        terminal(s: AcceptanceSlot, evidenceSHA256: string) {
            slot(s); writable(); const receipt = read(s, 'receipt'); need(receipt?.status === 'KNOWN_ACCEPTED' && !read(s, 'terminal'), 'ACCEPTED_RECEIPT_REQUIRED'); need(HEX.test(evidenceSHA256), 'EVIDENCE');
            try { consumeTrustedTerminalProof(journal, evidenceSHA256, getPaidStagingJournalBinding(journal)); }
            catch { held = true; throw Error('PAID_STAGING_JOURNAL_TRUSTED_TERMINAL_PROOF_REQUIRED_HOLD'); }
            return append('terminal', record('TERMINAL_SUCCEEDED', evidenceSHA256, receipt.providerId, receipt.httpStatus));
        },
        inventory,
    });
    ownedBindings.set(journal, () => {
        inventory(); const intent = read('capture-b', 'intent'), receipt = read('capture-b', 'receipt');
        return Object.freeze({ mode, acceptanceVersion, candidateSHA: expectedSHA, planSHA256, serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE, requestSHA256, slot: 'capture-b', providerId: receipt?.providerId ?? null, reservedAt: intent?.at ?? null, startCommand: pinnedRequest.startCommand, jobPlanId: PAID_STAGING_JOB_PLAN });
    });
    inventory(); return journal;
}
