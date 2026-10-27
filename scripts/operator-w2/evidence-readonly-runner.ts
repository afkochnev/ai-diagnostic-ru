/** Inert, staging-only outer wrapper. Importing or building source performs no
 * filesystem, child-process, credential or HTTP I/O. Execution is explicit. */
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { types } from 'node:util';
import { evidenceKeyContext, type EvidenceKeyContext } from '../../src/server/team/evidence-channel-key';
import { assertData } from './contract';
import {
    formatEvidenceDiagnostic, outerDiagnostic, parseEvidenceDiagnosticLine,
    GENERIC_HOLD, type OuterFailureCode, type OuterStage,
} from './evidence-diagnostic';

export const READONLY_RESULT_PREFIX = 'ACA_W2_EVIDENCE_READONLY ';
export const READONLY_CHILD_TIMEOUT_MS = 120000;
type NativeExpectation = Readonly<{ context: EvidenceKeyContext; captureSHA256: string; rowCount: number; AuthRows: number; capturedAt: string }>;
export type ReadonlyRunnerOptions = Readonly<{
    manifest: Readonly<{ version: 2; purpose: 'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2'; project: 'vflgxgdwlftlyjslyrmo'; rootRunId: string; expectedSHA: string; approvedPlanSHA256: string; expectedCaptureSHA256: string; expectedRowCount: number }>;
    nativeBinding: NativeExpectation;
    directory: string;
    childArgs: readonly string[];
    timeoutMs?: number;
}>;
const RESULT_KEYS = ['status', 'context', 'captureSHA256', 'tableCount', 'rowCount', 'AuthTableCount', 'AuthRows', 'ledger', 'capturedAt', 'actualCapabilityPOSTs', 'actualCapturePOSTs', 'retries', 'W2Writes', 'AuthIssuanceVerificationEmailAIYooKassaPDF'];
function need(value: unknown): asserts value { if (!value) throw Error('READONLY_RUNNER_SOURCE_DENIED'); }
function exact(value: object, keys: readonly string[]) { need(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())); }
function data(value: unknown, seen = new Set<object>()): void {
    if (!value || typeof value !== 'object') return;
    need(!types.isProxy(value) && !seen.has(value)); seen.add(value);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
        need(Object.hasOwn(descriptor, 'value')); data(descriptor.value, seen);
    }
    seen.delete(value);
}
function instant(value: string) { return value.length <= 64 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value)); }
function validated(input: ReadonlyRunnerOptions): ReadonlyRunnerOptions {
    try { data(input); assertData(input); } catch { throw Error('READONLY_RUNNER_SOURCE_DENIED'); }
    exact(input, ['manifest', 'nativeBinding', 'directory', 'childArgs', ...(Object.hasOwn(input, 'timeoutMs') ? ['timeoutMs'] : [])]);
    const { manifest: m, nativeBinding: n, directory: dir, childArgs } = input, timeout = input.timeoutMs ?? READONLY_CHILD_TIMEOUT_MS;
    exact(m, ['version', 'purpose', 'project', 'rootRunId', 'expectedSHA', 'approvedPlanSHA256', 'expectedCaptureSHA256', 'expectedRowCount']);
    exact(n, ['context', 'captureSHA256', 'rowCount', 'AuthRows', 'capturedAt']);
    const context = evidenceKeyContext(n.context);
    need(m.version === 2 && m.purpose === 'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2' && m.project === 'vflgxgdwlftlyjslyrmo' && m.rootRunId === 'e3623f1d-2da0-4dfe-b600-d747f529c5fc');
    need(context.rootRunId === m.rootRunId && context.canonicalAppSHA === m.expectedSHA && context.approvedPlanSHA256 === m.approvedPlanSHA256 && m.expectedCaptureSHA256 === n.captureSHA256 && m.expectedRowCount === n.rowCount);
    need(/^[a-f0-9]{64}$/.test(n.captureSHA256) && Number.isSafeInteger(n.rowCount) && n.rowCount >= 0 && Number.isSafeInteger(n.AuthRows) && n.AuthRows >= 0 && n.AuthRows <= n.rowCount && typeof n.capturedAt === 'string' && instant(n.capturedAt));
    need(typeof dir === 'string' && isAbsolute(dir) && dir.length <= 4096 && !dir.includes('\0') && Array.isArray(childArgs) && childArgs.length >= 1 && childArgs.length <= 12 && childArgs.every(x => typeof x === 'string' && x.length > 0 && !x.includes('\0')) && Number.isInteger(timeout) && timeout >= 1 && timeout <= READONLY_CHILD_TIMEOUT_MS);
    return JSON.parse(JSON.stringify(input)) as ReadonlyRunnerOptions;
}

class SafeOuterFailure { constructor(readonly code: OuterFailureCode) {} }
function fail(code: OuterFailureCode): never { throw new SafeOuterFailure(code); }
function innerDiagnosticLine(stderr: unknown): string | undefined {
    if (typeof stderr !== 'string' || Buffer.byteLength(stderr) > 1024) return;
    const lines = stderr.split(/\r?\n/).filter(Boolean);
    if (lines.length !== 2 || lines[1] !== GENERIC_HOLD) return;
    const record = parseEvidenceDiagnosticLine(lines[0], 'inner');
    return record ? formatEvidenceDiagnostic(record) : undefined;
}
function validateResult(stdout: unknown, expected: NativeExpectation): Record<string, unknown> {
    if (typeof stdout !== 'string') fail('CHILD_OUTPUT_BOUND_OR_FORMAT');
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1 || Buffer.byteLength(lines[0]) > 4096 || !lines[0].startsWith(READONLY_RESULT_PREFIX)) fail('CHILD_OUTPUT_BOUND_OR_FORMAT');
    let value: unknown;
    try { value = JSON.parse(lines[0].slice(READONLY_RESULT_PREFIX.length)); } catch { fail('CHILD_OUTPUT_BOUND_OR_FORMAT'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...RESULT_KEYS].sort())) fail('RESULT_SCHEMA_DENIED');
    const v = value as Record<string, unknown>;
    if (v.status !== 'STAGING_CROSS_RUNTIME_EVIDENCE_MATCH') fail('RESULT_SCHEMA_DENIED');
    if (!v.context || typeof v.context !== 'object' || Array.isArray(v.context) || JSON.stringify(Object.keys(v.context).sort()) !== JSON.stringify(Object.keys(expected.context).sort()) || !Object.keys(expected.context).every(k => (v.context as Record<string, unknown>)[k] === expected.context[k as keyof EvidenceKeyContext])) fail('RESULT_CONTEXT_DENIED');
    if (v.captureSHA256 !== expected.captureSHA256) fail('RESULT_COMMITMENT_DENIED');
    if (v.tableCount !== 122 || v.rowCount !== expected.rowCount || v.AuthTableCount !== 27 || v.AuthRows !== expected.AuthRows || v.ledger !== 58 || v.actualCapabilityPOSTs !== 0 || v.actualCapturePOSTs !== 1 || v.retries !== 0 || v.W2Writes !== 0 || v.AuthIssuanceVerificationEmailAIYooKassaPDF !== 0) fail('RESULT_COUNTS_DENIED');
    if (typeof v.capturedAt !== 'string' || !instant(v.capturedAt) || Date.parse(v.capturedAt) < Date.parse(expected.capturedAt)) fail('RESULT_TIME_DENIED');
    return v;
}

/** Uses only the existing local manifest and bounded child process. It does not
 * itself fetch, read protected credentials, reserve budgets, or write journals.
 * The separately pinned child/pre-import retains the one-capture POST guard. */
export function runReadonlyEvidenceRunner(input: ReadonlyRunnerOptions): void {
    let stage: OuterStage = 'OUTER_INIT', inner: string | undefined;
    try {
        let options: ReadonlyRunnerOptions;
        try { options = validated(input); } catch { fail('MANIFEST_IO_OR_SCOPE_DENIED'); }
        const { directory: dir, manifest, nativeBinding, childArgs } = options;
        const path = dir + '/storage-inventory-v2.json', bytes = Buffer.from(JSON.stringify(manifest));
        try {
            try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error; }
            const stat = fs.lstatSync(dir);
            if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw Error();
            const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
            try {
                const file = fs.fstatSync(fd);
                if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o777) !== 0o600 || file.nlink !== 1) throw Error();
                let offset = 0;
                while (offset < bytes.length) { const written = fs.writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) throw Error(); offset += written; }
                fs.fsyncSync(fd);
            } finally { fs.closeSync(fd); }
            const parent = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try { const stat = fs.fstatSync(parent); if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700) throw Error(); fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
        } catch { fail('MANIFEST_IO_OR_SCOPE_DENIED'); }
        stage = 'MANIFEST_READY';
        let result: ReturnType<typeof spawnSync>;
        try { result = spawnSync(process.execPath, [...childArgs, path], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: options.timeoutMs ?? READONLY_CHILD_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 8192 }); }
        catch { fail('CHILD_SPAWN_ERROR'); }
        stage = 'CHILD_RETURNED'; inner = innerDiagnosticLine(result.stderr);
        if (result.signal || result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') fail('CHILD_TIMEOUT_OR_SIGNAL');
        if (result.error) fail('CHILD_SPAWN_ERROR');
        if (result.status !== 0) fail('CHILD_NONZERO');
        stage = 'CHILD_EXIT_ACCEPTED';
        if (result.stderr !== '') fail('CHILD_STDERR_PRESENT');
        const value = validateResult(result.stdout, nativeBinding);
        stage = 'RESULT_VALIDATED';
        console.log(READONLY_RESULT_PREFIX + JSON.stringify(value));
    } catch (error) {
        if (inner) console.error(inner);
        console.error(formatEvidenceDiagnostic(outerDiagnostic(stage, error instanceof SafeOuterFailure ? error.code : 'UNCLASSIFIED_SAFE_HOLD')));
        console.error(GENERIC_HOLD); process.exitCode = 1;
    }
}

/** Small loader source keeps the existing containing command's 8192-byte bound.
 * The containing command must preload tsx. Loading failures export fixed enums
 * only; raw module errors/paths never pass through this boundary. */
export function buildReadonlyEvidenceRunnerSource(input: ReadonlyRunnerOptions): string {
    const options = validated(input), payload = Buffer.from(JSON.stringify(options)).toString('base64');
    const line = formatEvidenceDiagnostic(outerDiagnostic('OUTER_INIT', 'UNCLASSIFIED_SAFE_HOLD'));
    return `try{require('./scripts/operator-w2/evidence-readonly-runner.ts').runReadonlyEvidenceRunner(JSON.parse(Buffer.from(${JSON.stringify(payload)},'base64').toString('utf8')))}catch{console.error(${JSON.stringify(line)});console.error(${JSON.stringify(GENERIC_HOLD)});process.exitCode=1}`;
}
