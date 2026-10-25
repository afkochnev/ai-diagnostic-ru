import { constants, closeSync, existsSync, fsyncSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { z } from 'zod';
import { ALL_SLOTS, FIXED, bytesDigest, digest, hex, instant, need, parse, slot, type Scope, type Slot, type W2Plan } from './contract';
import { LEGACY_FILES } from './legacy';
const suffixes = ['intent', 'receipt', 'terminal'] as const;
type Suffix = typeof suffixes[number];
const recordSchema = z.strictObject({ version: z.literal(1), rootId: z.literal(FIXED.root), slot: z.string(), windowId: z.uuid().nullable(), planSHA256: hex, expectedSHA: z.string().regex(/^[a-f0-9]{40}$/), status: z.enum(['RESERVED_BEFORE_MUTATION', 'KNOWN_ACCEPTED', 'UNKNOWN_SPENT_STOP', 'TERMINAL_SUCCEEDED']), at: instant, requestSHA256: hex, evidenceSHA256: hex.nullable(), providerId: z.string().regex(/^(?:dep-|job-)[a-z0-9]{1,100}$|^[a-f0-9-]{36}$/).nullable(), httpStatus: z.number().int().min(100).max(599).nullable(), instanceId: z.string().regex(/^srv-dak5rurl550s73a17l60-[A-Za-z0-9]{3,30}$/).nullable() });
export type JournalRecord = z.infer<typeof recordSchema>;
const journals = new WeakMap<Journal, {
    plan: W2Plan;
    mode: 'PRODUCTION' | 'LOCAL_MOCK';
    base: string;
}>();
export function assertOwnedJournal(journal: Journal, plan: W2Plan, mode: 'PRODUCTION' | 'LOCAL_MOCK') { const own = journals.get(journal); need(own && own.plan === plan && own.mode === mode && (mode !== 'PRODUCTION' || own.base === FIXED.journalBase), 'owned_root_journal_mode'); }
const reservations = new WeakMap<JournalRecord, {
    used: boolean;
    plan: W2Plan;
    mode: 'PRODUCTION' | 'LOCAL_MOCK';
    base: string;
}>();
export function consumeReservation(record: JournalRecord, plan: W2Plan, s: Slot, requestSHA256: string, windowId: string | null, mode: 'PRODUCTION' | 'LOCAL_MOCK' | 'READ_ONLY') { const own = reservations.get(record); need(own && !own.used && own.plan === plan && own.mode === mode && (mode !== 'PRODUCTION' || own.base === FIXED.journalBase) && record.slot === s && record.rootId === FIXED.root && record.planSHA256 === plan.planSHA256 && record.expectedSHA === plan.expectedSHA && record.requestSHA256 === requestSHA256 && record.windowId === windowId, 'owned_unused_reservation'); own.used = true; }
export type Journal = {
    read: (s: Slot, end: Suffix) => JournalRecord | undefined;
    reserve: (s: Slot, scope: Scope | null, requestSHA256: string, instanceId?: string) => JournalRecord;
    receipt: (s: Slot, status: 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP', evidenceSHA256: string, providerId?: string, httpStatus?: number) => JournalRecord;
    terminal: (s: Slot, evidenceSHA256: string) => JournalRecord;
    assertSettled: () => void;
    inventory: () => Readonly<{
        sha256: string;
        records: number;
        legacyFiles: number;
    }>;
};
function owned(path: string, directory: boolean) { const s = lstatSync(path); need(!s.isSymbolicLink() && s.uid === process.getuid?.() && (directory ? s.isDirectory() : s.isFile()) && (s.mode & 0o777) === (directory ? 0o700 : 0o600), 'journal_private_owner'); return s; }
function privateAncestors(path: string, create = false) { const parts = resolve(path).split(sep).filter(Boolean); let current: string = sep; for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current) && create) {
        mkdirSync(current, { mode: 0o700 });
        const fd = openSync(dirname(current), constants.O_RDONLY);
        try {
            fsyncSync(fd);
        }
        finally {
            closeSync(fd);
        }
    }
    const s = lstatSync(current);
    need(!s.isSymbolicLink() && s.isDirectory(), 'journal_ancestor_symlink');
    if (current.includes('aca-v27-controlled-team') || current === path)
        owned(current, true);
} }
/** No deletion/reset/move/overwrite API. All namespaces share one lifetime root.
 * Production opening requires an explicit execution plan. Mock roots cannot
 * overlap the protected base; importing this module touches no filesystem.
 */
export function openRootJournal(plan: W2Plan, options: {
    mode: 'PRODUCTION';
} | {
    mode: 'LOCAL_MOCK';
    base: string;
    legacy?: readonly {
        path: string;
        sha256: string;
    }[];
}): Journal {
    const production = options.mode === 'PRODUCTION';
    need(!production || plan.authorization === 'EXPLICIT_OWNER_W2_EXECUTION', 'journal_authority');
    const base = production ? FIXED.journalBase : resolve(options.base);
    need(production || !(base === FIXED.journalBase || base.startsWith(FIXED.journalBase + sep)), 'mock_protected_path');
    const legacy = production ? LEGACY_FILES : options.legacy ?? [];
    const expectedLegacy = new Map(legacy.map(x => [x.path, x.sha256]));
    need(expectedLegacy.size === legacy.length, 'legacy_duplicate');
    for (const [p, h] of expectedLegacy)
        need(/^(?:control-operations|db-control-operations)\/[a-z0-9-]+\.json$/.test(p) && hex.safeParse(h).success, 'legacy_contract');
    privateAncestors(base, true);
    const root = join(base, FIXED.root), namespace = join(root, 'operator-v2');
    function recordPath(s: Slot, end: Suffix) { slot(s); need(suffixes.includes(end), 'journal_suffix'); return join(namespace, s, end + '.json'); }
    function readPath(p: string): JournalRecord | undefined { if (!existsSync(p))
        return; owned(p, false); const fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW); try {
        const s = fstatSync(fd);
        need(s.isFile() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.size <= 16384, 'journal_size');
        const r = parse(recordSchema, JSON.parse(readFileSync(fd, 'utf8')));
        slot(r.slot);
        return r;
    }
    catch {
        throw Error('w2_operator_journal_malformed_spent');
    }
    finally {
        closeSync(fd);
    } }
    function inventory() {
        const actualLegacy = new Map<string, string>(), records: {
            path: string;
            sha256: string;
        }[] = [];
        function walk(p: string) { owned(p, true); for (const entry of readdirSync(p)) {
            const full = join(p, entry), rel = relative(base, full).split(sep).join('/'), s = lstatSync(full);
            need(!s.isSymbolicLink(), 'journal_symlink');
            if (s.isDirectory()) {
                const allowed = ['control-operations', 'db-control-operations', FIXED.root, `${FIXED.root}/operator-v2`];
                const namespaceDir = rel.startsWith(`${FIXED.root}/operator-v2/`) && (ALL_SLOTS as readonly string[]).some(x => `${FIXED.root}/operator-v2/${x}` === rel || `${FIXED.root}/operator-v2/${x}`.startsWith(rel + '/'));
                need(allowed.includes(rel) || namespaceDir, 'journal_unknown_directory');
                walk(full);
            }
            else {
                owned(full, false);
                need(s.size <= 65536, 'journal_file_size');
                const bytes = readFileSync(full), hash = bytesDigest(bytes);
                if (expectedLegacy.has(rel)) {
                    need(hash === expectedLegacy.get(rel), 'legacy_changed');
                    actualLegacy.set(rel, hash);
                }
                else {
                    const prefix = `${FIXED.root}/operator-v2/`;
                    need(rel.startsWith(prefix), 'journal_unknown_file');
                    const parts = rel.slice(prefix.length).split('/'), end = parts.pop()?.replace(/\.json$/, '');
                    need(suffixes.includes(end as Suffix) && parts.length > 0, 'journal_unknown_suffix');
                    const key = slot(parts.join('/'));
                    need(recordPath(key, end as Suffix) === full, 'journal_path');
                    const record = readPath(full);
                    need(record?.slot === key && record.rootId === FIXED.root, 'journal_record_path');
                    records.push({ path: rel, sha256: hash });
                }
            }
        } }
        walk(base);
        need(actualLegacy.size === expectedLegacy.size, 'legacy_missing');
        for (const s of ALL_SLOTS) {
            const intent = readPath(recordPath(s, 'intent')), receipt = readPath(recordPath(s, 'receipt')), terminal = readPath(recordPath(s, 'terminal'));
            need(!receipt || intent, 'journal_orphan_receipt');
            need(!terminal || receipt?.status === 'KNOWN_ACCEPTED', 'journal_orphan_terminal');
            if (receipt)
                need(receipt.planSHA256 === intent?.planSHA256 && receipt.windowId === intent?.windowId && receipt.expectedSHA === intent?.expectedSHA && receipt.requestSHA256 === intent?.requestSHA256, 'journal_receipt_binding');
        }
        return Object.freeze({ sha256: digest({ legacy: [...actualLegacy].sort(), records: records.sort((a, b) => a.path.localeCompare(b.path)) }), records: records.length, legacyFiles: actualLegacy.size });
    }
    function write(s: Slot, end: Suffix, value: JournalRecord) { inventory(); const p = recordPath(s, end); privateAncestors(dirname(p), true); const record = parse(recordSchema, value); let fd: number; try {
        fd = openSync(p, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    }
    catch {
        throw Error('w2_operator_journal_spent_STOP');
    } try {
        const bytes = Buffer.from(JSON.stringify(record) + '\n');
        let written = 0;
        while (written < bytes.length) {
            const n = writeSync(fd, bytes, written, bytes.length - written);
            need(n > 0, 'journal_partial_write');
            written += n;
        }
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    } const dir = openSync(dirname(p), constants.O_RDONLY); try {
        fsyncSync(dir);
    }
    finally {
        closeSync(dir);
    } return Object.freeze(record); }
    const read = (s: Slot, end: Suffix) => { slot(s); return readPath(recordPath(s, end)); };
    const assertSettled = () => { inventory(); for (const s of ALL_SLOTS) {
        const i = read(s, 'intent'), r = read(s, 'receipt');
        need(!i || r?.status === 'KNOWN_ACCEPTED', 'unknown_or_inflight_STOP');
    } };
    const journal = Object.freeze({ inventory, read, assertSettled, reserve(s: Slot, sc: Scope | null, requestSHA256: string, instanceId?: string) { if (s === 'db/stop')
            inventory();
        else
            assertSettled(); need(!read(s, 'intent'), 'lifetime_slot_spent'); if (sc)
            need(sc.expectedSHA === plan.expectedSHA && sc.planSHA256 === plan.planSHA256, 'journal_scope'); const record = write(s, 'intent', { version: 1, rootId: FIXED.root, slot: s, windowId: sc?.windowId ?? null, planSHA256: plan.planSHA256, expectedSHA: plan.expectedSHA, status: 'RESERVED_BEFORE_MUTATION', at: new Date().toISOString(), requestSHA256, evidenceSHA256: null, providerId: null, httpStatus: null, instanceId: instanceId ?? null }); reservations.set(record, { used: false, plan, mode: production ? 'PRODUCTION' : 'LOCAL_MOCK', base }); return record; }, receipt(s: Slot, status: 'KNOWN_ACCEPTED' | 'UNKNOWN_SPENT_STOP', evidenceSHA256: string, providerId?: string, httpStatus?: number) { const i = read(s, 'intent'); need(i, 'intent_required'); return write(s, 'receipt', { ...i, status, at: new Date().toISOString(), evidenceSHA256, providerId: providerId ?? null, httpStatus: httpStatus ?? null }); }, terminal(s: Slot, evidenceSHA256: string) { const r = read(s, 'receipt'); need(r?.status === 'KNOWN_ACCEPTED', 'accepted_receipt_required'); return write(s, 'terminal', { ...r, status: 'TERMINAL_SUCCEEDED', at: new Date().toISOString(), evidenceSHA256 }); } });
    journals.set(journal, { plan, mode: production ? 'PRODUCTION' : 'LOCAL_MOCK', base });
    return journal;
}
